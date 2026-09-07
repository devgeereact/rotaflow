import { describe, expect, it } from 'vitest';
import { crossesMidnight, describeTimeRange, formatTimeRange } from '@/lib/timeRange';

describe('formatTimeRange', () => {
  it('joins a same-day range with an en dash, not a hyphen or a comma', () => {
    expect(formatTimeRange('07:00', '15:00')).toBe('07:00–15:00');
    expect(formatTimeRange('07:00', '15:00')).not.toContain('-');
    expect(formatTimeRange('07:00', '15:00')).not.toContain(',');
  });

  it('marks a shift that crosses midnight', () => {
    expect(formatTimeRange('23:00', '07:00')).toBe('23:00–07:00 (+1 day)');
  });

  it('has a compact overnight marker for a rota chip', () => {
    expect(formatTimeRange('23:00', '07:00', { overnight: 'compact' })).toBe(
      '23:00–07:00 +1',
    );
  });

  it('can suppress the marker where the date is already on the line', () => {
    expect(formatTimeRange('23:00', '07:00', { overnight: 'none' })).toBe('23:00–07:00');
  });

  it('treats an exactly-24-hour span as crossing midnight', () => {
    // Equal times cannot be a zero-length shift in this product, so the only
    // reading left is a full day ending the next morning.
    expect(crossesMidnight('08:00', '08:00')).toBe(true);
    expect(formatTimeRange('08:00', '08:00')).toBe('08:00–08:00 (+1 day)');
  });

  it('does not mark a same-day range', () => {
    expect(crossesMidnight('00:00', '23:59')).toBe(false);
  });
});

describe('describeTimeRange', () => {
  it('reads as a sentence for assistive technology', () => {
    expect(describeTimeRange('07:00', '15:00')).toBe('07:00 to 15:00');
    expect(describeTimeRange('23:00', '07:00')).toBe('23:00 to 07:00 the next day');
  });
});
