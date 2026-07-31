import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, LogIn, LogOut, MapPin, MapPinOff, WifiOff } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile } from '@/services/staffService';
import { listLocations } from '@/services/locationService';
import { getLatestClockEvent, recordClockEvent } from '@/services/clockService';
import { checkGeofence } from '@/lib/geo';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import type { ClockEvent, ClockEventInsert, Location, StaffProfile } from '@/types';

/**
 * The `clock_events.type` column is `text` + a check constraint, not a
 * Postgres enum, so the generated `ClockEvent['type']` is plain `string` —
 * too wide to index the lookups below safely. This is the app's own narrower
 * view of that same constraint.
 */
type ClockEventType = 'in' | 'break_start' | 'break_end' | 'out';
type NextAction = ClockEventType;

function toClockEventType(value: string | undefined): ClockEventType | 'none' {
  return value === 'in' ||
    value === 'break_start' ||
    value === 'break_end' ||
    value === 'out'
    ? value
    : 'none';
}

const NEXT_ACTION: Record<ClockEventType | 'none', NextAction> = {
  none: 'in',
  in: 'break_start',
  break_start: 'break_end',
  break_end: 'out',
  out: 'in',
};

const ACTION_LABEL: Record<NextAction, string> = {
  in: 'Clock in',
  break_start: 'Start break',
  break_end: 'End break',
  out: 'Clock out',
};

const STATUS_LABEL: Record<ClockEventType | 'none', string> = {
  none: 'Not clocked in',
  in: 'Clocked in',
  break_start: 'On break',
  break_end: 'Clocked in',
  out: 'Clocked out',
};

/**
 * `/app/clock` — staff clock in/out. GPS + manual only; QR is deferred (it
 * needs a per-location code to scan, which nothing in the product generates
 * yet — building the scan side without the generation side would be a screen
 * with no way to actually use it).
 *
 * The offline path is the point of this screen existing in Phase 5: a failed
 * insert — network genuinely down, not a server rejection — queues via
 * useSyncQueue's 'clock' kind instead of failing the action outright. That
 * queue was built in Phase 4 with no consumer; this is its first one.
 */
export function ClockInPage(): JSX.Element {
  const { orgId } = useOrg();
  const { user } = useSupabaseAuth();
  const online = useOnlineStatus();
  const geo = useGeolocation();
  const { pending, enqueue, syncing } = useSyncQueue();
  const { showError, showSuccess } = useToast();

  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [latest, setLatest] = useState<ClockEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live updates: a manager correcting a clock event, or this person clocking
  // in on another device, should be reflected here rather than leaving two
  // screens disagreeing about whether they are on shift.
  useRealtimeRefresh({
    tables: ['clock_events'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    void (async () => {
      try {
        const [myProfile, locs] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          listLocations(orgId),
        ]);
        if (!active) return;
        setProfile(myProfile);
        setLocations(locs);
        setLocationId((current) => current ?? locs[0]?.id ?? null);

        if (myProfile) {
          const lastEvent = await getLatestClockEvent(myProfile.id);
          if (!active) return;
          setLatest(lastEvent);
        }
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'clock:load' });
        setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, reloadKey]);

  const currentStatus = toClockEventType(latest?.type);
  const nextAction = NEXT_ACTION[currentStatus];
  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId) ?? null,
    [locations, locationId],
  );

  const handleClock = useCallback(
    async (method: 'gps' | 'manual'): Promise<void> => {
      if (!orgId || !profile) return;
      setSubmitting(true);
      try {
        let position: { latitude: number; longitude: number; accuracy: number } | null =
          null;
        let geofenceNote: string | null = null;

        if (method === 'gps') {
          position = await geo.request();
          if (!position) {
            showError(
              geo.status === 'denied'
                ? 'Location access was denied. Use manual clock-in instead, or allow location access and try again.'
                : 'Could not get your location. Try manual clock-in instead.',
            );
            setSubmitting(false);
            return;
          }
          if (selectedLocation) {
            const check = checkGeofence(position, selectedLocation);
            if (!check.withinFence) {
              geofenceNote = `${Math.round(check.distanceM)}m from ${selectedLocation.name} (outside the ${selectedLocation.geofence_radius_m}m geofence)`;
            }
          }
        }

        const input: ClockEventInsert = {
          org_id: orgId,
          staff_profile_id: profile.id,
          type: nextAction,
          method,
          location_name: selectedLocation?.name ?? null,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          accuracy: position?.accuracy ?? null,
        };

        if (!online) {
          await enqueue('clock', input);
          // Reflects the action locally so the button/status updates
          // immediately — the row itself does not exist in Postgres until the
          // outbox flushes, so this is a client-only optimistic event, not
          // read back from the server.
          setLatest({
            id: `pending-${Date.now()}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            event_at: new Date().toISOString(),
            shift_id: null,
            synced: false,
            ...input,
          } as ClockEvent);
          showSuccess(
            `${ACTION_LABEL[nextAction]} saved offline — it will sync automatically when you're back online.`,
          );
          return;
        }

        const created = await recordClockEvent(input);
        setLatest(created);
        showSuccess(
          geofenceNote
            ? `${ACTION_LABEL[nextAction]} recorded — ${geofenceNote}.`
            : `${ACTION_LABEL[nextAction]} recorded.`,
        );
      } catch (err) {
        reportError(err, { area: 'clock:submit' });
        showError(
          `Could not ${ACTION_LABEL[nextAction].toLowerCase()}. Please try again.`,
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      orgId,
      profile,
      nextAction,
      online,
      selectedLocation,
      geo,
      enqueue,
      showError,
      showSuccess,
    ],
  );

  if (loading) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Could not load your clock-in status. Check your connection and reload.
        </p>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          You don&rsquo;t have a staff profile in this organisation, so there is nothing
          to clock in to. Ask your manager to add you to the staff directory.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
        Clock in
      </h1>
      <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
        {profile.first_name}, here&rsquo;s your status.
      </p>

      {!online && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <WifiOff size={16} aria-hidden="true" />
          You&rsquo;re offline. Clock actions are saved on this device and will sync
          automatically once you&rsquo;re back online.
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
          <Clock size={16} aria-hidden="true" />
          {syncing
            ? 'Syncing queued clock events…'
            : `${pending.length} clock event${pending.length === 1 ? '' : 's'} waiting to sync.`}
        </div>
      )}

      <Card className="mb-6 text-center">
        <span
          className={cn(
            'mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full',
            currentStatus === 'in' || currentStatus === 'break_end'
              ? 'bg-success/10 text-success'
              : currentStatus === 'break_start'
                ? 'bg-warning/10 text-warning'
                : 'bg-surface-border/40 text-content-muted dark:bg-surface-border-dark/40 dark:text-content-muted-dark',
          )}
        >
          <Clock size={28} aria-hidden="true" />
        </span>
        <p className="font-display text-xl font-semibold text-content dark:text-content-dark">
          {STATUS_LABEL[currentStatus]}
        </p>
        {latest && (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            since{' '}
            {new Date(latest.event_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </Card>

      {locations.length > 1 && (
        <div className="mb-4">
          <Select
            aria-label="Location"
            value={locationId ?? ''}
            onChange={(e) => setLocationId(e.target.value || null)}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          size="lg"
          onClick={() => void handleClock('gps')}
          disabled={submitting}
          className="w-full"
        >
          {nextAction === 'out' || nextAction === 'break_start' ? (
            <LogOut size={18} aria-hidden="true" className="mr-1.5" />
          ) : (
            <LogIn size={18} aria-hidden="true" className="mr-1.5" />
          )}
          {ACTION_LABEL[nextAction]} with GPS
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => void handleClock('manual')}
          disabled={submitting}
          className="w-full"
        >
          {ACTION_LABEL[nextAction]} manually
        </Button>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-content-muted dark:text-content-muted-dark">
        {geo.status === 'denied' ? (
          <>
            <MapPinOff size={12} aria-hidden="true" />
            Location access denied — GPS clock-in will ask again each time.
          </>
        ) : (
          <>
            <MapPin size={12} aria-hidden="true" />
            GPS is checked against your location&rsquo;s geofence when one is configured;
            it never blocks manual clock-in.
          </>
        )}
      </p>
    </div>
  );
}
