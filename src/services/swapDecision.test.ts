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

interface RecordedRpc {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RecordedRpc[] = [];
const tableCalls: string[] = [];
let nextResult: { data: unknown; error: { code?: string; message: string } | null } = {
  data: null,
  error: null,
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(nextResult);
    },
    // Any table write during a decision is the two-step path returning.
    from(table: string): never {
      tableCalls.push(table);
      throw new Error(`decideShiftSwap must not write ${table} directly`);
    },
  },
}));

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
  rpcCalls.length = 0;
  tableCalls.length = 0;
  nextResult = { data: null, error: null };
});

describe('decideShiftSwap', () => {
  it('makes one request for the whole decision, not an approve-then-reassign pair', async () => {
    nextResult = { data: { outcome: 'approved', reassigned: true }, error: null };

    const decision = await decideShiftSwap(swap, 'approved');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.name).toBe('decide_shift_swap');
    expect(rpcCalls[0]?.args).toEqual({ p_swap_id: 'swap-1', p_status: 'approved' });
    // No PATCH of shift_swaps, and no second apply_swap_reassignment call.
    expect(tableCalls).toEqual([]);
    expect(decision).toEqual({ outcome: 'approved', reassigned: true });
  });

  it('does not send a browser-supplied reviewer id', () => {
    // The reviewer is auth.uid() inside the function (0123). Passing one from
    // the client is what let the old service record a reviewer the row policy
    // constrained but the RPC would not have.
    expect(decideShiftSwap.length).toBe(2);
  });

  it('reports a shift that moved on since the swap was raised as changing nothing', async () => {
    nextResult = {
      data: null,
      error: { code: 'SWAP6', message: 'no longer assigned to the requester' },
    };

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
    nextResult = { data: null, error: { code: 'SWAP5', message: 'archived rota' } };
    const decision = await decideShiftSwap(swap, 'approved');
    expect(decision.outcome).toBe('refused');
  });

  it('refuses a swap that already moved its shift, so a replay cannot revert a later transfer', async () => {
    nextResult = { data: null, error: { code: 'SWAP9', message: 'already applied' } };
    const decision = await decideShiftSwap(swap, 'approved');
    expect(decision).toEqual({
      outcome: 'refused',
      reason: 'That swap has already moved its shift. Nothing was changed.',
    });
  });

  it('returns the recorded result for a swap somebody else already decided', async () => {
    nextResult = {
      data: { outcome: 'already-decided', status: 'approved', reassigned: true },
      error: null,
    };
    const decision = await decideShiftSwap(swap, 'approved');
    expect(decision).toEqual({ outcome: 'already-decided', reassigned: true });
  });

  it('rethrows anything that is not a decision outcome', async () => {
    nextResult = { data: null, error: { code: '42501', message: 'denied' } };
    await expect(decideShiftSwap(swap, 'approved')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('declines without claiming a reassignment', async () => {
    nextResult = { data: { outcome: 'declined' }, error: null };
    expect(await decideShiftSwap(swap, 'rejected')).toEqual({ outcome: 'declined' });
  });

  it('approves an open swap nobody claimed without claiming a transfer', async () => {
    nextResult = {
      data: { outcome: 'approved', reassigned: false, reason: 'no-target' },
      error: null,
    };
    expect(await decideShiftSwap(swap, 'approved')).toEqual({
      outcome: 'approved',
      reassigned: false,
    });
  });
});
