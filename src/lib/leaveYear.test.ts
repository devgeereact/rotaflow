import { describe, expect, it } from 'vitest';
import {
  carriedOverDays,
  formatLeaveYear,
  leaveYearFor,
  proRataEntitlement,
} from '@/lib/leaveYear';

/**
 * Leave years that are not the calendar year (CAP-085).
 *
 * The assertions that matter are the ones about the months BEFORE the start
 * date — that is where a leave year silently behaves like a calendar year and
 * every balance is wrong in a way that still looks reasonable.
 */

describe('leaveYearFor', () => {
  it('is the calendar year when the year starts in January', () => {
    expect(leaveYearFor('2026-06-15', 1, 1)).toEqual({
      from: '2026-01-01',
      to: '2027-01-01',
    });
  });

  it('runs April to April for an April year', () => {
    expect(leaveYearFor('2026-06-15', 4, 1)).toEqual({
      from: '2026-04-01',
      to: '2027-04-01',
    });
  });

  it('puts February in the year that began LAST April', () => {
    // The bug this exists to prevent. In the months before the start date,
    // a leave year behaves nothing like a calendar year, and a balance
    // computed the wrong way still looks plausible.
    expect(leaveYearFor('2026-02-10', 4, 1)).toEqual({
      from: '2025-04-01',
      to: '2026-04-01',
    });
  });

  it('treats the first day of the year as inside it, not the previous one', () => {
    expect(leaveYearFor('2026-04-01', 4, 1).from).toBe('2026-04-01');
  });

  it('treats the last day as inside it', () => {
    expect(leaveYearFor('2027-03-31', 4, 1).from).toBe('2026-04-01');
  });
});

describe('proRataEntitlement', () => {
  const year = { from: '2026-04-01', to: '2027-04-01' };

  it('gives the full allowance to somebody who was already there', () => {
    expect(proRataEntitlement(28, '2020-01-01', year)).toBe(28);
  });

  it('gives the full allowance to somebody starting on day one', () => {
    expect(proRataEntitlement(28, '2026-04-01', year)).toBe(28);
  });

  it('halves it for somebody starting halfway through', () => {
    // 1 October is 182 of 365 days remaining.
    expect(proRataEntitlement(28, '2026-10-01', year)).toBe(14);
  });

  it('rounds to the nearest half day, because holiday is booked in halves', () => {
    const days = proRataEntitlement(28, '2026-10-15', year);
    expect(days * 2).toBe(Math.round(days * 2));
  });

  it('gives nothing to somebody who has not started yet', () => {
    // Never a negative: a leaver-shaped bug in the other direction would
    // show a person owing the company holiday.
    expect(proRataEntitlement(28, '2027-06-01', year)).toBe(0);
  });

  it('handles no recorded start date as already employed', () => {
    // Most staff records have no start date; treating that as "started
    // today" would quietly cut everybody's allowance.
    expect(proRataEntitlement(28, null, year)).toBe(28);
  });
});

describe('carriedOverDays', () => {
  it('carries what is left, up to the cap', () => {
    expect(carriedOverDays(3, 5)).toBe(3);
    expect(carriedOverDays(8, 5)).toBe(5);
  });

  it('carries nothing when the cap is zero — use it or lose it', () => {
    expect(carriedOverDays(8, 0)).toBe(0);
  });

  it('never carries a negative', () => {
    // Somebody who has overtaken their allowance starts the next year at
    // zero, not in debt. Deducting it is a payroll decision, not a rota one.
    expect(carriedOverDays(-4, 5)).toBe(0);
  });
});

describe('formatLeaveYear', () => {
  it('names the last day, not the exclusive end', () => {
    // The stored `to` is exclusive. Showing it would tell somebody their
    // leave year ends on 1 April when it ends on 31 March.
    expect(formatLeaveYear({ from: '2026-04-01', to: '2027-04-01' })).toBe(
      '1 April 2026 to 31 March 2027',
    );
  });
});
