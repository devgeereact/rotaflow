import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Clock3, MapPin, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { useWorkMode } from '@/hooks/useWorkMode';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  claimOpenShift,
  listOpenShifts,
  type OpenShift,
} from '@/services/openShiftService';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';

/**
 * `/app/open-shifts` — uncovered shifts anybody can take (CAP-010).
 *
 * ## Why this screen had to exist
 *
 * `shifts.status` has accepted `'open'` since `0002` and the rota builder
 * creates open shifts. Nothing has ever shown one to a staff member. So the
 * state meant "a manager knows this is uncovered" and nothing more: the
 * person who could cover it never learned it existed, and the manager rang
 * round instead. This is the cheapest cover the product can offer — the shift
 * is published, the person is already working that week.
 *
 * ## Claiming is immediate, not a request
 *
 * A manager put the shift up. Asking them to approve the answer to their own
 * question adds a day to a gap that is usually days away, and the common case
 * — an unfilled Saturday — has nobody to protect. The write is audited
 * (`shift.claimed`) so it is visible without being blocking.
 *
 * ## A clash is shown, not hidden
 *
 * A shift overlapping something the reader already works is listed and
 * labelled rather than filtered out. Filtering would leave somebody staring
 * at a board that says "no open shifts" while a colleague sees four, with no
 * way to tell why. The database refuses the claim regardless.
 *
 * ## A reader with no staff profile sees cover, not a claim
 *
 * An owner is an authorisation fact and need not work shifts
 * (`src/lib/workMode.ts`). Until this change the rail showed them Open Shifts
 * unconditionally and the board offered them "Take it" — a control that could
 * only ever fail, because `claim_open_shift` writes a `staff_profile_id` and
 * they have none. That is the exact shape `src/lib/unavailableControls.test.ts`
 * exists to stop: a primary action that is a promise the product cannot keep.
 *
 * So the board is read two ways. Somebody who can work shifts claims one.
 * Somebody who cannot is looking at a coverage problem rather than an
 * opportunity, and gets the count, the reason the control is unavailable, and
 * a link to the builder, which is where an owner actually fixes it.
 */
export function OpenShiftsPage(): JSX.Element {
  const { orgId } = useOrg();
  const navigate = useNavigate();
  // `staffProfileId` is null for a manager or owner with no staff record in
  // the active organisation. It is the same fact the work-mode switch is
  // gated on, read from the same place, so the rail and this screen cannot
  // disagree about whether personal controls apply.
  const { staffProfileId } = useWorkMode();
  const canClaim = staffProfileId !== null;
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [shifts, setShifts] = useState<OpenShift[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Somebody else taking a shift is the event this screen most needs to hear
  // about: the board is a queue several people read at once.
  useRealtimeRefresh({
    tables: ['shifts'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setFailed(false);
    void (async () => {
      try {
        const found = await listOpenShifts(orgId);
        if (active) setShifts(found);
      } catch (err) {
        reportError(err, { area: 'open-shifts:list' });
        if (active) {
          setShifts([]);
          setFailed(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const handleClaim = useCallback(
    async (shift: OpenShift): Promise<void> => {
      const when = new Date(shift.startsAt).toLocaleString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });

      const ok = await confirm({
        title: 'Take this shift?',
        message: `You will be rostered for ${when}. Your manager will see it on the rota.`,
        confirmLabel: 'Take it',
      });
      if (!ok) return;

      setClaiming(shift.shiftId);
      try {
        await claimOpenShift(shift.shiftId);
        setReloadKey((k) => k + 1);
        showSuccess('That shift is yours. It is on your schedule now.');
      } catch (err) {
        reportError(err, { area: 'open-shifts:claim' });
        // The message the database raised is the useful one here — "somebody
        // else has just taken that shift" and "you are already working at
        // that time" both tell the reader something they can act on, which a
        // generic failure notice would throw away.
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String(err.message)
            : 'That shift could not be taken.';
        showError(message);
        setReloadKey((k) => k + 1);
      } finally {
        setClaiming(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Open shifts"
        description={
          canClaim
            ? 'Shifts nobody is covering yet. Taking one puts it straight on your schedule.'
            : 'Shifts nobody is covering yet. Assign somebody in the rota builder, or wait for a member of staff to take one.'
        }
        actions={
          canClaim ? undefined : (
            <Button
              variant="secondary"
              onClick={() => {
                void navigate('/app/rota');
              }}
            >
              Open the rota builder
            </Button>
          )
        }
      />

      {shifts === null ? (
        <LoadingState label="Loading open shifts" />
      ) : failed ? (
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="Open shifts could not be loaded"
            description="Check your connection and try again."
            action={<Button onClick={() => setReloadKey((k) => k + 1)}>Try again</Button>}
          />
        </Card>
      ) : shifts.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarPlus}
            title="Nothing needs covering"
            description="Every published shift has somebody on it. Anything left open will appear here."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {shifts.map((shift) => {
            const start = new Date(shift.startsAt);
            const end = new Date(shift.endsAt);
            return (
              <li key={shift.shiftId}>
                <Card className="flex flex-wrap items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-content dark:text-content-dark">
                      {shift.shiftType ?? 'Shift'} ·{' '}
                      {start.toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-content-muted dark:text-content-muted-dark">
                      <span className="flex items-center gap-1.5">
                        <Clock3 size={14} aria-hidden="true" />
                        {start.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        –
                        {end.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {shift.breakMinutes > 0 && ` · ${shift.breakMinutes} min break`}
                      </span>
                      {shift.locationName && (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={14} aria-hidden="true" />
                          {shift.locationName}
                        </span>
                      )}
                    </p>
                    {shift.notes && (
                      <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                        {shift.notes}
                      </p>
                    )}
                  </div>

                  {!canClaim ? (
                    /* Not a disabled "Take it". The reader has no staff
                       profile, so claiming is not a thing they could do on a
                       better day — it does not apply to them at all, and a
                       greyed-out primary action would read as "not yet"
                       rather than "not you". The uncovered shift is the
                       information; the builder is the action. */
                    <Badge tone="warning">Needs cover</Badge>
                  ) : shift.clashesWithMine ? (
                    <>
                      <Badge tone="warning">Clashes with your rota</Badge>
                      {/* The reason is on the control, not only in the badge
                          beside it. A disabled button is not focusable, so a
                          keyboard user never lands on it to ask why, and a
                          pointer user hovering the thing they cannot press
                          got nothing. Every other unavailable control in this
                          product states its reason this way — see the five in
                          the platform console. */}
                      <Button
                        variant="secondary"
                        disabled
                        title="This shift overlaps one you are already rostered for"
                      >
                        Take it
                      </Button>
                    </>
                  ) : (
                    <Button
                      disabled={claiming !== null}
                      onClick={() => void handleClaim(shift)}
                    >
                      {claiming === shift.shiftId ? 'Taking…' : 'Take it'}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
