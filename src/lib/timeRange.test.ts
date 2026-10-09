import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
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

/**
 * The rule this module exists for, enforced over the tree rather than trusted.
 *
 * `RANGE_DASH`'s own comment says "never write a hyphen or a comma between two
 * times", and seven call sites were doing exactly that anyway — the rota's
 * shift-type chips, both schedules, the swap card, the timesheet's planned
 * column, the assistant's suggestions and the staff dashboard. Each one showed
 * `07:00, 15:00`, which reads as two separate times rather than a span.
 *
 * A regex over source text, in the style of `moduleBoundaries.test.ts`: the
 * thing being prevented is visible as text, and anything that evades this is
 * strange enough to deserve a reviewer.
 */
describe('no screen writes its own time range', () => {
  const SRC = path.resolve(__dirname, '..');

  const files = (function walk(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) found.push(full);
    }
    return found;
  })(SRC);

  /**
   * `HH:MM, HH:MM` written literally, or built from two adjacent expressions
   * that both name a start and an end. Literal fixture times inside
   * `*.test.ts` files are excluded above; a demo module that spells a single
   * label is not a range and does not match.
   */
  const COMMA_RANGE = [
    /\{\s*[\w.$[\]]*[sS]tart[\w.$[\]()]*\s*\}\s*,\s*\{\s*[\w.$[\]]*[eE]nd[\w.$[\]()]*\s*\}/,
    /\$\{[^}]*[sS]tart[^}]*\}\s*,\s*\$\{[^}]*[eE]nd[^}]*\}/,
  ];

  it('builds every range through formatTimeRange or describeTimeRange', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of COMMA_RANGE) {
        const hit = pattern.exec(source);
        if (hit) offenders.push(`${path.relative(SRC, file)}: ${hit[0].trim()}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
