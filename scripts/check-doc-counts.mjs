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

import { existsSync, readFileSync, readdirSync } from 'node:fs';

const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length;

/**
 * `security.txt`'s `Expires`, which is a promise with a date on it.
 *
 * RFC 9116 §2.5.5 makes the field mandatory and says a consumer MUST ignore
 * the file once the date has passed. So an expired `security.txt` is not a
 * stale document, it is **no security contact at all** — and it fails in the
 * quietest way anything in this repository can: no build breaks, no screen
 * changes, and the only person who finds out is a researcher who then has
 * nowhere to send what they found.
 *
 * GAP-029 opened this on 2026-08-30 with two options, "refresh it before then
 * or add it to the drift audit's checks". This is the second, moved earlier
 * than the audit: 90 days of warning on every push beats a weekly job noticing
 * on the day. Failing outright at 30 days is deliberate — a warning nobody is
 * forced to act on is how the date arrives in the first place.
 */
function securityTxtExpiry() {
  const file = 'public/.well-known/security.txt';
  const match = /^Expires:\s*(\S+)\s*$/mu.exec(readFileSync(file, 'utf8'));
  if (!match) return { file, days: null };
  const days = Math.floor((Date.parse(match[1]) - Date.now()) / 86_400_000);
  return { file, days, expires: match[1] };
}

/**
 * The sub-processor list's evidence paths, resolved against the tree.
 *
 * `src/lib/subprocessors.ts` states, in its own header, that every row must
 * cite something a reviewer can check, "because a customer will rely on it".
 * On 2026-08-31 one row did not: Inngest was published at `/legal/trust` as
 * receiving recipient ids and notification bodies, citing a service file that
 * had been deleted two weeks earlier along with the dispatch path itself
 * (BUG-067). The claim was wrong in the customer's favour, which is exactly
 * why nobody looked.
 *
 * This is the cheapest possible guard and deliberately not more: it pulls the
 * path-shaped TOKENS out of each `evidence` string and resolves those. A row
 * citing an environment variable or a Cloudflare setting is not something a
 * script can check, and pretending otherwise would be a gate that passes
 * because it cannot see anything. Several rows cite both at once — "src/lib/
 * sentry.ts, VITE_SENTRY_DSN" — so the string is scanned rather than tested
 * whole, or the useful half would be thrown away with the uncheckable half.
 */
const REPO_PATH = /\b(?:src|supabase|scripts|public|docs|e2e)\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]/gu;

function subProcessorEvidence() {
  const file = 'src/lib/subprocessors.ts';
  const contents = readFileSync(file, 'utf8');
  const cited = [...contents.matchAll(/evidence:\s*\n?\s*'([^']+)'/gu)].map((m) => m[1]);
  const missing = cited
    .flatMap((e) => e.match(REPO_PATH) ?? [])
    .filter((path) => !existsSync(path));
  return { file, cited: cited.length, missing };
}

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

{
  const { file, days, expires } = securityTxtExpiry();
  if (days === null) {
    console.error(
      `::error file=${file}::No Expires field. RFC 9116 §2.5.5 requires one, and a consumer ` +
        `MUST ignore a file without it — so this is not a formatting nit.`,
    );
    failed = true;
  } else if (days < 30) {
    console.error(
      `::error file=${file}::Expires ${expires} — ${days} days away. Past it, RFC 9116 says ` +
        `consumers ignore this file, so the project has no published security contact. ` +
        `Push the date out and confirm the address still reaches someone (GAP-029).`,
    );
    failed = true;
  } else if (days < 90) {
    console.log(`  warn ${file}: expires in ${days} days (${expires}) — renew it soon`);
  } else {
    console.log(`  ok  ${file}: expires in ${days} days`);
  }
}

{
  const { file, cited, missing } = subProcessorEvidence();
  if (cited === 0) {
    console.error(
      `::error file=${file}::No evidence strings matched. The shape of SUB_PROCESSORS changed, ` +
        `and this check silently stopped checking — which is worse than not having it.`,
    );
    failed = true;
  }
  for (const path of missing) {
    console.error(
      `::error file=${file}::A sub-processor cites ${path}, which does not exist. ` +
        `That row is published at /legal/trust; either fix the citation or remove the processor.`,
    );
    failed = true;
  }
  if (!missing.length && cited > 0) {
    console.log(`  ok  ${file}: ${cited} sub-processors, every repo-path citation resolves`);
  }
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
