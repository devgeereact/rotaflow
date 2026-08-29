import { describe, expect, it } from 'vitest';
import { pairClockEvents } from '@/lib/hours';
import {
  breakWindow,
  buildAttendance,
  buildCurrentShift,
  buildRecentActivity,
  buildThisWeekRows,
  buildWeeklySummary,
  clockStage,
  clockWindow,
  manualFallbackFor,
  formatHm,
  formatSignedHm,
  pickCurrentShift,
  scheduledMinutes,
  segmentsInRange,
  shiftCountdownLabel,
  syncStatusLabel,
} from '@/lib/clockRows';
import type { ClockLookups } from '@/lib/clockRows';
import type { ClockEvent, Shift } from '@/types';

/**
 * Times are written as local-clock strings on purpose. The suite runs in
 * Europe/London and CI builds in UTC (see vitest.config), so anything that
 * hard-codes a UTC instant and asserts a rendered "09:00" passes in one zone
 * and fails in the other.
 */
function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    org_id: 'org-1',
    rota_id: 'rota-1',
    location_id: 'loc-1',
    department_id: 'dep-1',
    staff_profile_id: 'staff-1',
    shift_type_id: 'type-1',
    starts_at: '2026-05-14T09:00:00',
    ends_at: '2026-05-14T17:00:00',
    break_minutes: 30,
    status: 'assigned',
    colour: null,
    notes: null,
    created_at: '2026-05-01T00:00:00',
    updated_at: '2026-05-01T00:00:00',
    ...overrides,
  };
}

function event(overrides: Partial<ClockEvent> = {}): ClockEvent {
  return {
    id: 'event-1',
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    shift_id: null,
    type: 'in',
    method: 'gps',
    event_at: '2026-05-13T09:00:00',
    location_name: 'Sunnyvale Care Home',
    latitude: null,
    longitude: null,
    accuracy: null,
    event_at_reported: null,
    synced: true,
    created_at: '2026-05-13T09:00:00',
    updated_at: '2026-05-13T09:00:00',
    ...overrides,
  };
}

const LOOKUPS: ClockLookups = {
  locationNames: { 'loc-1': 'Sunnyvale Care Home' },
  departmentNames: { 'dep-1': 'Care Home, Floor 2' },
  shiftTypeNames: { 'type-1': 'Day Shift' },
  jobTitle: 'Senior Care Assistant',
};

describe('formatHm', () => {
  it('zero-pads minutes but never the hour, as the reference does', () => {
    expect(formatHm(2102)).toBe('35h 02m');
    expect(formatHm(2250)).toBe('37h 30m');
    expect(formatHm(30)).toBe('0h 30m');
  });

  it('never renders a negative total', () => {
    expect(formatHm(-90)).toBe('0h 00m');
  });
});

describe('formatSignedHm', () => {
  it('carries the sign the variance figure needs', () => {
    expect(formatSignedHm(148)).toBe('+2h 28m');
    expect(formatSignedHm(-65)).toBe('-1h 05m');
    expect(formatSignedHm(0)).toBe('+0h 00m');
  });
});

describe('scheduledMinutes', () => {
  it('deducts the unpaid break', () => {
    expect(scheduledMinutes(shift())).toBe(450); // 8h - 30m
  });

  it('treats a zero break as no break', () => {
    expect(scheduledMinutes(shift({ break_minutes: 0 }))).toBe(480);
  });

  it('clamps a break longer than the shift rather than going negative', () => {
    expect(scheduledMinutes(shift({ break_minutes: 900 }))).toBe(0);
  });
});

describe('clockStage', () => {
  it('reads the stage from the latest event', () => {
    expect(clockStage(null)).toBe('ready');
    expect(clockStage(event({ type: 'in' }))).toBe('working');
    expect(clockStage(event({ type: 'break_start' }))).toBe('break');
    expect(clockStage(event({ type: 'out' }))).toBe('done');
  });

  it('puts you back on shift after a break ends, not into a state of its own', () => {
    expect(clockStage(event({ type: 'break_end' }))).toBe('working');
  });
});

describe('pickCurrentShift', () => {
  const morning = shift({
    id: 'a',
    starts_at: '2026-05-14T07:00:00',
    ends_at: '2026-05-14T11:00:00',
  });
  const evening = shift({
    id: 'b',
    starts_at: '2026-05-14T18:00:00',
    ends_at: '2026-05-14T22:00:00',
  });

  it('prefers the shift in progress', () => {
    const now = new Date('2026-05-14T09:00:00');
    expect(pickCurrentShift([evening, morning], now)?.id).toBe('a');
  });

  it('falls back to the next one still to start', () => {
    const now = new Date('2026-05-14T12:00:00');
    expect(pickCurrentShift([evening, morning], now)?.id).toBe('b');
  });

  it('falls back to the last one that ran once the day is over', () => {
    const now = new Date('2026-05-14T23:30:00');
    expect(pickCurrentShift([morning, evening], now)?.id).toBe('b');
  });

  it('returns null with nothing rostered', () => {
    expect(pickCurrentShift([], new Date('2026-05-14T09:00:00'))).toBeNull();
  });
});

describe('breakWindow', () => {
  it('centres the break on the shift midpoint', () => {
    const window = breakWindow(shift());
    expect(window).not.toBeNull();
    expect(window?.start.getHours()).toBe(12);
    expect(window?.start.getMinutes()).toBe(45);
    expect(window?.end.getHours()).toBe(13);
    expect(window?.end.getMinutes()).toBe(15);
  });

  it('is null for a shift with no unpaid break', () => {
    expect(breakWindow(shift({ break_minutes: 0 }))).toBeNull();
  });

  it('is null rather than inverted when the row has ends before starts', () => {
    expect(
      breakWindow(
        shift({ starts_at: '2026-05-14T17:00:00', ends_at: '2026-05-14T09:00:00' }),
      ),
    ).toBeNull();
  });
});

describe('shiftCountdownLabel', () => {
  it('counts down to the start, then to the end, then stops', () => {
    expect(shiftCountdownLabel(shift(), new Date('2026-05-14T08:48:00'))).toBe(
      'Starts in 12 min',
    );
    expect(shiftCountdownLabel(shift(), new Date('2026-05-14T06:00:00'))).toBe(
      'Starts in 3h',
    );
    expect(shiftCountdownLabel(shift(), new Date('2026-05-14T14:30:00'))).toBe(
      'Ends in 2h 30m',
    );
    expect(shiftCountdownLabel(shift(), new Date('2026-05-14T18:00:00'))).toBe('Ended');
  });
});

describe('clockWindow', () => {
  it('opens 15 minutes before the start', () => {
    expect(clockWindow(shift(), new Date('2026-05-14T08:44:00')).within).toBe(false);
    expect(clockWindow(shift(), new Date('2026-05-14T08:46:00'))).toEqual({
      label: 'Within time window',
      within: true,
    });
  });

  it('stays open for a late clock-in. Being late must never block you', () => {
    expect(clockWindow(shift(), new Date('2026-05-14T11:30:00')).within).toBe(true);
  });

  it('closes once the shift has ended', () => {
    expect(clockWindow(shift(), new Date('2026-05-14T17:30:00'))).toEqual({
      label: 'Shift has ended',
      within: false,
    });
  });

  it('says so plainly when nothing is rostered', () => {
    expect(clockWindow(null, new Date('2026-05-14T09:00:00')).label).toBe(
      'No shift scheduled',
    );
  });
});

describe('buildCurrentShift', () => {
  const info = buildCurrentShift(shift(), LOOKUPS, new Date('2026-05-14T08:48:00'));

  it('reproduces the reference values', () => {
    expect(info.timeRange).toBe('09:00-17:00');
    expect(info.dateLabel).toBe('Today, 14 May 2026');
    expect(info.countdownLabel).toBe('Starts in 12 min');
    expect(info.locationName).toBe('Sunnyvale Care Home');
    expect(info.areaName).toBe('Care Home, Floor 2');
    expect(info.roleName).toBe('Senior Care Assistant');
    expect(info.shiftTypeName).toBe('Day Shift');
    expect(info.breakDuration).toBe('(30 min)');
    expect(info.paidHours).toBe('7h 30m');
  });

  it('drops the optional rows rather than printing an id or a blank', () => {
    const bare = buildCurrentShift(
      shift({ department_id: null, shift_type_id: null, break_minutes: 0 }),
      { ...LOOKUPS, jobTitle: null },
      new Date('2026-05-14T08:48:00'),
    );
    expect(bare.areaName).toBeNull();
    expect(bare.shiftTypeName).toBeNull();
    expect(bare.roleName).toBeNull();
    expect(bare.breakRange).toBeNull();
    expect(bare.reminder).toBeNull();
  });

  it('names an unknown location instead of leaking its uuid', () => {
    const orphan = buildCurrentShift(
      shift({ location_id: 'missing' }),
      LOOKUPS,
      new Date('2026-05-14T08:48:00'),
    );
    expect(orphan.locationName).toBe('Unassigned location');
  });
});

describe('buildThisWeekRows', () => {
  it('pairs a shift with the segment clocked in on the same day', () => {
    const events = [
      event({ id: 'in', type: 'in', event_at: '2026-05-14T09:00:00' }),
      event({ id: 'out', type: 'out', event_at: '2026-05-14T17:03:00' }),
    ];
    const segments = pairClockEvents(events, new Date('2026-05-14T18:00:00'));
    const rows = buildThisWeekRows([shift()], segments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dateLabel: 'Thu 14 May',
      plannedLabel: '09:00, 17:00',
      actualLabel: '09:00, 17:03',
      paidLabel: '8h 03m',
    });
  });

  it('shows a dash, not a zero, for a shift with no matching segment', () => {
    const rows = buildThisWeekRows([shift()], []);
    expect(rows[0]).toMatchObject({ actualLabel: '-', paidLabel: '-' });
  });

  it('sorts by shift start', () => {
    const monday = shift({
      id: 'mon',
      starts_at: '2026-05-11T09:00:00',
      ends_at: '2026-05-11T17:00:00',
    });
    const rows = buildThisWeekRows([shift(), monday], []);
    expect(rows.map((r) => r.id)).toEqual(['mon', 'shift-1']);
  });
});

describe('buildRecentActivity', () => {
  const events = [
    event({ id: 'in-1', type: 'in', event_at: '2026-05-13T09:00:00' }),
    event({ id: 'out-1', type: 'out', event_at: '2026-05-13T17:02:00' }),
  ];

  it('is newest first and prints the worked length on the clock-out', () => {
    const rows = buildRecentActivity(events, new Date('2026-05-14T08:48:00'));
    expect(rows.map((r) => r.id)).toEqual(['out-1', 'in-1']);
    expect(rows[0]).toMatchObject({
      kind: 'out',
      label: 'Clock Out',
      timeLabel: 'Yesterday, 17:02',
      durationLabel: '8h 02m',
    });
    expect(rows[1]?.durationLabel).toBeUndefined();
  });

  it('honours the limit', () => {
    expect(buildRecentActivity(events, new Date('2026-05-14T08:48:00'), 1)).toHaveLength(
      1,
    );
  });

  it('says the location was not recorded rather than rendering nothing', () => {
    const rows = buildRecentActivity(
      [event({ location_name: null })],
      new Date('2026-05-13T10:00:00'),
    );
    expect(rows[0]?.locationName).toBe('Location not recorded');
  });

  it('labels today, yesterday and older days differently', () => {
    const rows = buildRecentActivity(
      [
        event({ id: 'a', event_at: '2026-05-14T08:00:00' }),
        event({ id: 'b', event_at: '2026-05-12T17:01:00' }),
      ],
      new Date('2026-05-14T08:48:00'),
    );
    expect(rows[0]?.timeLabel).toBe('Today, 08:00');
    expect(rows[1]?.timeLabel).toBe('Tue, 12 May, 17:01');
  });
});

describe('segmentsInRange', () => {
  it('keeps a shift that started inside the week but ended after it', () => {
    // Clocks in 23:00 Sunday and out 07:00 Monday. The segment belongs
    // wholly to the week it started in, and must not be split or double-counted.
    const events = [
      event({ id: 'in', type: 'in', event_at: '2026-05-17T23:00:00' }),
      event({ id: 'out', type: 'out', event_at: '2026-05-18T07:00:00' }),
    ];
    const segments = pairClockEvents(events, new Date('2026-05-18T12:00:00'));
    const weekOf11th = segmentsInRange(
      segments,
      new Date('2026-05-11T00:00:00'),
      new Date('2026-05-18T00:00:00'),
    );
    const weekOf18th = segmentsInRange(
      segments,
      new Date('2026-05-18T00:00:00'),
      new Date('2026-05-25T00:00:00'),
    );
    expect(weekOf11th).toHaveLength(1);
    expect(weekOf11th[0]?.minutes).toBe(480);
    expect(weekOf18th).toHaveLength(0);
  });
});

describe('buildWeeklySummary', () => {
  it('totals scheduled, worked, breaks and the variance between them', () => {
    const events = [
      event({ id: 'in', type: 'in', event_at: '2026-05-14T09:00:00' }),
      event({ id: 'bs', type: 'break_start', event_at: '2026-05-14T12:45:00' }),
      event({ id: 'be', type: 'break_end', event_at: '2026-05-14T13:15:00' }),
      event({ id: 'out', type: 'out', event_at: '2026-05-14T17:00:00' }),
    ];
    const segments = pairClockEvents(events, new Date('2026-05-14T18:00:00'));
    const summary = buildWeeklySummary([shift()], segments);

    expect(summary.stats.map((s) => s.value)).toEqual([
      '7h 30m', // scheduled: 8h less the 30m break
      '7h 30m', // worked
      '0h 30m', // break
      '+0h 00m', // variance
    ]);
    expect(summary.completedPercent).toBe(100);
    expect(summary.attendancePercent).toBe(100);
  });

  it('tints only the variance, and only when it is not negative', () => {
    const short = buildWeeklySummary([shift()], []);
    expect(short.stats[3]).toMatchObject({ value: '-7h 30m', positive: false });
    expect(short.stats[0]?.positive).toBeUndefined();
  });

  it('refuses to call an unrostered week 0% attendance', () => {
    const summary = buildWeeklySummary([], []);
    expect(summary.attendancePercent).toBeNull();
    expect(summary.progressLabel).toBe('No hours scheduled this week');
    expect(summary.completedPercent).toBe(0);
  });

  it('caps the progress bar at 100 while still reporting the real percentage', () => {
    const events = [
      event({ id: 'in', type: 'in', event_at: '2026-05-14T09:00:00' }),
      event({ id: 'out', type: 'out', event_at: '2026-05-14T21:00:00' }),
    ];
    const segments = pairClockEvents(events, new Date('2026-05-14T22:00:00'));
    const summary = buildWeeklySummary([shift()], segments);
    expect(summary.completedPercent).toBe(100);
    expect(summary.attendancePercent).toBeGreaterThan(100);
  });
});

describe('buildAttendance', () => {
  it('reproduces the reference wording at full attendance', () => {
    expect(buildAttendance(100, 98)).toMatchObject({
      tone: 'good',
      statusTitle: 'On Track',
      statusBody: "Great job! You're on track this week.",
      thisWeekValue: '100%',
      lastWeekValue: '98%',
    });
  });

  it('escalates as the shortfall grows', () => {
    expect(buildAttendance(88, 90).tone).toBe('warning');
    expect(buildAttendance(40, 90).tone).toBe('bad');
  });

  it('shows a dash, not 0%, for a week with nothing scheduled', () => {
    const summary = buildAttendance(null, null);
    expect(summary.thisWeekValue).toBe('-');
    expect(summary.lastWeekValue).toBe('-');
    expect(summary.statusBody).toBe('Nothing scheduled this week.');
  });
});

/**
 * BUG-008: manual clock-IN existed and manual clock-OUT did not.
 *
 * Someone whose phone refused a position could start a shift and never end
 * one — the screen told them to "use manual clock-in instead" while they were
 * already clocked in, and the attendance event stayed open until a manager
 * amended it by hand. Location permission must not be able to lock a
 * timesheet.
 */
describe('manualFallbackFor', () => {
  it('offers a manual clock-out to someone stuck mid-shift with location denied', () => {
    expect(manualFallbackFor('working', 'denied')).toEqual({
      type: 'out',
      label: 'Clock Out Manually',
    });
  });

  it('offers it on a break too — nobody is trapped on a break they forgot to end', () => {
    expect(manualFallbackFor('break', 'unavailable')?.type).toBe('out');
  });

  it('treats a timeout or missing hardware the same as a refusal', () => {
    // `unavailable` is every non-permission failure: indoors with no fix, no
    // GPS at all, an insecure context. The person is equally stuck.
    expect(manualFallbackFor('working', 'unavailable')).not.toBeNull();
  });

  it('stays hidden until the device has actually failed', () => {
    // An always-visible "clock out without location" is a one-tap way around
    // GPS attendance. This is a fallback, not an alternative.
    expect(manualFallbackFor('working', 'idle')).toBeNull();
    expect(manualFallbackFor('working', 'prompting')).toBeNull();
    expect(manualFallbackFor('working', 'granted')).toBeNull();
  });

  it('adds nothing before a shift, where manual clock-in is already the second action', () => {
    expect(manualFallbackFor('ready', 'denied')).toBeNull();
    expect(manualFallbackFor('done', 'denied')).toBeNull();
  });
});

describe('syncStatusLabel', () => {
  it('says Synced only when the queue is actually empty', () => {
    expect(syncStatusLabel(true, 0)).toBe('Synced');
  });

  it('does NOT say Synced while writes are still queued on a connected device', () => {
    // The defect this closes: the row read `navigator.onLine` alone, so a
    // transient failure left entries in the outbox while the screen claimed
    // everything had reached the server.
    expect(syncStatusLabel(true, 1)).toBe('Sending 1 entry…');
    expect(syncStatusLabel(true, 3)).toBe('Sending 3 entries…');
    expect(syncStatusLabel(true, 2)).not.toContain('Synced');
  });

  it('reports queue depth when offline, not just that it is offline', () => {
    expect(syncStatusLabel(false, 0)).toBe('Offline');
    expect(syncStatusLabel(false, 1)).toBe('Offline, 1 waiting');
    expect(syncStatusLabel(false, 4)).toBe('Offline, 4 waiting');
  });

  it('never claims a send is complete when it is not', () => {
    for (const online of [true, false]) {
      for (const pending of [1, 2, 10]) {
        expect(syncStatusLabel(online, pending)).not.toBe('Synced');
      }
    }
  });
});
