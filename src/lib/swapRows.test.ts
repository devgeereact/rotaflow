import { describe, expect, it } from 'vitest';
import { countSwapTiles, toDisplayStatus } from '@/lib/swapRows';
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

function mkRow(status: SwapRow['status'], needsReview = false): SwapRow {
  return {
    id: `r-${status}-${Math.random()}`,
    from: { firstName: 'A', lastName: 'B', jobTitle: null, photoUrl: null },
    fromStaffId: 's1',
    to: null,
    toStaffId: null,
    shift: null,
    requestedLabel: 'Today, 09:00',
    note: null,
    status,
    statusNote: null,
    needsReview,
  };
}

describe('countSwapTiles', () => {
  it('counts open, needs-review, approved and declined independently', () => {
    const rows = [
      mkRow('open'),
      mkRow('open', true),
      mkRow('accepted', true),
      mkRow('approved'),
      mkRow('approved'),
      mkRow('declined'),
      mkRow('cancelled'),
    ];
    const counts = countSwapTiles(rows);
    expect(counts.open).toBe(2);
    expect(counts.waitingOnYou).toBe(2);
    expect(counts.approved).toBe(2);
    expect(counts.declined).toBe(1);
  });

  it('is all zero for an empty list', () => {
    expect(countSwapTiles([])).toEqual({
      open: 0,
      waitingOnYou: 0,
      approved: 0,
      declined: 0,
    });
  });
});
