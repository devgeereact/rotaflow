import { describe, expect, it } from 'vitest';
import { isAlreadyGone, parseDeleteAccountRequest } from './request';

const USER = 'abcdef00-3333-4333-8333-33333333abcd';

describe('parseDeleteAccountRequest', () => {
  it('accepts one user id', () => {
    expect(parseDeleteAccountRequest({ userId: USER })).toEqual({ userId: USER });
  });

  it('refuses anything that is not a lower-case uuid', () => {
    for (const userId of ['', 'admin', `${USER}x`, USER.toUpperCase(), 42, null]) {
      expect(parseDeleteAccountRequest({ userId })).toBeNull();
    }
  });

  it('refuses a malformed body', () => {
    expect(parseDeleteAccountRequest(null)).toBeNull();
    expect(parseDeleteAccountRequest('x')).toBeNull();
    expect(parseDeleteAccountRequest({})).toBeNull();
  });
});

describe('isAlreadyGone', () => {
  it('reads a missing user as done', () => {
    expect(isAlreadyGone({ status: 404 })).toBe(true);
    expect(isAlreadyGone({ code: 'user_not_found' })).toBe(true);
    expect(isAlreadyGone({ message: 'User not found' })).toBe(true);
  });

  it('reads anything else as a failure to retry', () => {
    expect(isAlreadyGone({ status: 500, message: 'Database error deleting user' })).toBe(
      false,
    );
    expect(isAlreadyGone({})).toBe(false);
  });
});
