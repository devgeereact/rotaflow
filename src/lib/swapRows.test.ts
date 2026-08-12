import { describe, expect, it } from 'vitest';
import { toDisplayStatus } from '@/lib/swapRows';

describe('toDisplayStatus', () => {
  it('is "open" for a pending request with no named colleague', () => {
    expect(toDisplayStatus('pending', false)).toBe('open');
  });

  it('is "awaiting_colleague" for a pending request naming one', () => {
    expect(toDisplayStatus('pending', true)).toBe('awaiting_colleague');
  });

  it('is "awaiting_manager" once the colleague has accepted', () => {
    expect(toDisplayStatus('accepted', true)).toBe('awaiting_manager');
    // hasTarget is always true for an accepted swap in practice, but the
    // fold should not depend on it once status is past 'pending'.
    expect(toDisplayStatus('accepted', false)).toBe('awaiting_manager');
  });

  it('maps approved, rejected and cancelled straight through', () => {
    expect(toDisplayStatus('approved', true)).toBe('approved');
    expect(toDisplayStatus('rejected', false)).toBe('declined');
    expect(toDisplayStatus('cancelled', true)).toBe('cancelled');
  });
});
