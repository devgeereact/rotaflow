import { describe, expect, it } from 'vitest';
import {
  buildExceptions,
  buildWeeklyPattern,
  resolveTeamAvailabilityForDate,
} from '@/lib/availabilityRows';
import type { Availability } from '@/types';

function mkEntry(overrides: Partial<Availability> = {}): Availability {
  return {
    id: 'entry-1',
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    weekday: null,
    date: null,
    start_time: null,
    end_time: null,
    status: 'available',
    recurring: false,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildWeeklyPattern', () => {
  it('defaults every day with no entry to available, Monday first', () => {
    const days = buildWeeklyPattern([]);
    expect(days.map((d) => d.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(days.every((d) => d.available && d.note === null && d.entryId === null)).toBe(
      true,
    );
  });

  it('marks a recurring unavailable weekday entry as unavailable, no note', () => {
    const entries = [
      mkEntry({ id: 'e1', recurring: true, weekday: 2, status: 'unavailable' }),
    ];
    const days = buildWeeklyPattern(entries);
    const wed = days.find((d) => d.weekday === 2)!;
    expect(wed).toMatchObject({ available: false, note: null, entryId: 'e1' });
  });

  it('derives a "From HH:mm" note for a recurring available entry with only a start time', () => {
    const entries = [
      mkEntry({
        id: 'e2',
        recurring: true,
        weekday: 4,
        status: 'available',
        start_time: '12:00:00',
        end_time: null,
      }),
    ];
    const days = buildWeeklyPattern(entries);
    const fri = days.find((d) => d.weekday === 4)!;
    expect(fri).toMatchObject({ available: true, note: 'From 12:00', entryId: 'e2' });
  });

  it('ignores non-recurring (dated) entries entirely', () => {
    const entries = [
      mkEntry({ recurring: false, date: '2026-08-20', status: 'unavailable' }),
    ];
    const days = buildWeeklyPattern(entries);
    expect(days.every((d) => d.available && d.entryId === null)).toBe(true);
  });
});

describe('buildExceptions', () => {
  it('lists only dated, non-recurring entries, soonest first', () => {
    const entries = [
      mkEntry({
        id: 'late',
        recurring: false,
        date: '2026-08-29',
        status: 'available',
        start_time: '12:00:00',
      }),
      mkEntry({
        id: 'early',
        recurring: false,
        date: '2026-08-16',
        status: 'unavailable',
      }),
      mkEntry({ id: 'recurring', recurring: true, weekday: 1, status: 'unavailable' }),
    ];
    const rows = buildExceptions(entries);
    expect(rows.map((r) => r.id)).toEqual(['early', 'late']);
    expect(rows[0]).toMatchObject({
      dateLabel: '16 Aug 2026',
      availabilityLabel: 'Unavailable all day',
    });
    expect(rows[1]).toMatchObject({
      dateLabel: '29 Aug 2026',
      availabilityLabel: 'Available from 12:00',
    });
  });
});

describe('resolveTeamAvailabilityForDate', () => {
  it('defaults to available when nobody has any entry', () => {
    const rows = resolveTeamAvailabilityForDate(['s1', 's2'], [], '2026-08-12', 2);
    expect(rows).toEqual([
      { staffId: 's1', available: true },
      { staffId: 's2', available: true },
    ]);
  });

  it('reads the recurring weekday pattern when there is no dated exception', () => {
    const entries = [
      mkEntry({
        staff_profile_id: 's1',
        recurring: true,
        weekday: 2,
        status: 'unavailable',
      }),
    ];
    const rows = resolveTeamAvailabilityForDate(['s1'], entries, '2026-08-12', 2);
    expect(rows).toEqual([{ staffId: 's1', available: false }]);
  });

  it('lets a dated exception override the recurring pattern for that date', () => {
    const entries = [
      mkEntry({
        id: 'recurring',
        staff_profile_id: 's1',
        recurring: true,
        weekday: 2,
        status: 'unavailable',
      }),
      mkEntry({
        id: 'exception',
        staff_profile_id: 's1',
        recurring: false,
        date: '2026-08-12',
        status: 'available',
      }),
    ];
    const rows = resolveTeamAvailabilityForDate(['s1'], entries, '2026-08-12', 2);
    expect(rows).toEqual([{ staffId: 's1', available: true }]);
  });

  it('does not let a recurring pattern leak into a different weekday', () => {
    const entries = [
      mkEntry({
        staff_profile_id: 's1',
        recurring: true,
        weekday: 2,
        status: 'unavailable',
      }),
    ];
    // weekday 3 (Wednesday, if 2 is Tuesday) has no matching recurring entry.
    const rows = resolveTeamAvailabilityForDate(['s1'], entries, '2026-08-13', 3);
    expect(rows).toEqual([{ staffId: 's1', available: true }]);
  });
});
