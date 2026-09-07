import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pure logic stays out of the service layer, and the unit suite stays out of it too.
 *
 * ## What used to enforce this, and why it no longer can
 *
 * Until 2026-09-07 CI ran Node 20, which has no global `WebSocket`. `supabase-js`
 * reaches for one when a client is constructed, so any module that built a client at
 * module scope crashed the moment the unit suite imported it — and the suite imports
 * everything under `src/lib`. That was never a rule anybody wrote down. It was a
 * property of an old runtime, and `CLAUDE.md` recorded it as a constraint to preserve.
 *
 * Node 20 reached end of life in April 2026, and jsdom 30 requires
 * `^22.22.2 || ^24.15.0 || >=26.0.0`. Staying on a dead runtime to keep an accidental
 * guard is the wrong trade: the runtime stops receiving security fixes, and the guard
 * was never reliable anyway — it caught the bug only when a test happened to import the
 * offending module, and said nothing about *why* it failed. Node 22 has a global
 * `WebSocket`, so the crash is gone. This test is the rule stated on purpose instead.
 *
 * ## The two boundaries, and what each is for
 *
 * `src/lib` is pure logic: it is where the arithmetic lives that unit tests can exercise
 * without a network, a database or a mock. `src/services` is where Supabase calls live.
 * The moment a `lib` module imports a service, the whole import graph beneath it drags a
 * client in, and a suite that was fast and hermetic starts depending on a connection.
 *
 * ## Type imports are allowed, value imports are not
 *
 * `import type { X } from '@/services/…'` is erased before the code runs, so it creates no
 * runtime dependency and no client. Sharing a row type with the service that returns it is
 * the right thing to do; pulling in the function that fetches it is not.
 *
 * ## What this deliberately does not do
 *
 * It does not parse TypeScript. A regex over import statements is enough, because the thing
 * being prevented is an import, and an import is visible as text. Anything that evades this
 * regex is doing something strange enough to deserve a reviewer.
 *
 * It also does not police `src/services/*.test.ts`. Those tests import services on purpose
 * and always have. `CLAUDE.md` said "unit tests never import a service", which was never
 * true of this repository — eleven of them do, and they pass. The sentence described the
 * Node 20 crash rather than a rule anybody had adopted.
 */

const SRC = path.resolve(__dirname, '..');

/**
 * Every import that survives to runtime, with its specifier.
 *
 * `import type { … }` and `export type { … }` are dropped: they are erased by the
 * compiler. A clause-level `type` marker (`import { type Foo, bar }`) is not dropped,
 * because `bar` beside it is a value.
 */
function runtimeImportsIn(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const fromClause =
    /(?:^|\n)\s*(import|export)(\s+type)?([\s\S]*?)from\s+['"]([^'"]+)['"]/g;
  const bareForms = [
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
  ];

  let match: RegExpExecArray | null;
  while ((match = fromClause.exec(source)) !== null) {
    const typeOnly = match[2] !== undefined;
    const clause = match[3] ?? '';
    const specifier = match[4];
    if (typeOnly || specifier === undefined) continue;
    // `import { type A, type B } from …` is every-binding-type-only in practice.
    const bindings = /^\s*\{([\s\S]*)\}\s*$/.exec(clause);
    if (bindings) {
      const parts = (bindings[1] ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 0 && parts.every((part) => part.startsWith('type '))) continue;
    }
    specifiers.push(specifier);
  }
  for (const pattern of bareForms) {
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function filesUnder(dir: string, predicate: (file: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (predicate(full)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

const isSource = (file: string): boolean =>
  /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file);
const relative = (file: string): string => path.relative(SRC, file);

/**
 * The one violation that already existed when this test was written.
 *
 * `reportsCatalogue.ts` imports four fetch functions from `reportsService`, so the
 * report catalogue — which is otherwise a description of what the product can export —
 * drags the service layer into anything that reads it. It is listed rather than
 * quietly permitted, and it is tracked as GAP-114. The Node 20 crash never caught this
 * one either, which is the measure of how much that guard was actually doing.
 */
const KNOWN_VIOLATIONS = new Set(['lib/reportsCatalogue.ts']);

/** Does this specifier resolve into the service layer, or to the Supabase client itself? */
function reachesSupabase(specifier: string, fromFile: string): boolean {
  if (/^@\/services\//.test(specifier)) return true;
  // `lib/supabase.ts` IS the client module. Everything else reaching for it is the bug.
  if (relative(fromFile) === path.join('lib', 'supabase.ts')) return false;
  if (specifier === '@/lib/supabase' || specifier === '@supabase/supabase-js')
    return true;
  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    const asPath = path.relative(SRC, resolved);
    if (asPath.startsWith('services' + path.sep)) return true;
    if (asPath === path.join('lib', 'supabase')) return true;
  }
  return false;
}

describe('module boundaries', () => {
  it('no module under src/lib imports a service or the Supabase client', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(path.join(SRC, 'lib'), isSource)) {
      if (KNOWN_VIOLATIONS.has(relative(file))) continue;
      for (const specifier of runtimeImportsIn(file)) {
        if (reachesSupabase(specifier, file)) {
          offenders.push(`${relative(file)} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the known violation is still the only one, and still exists', () => {
    // An allowlist nobody rechecks becomes a licence. If this file is fixed, this
    // test fails and the entry comes out with it.
    const file = path.join(SRC, 'lib', 'reportsCatalogue.ts');
    const offending = runtimeImportsIn(file).filter((specifier) =>
      reachesSupabase(specifier, file),
    );
    expect(offending).not.toEqual([]);
  });
});
