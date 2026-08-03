import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Plus, X } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import {
  cancelOvertimeRequest,
  createOvertimeRequest,
  listMyOvertimeRequests,
  listOrgOvertimeRequests,
  reviewOvertimeRequest,
} from '@/services/overtimeService';
import {
  buildOvertimeRows,
  summariseOvertime,
  type OvertimeRow,
  type OvertimeStatus,
} from '@/lib/overtimeRows';
import { todayIso } from '@/lib/schedulePeriod';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { OvertimeRequest, StaffProfile } from '@/types';

const STATUS_STYLE: Record<OvertimeStatus, string> = {
  pending: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  cancelled: 'bg-surface-border/60 text-content-muted dark:bg-surface-border-dark/60',
};

const STATUS_LABEL: Record<OvertimeStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Withdrawn',
};

/**
 * `/app/overtime` (NEW_STRUCTURE §14 and §34).
 *
 * `overtime_requests` has been in the schema since 0001 with no reader and no
 * writer — audit01 P2-7. Staff could not offer overtime and managers could not
 * allocate it.
 *
 * Two views on one route, the same shape Availability uses: a staff member
 * sees and raises their own; a manager toggles to the whole organisation and
 * approves. Splitting them into two routes would mean a manager who is also on
 * the rota — the normal case in a small care home — has two places to look.
 */
export function OvertimePage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [teamMode, setTeamMode] = useState(false);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [requests, setRequests] = useState<OvertimeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [date, setDate] = useState(todayIso);
  const [hours, setHours] = useState('1');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useRealtimeRefresh({
    tables: ['overtime_requests'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [mine, staffRows] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          listActiveStaff(orgId),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);

        const rows = teamMode
          ? await listOrgOvertimeRequests(orgId)
          : mine
            ? await listMyOvertimeRequests(mine.id)
            : [];
        if (!active) return;
        setRequests(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'overtime:load' });
        setLoadFailed(true);
        showError('Could not load overtime requests.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, teamMode, reloadKey, showError]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const rows = useMemo(
    () =>
      buildOvertimeRows({
        requests,
        staffById,
        currentUserId: user?.id ?? null,
      }),
    [requests, staffById, user],
  );

  const summary = useMemo(() => summariseOvertime(rows), [rows]);

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!orgId || !myProfile) return;
    const parsed = Number(hours);
    // Validated here as well as by the input's own min/max: a paste can put
    // anything in a number field, and an overtime row is a payroll figure.
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showError('Enter how many hours you worked — more than zero.');
      return;
    }
    if (parsed > 24) {
      showError('That is more than a day. Raise one request per day worked.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createOvertimeRequest({
        org_id: orgId,
        staff_profile_id: myProfile.id,
        date,
        hours: parsed,
        note: note.trim() || null,
        status: 'pending',
      });
      setRequests((prev) => [created, ...prev]);
      setNote('');
      showSuccess('Overtime submitted. Your manager will review it.');
    } catch (err) {
      reportError(err, { area: 'overtime:create' });
      showError('Could not submit that request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [orgId, myProfile, date, hours, note, showError, showSuccess]);

  const handleReview = useCallback(
    async (row: OvertimeRow, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user) return;
      setBusyId(row.id);
      try {
        const updated = await reviewOvertimeRequest(row.id, status, user.id);
        setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showSuccess(
          status === 'approved'
            ? `Approved ${row.hoursLabel} for ${row.staffName}.`
            : `Declined ${row.staffName}'s overtime.`,
        );
      } catch (err) {
        reportError(err, { area: 'overtime:review' });
        showError('Could not record that decision. Please try again.');
      } finally {
        setBusyId(null);
      }
    },
    [user, showError, showSuccess],
  );

  const handleCancel = useCallback(
    async (row: OvertimeRow): Promise<void> => {
      const ok = await confirm({
        title: 'Withdraw this overtime request?',
        message: `${row.hoursLabel} on ${row.dateLabel} will no longer be sent for approval. You can submit it again if you change your mind.`,
        confirmLabel: 'Withdraw',
        tone: 'danger',
      });
      if (!ok) return;
      setBusyId(row.id);
      try {
        await cancelOvertimeRequest(row.id);
        setRequests((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: 'cancelled' } : r)),
        );
        showSuccess('Request withdrawn.');
      } catch (err) {
        reportError(err, { area: 'overtime:cancel' });
        showError('Could not withdraw that request.');
      } finally {
        setBusyId(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  return (
    <div className="max-w-[1600px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            Overtime
          </h1>
          <p className="text-content-muted dark:text-content-muted-dark">
            {teamMode
              ? 'Review and approve overtime across your organisation.'
              : 'Hours you have worked beyond your contracted time.'}
          </p>
        </div>

        {canApprove && (
          <div
            className="inline-flex rounded-lg border border-surface-border p-0.5 dark:border-surface-border-dark"
            role="group"
            aria-label="Overtime view"
          >
            <button
              type="button"
              onClick={() => setTeamMode(false)}
              aria-pressed={!teamMode}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                !teamMode
                  ? 'bg-primary/10 text-primary'
                  : 'text-content-muted dark:text-content-muted-dark',
              )}
            >
              My overtime
            </button>
            <button
              type="button"
              onClick={() => setTeamMode(true)}
              aria-pressed={teamMode}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                teamMode
                  ? 'bg-primary/10 text-primary'
                  : 'text-content-muted dark:text-content-muted-dark',
              )}
            >
              Team
            </button>
          </div>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Awaiting approval"
          value={String(summary.pending)}
          hint={`${summary.pendingHoursLabel} pending`}
        />
        <MetricCard
          label="Approved hours"
          value={summary.approvedHoursLabel}
          hint={teamMode ? 'Across the organisation' : 'Your approved overtime'}
        />
        <MetricCard
          label="Requests shown"
          value={String(rows.length)}
          hint={teamMode ? 'Whole organisation' : 'Yours only'}
        />
      </div>

      {!teamMode && (
        <Card className="mb-6 p-5">
          <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
            Submit overtime
          </h2>
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            Log hours worked beyond your contract. Your manager approves before they reach
            payroll.
          </p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)_1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="overtime-date">Date worked</Label>
              <Input
                id="overtime-date"
                type="date"
                value={date}
                max={todayIso()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="overtime-hours">Hours</Label>
              <Input
                id="overtime-hours"
                type="number"
                min="0.25"
                max="24"
                step="0.25"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="overtime-note">Note (optional)</Label>
              <Input
                id="overtime-note"
                value={note}
                placeholder="e.g. covered a late finish on Ward 2"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button
              onClick={() => void handleCreate()}
              disabled={submitting || !myProfile}
              title={
                myProfile
                  ? undefined
                  : 'You need a staff record in this organisation to log overtime'
              }
            >
              <Plus size={15} aria-hidden="true" />
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 font-semibold text-content dark:text-content-dark">
          {teamMode ? 'All requests' : 'Your requests'}
        </h2>

        {loading ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : loadFailed ? (
          <div>
            <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
              Something went wrong loading overtime.
            </p>
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            <Clock
              size={28}
              aria-hidden="true"
              className="mx-auto mb-3 text-content-muted dark:text-content-muted-dark"
            />
            <p className="font-medium text-content dark:text-content-dark">
              {teamMode ? 'No overtime requests' : 'You have not logged any overtime'}
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {teamMode
                ? 'Requests your team submits will appear here for approval.'
                : 'Use the form above to log hours worked beyond your contract.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                {teamMode && (
                  <StaffAvatar
                    firstName={row.staffName.split(' ')[0] ?? ''}
                    lastName={row.staffName.split(' ').slice(1).join(' ')}
                    photoUrl={row.photoUrl}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                    {teamMode ? row.staffName : row.dateLabel}
                    {teamMode && (
                      <span className="ml-2 font-normal text-content-muted dark:text-content-muted-dark">
                        {row.dateLabel}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                    {row.hoursLabel}
                    {row.note ? ` · ${row.note}` : ''}
                    {teamMode && row.jobTitle ? ` · ${row.jobTitle}` : ''}
                  </p>
                </div>

                <div className="text-right">
                  <span
                    className={cn(
                      'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium',
                      STATUS_STYLE[row.status],
                    )}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                  {row.statusNote && (
                    <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
                      {row.statusNote}
                    </p>
                  )}
                </div>

                {/* Managers decide; the person who raised it may withdraw while
                    it is still pending. Both disappear once it is settled. */}
                {row.status === 'pending' && teamMode && canApprove && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={busyId === row.id}
                      onClick={() => void handleReview(row, 'approved')}
                    >
                      <Check size={14} aria-hidden="true" />
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busyId === row.id}
                      onClick={() => void handleReview(row, 'rejected')}
                    >
                      <X size={14} aria-hidden="true" />
                      Decline
                    </Button>
                  </div>
                )}
                {row.status === 'pending' && !teamMode && (
                  <Button
                    variant="secondary"
                    disabled={busyId === row.id}
                    onClick={() => void handleCancel(row)}
                  >
                    Withdraw
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}): JSX.Element {
  return (
    <Card className="p-5">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-content dark:text-content-dark">
        {value}
      </p>
      <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
        {hint}
      </p>
    </Card>
  );
}
