import { describe, expect, it } from 'vitest';
import {
  countByStatus,
  decimalHours,
  splitOvertime,
  type TimesheetRow,
} from '@/lib/timesheetRows';

/**
 * Overtime is a pay multiplier, so the boundary between regular and overtime
 * minutes is worth more per unit than anything else computed in this app.
 */

describe('splitOvertime', () => {
  it('counts everything as regular below the contracted week', () => {
    expect(splitOvertime(30 * 60, 37.5)).toEqual({ regular: 1800, overtime: 0 });
  });

  it('splits at the contracted threshold', () => {
    // 42 hours against a 37.5-hour contract: 4.5 hours of overtime.
    expect(splitOvertime(42 * 60, 37.5)).toEqual({ regular: 2250, overtime: 270 });
  });

  it('treats exactly the contracted week as all regular', () => {
    // The off-by-one that would pay an hour of overtime to everyone who works
    // exactly their contract.
    expect(splitOvertime(37.5 * 60, 37.5)).toEqual({ regular: 2250, overtime: 0 });
  });

  it('puts one minute over the contract into overtime', () => {
    expect(splitOvertime(37.5 * 60 + 1, 37.5)).toEqual({ regular: 2250, overtime: 1 });
  });

  it('counts everything as regular when no contract is on file', () => {
    // Deliberate: inventing a default threshold (37.5? 40?) would silently
    // manufacture overtime for someone whose contract nobody has entered.
    expect(splitOvertime(60 * 60, null)).toEqual({ regular: 3600, overtime: 0 });
  });

  it('handles a zero-hours contract. Every minute is overtime', () => {
    // Zero-hours is common in this market and is NOT the same as "no contract".
    expect(splitOvertime(8 * 60, 0)).toEqual({ regular: 0, overtime: 480 });
  });

  it('splits a fractional contract without drift', () => {
    const { regular, overtime } = splitOvertime(40 * 60, 37.5);
    expect(regular + overtime).toBe(2400);
    expect(overtime).toBe(150);
  });

  it('never loses or invents minutes', () => {
    for (const worked of [0, 1, 599, 2250, 2251, 6000]) {
      for (const contract of [null, 0, 20, 37.5, 40]) {
        const { regular, overtime } = splitOvertime(worked, contract);
        expect(regular + overtime).toBe(worked);
        expect(regular).toBeGreaterThanOrEqual(0);
        expect(overtime).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reports zero for a week with no work', () => {
    expect(splitOvertime(0, 37.5)).toEqual({ regular: 0, overtime: 0 });
  });
});

describe('decimalHours', () => {
  it('formats whole hours to two places', () => {
    expect(decimalHours(1920)).toBe('32.00');
  });

  it('formats a half hour', () => {
    expect(decimalHours(90)).toBe('1.50');
  });

  it('formats zero', () => {
    expect(decimalHours(0)).toBe('0.00');
  });

  it('rounds a third of an hour rather than truncating', () => {
    expect(decimalHours(20)).toBe('0.33');
    expect(decimalHours(50)).toBe('0.83');
  });
});

describe('countByStatus', () => {
  const row = (status: TimesheetRow['status']): TimesheetRow => ({
    id: `row-${status}-${Math.abs(status.length)}`,
    firstName: 'A',
    lastName: 'B',
    jobTitle: null,
    photoUrl: null,
    weekLabel: '26 May-1 Jun 2025',
    shifts: 1,
    regularHours: '8.00',
    overtimeHours: '0.00',
    doubleTimeHours: null,
    totalHours: '8.00',
    totalCost: null,
    status,
  });

  it('returns every status even when none are present', () => {
    const counts = countByStatus([]);
    expect(counts).toHaveLength(5);
    expect(counts.every((c) => c.count === 0)).toBe(true);
  });

  it('keeps the reference’s legend order', () => {
    // The donut and its legend read in this order in
    // design/Timesheets-Dashboard.png; re-ordering silently mislabels slices.
    expect(countByStatus([]).map((c) => c.status)).toEqual([
      'pending',
      'submitted',
      'approved',
      'rejected',
      'cancelled',
    ]);
  });

  it('counts each status', () => {
    const counts = countByStatus([
      row('pending'),
      row('pending'),
      row('approved'),
      row('cancelled'),
    ]);

    expect(counts.find((c) => c.status === 'pending')?.count).toBe(2);
    expect(counts.find((c) => c.status === 'approved')?.count).toBe(1);
    expect(counts.find((c) => c.status === 'rejected')?.count).toBe(0);
  });

  it('accounts for every row exactly once', () => {
    const rows = [row('pending'), row('submitted'), row('approved'), row('rejected')];
    const total = countByStatus(rows).reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(rows.length);
  });
});
