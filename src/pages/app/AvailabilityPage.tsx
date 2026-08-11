import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import {
  createAvailability,
  deleteAvailability,
  listMyAvailability,
  listOrgAvailability,
} from '@/services/availabilityService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { teamWorkspaceTabs } from '@/lib/workspaceTabs';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import type { Availability, StaffProfile } from '@/types';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * `availability.status` is `text` + a check constraint, not a Postgres enum,
 * so the generated `Availability['status']` is plain `string`, a cast to it
 * is a same-type no-op ESLint correctly flags. This is the app's own
 * narrower view of that same constraint (see ClockInPage.tsx for the same
 * pattern on `clock_events.type`).
 */
type AvailabilityStatus = 'available' | 'preferred' | 'unavailable';

const STATUS_STYLE: Record<AvailabilityStatus, string> = {
  available: 'bg-success/10 text-success',
  preferred: 'bg-primary/10 text-primary',
  unavailable: 'bg-danger/10 text-danger',
};

function toAvailabilityStatus(value: string): AvailabilityStatus {
  return value === 'preferred' || value === 'unavailable' ? value : 'available';
}

/**
 * `/app/availability`. Recurring weekly pattern only (a specific one-off
 * date is also representable in the schema via `date`, but a manager building
 * next week's rota mainly needs the standing pattern; one-off exceptions are
 * closer to a leave request, which has its own screen).
 */
export function AvailabilityPage(): JSX.Element {
  const { orgId, role: membershipRole } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [teamMode, setTeamMode] = useState(false);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [entries, setEntries] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['availability', 'staff_profiles'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  const [weekday, setWeekday] = useState('1');
  const [status, setStatus] = useState<AvailabilityStatus>('available');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [mine, staffRows] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          teamMode ? listActiveStaff(orgId) : Promise.resolve<StaffProfile[]>([]),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);

        const rows = teamMode
          ? await listOrgAvailability(orgId)
          : mine
            ? await listMyAvailability(mine.id)
            : [];
        if (!active) return;
        setEntries(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'availability:load' });
        setLoadFailed(true);
        showError('Could not load availability.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, teamMode, reloadKey, showError]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const entriesByStaff = useMemo(() => {
    const grouped = new Map<string, Availability[]>();
    for (const entry of entries) {
      grouped.set(entry.staff_profile_id, [
        ...(grouped.get(entry.staff_profile_id) ?? []),
        entry,
      ]);
    }
    return grouped;
  }, [entries]);

  const handleAdd = useCallback(async (): Promise<void> => {
    if (!orgId || !myProfile) return;
    if (status !== 'unavailable' && endTime <= startTime) {
      showError('End time must be after start time.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createAvailability({
        org_id: orgId,
        staff_profile_id: myProfile.id,
        weekday: Number(weekday),
        status,
        recurring: true,
        start_time: status === 'unavailable' ? null : startTime,
        end_time: status === 'unavailable' ? null : endTime,
      });
      setEntries((prev) => [...prev, created]);
      showSuccess('Availability added.');
    } catch (err) {
      reportError(err, { area: 'availability:create' });
      showError('Could not add that entry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [orgId, myProfile, weekday, status, startTime, endTime, showError, showSuccess]);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        await deleteAvailability(id);
        setEntries((prev) => prev.filter((e) => e.id !== id));
      } catch (err) {
        reportError(err, { area: 'availability:delete' });
        showError('Could not remove that entry.');
      }
    },
    [showError],
  );

  const renderEntry = (entry: Availability, showDelete: boolean): JSX.Element => (
    <li
      key={entry.id}
      className="flex items-center justify-between gap-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
    >
      <div>
        <p className="text-sm font-medium text-content dark:text-content-dark">
          {entry.weekday !== null ? WEEKDAYS[entry.weekday] : entry.date}
        </p>
        {entry.start_time && entry.end_time && (
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            {entry.start_time.slice(0, 5)}, {entry.end_time.slice(0, 5)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
            STATUS_STYLE[toAvailabilityStatus(entry.status)],
          )}
        >
          {entry.status}
        </span>
        {showDelete && (
          <button
            type="button"
            onClick={() => void handleDelete(entry.id)}
            aria-label="Remove this availability entry"
            className="rounded p-1 text-content-muted hover:text-danger dark:text-content-muted-dark"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load availability.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div>
      <WorkspaceHeader
        title="Team"
        subtitle={
          teamMode
            ? 'Who can work when, across the team. Managers schedule around this; it does not block a rota being built.'
            : 'Your standing weekly pattern. Managers schedule around it, it doesn’t block a rota being built.'
        }
        tabs={teamWorkspaceTabs(membershipRole)}
        actions={
          canApprove ? (
            <div className="flex gap-1" role="group" aria-label="Scope">
              <button
                type="button"
                onClick={() => setTeamMode(false)}
                aria-pressed={!teamMode}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium',
                  !teamMode
                    ? 'bg-surface text-primary dark:bg-surface-dark'
                    : 'text-content-muted dark:text-content-muted-dark',
                )}
              >
                My availability
              </button>
              <button
                type="button"
                onClick={() => setTeamMode(true)}
                aria-pressed={teamMode}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium',
                  teamMode
                    ? 'bg-surface text-primary dark:bg-surface-dark'
                    : 'text-content-muted dark:text-content-muted-dark',
                )}
              >
                Team
              </button>
            </div>
          ) : undefined
        }
      />

      {!teamMode && (
        <Card className="mb-6">
          <h2 className="mb-4 font-medium text-content dark:text-content-dark">
            Add a weekly entry
          </h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="avail-weekday">Day</Label>
              <Select
                id="avail-weekday"
                value={weekday}
                onChange={(e) => setWeekday(e.target.value)}
              >
                {WEEKDAYS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="avail-status">Status</Label>
              <Select
                id="avail-status"
                value={status}
                onChange={(e) => setStatus(toAvailabilityStatus(e.target.value))}
              >
                <option value="available">Available</option>
                <option value="preferred">Preferred</option>
                <option value="unavailable">Unavailable</option>
              </Select>
            </div>
            {status !== 'unavailable' && (
              <>
                <div>
                  <Label htmlFor="avail-start">From</Label>
                  <Input
                    id="avail-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="avail-end">Until</Label>
                  <Input
                    id="avail-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <Button
            size="sm"
            className="mt-4"
            onClick={() => void handleAdd()}
            disabled={submitting}
          >
            <Plus size={14} aria-hidden="true" className="mr-1.5" />
            {submitting ? 'Adding…' : 'Add entry'}
          </Button>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : teamMode ? (
        entriesByStaff.size === 0 ? (
          <Card>
            <p className="text-content-muted dark:text-content-muted-dark">
              No availability submitted yet.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {[...entriesByStaff.entries()].map(([staffId, staffEntries]) => {
              const person = staffById.get(staffId);
              return (
                <Card key={staffId}>
                  <h3 className="mb-3 font-medium text-content dark:text-content-dark">
                    {person
                      ? `${person.first_name} ${person.last_name}`
                      : 'Unknown staff'}
                  </h3>
                  <ul className="space-y-2">
                    {staffEntries.map((entry) => renderEntry(entry, false))}
                  </ul>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        <Card>
          {entries.length === 0 ? (
            <p className="text-content-muted dark:text-content-muted-dark">
              You haven&rsquo;t added any availability yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => renderEntry(entry, true))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
