import { describe, expect, it } from 'vitest';
import { greeting } from '@/components/dashboard/dashboardFormat';

/**
 * `greeting` is read in the organisation's timezone, not the browser's, which
 * is the whole reason it takes one. These assertions pin both the boundaries
 * and that fact — an instant that is morning in London is the evening before
 * in Los Angeles, and the same call must say so.
 */
describe('greeting', () => {
  const at = (iso: string): Date => new Date(iso);

  it('says morning between 05:00 and noon', () => {
    expect(greeting(at('2026-09-11T05:00:00Z'), 'Europe/London')).toBe('Good morning');
    expect(greeting(at('2026-09-11T10:59:00Z'), 'Europe/London')).toBe('Good morning');
  });

  it('says afternoon from noon until 18:00', () => {
    // 12:00 and 17:59 London, which is 11:00 and 16:59 UTC in September.
    expect(greeting(at('2026-09-11T11:00:00Z'), 'Europe/London')).toBe('Good afternoon');
    expect(greeting(at('2026-09-11T16:59:00Z'), 'Europe/London')).toBe('Good afternoon');
  });

  it('says evening from 18:00 through the small hours', () => {
    expect(greeting(at('2026-09-11T17:00:00Z'), 'Europe/London')).toBe('Good evening');
    // 22:00, the start of a night shift — the case that made this a defect.
    expect(greeting(at('2026-09-11T21:00:00Z'), 'Europe/London')).toBe('Good evening');
    expect(greeting(at('2026-09-11T03:00:00Z'), 'Europe/London')).toBe('Good evening');
  });

  it('reads the hour in the organisation timezone, not UTC', () => {
    const instant = at('2026-09-11T08:00:00Z');
    expect(greeting(instant, 'Europe/London')).toBe('Good morning');
    // The same instant is 01:00 the same day in Los Angeles.
    expect(greeting(instant, 'America/Los_Angeles')).toBe('Good evening');
  });

  it('respects a clock change rather than assuming a fixed offset', () => {
    // 00:30 UTC on 25 October 2026 is 01:30 BST, before the change back.
    expect(greeting(at('2026-10-25T00:30:00Z'), 'Europe/London')).toBe('Good evening');
  });
});
