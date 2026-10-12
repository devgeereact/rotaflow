import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Text-on-surface contrast, computed from the stylesheet itself.
 *
 * The axe gate in `e2e/app-surface.spec.ts` measures what it can render and
 * open; this measures what the tokens *permit*. It reads the `@theme` block in
 * `src/index.css`, so changing a neutral or a status value re-runs the
 * arithmetic for every pair that value takes part in, in both themes, without
 * starting a browser. The pairs are the ones docs/ACCESSIBILITY.md allows:
 * every text token on every neutral surface, and every status ink on its own
 * wash. A status DEFAULT is a fill, not text, so it is not listed here.
 */

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!match?.[1])
    throw new Error(`--color-${name} not found as a 6-digit hex in index.css`);
  return match[1];
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 2.x contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const STATUSES = ['success', 'warning', 'danger', 'info'] as const;

interface Theme {
  name: string;
  texts: string[];
  surfaces: string[];
  /** [ink, wash] pairs: a status label on its own wash. */
  washPairs: Array<[string, string]>;
}

const THEMES: Theme[] = [
  {
    name: 'light',
    texts: [
      'content',
      'content-muted',
      'secondary',
      'primary-ink',
      ...STATUSES.map((s) => `${s}-ink`),
    ],
    surfaces: ['background', 'surface', 'surface-subtle', 'surface-rail', 'primary-wash'],
    washPairs: [
      ...STATUSES.flatMap((s): Array<[string, string]> => [
        [`${s}-ink`, `${s}-wash`],
        ['content', `${s}-wash`],
        ['content-muted', `${s}-wash`],
      ]),
      ['primary-fg', 'primary'],
    ],
  },
  {
    name: 'dark',
    texts: [
      'content-dark',
      'content-muted-dark',
      'secondary-dark',
      'primary-ink-dark',
      ...STATUSES.map((s) => `${s}-ink-dark`),
    ],
    surfaces: [
      'background-dark',
      'surface-dark',
      'surface-subtle-dark',
      'surface-rail-dark',
      'primary-wash-dark',
    ],
    washPairs: STATUSES.flatMap((s): Array<[string, string]> => [
      [`${s}-ink-dark`, `${s}-wash-dark`],
      ['content-dark', `${s}-wash-dark`],
      ['content-muted-dark', `${s}-wash-dark`],
    ]),
  },
];

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the textbook 4.54:1.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe.each(THEMES)('$name theme tokens', ({ texts, surfaces, washPairs }) => {
  const surfacePairs = texts.flatMap((t) =>
    surfaces.map((s): [string, string] => [t, s]),
  );

  it.each(surfacePairs)('%s on %s meets 4.5:1', (text, surface) => {
    const ratio = contrast(token(text), token(surface));
    expect(
      ratio,
      `${text} on ${surface} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA);
  });

  it.each(washPairs)('%s on %s meets 4.5:1', (text, wash) => {
    const ratio = contrast(token(text), token(wash));
    expect(ratio, `${text} on ${wash} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA,
    );
  });
});
