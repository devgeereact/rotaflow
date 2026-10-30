import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftSwapWithShift } from '@/services/swapService';

/**
 * RF-02 and RF-03 — a swap decision is one transaction, or it did not happen.
 *
 * The audited version made two round trips: PATCH the swap to 'approved',
 * then call `apply_swap_reassignment`. The audit reproduced the gap between
 * them by letting the first succeed and rejecting the second: the swap was
 * left approved, the shift stayed with the original person, and
 * `enqueue_swap_reviewed_notification` had already told the requester their
 * swap went through. The screen asked the manager to move the shift by hand.
 *
 * What is testable here is the shape of the call — that the client makes
 * exactly ONE request for the whole decision, and that a database refusal is
 * surfaced as "nothing changed" rather than "approved, now go and fix it".
 * The atomicity itself is Postgres's, and is asserted in
 * `supabase/tests/database/swap_decision_atomicity.test.sql`.
 *
 * Deleting the RPC and going back to two calls is otherwise an invisible
 * regression: types check, lint passes, and the split commit comes back.
 */

interface RecordedPost {
  path: string;
  body: unknown;
}

const posts: RecordedPost[] = [];
let nextResult: unknown = null;
let nextError: Error | null = null;

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: () => Promise.reject(new Error('decideShiftSwap must not read anything')),
      post(path: string, body: unknown) {
        posts.push({ path, body });
        return nextError ? Promise.reject(nextError) : Promise.resolve(nextResult);
      },
    },
  };
});

const { ApiError } = await import('@/lib/apiClient');
const { decideShiftSwap } = await import('@/services/swapService');

const swap = {
  id: 'swap-1',
  org_id: 'org-1',
  shift_id: 'shift-1',
  requested_by: 'staff-a',
  target_staff_profile_id: 'staff-b',
  status: 'accepted',
  shift: null,
} as unknown as ShiftSwapWithShift;

beforeEach(() => {
  posts.length = 0;
  nextResult = null;
  nextError = null;
});

describe('decideShiftSwap', () => {
  it('makes one request for the whole decision, not an approve-then-reassign pair', async () => {
    nextResult = { outcome: 'approved', reassigned: true };

    const decision = await decideShiftSwap(swap, 'approved');

    // One request; no separate reassign call.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe('/orgs/org-1/swaps/swap-1/decide');
    expect(posts[0]?.body).toEqual({ status: 'approved' });
    expect(decision).toEqual({ outcome: 'approved', reassigned: true });
  });

  it('does not send a browser-supplied reviewer id', () => {
    // The reviewer is the signed-in person on the API. Passing one from the
    // client is what once let a reviewer be recorded that nobody checked.
    expect(decideShiftSwap.length).toBe(2);
  });

  it('reports a shift that moved on since the swap was raised as changing nothing', async () => {
    nextError = new ApiError(
      409,
      'shift_reassigned',
      'no longer assigned to the requester',
    );

    const decision = await decideShiftSwap(swap, 'approved');

    expect(decision.outcome).toBe('refused');
    if (decision.outcome === 'refused') {
      expect(decision.reason).toContain('Nothing was changed');
      // The old copy told the manager the swap WAS approved and asked them to
      // move the shift by hand. It is not approved; it did not happen.
      expect(decision.reason).not.toContain('approved');
    }
  });

  it('refuses an archived rota rather than reaching into superseded history', async () => {
    nextError = new ApiError(409, 'rota_archived', 'archived rota');
    const decision = await decideShiftSwap(swap, 'approved');
    expect(decision.outcome).toBe('refused');
  });

  it('refuses a swap that already moved its shift, so a replay cannot revert a later transfer', async () => {
    nextError = new ApiError(409, 'swap_already_applied', 'already applied');
    const decision = await decideShiftSwap(swap, 'approved');
    expect(decision).toEqual({
      outcome: 'refused',
      reason: 'That swap has already moved its shift. Nothing was changed.',
    });
  });

  it('returns the recorded result for a swap somebody else already decided', async () => {
    nextResult = { outcome: 'already-decided', status: 'approved', reassigned: true };
    const decision = await decideShiftSwap(swap, 'approved');
    expect(decision).toEqual({ outcome: 'already-decided', reassigned: true });
  });

  it('rethrows anything that is not a decision outcome', async () => {
    nextError = new ApiError(403, 'forbidden', 'denied');
    await expect(decideShiftSwap(swap, 'approved')).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('declines without claiming a reassignment', async () => {
    nextResult = { outcome: 'declined' };
    expect(await decideShiftSwap(swap, 'rejected')).toEqual({ outcome: 'declined' });
  });

  it('approves an open swap nobody claimed without claiming a transfer', async () => {
    nextResult = { outcome: 'approved', reassigned: false, reason: 'no-target' };
    expect(await decideShiftSwap(swap, 'approved')).toEqual({
      outcome: 'approved',
      reassigned: false,
    });
  });
});
