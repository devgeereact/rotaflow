import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  toPersonalPreferences,
  weekStartsOn,
} from '@/lib/personalPreferences';
import { periodStart } from '@/lib/schedulePeriod';

describe('toPersonalPreferences', () => {
  it('reads a missing row as today’s behaviour', () => {
    expect(toPersonalPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('reads the stored values', () => {
    expect(
      toPersonalPreferences({
        time_format: '12h',
        week_start: 'sunday',
        digest_frequency: 'weekly',
      }),
    ).toEqual({ timeFormat: '12h', weekStart: 'sunday', digestFrequency: 'weekly' });
  });

  it('reads an unexpected value as the default rather than failing', () => {
    expect(
      toPersonalPreferences({
        time_format: '13h',
        week_start: 'wednesday',
        digest_frequency: 'hourly',
      }),
    ).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('weekStartsOn', () => {
  it('maps Sunday to 0 and Monday to 1', () => {
    expect(weekStartsOn('sunday')).toBe(0);
    expect(weekStartsOn('monday')).toBe(1);
  });

  it('moves a personal week to the Sunday before', () => {
    // 15 Oct 2026 is a Thursday.
    expect(periodStart('week', '2026-10-15', weekStartsOn('sunday'))).toBe('2026-10-11');
    expect(periodStart('week', '2026-10-15', weekStartsOn('monday'))).toBe('2026-10-12');
  });
});
