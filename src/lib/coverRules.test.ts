import { describe, expect, it } from 'vitest';
import {
  assessCover,
  coverStatusLabel,
  overlaps,
  rankCandidates,
  swapStaleReason,
  type CoverAssessment,
  type CoverPerson,
} from '@/lib/coverRules';
import type { WarnAvailability, WarnLeave, WarnShift } from '@/lib/schedulingRules';
import { addDays, zonedToUtc } from '@/lib/zonedTime';

// S12 cover rules. The same cases as backend/tests/suites/245-cover-rules.php.
const LON = 'Europe/London';
const LIMITS = { minRestHours: 11, maxWeeklyHours: 48 };
const at = (date: string, time: string): string => zonedToUtc(date, time, LON);
let seq = 0;
const sh = (
  date: string,
  start: string,
  end: string,
  o: Partial<WarnShift> = {},
): WarnShift => {
  seq += 1;
  return {
    id: `s${seq}`,
    staff_profile_id: 'sam',
    starts_at: at(date, start),
    ends_at: at(end <= start ? addDays(date, 1) : date, end),
    break_minutes: 0,
    status: 'assigned',
    timezone: null,
    ...o,
  };
};
const OK: CoverPerson = { active: true, absent: false, documents: null };
const target = sh('2029-03-21', '09:00', '17:00', {
  id: 'target',
  staff_profile_id: null,
  status: 'open',
});
const run = (
  person: CoverPerson,
  others: WarnShift[] = [],
  leave: WarnLeave[] = [],
  avail: WarnAvailability[] = [],
  limits = LIMITS,
): CoverAssessment =>
  assessCover('sam', target, person, others, leave, avail, limits, LON);
const codes = (r: CoverAssessment): string[] => r.reasons.map((x) => x.code);
const LEAVE: WarnLeave[] = [
  {
    staff_profile_id: 'sam',
    start_date: '2029-03-21',
    end_date: '2029-03-22',
    status: 'approved',
    type: 'Holiday',
  },
];
const AVAIL: WarnAvailability[] = [
  {
    staff_profile_id: 'sam',
    weekday: 3,
    date: null,
    start_time: '16:00:00',
    end_time: '22:00:00',
    status: 'unavailable',
    recurring: true,
  },
];

describe('assessCover', () => {
  it('nothing in the way means eligible, no warnings', () => {
    expect(run(OK)).toEqual({ reasons: [], warnings: [] });
  });
  it('inactive and absent come first, in that order', () => {
    expect(codes(run({ active: false, absent: true, documents: null }))).toEqual([
      'inactive',
      'absent',
    ]);
  });
  it('an overlapping shift blocks; back to back, cancelled, others and itself do not', () => {
    expect(codes(run(OK, [sh('2029-03-21', '16:00', '20:00')]))).toEqual(['overlap']);
    expect(
      codes(
        run(OK, [
          sh('2029-03-21', '17:00', '20:00'),
          sh('2029-03-21', '10:00', '12:00', { status: 'cancelled' }),
          sh('2029-03-21', '10:00', '12:00', { staff_profile_id: 'pat' }),
          { ...target, staff_profile_id: 'sam' },
        ]),
      ),
    ).toEqual([]);
  });
  it('approved leave blocks with S11 words; pending does not', () => {
    const r = run(OK, [], LEAVE);
    expect(codes(r)).toEqual(['leave']);
    expect(r.reasons[0]?.message).toBe('On approved holiday (Wed 21 Mar – Thu 22 Mar)');
    expect(run(OK, [], [{ ...LEAVE[0]!, status: 'pending' }]).reasons).toEqual([]);
  });
  it('declared unavailability blocks; an available row does not', () => {
    const r = run(OK, [], [], AVAIL);
    expect(codes(r)).toEqual(['unavailable']);
    expect(r.reasons[0]?.message).toBe('Declared unavailable Wednesdays 16:00–22:00');
    expect(run(OK, [], [], [{ ...AVAIL[0]!, status: 'available' }]).reasons).toEqual([]);
  });
  it('documents: named, unnamed, and in order', () => {
    expect(
      run({
        ...OK,
        documents: { ok: false, missing: ['DBS check', 'Right to work check'] },
      }).reasons[0]?.message,
    ).toBe('Missing or expired: DBS check, Right to work check');
    expect(
      run({ ...OK, documents: { ok: false, missing: [] } }).reasons[0]?.message,
    ).toBe('Required documents are not in order');
    expect(run({ ...OK, documents: { ok: true, missing: [] } }).reasons).toEqual([]);
  });
  it('short rest is a warning, never a reason; rest 0 turns it off', () => {
    const r = run(OK, [sh('2029-03-20', '12:00', '02:00')]);
    expect(r.reasons).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['rest']);
    expect(r.warnings[0]?.message).toBe(
      'Only 7h rest before this shift (minimum 11h in any 24 hours)',
    );
    expect(
      run(OK, [sh('2029-03-20', '12:00', '02:00')], [], [], {
        ...LIMITS,
        minRestHours: 0,
      }).warnings,
    ).toEqual([]);
  });
  it('weekly hours: exactly the limit is fine, over it warns', () => {
    const week = [
      sh('2029-03-19', '08:00', '18:00'),
      sh('2029-03-20', '08:00', '18:00'),
      sh('2029-03-22', '08:00', '18:00'),
      sh('2029-03-23', '08:00', '18:00'),
    ];
    expect(run(OK, week)).toEqual({ reasons: [], warnings: [] });
    const r = run(OK, [...week, sh('2029-03-24', '08:00', '18:00')]);
    expect(r.reasons).toEqual([]);
    expect(r.warnings).toEqual([
      {
        code: 'weekly_hours',
        message: '58h scheduled in the week of Mon 19 Mar (limit 48h)',
      },
    ]);
  });
  it('every reason at once, in the fixed order', () => {
    const r = run(
      { active: false, absent: true, documents: { ok: false, missing: ['DBS check'] } },
      [sh('2029-03-21', '08:00', '10:00')],
      LEAVE,
      AVAIL,
    );
    expect(codes(r)).toEqual([
      'inactive',
      'absent',
      'overlap',
      'leave',
      'unavailable',
      'documents',
    ]);
  });
  it('overlaps helper', () => {
    expect(overlaps([{ s: 0, e: 10 }], 5, 15)).toBe(true);
    expect(overlaps([{ s: 0, e: 10 }], 10, 15)).toBe(false);
    expect(overlaps([], 0, 1)).toBe(false);
  });
});

describe('rankCandidates', () => {
  it('eligible, then applied, then fewest hours, then fewer reasons, then name', () => {
    const rows = [
      { name: 'Zed', eligible: true, applied: false, hours: 10, reasons: [] },
      { name: 'amy', eligible: true, applied: false, hours: 10, reasons: [] },
      { name: 'Bob', eligible: false, applied: true, hours: 0, reasons: [1] },
      { name: 'Cat', eligible: true, applied: true, hours: 30, reasons: [] },
      { name: 'Dan', eligible: true, applied: false, hours: 2.5, reasons: [] },
      { name: 'Eve', eligible: false, applied: false, hours: 0, reasons: [1, 2] },
      { name: 'Fay', eligible: false, applied: false, hours: 0, reasons: [1] },
    ];
    expect(rankCandidates(rows).map((r) => r.name)).toEqual([
      'Cat',
      'Dan',
      'amy',
      'Zed',
      'Bob',
      'Fay',
      'Eve',
    ]);
  });
});

describe('swapStaleReason', () => {
  const t = Date.parse('2029-03-21T09:00:00Z');
  it('unchanged and future is fine', () => {
    expect(swapStaleReason('a', 'a', 'assigned', 'published', t, t - 1)).toBeNull();
  });
  it('a change, a cancellation or an archived rota is shift_changed', () => {
    expect(swapStaleReason('a', 'x', 'assigned', 'published', t, 0)).toBe(
      'shift_changed',
    );
    expect(swapStaleReason('a', 'a', 'cancelled', 'published', t, 0)).toBe(
      'shift_changed',
    );
    expect(swapStaleReason('a', 'a', 'assigned', 'archived', t, 0)).toBe('shift_changed');
  });
  it('started is shift_started, but a change wins', () => {
    expect(swapStaleReason('a', 'a', 'assigned', 'published', t, t)).toBe(
      'shift_started',
    );
    expect(swapStaleReason('a', 'x', 'assigned', 'published', t, t)).toBe(
      'shift_changed',
    );
  });
  it('a swap raised before fingerprints is judged on the rest', () => {
    expect(swapStaleReason(null, 'a', 'assigned', null, t, 0)).toBeNull();
    expect(swapStaleReason(null, 'a', 'assigned', null, t, t + 1)).toBe('shift_started');
  });
});

describe('coverStatusLabel', () => {
  it('says each status in plain words', () => {
    expect(coverStatusLabel('absence', 'open')).toBe('Waiting for a manager');
    expect(coverStatusLabel('absence', 'dismissed')).toBe('Still on the shift');
    expect(coverStatusLabel('request', 'filled')).toBe('Filled');
    expect(coverStatusLabel('application', 'approved')).toBe('You are covering it');
  });
});
