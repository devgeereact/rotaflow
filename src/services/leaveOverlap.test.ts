import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GAP-123 / migration `0152` — the days are already booked, said in a
 * sentence.
 *
 * The control itself is a Postgres exclusion constraint and is proved in
 * `supabase/tests/database/leave_no_double_booking.test.sql`; a unit test
 * cannot and should not try to re-prove it. What is testable here is the
 * translation, and it is the part that can rot silently:
 *
 *   * SQLSTATE `23P01`'s own message names an index, so a screen showing it
 *     raw tells a care worker nothing;
 *   * the replacement must keep the `code`, because `classifyFailure` reads
 *     it to decide whether an offline write is retried or dead-lettered, and
 *     a bare `Error` falls through to its `transient` default — which would
 *     queue a permanently-refused request and replay it forever;
 *   * and every other error must pass through untouched, or a real failure
 *     would be reported to the person as a double-booking.
 */

interface Outcome {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let nextResult: Outcome = { data: { id: 'req-1' }, error: null };

vi.mock('@/lib/supabase', () => {
  // Untyped on purpose, for the reason `reviewConcurrency.test.ts` gives:
  // the real builder is a deep generic over the generated Database type.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const from = () => {
    const builder = {
      insert() {
        return builder;
      },
      update() {
        return builder;
      },
      eq() {
        return builder;
      },
      select() {
        return builder;
      },
      single() {
        return Promise.resolve(nextResult);
      },
      maybeSingle() {
        return Promise.resolve(nextResult);
      },
    };
    return builder;
  };
  return { supabase: { from } };
});

const { createLeaveRequest, isDoubleBookedLeave, reviewLeaveRequest } =
  await import('@/services/leaveService');
const { classifyFailure } = await import('@/services/syncQueue');

const OVERLAP = {
  code: '23P01',
  message:
    'conflicting key value violates exclusion constraint "leave_requests_no_live_overlap"',
};

/** The insert payload's shape is irrelevant here; the refusal is the subject. */
const REQUEST = {
  org_id: 'org-1',
  staff_profile_id: 'staff-1',
  type: 'annual',
  start_date: '2026-09-22',
  end_date: '2026-09-23',
} as Parameters<typeof createLeaveRequest>[0];

beforeEach(() => {
  nextResult = { data: { id: 'req-1' }, error: null };
});

describe('a leave request that would double-book the same days', () => {
  it('is refused with a sentence, not with the constraint name', async () => {
    nextResult = { data: null, error: OVERLAP };
    await expect(createLeaveRequest(REQUEST)).rejects.toThrow(
      /overlap leave you have already asked for/i,
    );
  });

  it('keeps the SQLSTATE, so the offline queue dead-letters it instead of replaying it', async () => {
    nextResult = { data: null, error: OVERLAP };
    const error = await createLeaveRequest(REQUEST).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('23P01');
    expect(classifyFailure(error)).toBe('permanent');
  });

  it('tells a manager approving one what they are actually being stopped from doing', async () => {
    nextResult = { data: null, error: OVERLAP };
    await expect(reviewLeaveRequest('req-1', 'approved', 'user-1')).rejects.toThrow(
      /double-book days this person already has off/i,
    );
  });

  it('is recognisable to a screen, so it is shown rather than reported as a fault', async () => {
    nextResult = { data: null, error: OVERLAP };
    const error = await createLeaveRequest(REQUEST).catch((e: unknown) => e);
    expect(isDoubleBookedLeave(error)).toBe(true);
  });
});

describe('every other failure', () => {
  it('passes through untouched, so a real fault is not read as a double-booking', async () => {
    nextResult = { data: null, error: { code: '42501', message: 'permission denied' } };
    const error = await createLeaveRequest(REQUEST).catch((e: unknown) => e);
    expect((error as { message: string }).message).toBe('permission denied');
    expect(isDoubleBookedLeave(error)).toBe(false);
  });
});
