import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-061: a manager's decision must not overwrite one already recorded.
 *
 * Two managers acting on the same request used to both succeed, and the second silently replaced the first's
 * reviewer and time. The API now decides under a row lock and answers the loser with 409 `already_decided`
 * (withdrawing something no longer pending is 409 `cannot_cancel`); that refusal is proved in the backend suites
 * 105 and 110. What these tests guard is the browser half: each decision goes to its own decision route, carries
 * no browser-supplied reviewer, and a lost race is surfaced as `null`/`false` instead of being reported as success
 * or as a fault.
 */

interface RecordedPost {
  path: string;
  body: unknown;
}

const posts: RecordedPost[] = [];
let nextError: Error | null = null;
let nextResult: unknown = {};

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    activeOrgPath: (rest = '') => `/orgs/org-1${rest}`,
    api: {
      get: () => Promise.resolve({ swaps: [] }),
      post(path: string, body: unknown) {
        posts.push({ path, body });
        return nextError ? Promise.reject(nextError) : Promise.resolve(nextResult);
      },
    },
  };
});

const { ApiError } = await import('@/lib/apiClient');
const { reviewLeaveRequest } = await import('@/services/leaveService');
const { reviewShiftSwap } = await import('@/services/swapService');
const { cancelOvertimeRequest, reviewOvertimeRequest } = await import(
  '@/services/overtimeService'
);

function lastPost(): RecordedPost {
  const post = posts[posts.length - 1];
  if (post === undefined) throw new Error('expected a request to have been sent');
  return post;
}

beforeEach(() => {
  posts.length = 0;
  nextError = null;
  nextResult = {
    leave: { id: 'req-1' },
    overtime: { id: 'ot-1', hours: 2 },
    outcome: 'approved',
  };
});

describe('reviewLeaveRequest', () => {
  it('sends the decision to the review route, with no reviewer from the browser', async () => {
    await reviewLeaveRequest('req-1', 'approved', 'user-1');
    expect(lastPost()).toEqual({
      path: '/orgs/org-1/leave/req-1/review',
      body: { status: 'approved' },
    });
  });

  it('returns null when someone else decided it first', async () => {
    nextError = new ApiError(
      409,
      'already_decided',
      'That leave request has already been approved',
    );
    await expect(reviewLeaveRequest('req-1', 'approved', 'user-1')).resolves.toBeNull();
  });

  it('does not swallow any other refusal', async () => {
    nextError = new ApiError(403, 'forbidden', 'nope');
    await expect(reviewLeaveRequest('req-1', 'rejected', 'user-7')).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
  });
});

describe('reviewShiftSwap', () => {
  it('decides through the single decision route', async () => {
    await reviewShiftSwap('swap-1', 'approved', 'user-1');
    expect(lastPost()).toEqual({
      path: '/orgs/org-1/swaps/swap-1/decide',
      body: { status: 'approved' },
    });
  });

  it('returns null when it was already decided or withdrawn', async () => {
    nextResult = { outcome: 'already-decided', reassigned: false };
    await expect(reviewShiftSwap('swap-1', 'approved', 'user-1')).resolves.toBeNull();
  });
});

describe('overtime', () => {
  it('reviews through the review route', async () => {
    await reviewOvertimeRequest('ot-1', 'approved', 'user-1');
    expect(lastPost().path).toBe('/orgs/org-1/overtime/ot-1/review');
  });

  it('returns null for a claim someone else already decided', async () => {
    nextError = new ApiError(409, 'already_decided', 'decided');
    await expect(reviewOvertimeRequest('ot-1', 'approved', 'user-1')).resolves.toBeNull();
  });

  it('withdraws through the cancel route', async () => {
    await expect(cancelOvertimeRequest('ot-1')).resolves.toBe(true);
    expect(lastPost().path).toBe('/orgs/org-1/overtime/ot-1/cancel');
  });

  it('reports a lost withdrawal as false rather than as success', async () => {
    nextError = new ApiError(
      409,
      'cannot_cancel',
      'A approved overtime request cannot be cancelled',
    );
    await expect(cancelOvertimeRequest('ot-1')).resolves.toBe(false);
  });
});
