import { describe, expect, it } from 'vitest';
import {
  classifyMfaError,
  decideMfaStep,
  isCompleteCode,
  needsSecondFactor,
  normaliseCode,
  type ChallengeFactor,
} from '@/lib/mfaStep';

function factor(overrides: Partial<ChallengeFactor> = {}): ChallengeFactor {
  return {
    id: 'f1',
    friendlyName: 'Authenticator app',
    createdAt: '2026-09-01T10:00:00Z',
    status: 'verified',
    factorType: 'totp',
    ...overrides,
  };
}

describe('needsSecondFactor', () => {
  it('is true only for aal1 now, aal2 next', () => {
    expect(needsSecondFactor({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe(true);
    expect(needsSecondFactor({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe(false);
    expect(needsSecondFactor({ currentLevel: 'aal2', nextLevel: 'aal2' })).toBe(false);
    // Factor removed elsewhere, token not yet refreshed.
    expect(needsSecondFactor({ currentLevel: 'aal2', nextLevel: 'aal1' })).toBe(false);
    // No session: ProtectedRoute's redirect, not this gate's.
    expect(needsSecondFactor({ currentLevel: null, nextLevel: null })).toBe(false);
  });
});

describe('decideMfaStep', () => {
  it('proceeds when no factor is enrolled', () => {
    expect(decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal1' }, [])).toEqual({
      kind: 'proceed',
    });
  });

  it('proceeds once the session has used its factor', () => {
    expect(
      decideMfaStep({ currentLevel: 'aal2', nextLevel: 'aal2' }, [factor()]),
    ).toEqual({ kind: 'proceed' });
  });

  it('asks for the code with the single verified TOTP factor preselected', () => {
    const step = decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, [factor()]);
    expect(step).toEqual({
      kind: 'challenge',
      factors: [factor()],
      defaultFactorId: 'f1',
    });
  });

  it('ignores unverified enrolments and non-TOTP factors', () => {
    const step = decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, [
      factor({ id: 'abandoned', status: 'unverified' }),
      factor({ id: 'phone', factorType: 'phone' }),
      factor({ id: 'real' }),
    ]);
    expect(step.kind).toBe('challenge');
    if (step.kind !== 'challenge') return;
    expect(step.factors.map((f) => f.id)).toEqual(['real']);
    expect(step.defaultFactorId).toBe('real');
  });

  it('offers every verified TOTP factor, oldest first, and preselects the oldest', () => {
    const step = decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, [
      factor({ id: 'newer', createdAt: '2026-10-01T00:00:00Z' }),
      factor({ id: 'older', createdAt: '2026-08-01T00:00:00Z' }),
    ]);
    expect(step.kind).toBe('challenge');
    if (step.kind !== 'challenge') return;
    expect(step.factors.map((f) => f.id)).toEqual(['older', 'newer']);
    expect(step.defaultFactorId).toBe('older');
  });

  it('refuses to admit a session that owes a factor this screen cannot take', () => {
    expect(
      decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, [
        factor({ factorType: 'phone' }),
      ]),
    ).toEqual({ kind: 'unsupported' });
    // nextLevel says a factor exists even if the list came back empty: fail closed.
    expect(decideMfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, [])).toEqual({
      kind: 'unsupported',
    });
  });
});

describe('code input', () => {
  it('keeps digits only, at most six', () => {
    expect(normaliseCode('123 456')).toBe('123456');
    expect(normaliseCode('12a3-4')).toBe('1234');
    expect(normaliseCode('12345678')).toBe('123456');
  });

  it('accepts exactly six digits', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
  });
});

describe('classifyMfaError', () => {
  it('reads GoTrue error codes', () => {
    expect(classifyMfaError({ code: 'mfa_verification_failed', status: 422 })).toBe(
      'wrong-code',
    );
    expect(classifyMfaError({ code: 'mfa_challenge_expired', status: 422 })).toBe(
      'expired',
    );
    expect(classifyMfaError({ code: 'mfa_factor_not_found', status: 404 })).toBe(
      'factor-missing',
    );
    expect(classifyMfaError({ code: 'over_request_rate_limit', status: 429 })).toBe(
      'rate-limited',
    );
  });

  it('falls back on status and message for older servers', () => {
    expect(classifyMfaError({ status: 429 })).toBe('rate-limited');
    expect(classifyMfaError({ status: 0, message: 'Failed to fetch' })).toBe('offline');
    expect(classifyMfaError(new Error('Invalid TOTP code entered'))).toBe('wrong-code');
  });

  it('says unknown rather than guessing', () => {
    expect(classifyMfaError(new Error('boom'))).toBe('unknown');
    expect(classifyMfaError(null)).toBe('unknown');
    expect(classifyMfaError('a string')).toBe('unknown');
  });
});
