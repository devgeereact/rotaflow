import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHART_TOKENS } from '@/lib/chartPalette';

/**
 * `CHART_TOKENS` is a copy of stylesheet tokens, kept as literals because SVG
 * presentation attributes need one. A copy is only safe while something checks
 * it, so this reads `src/index.css` and compares.
 */
describe('CHART_TOKENS', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

  it.each(Object.entries(CHART_TOKENS))(
    '%s matches its --color token in index.css',
    (name, hex) => {
      const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
      expect(match, `--color-${name} not found in index.css`).not.toBeNull();
      expect(match?.[1]?.toLowerCase()).toBe(hex.toLowerCase());
    },
  );
});
