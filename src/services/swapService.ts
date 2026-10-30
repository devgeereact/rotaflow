import { activeOrgPath, api, ApiError, orgPath, seg } from '@/lib/api';
import type { Shift, ShiftSwap, ShiftSwapInsert } from '@/types';

export interface ShiftSwapWithShift extends ShiftSwap {
  shift: Shift | null;
}

/**
 * The insert path predates its screen (Phase 4). UseSyncQueue needed a real
 * target to replay a queued 'swap' item against. This phase adds the reads
 * and respond/approve actions, plus 0008_shift_swaps_target_respond.sql,
 * which grants the write access the target colleague was missing.
 */
type ApiSwap = ShiftSwap & {
  shift_starts_at?: string;
  shift_ends_at?: string;
  shift_location_id?: string | null;
  shift_staff_profile_id?: string | null;
};

/** The list carries the shift's times, site and holder; enough of the shift for every swap screen. */
function withShift(r: ApiSwap): ShiftSwapWithShift {
  const {
    shift_starts_at,
    shift_ends_at,
    shift_location_id,
    shift_staff_profile_id,
    ...swap
  } = r;
  const shift =
    shift_starts_at && shift_ends_at
      ? ({
          id: swap.shift_id,
          org_id: swap.org_id,
          starts_at: shift_starts_at,
          ends_at: shift_ends_at,
          location_id: shift_location_id ?? null,
          staff_profile_id: shift_staff_profile_id ?? null,
        } as Shift)
      : null;
  return { ...swap, shift };
}

async function readSwaps(path: string): Promise<ShiftSwapWithShift[]> {
  const r = await api.get<{ swaps: ApiSwap[] }>(path);
  return r.swaps.map(withShift);
}

export async function requestShiftSwap(input: ShiftSwapInsert): Promise<ShiftSwap> {
  const r = await api.post<{ swap: ApiSwap }>(orgPath(input.org_id, '/swaps'), {
    shift_id: input.shift_id,
    requested_by: input.requested_by,
    target_staff_profile_id: input.target_staff_profile_id ?? null,
    note: input.note ?? null,
    client_event_id: input.client_event_id ?? null,
  });
  return withShift(r.swap);
}

/** Swaps involving one person, as requester or target, newest first. */
export async function listMyShiftSwaps(
  staffProfileId: string,
): Promise<ShiftSwapWithShift[]> {
  return (await readSwaps(activeOrgPath('/swaps'))).filter(
    (w) =>
      w.requested_by === staffProfileId || w.target_staff_profile_id === staffProfileId,
  );
}

/** Every swap across the org. Manager approval queue. */
export async function listOrgShiftSwaps(orgId: string): Promise<ShiftSwapWithShift[]> {
  return readSwaps(orgPath(orgId, '/swaps'));
}

/**
 * Count only, for the sidebar's Shift Swaps badge. `head: true` skips the
 * shift join and row payload, this runs on every `/app/*` page load.
 * `accepted` counts too: the target has agreed, but a named-colleague swap
 * still needs the requester's own final say (`reviewShiftSwap`, 0043) and
 * an open one still needs a manager, so it is still a swap someone needs
 * to act on.
 */
export async function countSwapsNeedingAttention(orgId: string): Promise<number> {
  const r = await api.get<{ swaps_pending: number }>(orgPath(orgId, '/attention'));
  return r.swaps_pending;
}

/**
 * The target colleague accepting or declining. Permitted by
 * `shift_swaps_target_respond` (0008), which only allows a still-pending
 * row to move to 'accepted' or 'rejected'. Accepting still isn't final —
 * the requester (or a manager) has to finalize it next; this alone does
 * not change the rota.
 */
export async function respondToShiftSwap(
  id: string,
  status: 'accepted' | 'rejected',
): Promise<ShiftSwap> {
  const r = await api.post<{ swap: ApiSwap }>(
    activeOrgPath(`/swaps/${seg(id)}/respond`),
    { status },
  );
  return withShift(r.swap);
}

/**
 * Final approve/reject. Two different RLS policies permit this same call
 * depending on who's asking and what stage the row is at:
 *   - a manager/owner, on any swap at any stage (`shift_swaps_write`, 0002)
 *   - the requester, once their named colleague has already accepted
 *     (`shift_swaps_requester_finalize`, 0043) — a swap both people already
 *     agreed to doesn't need a manager on top
 * An open ("anyone") swap has no named colleague to have accepted, so only
 * the manager path applies to it.
 */
/**
 * A manager's decision on a swap. Returns `null` when it was already decided
 * or withdrawn by the time this landed (BUG-061).
 *
 * The prior states are `pending` and `accepted`, not `pending` alone: a swap
 * posted to the open board is reviewable while still `pending`, and a targeted
 * one becomes `accepted` once the colleague agrees. `SwapRequestRow` offers the
 * decision on exactly those two, so the predicate refuses nothing a manager may
 * legitimately do — only a second decision on something already settled.
 *
 * Atomic for the same reason as `reviewLeaveRequest`: the WHERE clause is
 * re-evaluated under the row lock, so two managers racing produce one update
 * and one no-op rather than two overwrites.
 */
export async function reviewShiftSwap(
  id: string,
  status: 'approved' | 'rejected',
  _reviewedBy: string,
): Promise<ShiftSwap | null> {
  // The API decides in one transaction (and reassigns on approval). One already decided or withdrawn is null.
  const r = await api.post<{ outcome: string }>(
    activeOrgPath(`/swaps/${seg(id)}/decide`),
    { status },
  );
  if (r.outcome === 'already-decided') return null;
  const swaps = await readSwaps(activeOrgPath('/swaps'));
  return swaps.find((w) => w.id === id) ?? null;
}

/**
 * Move the shift to whoever is taking it, once the swap is approved.
 *
 * Goes through an RPC rather than a plain `updateShift` because the shift is
 * almost always on a PUBLISHED rota, and 0061 froze those: the whole point of
 * BUG-028's fix is that a manager cannot quietly change what staff have
 * already been told. An approved swap is the one exception the product
 * genuinely wants — both people agreed and it was approved, so staff should
 * see the new name immediately — and `apply_swap_reassignment` is that
 * exception, narrowed to one column and audited, which the old client-side
 * update was not.
 */
export async function applySwapReassignment(swapId: string): Promise<Shift> {
  const r = await api.post<{ shift_id: string }>(
    activeOrgPath(`/swaps/${seg(swapId)}/reassign`),
  );
  return { id: r.shift_id } as Shift;
}

/**
 * A colleague claiming an open ("anyone") swap — `SCREENS.swaps`'s "Take
 * this shift". Sets the claimer as target and jumps straight to
 * 'accepted': the claim itself is their consent, so there is no separate
 * respond step left to take. Permitted by `shift_swaps_claim_open` (0044),
 * which only allows exactly this transition on a still-open row.
 */
export async function claimShiftSwap(
  id: string,
  _staffProfileId: string,
): Promise<ShiftSwap> {
  // The API takes the claimant from the signed-in person's own staff record.
  const r = await api.post<{ swap: ApiSwap }>(activeOrgPath(`/swaps/${seg(id)}/claim`));
  return withShift(r.swap);
}

/** The requester withdrawing their own request. */
export async function cancelShiftSwap(id: string): Promise<void> {
  await api.post(activeOrgPath(`/swaps/${seg(id)}/cancel`));
}

/**
 * The whole swap decision: record it, and move the shift if it was approved.
 *
 * One RPC, and therefore one transaction. Until 0123 this was two round
 * trips — PATCH the swap to 'approved', then call `apply_swap_reassignment`
 * — and anything that went wrong between them left the swap approved with
 * the shift still on the original person. The notification trigger fires on
 * the status change, so the requester was told their swap went through for a
 * shift that had not moved. The screen asked the manager to move it by hand,
 * which is a recovery procedure rather than correctness: nothing made them,
 * and nothing noticed if they did not (RF-02).
 *
 * `decide_shift_swap` now does the lock, the authorisation, the decision,
 * the reassignment and the audit together. A failure at any step rolls the
 * approval and its outbox row back with it, so 'approved' and 'reassigned'
 * can no longer disagree. It also refuses to move a shift the requester no
 * longer holds or one on an archived rota, and marks the swap spent so a
 * replay cannot reach past a later legitimate transfer (RF-03).
 *
 * The caller renders the message. The outcomes stay separate because they
 * need different sentences, and `refused` is new: it means nothing changed
 * and there is a specific reason to show, rather than the old
 * "approved but you must move the shift by hand".
 */
export type SwapDecision =
  | { outcome: 'already-decided'; reassigned: boolean }
  | { outcome: 'declined' }
  | { outcome: 'approved'; reassigned: boolean }
  | { outcome: 'refused'; reason: string };

/**
 * Guard failures the database raises when it declines to move a shift.
 * These are outcomes to explain, not faults to report to Sentry: the
 * decision did not happen and the manager needs to know why. Everything
 * else — a policy denial, a dropped connection — still throws.
 */
/** The API's refusals for a swap that can no longer be applied, in the words the manager sees. */
const SWAP_REFUSAL_CODES: Record<string, string> = {
  shift_gone: 'That shift no longer exists, so the swap was not approved.',
  rota_archived:
    'That shift is on an archived rota, which is history and is never edited. Raise the swap against the current version. Nothing was changed.',
  shift_reassigned:
    'That shift is no longer assigned to the person who offered it — somebody else has taken it since. Nothing was changed.',
  target_inactive:
    'The person taking that shift is no longer an active member of this organisation. Nothing was changed.',
  swap_already_applied: 'That swap has already moved its shift. Nothing was changed.',
};

interface DecideSwapRpcResult {
  outcome: 'already-decided' | 'declined' | 'approved';
  reassigned?: boolean;
}

export async function decideShiftSwap(
  swap: ShiftSwapWithShift,
  status: 'approved' | 'rejected',
): Promise<SwapDecision> {
  let result: DecideSwapRpcResult;
  try {
    result = await api.post<DecideSwapRpcResult>(
      orgPath(swap.org_id, `/swaps/${seg(swap.id)}/decide`),
      { status },
    );
  } catch (error) {
    const refusal =
      error instanceof ApiError ? SWAP_REFUSAL_CODES[error.code] : undefined;
    if (refusal) return { outcome: 'refused', reason: refusal };
    throw error;
  }
  if (result.outcome === 'declined') return { outcome: 'declined' };
  if (result.outcome === 'already-decided') {
    return { outcome: 'already-decided', reassigned: Boolean(result.reassigned) };
  }
  return { outcome: 'approved', reassigned: Boolean(result.reassigned) };
}
