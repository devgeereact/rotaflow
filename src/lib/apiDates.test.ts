import { describe, expect, it } from 'vitest';
import { isoFromSql, normaliseApiDates } from '@/lib/apiDates';

describe('API timestamps', () => {
  it('reads a database datetime as UTC', () => {
    expect(isoFromSql('2026-07-01 09:30:00')).toBe('2026-07-01T09:30:00Z');
    expect(new Date(isoFromSql('2026-07-01 09:30:00')).toISOString()).toBe(
      '2026-07-01T09:30:00.000Z',
    );
    expect(isoFromSql('2026-07-01 09:30:00.123456')).toBe('2026-07-01T09:30:00.123456Z');
  });

  it('leaves dates, times of day, ISO strings and prose alone', () => {
    for (const v of [
      '2026-07-01',
      '09:30:00',
      '2026-07-01T09:30:00Z',
      'Meet at 2026-07-01 09:30:00 sharp',
      '',
    ]) {
      expect(isoFromSql(v)).toBe(v);
    }
  });

  it('walks objects and arrays without touching other types', () => {
    const input = {
      a: '2026-01-02 03:04:05',
      n: 3,
      b: true,
      z: null,
      list: [{ at: '2026-01-02 03:04:05', d: '2026-01-02' }],
    };
    expect(normaliseApiDates(input)).toEqual({
      a: '2026-01-02T03:04:05Z',
      n: 3,
      b: true,
      z: null,
      list: [{ at: '2026-01-02T03:04:05Z', d: '2026-01-02' }],
    });
  });
});
