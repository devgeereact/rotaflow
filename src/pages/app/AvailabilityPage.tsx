import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
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
import {
  buildExceptions,
  buildWeeklyPattern,
  resolveTeamAvailabilityForDate,
  type WeeklyPatternDay,
} from '@/lib/availabilityRows';
import { todayIso } from '@/lib/schedulePeriod';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { AvailabilityView } from '@/components/availability/AvailabilityView';
import type { AddExceptionInput } from '@/components/availability/AddExceptionModal';
import type { Availability, StaffProfile } from '@/types';

/**
 * `/app/availability`. Real data wiring; see AvailabilityView for the markup
 * (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.availability`).
 *
 * One screen for everyone rather than a role split: a manager gets the same
 * "your pattern" + "exceptions" cards as anyone else, plus a "Team
 * availability" card. No workspace tab bar to Team/StaffPage.tsx any more —
 * dropped deliberately, matching the reference's own nav (its own sidebar
 * row, no shared tab strip), unlike `teamWorkspaceTabs`'s other half, which
 * still links from Team's own page.
 */
export function AvailabilityPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();
  const isManager = canApprove;

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [myEntries, setMyEntries] = useState<Availability[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [orgEntries, setOrgEntries] = useState<Availability[]>([]);
  const [togglingWeekday, setTogglingWeekday] = useState<number | null>(null);
  const [removingExceptionId, setRemovingExceptionId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId || !user) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const me = await getMyStaffProfile(orgId, user.id);
      setMyProfile(me);
      const [mine, staffRows, org] = await Promise.all([
        me ? listMyAvailability(me.id) : Promise.resolve<Availability[]>([]),
        isManager ? listActiveStaff(orgId) : Promise.resolve<StaffProfile[]>([]),
        isManager ? listOrgAvailability(orgId) : Promise.resolve<Availability[]>([]),
      ]);
      setMyEntries(mine);
      setStaff(staffRows);
      setOrgEntries(org);
    } catch (err) {
      reportError(err, { area: 'availability:load' });
      setLoadFailed(true);
      showError('Could not load availability.');
    } finally {
      setLoading(false);
    }
  }, [orgId, user, isManager, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    tables: ['availability', 'staff_profiles'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const weekPattern = useMemo(() => buildWeeklyPattern(myEntries), [myEntries]);
  const exceptions = useMemo(() => buildExceptions(myEntries), [myEntries]);

  const team = useMemo(() => {
    if (!isManager) return null;
    const today = todayIso();
    const weekday = new Date(`${today}T00:00:00`).getDay();
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const rows = resolveTeamAvailabilityForDate(
      staff.map((s) => s.id),
      orgEntries,
      today,
      weekday,
    );
    return {
      todayLabel: format(new Date(`${today}T00:00:00`), 'EEEE'),
      rows: rows.map((row) => {
        const person = staffById.get(row.staffId);
        return {
          staffId: row.staffId,
          firstName: person?.first_name ?? 'Unknown',
          lastName: person?.last_name ?? '',
          photoUrl: person?.photo_url ?? null,
          available: row.available,
        };
      }),
    };
  }, [isManager, staff, orgEntries]);

  const handleToggleDay = useCallback(
    async (day: WeeklyPatternDay): Promise<void> => {
      if (!orgId || !myProfile) return;
      setTogglingWeekday(day.weekday);
      try {
        if (day.available) {
          // Going to unavailable: clear any partial-availability entry
          // first, then write the explicit unavailable one.
          if (day.entryId) await deleteAvailability(day.entryId);
          await createAvailability({
            org_id: orgId,
            staff_profile_id: myProfile.id,
            weekday: day.weekday,
            status: 'unavailable',
            recurring: true,
            start_time: null,
            end_time: null,
          });
        } else if (day.entryId) {
          // Reverts to the "available all day" default: no entry at all.
          await deleteAvailability(day.entryId);
        }
        showSuccess(
          `${day.label} set to ${day.available ? 'unavailable' : 'available'}.`,
        );
        await load();
      } catch (err) {
        reportError(err, { area: 'availability:toggle-day' });
        showError('Could not change that day. Please try again.');
      } finally {
        setTogglingWeekday(null);
      }
    },
    [orgId, myProfile, showSuccess, showError, load],
  );

  const handleAddException = useCallback(
    async (input: AddExceptionInput): Promise<void> => {
      if (!orgId || !myProfile) return;
      try {
        await createAvailability({
          org_id: orgId,
          staff_profile_id: myProfile.id,
          weekday: null,
          date: input.date,
          recurring: false,
          status: input.availability === 'unavailable' ? 'unavailable' : 'available',
          start_time: input.availability === 'available_from_midday' ? '12:00' : null,
          end_time: null,
        });
        showSuccess(
          `Exception saved for ${format(new Date(`${input.date}T00:00:00`), 'd MMM yyyy')}.`,
        );
        await load();
      } catch (err) {
        reportError(err, { area: 'availability:add-exception' });
        showError('Could not save that exception. Please try again.');
      }
    },
    [orgId, myProfile, showSuccess, showError, load],
  );

  const handleRemoveException = useCallback(
    (id: string): void => {
      setRemovingExceptionId(id);
      void deleteAvailability(id)
        .then(() => {
          showSuccess('Exception removed.');
          return load();
        })
        .catch((err) => {
          reportError(err, { area: 'availability:remove-exception' });
          showError('Could not remove that exception.');
        })
        .finally(() => setRemovingExceptionId(null));
    },
    [showSuccess, showError, load],
  );

  if (loading) {
    return <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>;
  }

  if (loadFailed) {
    return (
      <Card className="max-w-sm">
        <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
          Could not load availability.
        </p>
        <Button onClick={() => void load()}>Retry</Button>
      </Card>
    );
  }

  if (!myProfile) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          You don&rsquo;t have a staff profile in this organisation, so there is no
          pattern to set. Ask your manager to add you to the staff directory.
        </p>
      </Card>
    );
  }

  return (
    <AvailabilityView
      weekPattern={weekPattern}
      onToggleDay={(day) => void handleToggleDay(day)}
      togglingWeekday={togglingWeekday}
      exceptions={exceptions}
      onAddException={handleAddException}
      removingExceptionId={removingExceptionId}
      onRemoveException={handleRemoveException}
      team={team}
    />
  );
}
