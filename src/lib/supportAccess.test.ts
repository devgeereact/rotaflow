import { describe, expect, it } from 'vitest';
import {
  MIN_REASON_LENGTH,
  SUPPORT_ACCESS_DURATIONS,
  formatRemaining,
  millisecondsRemaining,
  sessionStatus,
  validateRequest,
} from '@/lib/supportAccess';

const NOW = new Date('2026-08-04T12:00:00.000Z');
const iso = (offsetMs: number): string =>
  new Date(NOW.getTime() + offsetMs).toISOString();

describe('sessionStatus', () => {
  it('is active while the expiry is in the future', () => {
    expect(sessionStatus({ expiresAt: iso(60_000), revokedAt: null }, NOW)).toBe(
      'active',
    );
  });

  it('is expired once the clock reaches the expiry, not a moment later', () => {
    expect(sessionStatus({ expiresAt: iso(0), revokedAt: null }, NOW)).toBe('expired');
    expect(sessionStatus({ expiresAt: iso(-1), revokedAt: null }, NOW)).toBe('expired');
  });

  it('ranks revoked above expired — a revoked session never reads as merely lapsed', () => {
    // Both conditions true at once: revocation is the more specific fact and
    // must win, or an early revocation disappears from the record.
    expect(sessionStatus({ expiresAt: iso(-60_000), revokedAt: iso(-90_000) }, NOW)).toBe(
      'revoked',
    );
  });

  it('reports revoked even when the expiry has not yet passed', () => {
    expect(sessionStatus({ expiresAt: iso(600_000), revokedAt: iso(-1_000) }, NOW)).toBe(
      'revoked',
    );
  });
});

describe('millisecondsRemaining', () => {
  it('counts down to the expiry', () => {
    expect(millisecondsRemaining(iso(90_000), NOW)).toBe(90_000);
  });

  it('floors at zero rather than going negative', () => {
    expect(millisecondsRemaining(iso(-5_000), NOW)).toBe(0);
  });

  it('returns zero for an unparseable timestamp instead of NaN', () => {
    expect(millisecondsRemaining('not a date', NOW)).toBe(0);
  });
});

describe('formatRemaining', () => {
  it('says expired at or below zero', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(-1)).toBe('expired');
  });

  it('handles the sub-minute case without saying "0 minutes"', () => {
    expect(formatRemaining(30_000)).toBe('under a minute');
  });

  it('rounds down, so remaining access is never overstated', () => {
    // 90 seconds is one minute and a half — reporting "2 minutes" would give a
    // person longer than they have.
    expect(formatRemaining(90_000)).toBe('1 minute');
    expect(formatRemaining(119_000)).toBe('1 minute');
  });

  it('pluralises minutes', () => {
    expect(formatRemaining(60_000)).toBe('1 minute');
    expect(formatRemaining(43 * 60_000)).toBe('43 minutes');
  });

  it('switches to hours, and omits a zero minute part', () => {
    expect(formatRemaining(60 * 60_000)).toBe('1 hour');
    expect(formatRemaining(2 * 60 * 60_000)).toBe('2 hours');
    expect(formatRemaining((3 * 60 + 5) * 60_000)).toBe('3 hours 5 minutes');
    expect(formatRemaining((1 * 60 + 1) * 60_000)).toBe('1 hour 1 minute');
  });
});

describe('validateRequest', () => {
  const valid = {
    orgId: 'org-1',
    reason: 'Investigating the rota publish failure reported in CASE-2400.',
    caseRef: 'CASE-2400',
    minutes: 60,
  };

  it('accepts a well-formed request', () => {
    expect(validateRequest(valid)).toEqual({});
  });

  it('requires an organisation', () => {
    expect(validateRequest({ ...valid, orgId: '' }).orgId).toBeDefined();
  });

  it('requires a reason of real length, ignoring padding', () => {
    expect(
      validateRequest({ ...valid, reason: 'x'.repeat(MIN_REASON_LENGTH - 1) }).reason,
    ).toBeDefined();
    expect(
      validateRequest({ ...valid, reason: `   ${' '.repeat(20)}   ` }).reason,
    ).toBeDefined();
    expect(
      validateRequest({ ...valid, reason: 'x'.repeat(MIN_REASON_LENGTH) }).reason,
    ).toBeUndefined();
  });

  it('requires a case reference', () => {
    expect(validateRequest({ ...valid, caseRef: '' }).caseRef).toBeDefined();
    expect(validateRequest({ ...valid, caseRef: 'ab' }).caseRef).toBeDefined();
  });

  it('rejects a duration the database would refuse', () => {
    // The SQL bounds are 15 minutes to 24 hours; anything outside the offered
    // list would come back as a 22023 rather than a sentence.
    expect(validateRequest({ ...valid, minutes: 5 }).minutes).toBeDefined();
    expect(validateRequest({ ...valid, minutes: 2880 }).minutes).toBeDefined();
    expect(validateRequest({ ...valid, minutes: 45 }).minutes).toBeDefined();
  });

  it('accepts every duration the console offers', () => {
    for (const { minutes } of SUPPORT_ACCESS_DURATIONS) {
      expect(validateRequest({ ...valid, minutes }).minutes).toBeUndefined();
    }
  });
});

describe('SUPPORT_ACCESS_DURATIONS', () => {
  it('stays inside the bounds request_support_access enforces', () => {
    for (const { minutes } of SUPPORT_ACCESS_DURATIONS) {
      expect(minutes).toBeGreaterThanOrEqual(15);
      expect(minutes).toBeLessThanOrEqual(1440);
    }
  });
});
