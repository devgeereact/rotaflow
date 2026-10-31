import { describe, expect, it } from 'vitest';
import {
  chipsByShift,
  exportRangeProblem,
  flagChips,
  isLate,
  lateMinutes,
  payrollFilename,
  payrollHours,
  toleranceFrom,
  type TimesheetLine,
} from '@/lib/timesheetRules';

// S13 timesheet rules, browser side. Hours and the range rule mirror
// backend/tests/suites/255-timesheet-rules.php.
const line = (over: Partial<TimesheetLine> = {}): TimesheetLine => ({
  shift_id: 'S1',
  staff_profile_id: 'P1',
  location_id: null,
  scheduled_start: '2030-04-01T09:00:00Z',
  scheduled_end: '2030-04-01T17:00:00Z',
  break_minutes: 0,
  clock_in: '2030-04-01T09:00:00Z',
  clock_out: '2030-04-01T17:00:00Z',
  scheduled_minutes: 480,
  recorded_minutes: 480,
  variance_minutes: 0,
  late_minutes: 0,
  early_minutes: 0,
  finished: true,
  flags: {
    late: false,
    early_finish: false,
    overtime: false,
    no_clock_in: false,
    missing_clock_out: false,
  },
  ...over,
});

describe('flagChips', () => {
  it('shows no chip for a line on time', () => {
    expect(flagChips(line())).toEqual([]);
  });

  it('shows late, early finish and overtime in that order, with the minutes', () => {
    const l = line({
      late_minutes: 12,
      early_minutes: 15,
      variance_minutes: 25,
      flags: {
        late: true,
        early_finish: true,
        overtime: true,
        no_clock_in: false,
        missing_clock_out: false,
      },
    });
    expect(flagChips(l).map((c) => c.label)).toEqual([
      'Late 12 min',
      'Early finish 15 min',
      'Overtime 25 min',
    ]);
  });

  it('never makes a chip from the minutes alone: the server decides the tolerance', () => {
    expect(flagChips(line({ late_minutes: 30 }))).toEqual([]);
  });

  it('leaves no clock-in and no clock-out to the row status', () => {
    const l = line({
      clock_in: null,
      clock_out: null,
      recorded_minutes: null,
      variance_minutes: null,
      flags: {
        late: false,
        early_finish: false,
        overtime: false,
        no_clock_in: true,
        missing_clock_out: false,
      },
    });
    expect(flagChips(l)).toEqual([]);
  });

  it('indexes chips by shift', () => {
    const m = chipsByShift([
      line({ shift_id: 'A' }),
      line({
        shift_id: 'B',
        late_minutes: 11,
        flags: { ...line().flags, late: true },
      }),
    ]);
    expect(m.get('A')).toEqual([]);
    expect(m.get('B')?.[0]?.label).toBe('Late 11 min');
  });
});

describe('exportRangeProblem', () => {
  it('allows one to 31 days inclusive', () => {
    expect(exportRangeProblem('2026-10-05', '2026-10-05')).toBeNull();
    expect(exportRangeProblem('2026-10-01', '2026-10-31')).toBeNull();
  });

  it('refuses 32 days, an end before the start and dates that do not exist', () => {
    expect(exportRangeProblem('2026-10-01', '2026-11-01')).toBe(
      'Choose at most 31 days.',
    );
    expect(exportRangeProblem('2026-10-25', '2026-10-19')).toMatch(/on or after/);
    expect(exportRangeProblem('2026-02-30', '2026-03-01')).toMatch(/Choose a start/);
    expect(exportRangeProblem('', '2026-03-01')).toMatch(/Choose a start/);
  });

  it('counts calendar days, so a range across the clock change is not a day short', () => {
    expect(exportRangeProblem('2026-10-01', '2026-10-31')).toBeNull();
    expect(exportRangeProblem('2026-03-01', '2026-03-31')).toBeNull();
  });
});

describe('payrollHours', () => {
  it('matches the server for the known cases', () => {
    const cases: [number, string][] = [
      [450, '7.50'],
      [180, '3.00'],
      [205, '3.42'],
      [0, '0.00'],
      [7, '0.12'],
      [1, '0.02'],
      [59, '0.98'],
      [61, '1.02'],
      [100000, '1666.67'],
      [2430, '40.50'],
    ];
    for (const [m, want] of cases) expect(payrollHours(m)).toBe(want);
  });

  it('agrees with integer rounding for every minute up to 6000 (no float drift)', () => {
    for (let m = 0; m <= 6000; m++) {
      const h = Math.floor((m * 100 + 30) / 60);
      expect(payrollHours(m)).toBe(
        `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`,
      );
    }
  });
});

describe('lateMinutes and isLate (mirrors suite 255)', () => {
  const start = Date.UTC(2030, 3, 1, 9, 0, 0);
  const at = (min: number, sec = 0): number => start + min * 60_000 + sec * 1000;

  it('counts whole minutes after the start, the floor, never below 0', () => {
    expect(lateMinutes(at(0), start)).toBe(0);
    expect(lateMinutes(at(10, 59), start)).toBe(10);
    expect(lateMinutes(at(11), start)).toBe(11);
    expect(lateMinutes(at(-30), start)).toBe(0);
    expect(lateMinutes(at(0, 59) + 999, start)).toBe(0);
  });

  it('is late only beyond the tolerance', () => {
    expect(isLate(at(10), start, 10)).toBe(false);
    expect(isLate(at(10, 59), start, 10)).toBe(false);
    expect(isLate(at(11), start, 10)).toBe(true);
    expect(isLate(at(11), start, 15)).toBe(false);
    expect(isLate(at(0, 59), start, 0)).toBe(false);
    expect(isLate(at(1), start, 0)).toBe(true);
    expect(isLate(at(-5), start, 0)).toBe(false);
    expect(isLate(at(121), start, 120)).toBe(true);
  });
});

describe('toleranceFrom and payrollFilename', () => {
  it('reads a whole number 0 to 120, else 10', () => {
    expect(toleranceFrom({})).toBe(10);
    expect(toleranceFrom(null)).toBe(10);
    expect(toleranceFrom({ timesheet_tolerance_minutes: 0 })).toBe(0);
    expect(toleranceFrom({ timesheet_tolerance_minutes: 5 })).toBe(5);
    expect(toleranceFrom({ timesheet_tolerance_minutes: 7.5 })).toBe(10);
    expect(toleranceFrom({ timesheet_tolerance_minutes: 121 })).toBe(10);
    expect(toleranceFrom({ timesheet_tolerance_minutes: '15' })).toBe(10);
  });

  it('names the download after the organisation and its dates (mirrors suite 255)', () => {
    expect(payrollFilename('payroll-org', '2026-10-19', '2026-10-25')).toBe(
      'rotaflow-timesheets-payroll-org-2026-10-19-2026-10-25.csv',
    );
    expect(payrollFilename('../Café & "Co";x=1', '2026-10-19', '2026-10-25')).toBe(
      'rotaflow-timesheets-caf-co-x-1-2026-10-19-2026-10-25.csv',
    );
    expect(payrollFilename(null, '2026-10-19', '2026-10-25')).toBe(
      'rotaflow-timesheets-organisation-2026-10-19-2026-10-25.csv',
    );
    expect(payrollFilename('---', '2026-10-19', '2026-10-25')).toBe(
      'rotaflow-timesheets-organisation-2026-10-19-2026-10-25.csv',
    );
    expect(payrollFilename(`${'a'.repeat(59)}-bbbb`, '2026-10-19', '2026-10-25')).toBe(
      `rotaflow-timesheets-${'a'.repeat(59)}-2026-10-19-2026-10-25.csv`,
    );
    expect(payrollFilename('Ü'.repeat(80), '2026-10-19', '2026-10-25')).toMatch(
      /^[a-z0-9.-]+$/,
    );
  });
});
