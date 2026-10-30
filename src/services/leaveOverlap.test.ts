import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GAP-123: the days are already booked, said in a sentence.
 *
 * The control itself is the API's locked overlap check (backend suite 105-leave-overtime); a unit test cannot and
 * should not re-prove it. What is testable here is the translation, and it is the part that can rot silently:
 *
 *   * the API's `leave_overlap` refusal must reach a care worker as a sentence;
 *   * the replacement must keep the code AND the 409, because `classifyFailure` reads them to decide whether an
 *     offline write is retried or dead-lettered, and a bare `Error` falls through to its `transient` default,
 *     which would queue a permanently refused request and replay it for ever;
 *   * and every other error must pass through untouched, or a real failure would read as a double-booking.
 */

let nextError: Error | null = null;

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  const post = (): Promise<unknown> =>
    nextError ? Promise.reject(nextError) : Promise.resolve({ leave: { id: 'req-1' } });
  return {
    ...actual,
    api: { get: () => Promise.resolve({}), post },
    activeOrgPath: (rest = '') => `/orgs/org-1${rest}`,
  };
});

const { createLeaveRequest, isDoubleBookedLeave, reviewLeaveRequest } = await import(
  '@/services/leaveService'
);
const { classifyFailure } = await import('@/services/syncQueue');

const { ApiError } = await import('@/lib/apiClient');
const OVERLAP = new ApiError(
  409,
  'leave_overlap',
  'That person already has leave booked on one of those days',
);

/** The insert payload's shape is irrelevant here; the refusal is the subject. */
const REQUEST = {
  org_id: 'org-1',
  staff_profile_id: 'staff-1',
  type: 'annual',
  start_date: '2026-09-22',
  end_date: '2026-09-23',
} as Parameters<typeof createLeaveRequest>[0];

beforeEach(() => {
  nextError = null;
});

describe('a leave request that would double-book the same days', () => {
  it('is refused with a sentence, not with the constraint name', async () => {
    nextError = OVERLAP;
    await expect(createLeaveRequest(REQUEST)).rejects.toThrow(
      /overlap leave you have already asked for/i,
    );
  });

  it('keeps the code and status, so the offline queue dead-letters it instead of replaying it', async () => {
    nextError = OVERLAP;
    const error = await createLeaveRequest(REQUEST).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('leave_overlap');
    expect(classifyFailure(error)).toBe('permanent');
  });

  it('tells a manager approving one what they are actually being stopped from doing', async () => {
    nextError = OVERLAP;
    await expect(reviewLeaveRequest('req-1', 'approved', 'user-1')).rejects.toThrow(
      /double-book days this person already has off/i,
    );
  });

  it('is recognisable to a screen, so it is shown rather than reported as a fault', async () => {
    nextError = OVERLAP;
    const error = await createLeaveRequest(REQUEST).catch((e: unknown) => e);
    expect(isDoubleBookedLeave(error)).toBe(true);
  });
});

describe('every other failure', () => {
  it('passes through untouched, so a real fault is not read as a double-booking', async () => {
    nextError = new ApiError(403, 'forbidden', 'permission denied');
    const error = await createLeaveRequest(REQUEST).catch((e: unknown) => e);
    expect((error as { message: string }).message).toBe('permission denied');
    expect(isDoubleBookedLeave(error)).toBe(false);
  });
});
