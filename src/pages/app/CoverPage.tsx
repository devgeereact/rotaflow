import { useCallback, useEffect, useState, type JSX } from 'react';
import { CalendarX2, LifeBuoy, TriangleAlert, UserCheck } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useWorkMode } from '@/hooks/useWorkMode';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { reportError } from '@/lib/sentry';
import {
  COVER_REASON_LABELS,
  coverStatusLabel,
  type CoverReason,
} from '@/lib/coverRules';
import type { SchedulingWarning } from '@/lib/schedulingRules';
import {
  applyForCover,
  assignCover,
  cancelCoverRequest,
  closeAbsence,
  COVER_FEATURE,
  createCoverRequest,
  decideApplication,
  getCandidates,
  getCoverMine,
  getCoverOpen,
  getCoverOverview,
  reportAbsence,
  type Candidate,
  type CoverMine,
  type CoverOpenShift,
  type CoverOverview,
  type CoverShift,
} from '@/services/coverService';

/**
 * `/app/cover` (R2, slice S12). Staff tell their manager they cannot work a shift and offer to
 * cover shifts a manager has opened for cover. Owners and managers get the cover board: who cannot
 * work, requests with their applicants, unfilled shifts in the next 72 hours, and ranked candidates
 * with the reason anyone cannot take the shift (on leave, unavailable, already working, documents).
 *
 * The API decides: approval re-checks eligibility under a lock, so a stale screen can never put
 * someone ineligible on a shift. Swaps are unchanged and stay on Shift Swaps.
 *
 * Behind the `cover_tools` feature flag, so the module ships dark.
 */
export function CoverPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { staffProfileId } = useWorkMode();
  const enabled = useFeatureAccess().has(COVER_FEATURE);
  const manages = role === 'owner' || role === 'manager';
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [board, setBoard] = useState<CoverOverview | null>(null);
  const [mine, setMine] = useState<CoverMine | null>(null);
  const [open, setOpen] = useState<CoverOpenShift[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [absenceFor, setAbsenceFor] = useState<CoverShift | null>(null);
  const [reason, setReason] = useState('');
  const [candidatesFor, setCandidatesFor] = useState<CoverShift | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!orgId || !enabled) return;
    let active = true;
    setFailed(false);
    void (async () => {
      try {
        const [b, m, o] = await Promise.all([
          manages ? getCoverOverview(orgId) : Promise.resolve(null),
          staffProfileId ? getCoverMine(orgId) : Promise.resolve(null),
          staffProfileId ? getCoverOpen(orgId) : Promise.resolve([]),
        ]);
        if (!active) return;
        setBoard(b);
        setMine(m);
        setOpen(o.filter((s) => s.cover_request !== null));
      } catch (err) {
        reportError(err, { area: 'cover:load' });
        if (active) setFailed(true);
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, enabled, manages, staffProfileId, reloadKey]);

  useEffect(() => {
    if (!candidatesFor) {
      setCandidates(null);
      return;
    }
    let active = true;
    void getCandidates(candidatesFor.id)
      .then((r) => {
        if (active) setCandidates(r.candidates);
      })
      .catch((err: unknown) => {
        reportError(err, { area: 'cover:candidates' });
        if (active) setCandidates([]);
      });
    return () => {
      active = false;
    };
  }, [candidatesFor]);

  /** Runs one write, says what happened, reloads. The API's sentence is the useful message on failure. */
  const act = useCallback(
    async (work: () => Promise<unknown>, done: string): Promise<boolean> => {
      setBusy(true);
      try {
        await work();
        showSuccess(done);
        reload();
        return true;
      } catch (err) {
        reportError(err, { area: 'cover:write' });
        showError(
          err instanceof Error && err.message ? err.message : 'That did not work.',
        );
        reload();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload, showError, showSuccess],
  );

  if (!enabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cover" />
        <Card>
          <EmptyState
            icon={LifeBuoy}
            title="Cover is not switched on"
            description="Your organisation does not have the cover tools yet."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cover"
        description={
          manages
            ? 'Who cannot work, the shifts that need someone, and who could take them.'
            : 'Tell your manager when you cannot work a shift, and offer to cover one.'
        }
      />
      {!loaded ? (
        <LoadingState label="Loading cover" />
      ) : failed ? (
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="Cover could not be loaded"
            description="Check your connection and try again."
            action={<Button onClick={reload}>Try again</Button>}
          />
        </Card>
      ) : (
        <>
          {board && (
            <ManagerBoard
              board={board}
              busy={busy}
              onFindCover={(shiftId, absenceId) =>
                void act(
                  () =>
                    createCoverRequest(
                      absenceId
                        ? { shift_id: shiftId, absence_id: absenceId }
                        : { shift_id: shiftId },
                    ),
                  'Cover request sent to the people who can take it.',
                )
              }
              onKeep={(absenceId) =>
                void act(
                  () => closeAbsence(absenceId, 'dismiss'),
                  'They stay on the shift and have been told.',
                )
              }
              onDecide={(id, action) =>
                void act(
                  () => decideApplication(id, action),
                  action === 'approve'
                    ? 'Approved. The shift is theirs.'
                    : 'Turned down.',
                )
              }
              onCloseRequest={(id) =>
                void act(
                  () => cancelCoverRequest(id),
                  'Request closed. The shift stays open.',
                )
              }
              onCandidates={setCandidatesFor}
            />
          )}
          {mine && (
            <StaffView
              mine={mine}
              open={open}
              busy={busy}
              onReport={(s) => {
                setReason('');
                setAbsenceFor(s);
              }}
              onWithdrawAbsence={(id) =>
                void act(
                  () => closeAbsence(id, 'withdraw'),
                  'Report withdrawn. You are still on the shift.',
                )
              }
              onApply={async (s) => {
                const ok = await confirm({
                  title: 'Offer to cover this shift?',
                  message: `${describe(s)}. Your manager decides; you will hear either way.`,
                  confirmLabel: 'Offer to cover',
                });
                if (ok)
                  void act(() => applyForCover(s.id), 'Offer sent to your manager.');
              }}
              onWithdrawApplication={(id) =>
                void act(() => decideApplication(id, 'withdraw'), 'Offer withdrawn.')
              }
            />
          )}
          {!board && !mine && (
            <Card>
              <EmptyState
                icon={LifeBuoy}
                title="Nothing here for you"
                description="Cover is for people on the rota. You have no staff record in this organisation."
              />
            </Card>
          )}
        </>
      )}

      <Modal
        open={absenceFor !== null}
        onClose={() => setAbsenceFor(null)}
        title="Cannot work this shift"
      >
        {absenceFor && (
          <div className="space-y-4">
            <p className="text-sm text-content dark:text-content-dark">
              {describe(absenceFor)}
            </p>
            <Field
              label="Reason"
              hint="Your manager sees this. At least 3 characters."
              required
            >
              <textarea
                className="w-full rounded-md border border-border bg-surface p-2 text-sm dark:border-border-dark dark:bg-surface-dark"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex gap-3">
              <Button
                className="flex-1"
                disabled={busy || reason.trim().length < 3}
                onClick={() => {
                  const shift = absenceFor;
                  void act(
                    () => reportAbsence(shift.id, reason.trim()),
                    'Your manager has been told.',
                  ).then((ok) => {
                    if (ok) setAbsenceFor(null);
                  });
                }}
              >
                Tell my manager
              </Button>
              <Button variant="secondary" onClick={() => setAbsenceFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={candidatesFor !== null}
        onClose={() => setCandidatesFor(null)}
        title="Who could take it"
      >
        {candidatesFor && (
          <div className="space-y-3">
            <p className="text-sm text-content dark:text-content-dark">
              {describe(candidatesFor)}
            </p>
            {candidates === null ? (
              <LoadingState label="Checking who can take it" />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Nobody to offer it to.
              </p>
            ) : (
              <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
                {candidates.map((c) => (
                  <li
                    key={c.staff_profile_id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 dark:border-border-dark"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-content dark:text-content-dark">
                        {c.name}
                        {c.application?.status === 'pending' && (
                          <Badge className="ml-2" tone="info">
                            Offered
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {c.hours_that_week}h already that week
                      </p>
                      <Reasons reasons={c.reasons} warnings={c.warnings} />
                    </div>
                    <Button
                      variant={c.eligible ? 'primary' : 'secondary'}
                      disabled={
                        busy || !c.eligible || candidatesFor.staff_profile_id !== null
                      }
                      title={
                        c.eligible
                          ? candidatesFor.staff_profile_id !== null
                            ? 'Open the shift for cover first'
                            : undefined
                          : c.reasons.map((r) => r.message).join('; ')
                      }
                      onClick={() => {
                        const shift = candidatesFor;
                        void act(
                          () => assignCover(shift.id, c.staff_profile_id),
                          `${c.name} is on the shift.`,
                        ).then((ok) => {
                          if (ok) setCandidatesFor(null);
                        });
                      }}
                    >
                      Assign
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function describe(s: CoverShift): string {
  const tz = s.timezone ?? undefined;
  const day = new Date(s.starts_at).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  });
  const t = (iso: string): string =>
    new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
  return `${s.location_name ? `${s.location_name}, ` : ''}${day} ${t(s.starts_at)}–${t(s.ends_at)}`;
}

function Reasons({
  reasons,
  warnings,
}: {
  reasons: CoverReason[];
  warnings: SchedulingWarning[];
}): JSX.Element | null {
  if (reasons.length === 0 && warnings.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {reasons.map((r) => (
        <li key={r.code}>
          <Badge tone="danger">
            {COVER_REASON_LABELS[r.code]}: {r.message}
          </Badge>
        </li>
      ))}
      {warnings.map((w) => (
        <li key={w.code}>
          <Badge tone="warning">{w.message}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-content dark:text-content-dark">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ManagerBoard({
  board,
  busy,
  onFindCover,
  onKeep,
  onDecide,
  onCloseRequest,
  onCandidates,
}: {
  board: CoverOverview;
  busy: boolean;
  onFindCover: (shiftId: string, absenceId?: string) => void;
  onKeep: (absenceId: string) => void;
  onDecide: (applicationId: string, action: 'approve' | 'reject') => void;
  onCloseRequest: (requestId: string) => void;
  onCandidates: (s: CoverShift) => void;
}): JSX.Element {
  const unrequested = board.unfilled.filter((u) => u.cover_request_id === null);
  const nothing =
    board.absences.length === 0 &&
    board.requests.length === 0 &&
    unrequested.length === 0;
  return (
    <div className="space-y-6">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        {board.counts.open_absences} cannot work · {board.counts.open_requests} looking
        for cover · {board.counts.pending_applications} offers waiting ·{' '}
        {board.counts.unfilled_72h} unfilled in the next 72 hours
      </p>
      {nothing && (
        <Card>
          <EmptyState
            icon={UserCheck}
            title="Nothing needs cover"
            description="Reports, requests and offers appear here."
          />
        </Card>
      )}
      {board.absences.length > 0 && (
        <Section title="Cannot work">
          {board.absences.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content dark:text-content-dark">
                  {a.name ?? 'Someone'} · {describe(a.shift)}
                </p>
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  {a.reason}
                </p>
              </div>
              <Button disabled={busy} onClick={() => onFindCover(a.shift_id, a.id)}>
                Find cover
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onKeep(a.id)}>
                Keep on shift
              </Button>
            </Card>
          ))}
        </Section>
      )}
      {board.requests.length > 0 && (
        <Section title="Looking for cover">
          {board.requests.map((r) => (
            <Card key={r.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-content dark:text-content-dark">
                    {describe(r.shift)}
                  </p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {r.absent_name ? `${r.absent_name} cannot work it · ` : ''}offered to{' '}
                    {r.offered_count}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onCandidates(r.shift)}
                >
                  Who could take it
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onCloseRequest(r.id)}
                >
                  Close request
                </Button>
              </div>
              {r.applicants.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  No offers yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {r.applicants.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-content dark:text-content-dark">
                          {a.name ?? 'Someone'}
                        </p>
                        <Reasons reasons={a.reasons} warnings={a.warnings} />
                      </div>
                      <Button
                        disabled={busy || !a.eligible}
                        title={
                          a.eligible
                            ? undefined
                            : a.reasons.map((x) => x.message).join('; ')
                        }
                        onClick={() => onDecide(a.id, 'approve')}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => onDecide(a.id, 'reject')}
                      >
                        Turn down
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </Section>
      )}
      {unrequested.length > 0 && (
        <Section title="Unfilled in the next 72 hours">
          {unrequested.map((u) => (
            <Card key={u.id} className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-content dark:text-content-dark">
                {describe(u)}
              </p>
              <Button variant="secondary" disabled={busy} onClick={() => onCandidates(u)}>
                Who could take it
              </Button>
              <Button disabled={busy} onClick={() => onFindCover(u.id)}>
                Ask for cover
              </Button>
            </Card>
          ))}
        </Section>
      )}
    </div>
  );
}

function StaffView({
  mine,
  open,
  busy,
  onReport,
  onWithdrawAbsence,
  onApply,
  onWithdrawApplication,
}: {
  mine: CoverMine;
  open: CoverOpenShift[];
  busy: boolean;
  onReport: (s: CoverShift) => void;
  onWithdrawAbsence: (absenceId: string) => void;
  onApply: (s: CoverOpenShift) => Promise<void>;
  onWithdrawApplication: (applicationId: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-6">
      <Section title="Shifts needing cover">
        {open.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Nobody is looking for cover right now.
          </p>
        ) : (
          open.map((s) => (
            <Card key={s.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content dark:text-content-dark">
                  {describe(s)}
                </p>
                {s.cover_request?.note && (
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {s.cover_request.note}
                  </p>
                )}
                <Reasons reasons={s.reasons ?? []} warnings={s.warnings ?? []} />
              </div>
              {s.application?.status === 'pending' ? (
                <>
                  <Badge tone="info">Offered</Badge>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onWithdrawApplication(s.application?.id ?? '')}
                  >
                    Withdraw
                  </Button>
                </>
              ) : (
                <Button
                  disabled={busy || s.eligible === false}
                  title={
                    s.eligible === false
                      ? (s.reasons ?? []).map((r) => r.message).join('; ')
                      : undefined
                  }
                  onClick={() => void onApply(s)}
                >
                  Offer to cover
                </Button>
              )}
            </Card>
          ))
        )}
      </Section>
      <Section title="My upcoming shifts">
        {mine.upcoming.length === 0 ? (
          <Card>
            <EmptyState
              icon={CalendarX2}
              title="No published shifts in the next four weeks"
              description=""
            />
          </Card>
        ) : (
          mine.upcoming.map((s) => (
            <Card key={s.id} className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-content dark:text-content-dark">
                {describe(s)}
              </p>
              {s.absence_id ? (
                <>
                  <Badge tone="warning">{coverStatusLabel('absence', 'open')}</Badge>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onWithdrawAbsence(s.absence_id ?? '')}
                  >
                    Withdraw
                  </Button>
                </>
              ) : (
                <Button variant="secondary" disabled={busy} onClick={() => onReport(s)}>
                  Cannot work it
                </Button>
              )}
            </Card>
          ))
        )}
      </Section>
      {(mine.applications.length > 0 || mine.absences.length > 0) && (
        <Section title="Recent">
          <Card>
            <ul className="space-y-1 text-sm text-content dark:text-content-dark">
              {mine.absences.map((a) => (
                <li key={a.id}>
                  Cannot work {a.shift ? describe(a.shift) : 'a shift'}:{' '}
                  {coverStatusLabel('absence', a.status)}
                </li>
              ))}
              {mine.applications.map((a) => (
                <li key={a.id}>
                  Offer to cover {a.shift ? describe(a.shift) : 'a shift'}:{' '}
                  {coverStatusLabel('application', a.status)}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
    </div>
  );
}
