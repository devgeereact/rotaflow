import { describe, expect, it } from 'vitest';
import {
  countChanges,
  dateSpan,
  expandPattern,
  formatHours,
  generateHeadline,
  groupSkipped,
  isOvernight,
  leaveClashes,
  lengthMinutes,
  parseBreak,
  type PatternFields,
  patternBody,
  patternError,
  restShortfall,
  shiftWarnings,
  summariseWarnings,
  type WarnAvailability,
  type WarnLeave,
  type WarnShift,
  weekOf,
} from '@/lib/schedulingRules';
import { zonedToUtc } from '@/lib/zonedTime';

// S11 scheduling rules. Cases ported from SiteRelay tests/scheduling-tools.test.ts and the
// warning rules of backend/src/Mod/Scheduling.php; the PHP suite 240-scheduling mirrors them.
const LON = 'Europe/London';
const H = 3_600_000;
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
  const endDate =
    end <= start
      ? `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, '0')}`
      : date;
  return {
    id: `s${seq}`,
    staff_profile_id: 'p1',
    starts_at: at(date, start),
    ends_at: at(endDate, end),
    break_minutes: 0,
    status: 'assigned',
    ...o,
  };
};

describe('rest rule', () => {
  it('needs a continuous break of the minimum in the 24 hours before a shift', () => {
    const start = Date.parse('2026-11-03T07:00:00Z');
    // Off at 22:00 the night before: 9 hours, short of 11.
    expect(restShortfall([{ s: start - 17 * H, e: start - 9 * H }], start, 11 * H)).toBe(
      9 * H,
    );
    // Off at 19:00: 12 hours, fine.
    expect(
      restShortfall([{ s: start - 20 * H, e: start - 12 * H }], start, 11 * H),
    ).toBeNull();
    // Nothing in the window: fine.
    expect(restShortfall([], start, 11 * H)).toBeNull();
  });

  it('allows a split shift when the long rest still falls in the window', () => {
    const start = Date.parse('2026-11-03T17:00:00Z');
    // 06:00-10:00 the same day, 3 hours before; the night before is free: 20h gap earlier in the window.
    expect(
      restShortfall([{ s: start - 11 * H, e: start - 7 * H }], start, 11 * H),
    ).toBeNull();
    // Worked 22:00-02:00 and 06:00-10:00: longest gap is 4h, rest before is 7h.
    expect(
      restShortfall(
        [
          { s: start - 19 * H, e: start - 15 * H },
          { s: start - 11 * H, e: start - 7 * H },
        ],
        start,
        11 * H,
      ),
    ).toBe(7 * H);
  });
});

describe('shift warnings', () => {
  it('flags short rest, measured in real hours across the clock change', () => {
    // Sat 24 Oct 14:00-22:00 BST, then Sun 25 Oct 08:00 GMT: 11 real hours (10 on the wall clock).
    const a = sh('2026-10-24', '14:00', '22:00');
    const b = sh('2026-10-25', '08:00', '16:00');
    expect(shiftWarnings([b], [a], [], [], LIMITS, LON)).toEqual({});
    const c = sh('2026-10-25', '07:30', '16:00');
    expect(shiftWarnings([c], [a], [], [], LIMITS, LON)[c.id]?.[0]).toEqual({
      code: 'rest',
      message: 'Only 10.5h rest before this shift (minimum 11h in any 24 hours)',
    });
  });

  it('a zero rest minimum turns the check off; other people and cancelled shifts never count', () => {
    const a = sh('2026-11-02', '14:00', '23:00');
    const b = sh('2026-11-03', '06:00', '14:00');
    expect(shiftWarnings([b], [a], [], [], { ...LIMITS, minRestHours: 0 }, LON)).toEqual(
      {},
    );
    expect(
      shiftWarnings([b], [{ ...a, staff_profile_id: 'p2' }], [], [], LIMITS, LON),
    ).toEqual({});
    expect(
      shiftWarnings([b], [{ ...a, status: 'cancelled' }], [], [], LIMITS, LON),
    ).toEqual({});
    expect(
      shiftWarnings([{ ...b, staff_profile_id: null }], [a], [], [], LIMITS, LON),
    ).toEqual({});
  });

  it('weekly hours: net of breaks, Monday to Sunday in the organisation zone', () => {
    // Mon-Fri 08:00-18:00 with 30 minutes off = 47.5h: fine. A Saturday 4h makes 51.5h.
    const week = ['02', '03', '04', '05', '06'].map((d) =>
      sh(`2026-11-${d}`, '08:00', '18:00', { break_minutes: 30 }),
    );
    expect(shiftWarnings(week, week, [], [], LIMITS, LON)).toEqual({});
    const sat = sh('2026-11-07', '09:00', '13:00');
    const w = shiftWarnings([sat], week, [], [], LIMITS, LON);
    expect(w[sat.id]).toEqual([
      {
        code: 'weekly_hours',
        message: '51.5h scheduled in the week of Mon 2 Nov (limit 48h)',
      },
    ]);
    // The next Monday is a new week.
    const mon = sh('2026-11-09', '09:00', '13:00');
    expect(shiftWarnings([mon], [...week, sat], [], [], LIMITS, LON)).toEqual({});
  });

  it('approved leave clashes on its local dates; pending leave does not', () => {
    const leave: WarnLeave[] = [
      {
        staff_profile_id: 'p1',
        start_date: '2026-11-04',
        end_date: '2026-11-06',
        status: 'approved',
        type: 'Holiday',
      },
      {
        staff_profile_id: 'p1',
        start_date: '2026-11-09',
        end_date: '2026-11-09',
        status: 'pending',
        type: 'holiday',
      },
    ];
    const inLeave = sh('2026-11-06', '20:00', '23:00');
    const night = sh('2026-11-03', '22:00', '06:00'); // runs into the first leave day
    const after = sh('2026-11-07', '00:00', '08:00');
    const pending = sh('2026-11-09', '09:00', '17:00');
    const w = shiftWarnings([inLeave, night, after, pending], [], leave, [], LIMITS, LON);
    expect(w[inLeave.id]).toEqual([
      { code: 'leave', message: 'On approved holiday (Wed 4 Nov – Fri 6 Nov)' },
    ]);
    expect(w[night.id]?.[0]?.code).toBe('leave');
    expect(w[after.id]).toBeUndefined();
    expect(w[pending.id]).toBeUndefined();
  });

  it('declared unavailability: a weekday window, a whole day, a one-off date, overnight', () => {
    const avail: WarnAvailability[] = [
      // Mondays (1) 18:00-22:00
      {
        staff_profile_id: 'p1',
        weekday: 1,
        date: null,
        start_time: '18:00:00',
        end_time: '22:00:00',
        status: 'unavailable',
        recurring: true,
      },
      // Sundays (0) all day
      {
        staff_profile_id: 'p1',
        weekday: 0,
        date: null,
        start_time: null,
        end_time: null,
        status: 'unavailable',
        recurring: true,
      },
      // Wed 4 Nov only
      {
        staff_profile_id: 'p1',
        weekday: null,
        date: '2026-11-04',
        start_time: null,
        end_time: null,
        status: 'unavailable',
        recurring: false,
      },
      // an 'available' row never warns
      {
        staff_profile_id: 'p1',
        weekday: 2,
        date: null,
        start_time: null,
        end_time: null,
        status: 'available',
        recurring: true,
      },
    ];
    const monDay = sh('2026-11-02', '09:00', '17:00');
    const monEve = sh('2026-11-02', '17:00', '19:00');
    const satNight = sh('2026-11-07', '22:00', '06:00'); // runs into Sunday
    const wed = sh('2026-11-04', '09:00', '12:00');
    const tue = sh('2026-11-03', '09:00', '12:00');
    const w = shiftWarnings(
      [monDay, monEve, satNight, wed, tue],
      [],
      [],
      avail,
      LIMITS,
      LON,
    );
    expect(w[monDay.id]).toBeUndefined();
    expect(w[monEve.id]).toEqual([
      { code: 'unavailable', message: 'Declared unavailable Mondays 18:00–22:00' },
    ]);
    expect(w[satNight.id]).toEqual([
      { code: 'unavailable', message: 'Declared unavailable Sundays all day' },
    ]);
    expect(w[wed.id]).toEqual([
      { code: 'unavailable', message: 'Declared unavailable Wed 4 Nov all day' },
    ]);
    expect(w[tue.id]).toBeUndefined();
  });

  it('a site in another zone reads leave and availability in its own zone', () => {
    const leave: WarnLeave[] = [
      {
        staff_profile_id: 'p1',
        start_date: '2026-11-05',
        end_date: '2026-11-05',
        status: 'approved',
        type: 'holiday',
      },
    ];
    // 4 Nov 20:00 New York is 5 Nov 01:00 UTC: not on leave there.
    const ny = { ...sh('2026-11-05', '01:00', '03:00'), timezone: 'America/New_York' };
    ny.starts_at = '2026-11-05T01:00:00Z';
    ny.ends_at = '2026-11-05T03:00:00Z';
    expect(shiftWarnings([ny], [], leave, [], LIMITS, LON)).toEqual({});
    expect(
      shiftWarnings([{ ...ny, timezone: null }], [], leave, [], LIMITS, LON)[ny.id]?.[0]
        ?.code,
    ).toBe('leave');
  });

  it('helpers: hours, spans, weeks and the summary order', () => {
    expect(formatHours(8 * H)).toBe('8h');
    expect(formatHours(7.5 * H)).toBe('7.5h');
    expect(dateSpan('2026-11-02', '2026-11-02')).toBe('Mon 2 Nov');
    expect(weekOf('2026-10-25T23:30:00Z', LON)).toBe('2026-10-19'); // Sun 25 Oct 23:30 GMT
    expect(weekOf('2026-10-25T23:30:00Z', 'Europe/Berlin')).toBe('2026-10-26'); // already Monday there
    expect(
      summariseWarnings([
        { warnings: [{ code: 'rest' }, { code: 'leave' }] },
        { warnings: [{ code: 'rest' }] },
        { warnings: [] },
      ]).map((x) => [x.code, x.count]),
    ).toEqual([
      ['leave', 1],
      ['rest', 2],
    ]);
  });

  it('leave clashes count only the person’s live shifts', () => {
    const shifts = [
      sh('2026-11-04', '09:00', '17:00'),
      sh('2026-11-04', '18:00', '20:00', { status: 'cancelled' }),
      sh('2026-11-05', '09:00', '17:00', { staff_profile_id: 'p2' }),
      sh('2026-11-07', '09:00', '17:00'),
    ];
    expect(
      leaveClashes(shifts, 'p1', '2026-11-04', '2026-11-06', LON).map((s) => s.id),
    ).toEqual([shifts[0]?.id]);
  });
});

describe('patterns', () => {
  it('overnight and shift length wrap past midnight', () => {
    expect(isOvernight('22:00', '06:00')).toBe(true);
    expect(isOvernight('06:00', '14:00')).toBe(false);
    expect(lengthMinutes('22:00', '06:00')).toBe(480);
    expect(lengthMinutes('09:00', '13:30')).toBe(270);
    expect(lengthMinutes('09:00', '09:00')).toBe(0);
    expect(lengthMinutes('9am', '10:00')).toBe(0);
  });

  it('break parses whole minutes', () => {
    expect(parseBreak('')).toBe(0);
    expect(parseBreak(' 30 ')).toBe(30);
    for (const bad of ['1441', '-5', '7.5', 'half']) expect(parseBreak(bad)).toBeNull();
  });

  it('weekly and cycle rules expand to local items, overnight blocks ending the next day', () => {
    const weekly = expandPattern({
      kind: 'weekly',
      weekdays: [1, 3],
      from: '2026-11-02',
      to: '2026-11-08',
      blocks: [
        { start: '06:00', end: '10:00' },
        { start: '22:00', end: '06:00' },
      ],
    });
    expect(weekly).toEqual([
      { date: '2026-11-02', start: '06:00', endDate: '2026-11-02', end: '10:00' },
      { date: '2026-11-02', start: '22:00', endDate: '2026-11-03', end: '06:00' },
      { date: '2026-11-04', start: '06:00', endDate: '2026-11-04', end: '10:00' },
      { date: '2026-11-04', start: '22:00', endDate: '2026-11-05', end: '06:00' },
    ]);
    // 4 on 4 off anchored two days before the range: days 3 and 4 of the first run, then 4 off, then on.
    const cycle = expandPattern({
      kind: 'cycle',
      daysOn: 4,
      daysOff: 4,
      cycleStart: '2026-10-31',
      from: '2026-11-02',
      to: '2026-11-11',
      blocks: [{ start: '07:00', end: '19:00' }],
    });
    expect(cycle.map((x) => x.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ]);
  });

  it('pattern times stay on the wall clock across the clock change', () => {
    const items = expandPattern({
      kind: 'weekly',
      weekdays: [6, 7, 1],
      from: '2026-10-24',
      to: '2026-10-26',
      blocks: [{ start: '06:00', end: '14:00' }],
    });
    expect(items.map((i) => at(i.date, i.start))).toEqual([
      '2026-10-24T05:00:00Z', // BST
      '2026-10-25T06:00:00Z', // GMT from the Sunday
      '2026-10-26T06:00:00Z',
    ]);
  });

  const form = (o: Partial<PatternFields> = {}): PatternFields => ({
    kind: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    daysOn: '4',
    daysOff: '4',
    cycleStart: '2026-11-02',
    from: '2026-11-02',
    to: '2026-11-29',
    blocks: [{ start: '06:00', end: '14:00' }],
    staffProfileId: '',
    locationId: 'l1',
    shiftTypeId: '',
    breakRaw: '0',
    notes: '',
    ...o,
  });

  it('pattern checks catch what the server would refuse', () => {
    expect(patternError(form())).toBe('');
    expect(patternError(form({ kind: 'cycle' }))).toBe('');
    expect(patternError(form({ weekdays: [] }))).toMatch(/day of the week/);
    expect(patternError(form({ kind: 'cycle', daysOn: '0' }))).toMatch(/Days on/);
    expect(patternError(form({ kind: 'cycle', daysOff: '29' }))).toMatch(/Days on/);
    expect(patternError(form({ kind: 'cycle', cycleStart: '2026-11-03' }))).toMatch(
      /on or before/,
    );
    expect(patternError(form({ to: '2026-11-01' }))).toMatch(/on or after/);
    expect(patternError(form({ to: '2027-02-02' }))).toMatch(/92 days/);
    expect(patternError(form({ to: '2027-02-01' }))).toBe('');
    expect(patternError(form({ blocks: [] }))).toMatch(/time blocks/);
    expect(patternError(form({ blocks: [{ start: '09:00', end: '09:00' }] }))).toMatch(
      /different/,
    );
    expect(patternError(form({ breakRaw: '480' }))).toMatch(/shorter/);
    expect(patternError(form({ breakRaw: 'x' }))).toMatch(/Break/);
    expect(
      patternError(form({ weekdays: [6], from: '2026-11-02', to: '2026-11-06' })),
    ).toMatch(/no working days/);
    expect(patternError(form(), { start: '2026-11-02', end: '2026-11-08' })).toMatch(
      /period/,
    );
    expect(
      patternError(form({ to: '2026-11-08' }), {
        start: '2026-11-02',
        end: '2026-11-08',
      }),
    ).toBe('');
    const six = Array.from({ length: 6 }, (_, i) => ({
      start: `${String(i * 4).padStart(2, '0')}:00`,
      end: `${String(i * 4 + 1).padStart(2, '0')}:00`,
    }));
    expect(
      patternError(
        form({
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          from: '2026-11-01',
          to: '2027-01-31',
          blocks: six,
        }),
      ),
    ).toMatch(/limit is 500/);
  });

  it('pattern body matches the API', () => {
    expect(
      patternBody(
        form({
          weekdays: [5, 1, 1, 3],
          staffProfileId: 'p1',
          breakRaw: '30',
          notes: ' Lock up ',
        }),
        true,
      ),
    ).toEqual({
      kind: 'weekly',
      weekdays: [1, 3, 5],
      from_date: '2026-11-02',
      to_date: '2026-11-29',
      blocks: [{ start: '06:00', end: '14:00' }],
      staff_profile_id: 'p1',
      location_id: 'l1',
      shift_type_id: null,
      break_minutes: 30,
      notes: 'Lock up',
      preview: true,
    });
    const cycle = patternBody(form({ kind: 'cycle', daysOn: '2', daysOff: '3' }), false);
    expect([
      cycle.days_on,
      cycle.days_off,
      cycle.cycle_start,
      cycle.weekdays,
      cycle.staff_profile_id,
      cycle.preview,
    ]).toEqual([2, 3, '2026-11-02', undefined, null, false]);
  });

  it('results read clearly, previews included; skips grouped; changes counted', () => {
    expect(generateHeadline({ created: 1, preview: false })).toBe(
      'Created 1 draft shift.',
    );
    expect(generateHeadline({ created: 3 })).toBe('Created 3 draft shifts.');
    expect(generateHeadline({ created: 0 })).toBe('No draft shifts were created.');
    expect(generateHeadline({ created: 4, preview: true })).toBe(
      'Would create 4 draft shifts.',
    );
    expect(generateHeadline({ created: 0, preview: true })).toBe(
      'This would not create any shifts.',
    );
    expect(
      groupSkipped([
        { reason: 'overlap' },
        { reason: 'duplicate' },
        { reason: 'overlap' },
        { reason: 'mystery' },
      ]),
    ).toEqual([
      { reason: 'overlap', label: 'Person already working then', count: 2 },
      { reason: 'duplicate', label: 'Already on the rota', count: 1 },
      { reason: 'mystery', label: 'Skipped', count: 1 },
    ]);
    expect(
      countChanges([
        { change: 'new' },
        { change: 'new' },
        { change: 'cancelled' },
        { change: 'unchanged' },
      ]),
    ).toEqual({
      new: 2,
      unchanged: 1,
      cancelled: 1,
    });
  });
});
