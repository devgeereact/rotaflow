import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-061 — a manager's decision must not overwrite one already recorded.
 *
 * Leave, swaps and overtime all reviewed with a bare
 * `.update(...).eq('id', id)`, so two managers acting on the same request both
 * succeeded and the second silently replaced the first's `reviewed_by` and
 * `reviewed_at`. The audit trail then named the wrong person, and on overtime
 * the losing decision was the one payroll saw.
 *
 * The fix is a state predicate on the UPDATE itself, which Postgres
 * re-evaluates under the row lock — so the loser updates zero rows rather than
 * clobbering the winner. What these tests guard is that the predicate is still
 * there, and that a zero-row result is surfaced as `null`/`false` instead of
 * being reported as success. Deleting the `.eq('status', …)` line is a silent,
 * invisible regression otherwise: types still check, lint still passes, and the
 * bug simply comes back.
 *
 * A fake query builder records the chain rather than reaching Supabase. The
 * atomicity itself is Postgres's, not something a unit test can prove; what is
 * testable here — and what actually broke — is the shape of the statement sent.
 */

interface RecordedCall {
  table: string;
  patch: Record<string, unknown>;
  /** Every `.eq()` / `.in()` filter, in call order. */
  filters: [string, unknown][];
  /** True when the caller used `maybeSingle`, which tolerates zero rows. */
  maybeSingle: boolean;
}

const calls: RecordedCall[] = [];
/** What the fake builder resolves to — one row, or none (the losing race). */
let nextResult: { data: unknown; error: null } = { data: null, error: null };

vi.mock('@/lib/supabase', () => {
  // Deliberately untyped: this stands in for PostgrestFilterBuilder, whose real
  // signature is a deep generic over the generated Database type. Reproducing
  // it here would be a large amount of type machinery to assert one string.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const from = (table: string) => ({
    update(patch: Record<string, unknown>) {
      const call: RecordedCall = { table, patch, filters: [], maybeSingle: false };
      calls.push(call);
      const builder = {
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        in(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle() {
          call.maybeSingle = true;
          return Promise.resolve(nextResult);
        },
        single() {
          return Promise.resolve(nextResult);
        },
      };
      return builder;
    },
  });
  return { supabase: { from } };
});

const { reviewLeaveRequest } = await import('@/services/leaveService');
const { reviewShiftSwap } = await import('@/services/swapService');
const { cancelOvertimeRequest, reviewOvertimeRequest } =
  await import('@/services/overtimeService');

function lastCall(): RecordedCall {
  const call = calls[calls.length - 1];
  if (call === undefined) throw new Error('expected a query to have been issued');
  return call;
}

/** The filter for a column, or undefined — never a non-null assertion. */
function filterFor(call: RecordedCall, column: string): unknown {
  return call.filters.find(([name]) => name === column)?.[1];
}

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: { id: 'req-1' }, error: null };
});

describe('reviewLeaveRequest', () => {
  it('only writes over a request that is still pending', async () => {
    await reviewLeaveRequest('req-1', 'approved', 'user-1');
    const call = lastCall();
    expect(call.table).toBe('leave_requests');
    expect(filterFor(call, 'id')).toBe('req-1');
    // The line whose absence is BUG-061.
    expect(filterFor(call, 'status')).toBe('pending');
  });

  it('returns null when someone else decided it first', async () => {
    nextResult = { data: null, error: null };
    await expect(reviewLeaveRequest('req-1', 'approved', 'user-1')).resolves.toBeNull();
    // `single()` would have thrown on zero rows, which the page would have
    // shown as "Could not approve that request" — a lie about a request that
    // was in fact decided, just by someone else.
    expect(lastCall().maybeSingle).toBe(true);
  });

  it('still records who decided it and when', async () => {
    await reviewLeaveRequest('req-1', 'rejected', 'user-7');
    expect(lastCall().patch).toMatchObject({ status: 'rejected', reviewed_by: 'user-7' });
    expect(lastCall().patch['reviewed_at']).toEqual(expect.any(String));
  });
});

describe('reviewShiftSwap', () => {
  it('accepts both undecided states, because a swap has two of them', async () => {
    await reviewShiftSwap('swap-1', 'approved', 'user-1');
    // Not `pending` alone: a swap on the open board is reviewable while
    // pending, and a targeted one becomes `accepted` once the colleague
    // agrees. Guarding on `pending` only would refuse half the real approvals.
    expect(filterFor(lastCall(), 'status')).toEqual(['pending', 'accepted']);
  });

  it('returns null when it was already decided or withdrawn', async () => {
    nextResult = { data: null, error: null };
    await expect(reviewShiftSwap('swap-1', 'approved', 'user-1')).resolves.toBeNull();
  });
});

describe('overtime', () => {
  it('reviews only a pending claim', async () => {
    await reviewOvertimeRequest('ot-1', 'approved', 'user-1');
    expect(lastCall().table).toBe('overtime_requests');
    expect(filterFor(lastCall(), 'status')).toBe('pending');
  });

  it('withdraws only a pending claim, so a decision cannot be un-approved', async () => {
    // The same guard from the staff member's side. Without it, a withdrawal
    // arriving after a manager approved would cancel hours already sent to
    // payroll — the one case here where the losing write costs money.
    await cancelOvertimeRequest('ot-1');
    expect(lastCall().patch).toEqual({ status: 'cancelled' });
    expect(filterFor(lastCall(), 'status')).toBe('pending');
  });

  it('reports a lost withdrawal as false rather than as success', async () => {
    nextResult = { data: null, error: null };
    await expect(cancelOvertimeRequest('ot-1')).resolves.toBe(false);
  });
});
