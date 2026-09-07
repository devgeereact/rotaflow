import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * An unavailable control says why it is unavailable.
 *
 * `docs/SAAS.md`'s repolish rule: "every interactive control needs a real
 * outcome, or a deliberate non-interactive unavailable explanation.
 * Permanently dead primary actions are not acceptable polish."
 *
 * ## Why a source scan rather than a render test
 *
 * The rule is about controls that are *unconditionally* disabled — written
 * `disabled` with no expression. A `disabled={busy}` is a loading state and
 * needs no explanation; a bare `disabled` is a promise the product does not
 * keep, and the only acceptable version of it carries a sentence saying so.
 *
 * Rendering every one of them would mean mounting most of the application
 * with a session, an organisation and a role. The question here is textual —
 * "does this control have a title next to its `disabled`" — and the source
 * answers it directly and cannot drift from what ships.
 *
 * ## What it found when it was written
 *
 * Six unconditionally-disabled controls across the tree. Five in the platform
 * console already carried an explanation ("Flags are declared in migration
 * 0022, because code checks the key by name"), which is the standard this
 * asserts. One did not: the "Take it" button on a clashing open shift, whose
 * reason lived only in an adjacent badge — and a disabled button is not
 * focusable, so a keyboard user never reaches it to ask, and a pointer user
 * hovering it got nothing.
 */

const ROOT = path.join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
  });
}

/**
 * A bare `disabled` prop — no `=`, so no expression gating it.
 *
 * Matched at a JSX attribute boundary so `disabled={x}`, `aria-disabled` and
 * the word inside a string or a comment do not count.
 */
const BARE_DISABLED = /(?<![\w-])disabled(?!\s*=)(?=\s*[\n/>])/g;

/** How far after the attribute to look for its explanation. */
const WINDOW = 400;

interface Finding {
  file: string;
  line: number;
}

function findingsIn(file: string): Finding[] {
  const source = readFileSync(file, 'utf8');
  const out: Finding[] = [];

  for (const match of source.matchAll(BARE_DISABLED)) {
    const from = match.index ?? 0;
    // The explanation may sit either side of the attribute within the same
    // element, so the window looks back a little as well as forward.
    const near = source.slice(Math.max(0, from - WINDOW), from + WINDOW);
    if (/\btitle=/.test(near) || /\baria-label=/.test(near)) continue;
    out.push({
      file: path.relative(process.cwd(), file),
      line: source.slice(0, from).split('\n').length,
    });
  }
  return out;
}

describe('unavailable controls explain themselves', () => {
  const files = sourceFiles(ROOT);

  it('scans a non-trivial number of components', () => {
    // Guards the guard: a broken walk that found nothing would pass the real
    // assertion silently, which is the failure mode this repository keeps
    // finding in its own gates.
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds at least one control to check, so the pattern still matches', () => {
    const total = files.reduce((sum, file) => {
      const source = readFileSync(file, 'utf8');
      return sum + [...source.matchAll(BARE_DISABLED)].length;
    }, 0);
    // If this ever reaches zero, either every dead control was removed — good,
    // and delete this file — or the regex stopped matching the syntax in use.
    expect(total).toBeGreaterThan(0);
  });

  it('every permanently disabled control carries a reason', () => {
    const findings = files.flatMap(findingsIn);
    expect(
      findings.map((f) => `${f.file}:${f.line}`),
      'A control disabled with no condition is a promise the product does not keep. ' +
        'Give it a `title` saying why it is unavailable, or remove it.',
    ).toEqual([]);
  });
});
