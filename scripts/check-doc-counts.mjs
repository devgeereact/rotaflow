#!/usr/bin/env node
/**
 * Counts in prose, checked against the tree (docs/SAAS.md, README).
 *
 * ## Why this exists
 *
 * The README told a new contributor to run "0001 through 0066 — there are
 * 66" while there were 91, and quoted "636 unit tests" when there were 701.
 * `docs/DATA_LIFECYCLE.md` said 82. Every one of those was correct when
 * written. A number in prose that nothing verifies is a number that drifts,
 * and the ones that drift worst are the ones a newcomer follows literally.
 *
 * The durable fix for most of them was to delete the number — the README now
 * says to run `ls | wc -l` rather than trusting a figure. But a couple are
 * genuinely useful to state, so those are checked here instead of trusted.
 *
 * ## What this deliberately does NOT do
 *
 * It does not rewrite the documents. A count that disagrees is sometimes a
 * stale number and sometimes a real change somebody should look at, and a
 * script that silently fixed both would hide the second. It reports and
 * fails; a person decides.
 */

import { readFileSync, readdirSync } from 'node:fs';

const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length;

/**
 * The register's own status table, counted from the register's own rows.
 *
 * This is the table the owner reads to decide what to work on, and it was
 * wrong on 2026-08-31: it claimed 69 🟢 / 14 🟡 / 1 🔵 / 5 ❓ when the rows
 * said 72 / 10 / 0 / 3. Every closed capability edits a row and nothing made
 * it edit the summary, so the summary drifted in exactly the direction that
 * flatters the project — a reader would have believed there was more left
 * partial and less complete than is true.
 *
 * A duplicate id is a failure too. Twice during the merge a bulk edit deleted
 * or duplicated a row without changing any total, which is the silent version
 * of the same problem.
 */
const STATUSES = ['🟢', '🟡', '🟠', '🔵', '⚪', '🔴', '⚫', '❓'];

function registerCounts(contents) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const seen = new Set();
  const duplicates = [];

  for (const line of contents.split('\n')) {
    // `CAP-020a` — a row split off from its parent capability. Missing the
    // suffix here silently dropped four rows from every total.
    const row = /^- \[[ x]\] (CAP-\d+[a-z]?)\s+(\S+)/u.exec(line);
    if (!row) continue;
    if (seen.has(row[1])) duplicates.push(row[1]);
    seen.add(row[1]);
    const status = STATUSES.find((s) => row[2].startsWith(s));
    if (status) counts[status] += 1;
    else duplicates.push(`${row[1]} (no status mark)`);
  }

  return { counts, duplicates, total: seen.size };
}

/**
 * Each check names the file, what the number should be, and a pattern that
 * captures the number as written. A pattern that matches nothing is itself a
 * failure: it means the sentence was reworded and the check silently stopped
 * checking, which is the quiet way a gate like this rots.
 */
const CHECKS = [
  {
    file: 'README.md',
    label: 'migration count',
    expected: migrations,
    pattern: /in numeric order\*\* — there are (\d+)/,
  },
  {
    file: 'docs/SAAS.md',
    label: 'migration count',
    expected: migrations,
    pattern: /took `main` to (\d+) migrations/,
  },
  {
    file: 'docs/DATA_LIFECYCLE.md',
    label: 'migration count',
    expected: migrations,
    pattern: /— (\d+) today; the figure dates/,
  },
];

let failed = false;

{
  const file = 'docs/SAAS.md';
  const contents = readFileSync(file, 'utf8');
  const { counts, duplicates, total } = registerCounts(contents);

  if (total === 0) {
    console.error(`::error file=${file}::No capability rows matched. The row format changed.`);
    failed = true;
  }

  for (const id of duplicates) {
    console.error(`::error file=${file}::${id} appears twice, or carries no status mark.`);
    failed = true;
  }

  // Each row of the summary table: `| 🟢 Complete | 69 |`.
  for (const status of STATUSES) {
    const pattern = new RegExp(`\\| ${status}[^|]*\\|\\s*(\\d+)\\s*\\|`, 'u');
    const match = pattern.exec(contents);
    if (!match) {
      console.error(`::error file=${file}::The summary table has no ${status} row.`);
      failed = true;
      continue;
    }
    const stated = Number(match[1]);
    if (stated !== counts[status]) {
      console.error(
        `::error file=${file}::summary says ${stated} ${status}, the rows say ${counts[status]}.`,
      );
      failed = true;
    }
  }

  if (!failed) console.log(`  ok  ${file}: ${total} capability rows match the summary table`);
}

for (const check of CHECKS) {
  let contents;
  try {
    contents = readFileSync(check.file, 'utf8');
  } catch {
    console.error(`::error::${check.file} is missing, so its ${check.label} was not checked.`);
    failed = true;
    continue;
  }

  const match = check.pattern.exec(contents);
  if (!match) {
    console.error(
      `::error file=${check.file}::Could not find the ${check.label} sentence. ` +
        `If it was reworded, update the pattern in scripts/check-doc-counts.mjs — ` +
        `a check that quietly matches nothing is worse than no check.`,
    );
    failed = true;
    continue;
  }

  const found = Number(match[1]);
  if (found !== check.expected) {
    console.error(
      `::error file=${check.file}::${check.label} says ${found}, the tree has ${check.expected}.`,
    );
    failed = true;
    continue;
  }

  console.log(`  ok  ${check.file}: ${check.label} = ${found}`);
}

if (failed) {
  console.error(
    '\nA number in prose that nothing verifies is a number that drifts. ' +
      'Either correct it, or delete it and say how to count instead.',
  );
  process.exit(1);
}

console.log('\n✅ Documented counts match the tree.');
