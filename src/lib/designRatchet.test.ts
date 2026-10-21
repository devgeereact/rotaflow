import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design-drift ratchets.
 *
 * The visual language adopted on 2026-10-12 (docs/DESIGN-SYSTEM.md "Visual
 * language") is flat, monochrome-plus-one and colour-only on hover. The tree
 * already holds patterns that predate it, and rewriting them all at once is a
 * restyle of every screen. So each pattern is counted, the count measured on
 * 2026-10-12 is written down below, and this test fails only when a count
 * RISES. A change that removes some lowers the number it should be compared
 * against: lower the baseline in the same change, so the ratchet only turns
 * one way.
 *
 * Comments are stripped before counting, so a comment that names a hex value
 * to explain a token is not drift. Test files are not scanned.
 *
 * This is a test rather than an ESLint rule on purpose: `eslint.config.js` is a
 * protected file, and a rule that errors on today's tree would have to be
 * switched off where it matters most.
 */

const SRC = resolve(__dirname, '..');

/**
 * Files whose job is to hold colour values. Everything else takes a token
 * class. Each entry is a palette with its own drift check, or a third-party
 * mark whose colours are not ours to choose.
 */
const PALETTE_FILES = new Set([
  'index.css',
  'lib/chartPalette.ts',
  'lib/jobTitlePalette.ts',
  'lib/shiftPalette.ts',
  // Google's own four-colour "G", required unaltered by its brand rules.
  'components/ui/icons/GoogleIcon.tsx',
]);

/**
 * Measured 2026-10-12, after the primitive changes that introduced this test.
 * On main at 8f01667, before them, the same scan read 78 / 16 / 8 / 13: Button
 * carried four alpha hovers and a hover scale, and Modal a `shadow-lg`.
 */
const BASELINE = {
  /** `bg-success/10` and friends: alpha status fills instead of the opaque washes. */
  alphaStatusWash: 74,
  /** A raw hex colour in a file that is not a palette. */
  hexOutsidePalette: 16,
  /** A hover that moves the box. Hover is a colour change only. */
  hoverScale: 7,
  /** The floating shadow used on something that does not float. */
  shadowLg: 12,
} as const;

const PATTERNS: Record<keyof typeof BASELINE, RegExp> = {
  alphaStatusWash: /bg-(?:success|warning|danger|info)\/[0-9]/g,
  hexOutsidePalette: /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
  hoverScale: /hover:scale-/g,
  shadowLg: /\bshadow-lg\b/g,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(tsx?|css)$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path];
  });
}

/** Removes block and line comments. Good enough for counting, not a parser. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function measure(): Record<keyof typeof BASELINE, Map<string, number>> {
  const found = {
    alphaStatusWash: new Map<string, number>(),
    hexOutsidePalette: new Map<string, number>(),
    hoverScale: new Map<string, number>(),
    shadowLg: new Map<string, number>(),
  };
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const key of Object.keys(PATTERNS) as Array<keyof typeof BASELINE>) {
      if (key === 'hexOutsidePalette' && PALETTE_FILES.has(rel)) continue;
      // The token definition itself (`--shadow-lg`) is not a use of it.
      if (key === 'shadowLg' && rel === 'index.css') continue;
      const count = text.match(PATTERNS[key])?.length ?? 0;
      if (count > 0) found[key].set(rel, count);
    }
  }
  return found;
}

describe('design ratchets', () => {
  const found = measure();

  it.each(Object.keys(BASELINE) as Array<keyof typeof BASELINE>)(
    '%s does not rise above its baseline',
    (key) => {
      const total = [...found[key].values()].reduce((a, b) => a + b, 0);
      const where = [...found[key].entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${f} (${n})`)
        .join(', ');
      expect(
        total,
        `${key}: ${total} found, baseline ${BASELINE[key]}. Use the token or the primitive ` +
          `instead (docs/DESIGN-SYSTEM.md). Found in: ${where}`,
      ).toBeLessThanOrEqual(BASELINE[key]);
    },
  );
});
