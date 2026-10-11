#!/usr/bin/env node
/**
 * Counts in prose, checked against the tree (docs/SAAS.md, README).
 *
 * ## Why this exists
 *
 * The README told a new contributor to run "0001 through 0066 — there are
 * 66" while there were 91, and quoted "636 unit tests" when there were 701.
 * `docs/SECURITY.md` (then `DATA_LIFECYCLE.md`) said 82. Every one of those was correct when
 * written. A number in prose that nothing verifies is a number that drifts,
 * and the ones that drift worst are the ones a newcomer follows literally.
 *
 * The durable fix for most of them was to delete the number — the README now
 * says to run `ls | wc -l` rather than trusting a figure. But a couple are
 * genuinely useful to state, so those are checked here instead of trusted.
 *
 * Since 2026-10-11 it also checks the toolchain facts prose states (CI job
 * count, Edge Function count, Node major) and that every relative link and
 * backticked `docs/` or `qa/` path in the governed Markdown resolves. A
 * link to a moved document is the same failure as a stale number: it was
 * right when written and nothing re-checked it.
 *
 * ## What this deliberately does NOT do
 *
 * It does not rewrite the documents. A count that disagrees is sometimes a
 * stale number and sometimes a real change somebody should look at, and a
 * script that silently fixed both would hide the second. It reports and
 * fails; a person decides.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const migrations = readdirSync('supabase/migrations').filter((f) =>
  f.endsWith('.sql'),
).length;

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
const REPO_PATH =
  /\b(?:src|supabase|scripts|public|docs|e2e)\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]/gu;

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
    file: 'docs/SECURITY.md',
    label: 'migration count',
    expected: migrations,
    pattern: /— (\d+) today; the figure dates/,
  },
];

// ---------------------------------------------------------------------------
// Facts about the toolchain, stated in prose. Added 2026-10-11 with the
// docs-sync work: each of these had already drifted once (the README said
// `Node.js >= 20` after CI moved to 22; the CI job count was hand-edited
// from five to six). Each check SKIPS when its phrase is absent — unlike the
// CHECKS table above, these scan for any claim rather than one sentence, so
// "no claim" is a legitimate state, not a reworded sentence.
// ---------------------------------------------------------------------------

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/** `6`, `six`, `Six`, `**six**` → 6. Anything else → null (not a count). */
export function parseCount(word) {
  const w = String(word ?? '')
    .replace(/[*_]/gu, '')
    .trim()
    .toLowerCase();
  if (/^\d+$/u.test(w)) return Number(w);
  return Object.hasOwn(NUMBER_WORDS, w) ? NUMBER_WORDS[w] : null;
}

/** Top-level job ids under `jobs:` in a workflow, without a YAML parser. */
export function countWorkflowJobs(yamlText) {
  const lines = yamlText.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/u.test(l));
  if (start < 0) return 0;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break; // next top-level key
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(line)) count += 1;
  }
  return count;
}

/** Edge Function entry points: `supabase/functions/<name>/index.ts`, `_shared` excluded. */
export function countEdgeFunctions(root = 'supabase/functions') {
  if (!existsSync(root)) return 0;
  return readdirSync(root, { withFileTypes: true }).filter(
    (d) =>
      d.isDirectory() &&
      !d.name.startsWith('_') &&
      existsSync(`${root}/${d.name}/index.ts`),
  ).length;
}

/**
 * Claims of the form "ci.yml runs these as **six** jobs". Only a count that
 * follows a mention of CI on the same line is a claim about the workflow;
 * "four jobs" on its own is the pg_cron list, which is a different fact.
 */
export function ciJobClaims(text) {
  const out = [];
  const re =
    /(?:ci\.yml|\bCI\b)[^\n]{0,80}?(?<![\w-])\*{0,2}([A-Za-z]+|\d+)\*{0,2}\s+jobs\b/gu;
  for (const m of text.matchAll(re)) {
    const n = parseCount(m[1]);
    if (n !== null) out.push({ n, text: m[0] });
  }
  return out;
}

/**
 * "all eight Edge entry points", "8 Edge Functions". A count inside a
 * sentence about billing ("Checkout, the Portal and a webhook, all three
 * Edge Functions") is a subset, not the total, and is skipped.
 */
const SUBSET_CONTEXT = /stripe|billing|checkout|webhook/iu;
export function edgeFunctionClaims(text) {
  const out = [];
  const re =
    /(?<![\w-])\*{0,2}([A-Za-z]+|\d+)\*{0,2}\s+edge\s+(?:functions|entry\s+points)\b/giu;
  for (const m of text.matchAll(re)) {
    const n = parseCount(m[1]);
    if (n === null) continue;
    const before = text.slice(Math.max(0, m.index - 160), m.index);
    if (SUBSET_CONTEXT.test(before)) continue;
    out.push({ n, text: m[0] });
  }
  return out;
}

/**
 * Statements of the CURRENT Node requirement. Historical mentions ("on Node
 * 20 anything constructing a client died") are deliberately not matched.
 */
export function nodeClaims(text) {
  const out = [];
  const patterns = [
    /CI runs \*{0,2}Node(?:\.js)? (\d+)/gu,
    /Node(?:\.js)?\s*\*{0,2}\s*>=\s*v?(\d+)/gu,
    /requires? Node(?:\.js)?\s+v?(\d+)/giu,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push({ n: Number(m[1]), text: m[0] });
  }
  return out;
}

/** The major version from `engines.node`, e.g. ">=22.0.0" → 22. */
export function engineNodeMajor(pkgJson) {
  const m = /(\d+)/u.exec(JSON.parse(pkgJson)?.engines?.node ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Relative link targets in a Markdown document: `[x](path)` and backticked
 * `docs/...` or `qa/...` paths. Code fences are skipped, as are URLs,
 * in-page anchors, site routes (`/app/...`), and anything with a glob or
 * placeholder in it.
 *
 * Returns `{ target, fromRoot, line }`: link targets resolve against the
 * document's own directory, backticked repo paths against the repo root.
 */
const HISTORICAL = /\b(?:deleted|removed|retired|renamed|moved to|no longer exists)\b/iu;

export function extractLinkTargets(markdown) {
  const out = [];
  let fenced = false;
  markdown.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const m of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu)) {
      const raw = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/|\{)/iu.test(raw)) continue;
      const target = safeDecode(raw.replace(/[#?].*$/u, ''));
      if (target && !/[*{}<>$…]/u.test(target))
        out.push({ target, fromRoot: false, line: i + 1 });
    }
    // A backticked path on a line that says it is gone ("`docs/audit01.md`
    // (deleted 2026-08-04)") is history, not a reference. Markdown links are
    // still checked on such a line: a link is a promise the target opens.
    if (HISTORICAL.test(line)) return;
    for (const m of line.matchAll(/`((?:docs|qa)\/[^`\s]+)`/gu)) {
      const target = m[1].replace(/[#:].*$/u, '').replace(/[),.;]+$/u, '');
      if (target && !/[*{}<>$…]|\.\.\./u.test(target))
        out.push({ target, fromRoot: true, line: i + 1 });
    }
  });
  return out;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const LINK_SCOPE = [
  (f) => !f.includes('/') && f.endsWith('.md'),
  (f) => f.startsWith('docs/') && f.endsWith('.md') && !f.startsWith('docs/Plans 2026/'),
  (f) => f.startsWith('qa/') && f.endsWith('.md'),
  (f) => f.startsWith('.agent/') && f.endsWith('.md'),
  (f) => f.startsWith('.claude/agents/') && f.endsWith('.md'),
];

/** Tracked Markdown in scope. Tracked, so worktrees and node_modules never count. */
function markdownInScope() {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' });
  return out.split('\0').filter((f) => f && LINK_SCOPE.some((ok) => ok(f)));
}

/** Of these paths, the ones .gitignore excludes ON PURPOSE (docs/ACCOUNTS.md). */
function gitIgnored(paths) {
  if (!paths.length) return new Set();
  try {
    const out = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      input: paths.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return new Set(out.split('\n').filter(Boolean));
  } catch (err) {
    // Exit 1 means "none ignored".
    return new Set(
      String(err.stdout ?? '')
        .split('\n')
        .filter(Boolean),
    );
  }
}

function brokenLinks() {
  const broken = [];
  for (const file of markdownInScope()) {
    const dir = posix.dirname(file);
    for (const { target, fromRoot, line } of extractLinkTargets(
      readFileSync(file, 'utf8'),
    )) {
      const resolved = posix.normalize(fromRoot ? target : posix.join(dir, target));
      if (resolved.startsWith('..') || existsSync(resolved)) continue;
      broken.push({ file, line, target, resolved });
    }
  }
  const ignored = gitIgnored([...new Set(broken.map((b) => b.resolved))]);
  return broken.filter((b) => !ignored.has(b.resolved));
}

/** Read a file, or null when it does not exist (a skipped check, not a failure). */
function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function toolchainChecks() {
  let bad = false;
  const report = (file, label, claims, expected) => {
    for (const { n, text } of claims) {
      if (n === expected) {
        console.log(`  ok  ${file}: ${label} = ${n}`);
      } else {
        console.error(
          `::error file=${file}::${label}: "${text.trim()}" says ${n}, the tree has ${expected}.`,
        );
        bad = true;
      }
    }
  };

  const ciJobs = countWorkflowJobs(readFileSync('.github/workflows/ci.yml', 'utf8'));
  for (const file of ['CLAUDE.md', 'README.md', 'qa/README.md']) {
    const text = readIfExists(file);
    if (text) report(file, 'CI job count (ci.yml)', ciJobClaims(text), ciJobs);
  }

  const edge = countEdgeFunctions();
  for (const file of [
    'CLAUDE.md',
    'README.md',
    'qa/README.md',
    'docs/SAAS.md',
    'docs/API-SPEC.md',
    'docs/DEPLOYMENT.md',
  ]) {
    const text = readIfExists(file);
    if (text) report(file, 'Edge Function count', edgeFunctionClaims(text), edge);
  }

  const node = engineNodeMajor(readFileSync('package.json', 'utf8'));
  if (node === null) {
    console.error(
      '::error file=package.json::engines.node is missing, so the stated Node version was not checked.',
    );
    bad = true;
  } else {
    for (const file of ['CLAUDE.md', 'README.md']) {
      const text = readIfExists(file);
      if (text) report(file, 'Node major (package.json engines)', nodeClaims(text), node);
    }
  }

  return bad;
}

function linkChecks() {
  let broken;
  try {
    broken = brokenLinks();
  } catch (err) {
    console.error(
      `::error::Could not list tracked Markdown for the link check: ${err.message}`,
    );
    return true;
  }
  for (const b of broken) {
    console.error(
      `::error file=${b.file},line=${b.line}::Link target ${b.target} does not exist (resolved: ${b.resolved}).`,
    );
  }
  if (!broken.length)
    console.log('  ok  every relative link and backticked docs/ or qa/ path resolves');
  return broken.length > 0;
}

function main() {
  let failed = false;

  {
    const file = 'docs/SAAS.md';
    const contents = readFileSync(file, 'utf8');
    const { counts, duplicates, total } = registerCounts(contents);

    if (total === 0) {
      console.error(
        `::error file=${file}::No capability rows matched. The row format changed.`,
      );
      failed = true;
    }

    for (const id of duplicates) {
      console.error(
        `::error file=${file}::${id} appears twice, or carries no status mark.`,
      );
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

    if (!failed)
      console.log(`  ok  ${file}: ${total} capability rows match the summary table`);
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
      console.log(
        `  ok  ${file}: ${cited} sub-processors, every repo-path citation resolves`,
      );
    }
  }

  for (const check of CHECKS) {
    let contents;
    try {
      contents = readFileSync(check.file, 'utf8');
    } catch {
      console.error(
        `::error::${check.file} is missing, so its ${check.label} was not checked.`,
      );
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

  if (toolchainChecks()) failed = true;
  if (linkChecks()) failed = true;

  if (failed) {
    console.error(
      '\nA number in prose that nothing verifies is a number that drifts. ' +
        'Either correct it, or delete it and say how to count instead.',
    );
    process.exit(1);
  }

  console.log('\n✅ Documented counts match the tree.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
