import { describe, expect, it } from 'vitest';
import { countByStatus, toDisplayStatus, toSwapTab } from '@/lib/swapRows';
import type { SwapRow } from '@/lib/swapRows';

describe('toDisplayStatus', () => {
  it('is "open" for a pending request with no named colleague', () => {
    expect(toDisplayStatus('pending', false)).toBe('open');
  });

  it('is "awaiting_colleague" for a pending request naming one', () => {
    expect(toDisplayStatus('pending', true)).toBe('awaiting_colleague');
  });

  it('is "accepted" once the colleague has said yes', () => {
    expect(toDisplayStatus('accepted', true)).toBe('accepted');
    // hasTarget is always true for an accepted swap in practice, but the
    // fold should not depend on it once status is past 'pending'.
    expect(toDisplayStatus('accepted', false)).toBe('accepted');
  });

  it('maps approved, rejected and cancelled straight through', () => {
    expect(toDisplayStatus('approved', true)).toBe('approved');
    expect(toDisplayStatus('rejected', false)).toBe('declined');
    expect(toDisplayStatus('cancelled', true)).toBe('cancelled');
  });
});

describe('toSwapTab', () => {
  it('folds every unsettled state into "pending"', () => {
    expect(toSwapTab('open')).toBe('pending');
    expect(toSwapTab('awaiting_colleague')).toBe('pending');
    expect(toSwapTab('accepted')).toBe('pending');
  });

  it('maps settled states straight through', () => {
    expect(toSwapTab('approved')).toBe('approved');
    expect(toSwapTab('declined')).toBe('declined');
    expect(toSwapTab('cancelled')).toBe('cancelled');
  });
});

function mkRow(status: SwapRow['status']): SwapRow {
  return {
    id: `r-${status}`,
    from: { firstName: 'A', lastName: 'B', jobTitle: null, photoUrl: null },
    fromStaffId: 's1',
    to: null,
    toStaffId: null,
    shift: null,
    requestedLabel: 'Today, 09:00',
    note: null,
    status,
    statusNote: null,
    needsReview: false,
  };
}

describe('countByStatus', () => {
  it('counts each of the six states independently', () => {
    const rows = [mkRow('open'), mkRow('open'), mkRow('approved'), mkRow('cancelled')];
    const counts = countByStatus(rows);
    expect(counts.find((c) => c.status === 'open')?.count).toBe(2);
    expect(counts.find((c) => c.status === 'approved')?.count).toBe(1);
    expect(counts.find((c) => c.status === 'cancelled')?.count).toBe(1);
    expect(counts.find((c) => c.status === 'declined')?.count).toBe(0);
  });
});
