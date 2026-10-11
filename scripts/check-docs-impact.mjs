#!/usr/bin/env node
/**
 * Did a change that alters behaviour also touch the documents that describe it?
 *
 * ## Why this exists
 *
 * Every document in this repository that has lied did so the same way: it was
 * right when written, the code moved, and nothing asked whether the prose
 * should move with it. CLAUDE.md records several (a register that claimed
 * features that did not exist, and the reverse; a README that quoted 66
 * migrations when there were 91). `check:docs` catches the drift that can be
 * counted. This catches the drift that cannot: a pull request that changes
 * code and says nothing about documentation at all.
 *
 * It is the CI half of GEE OS LOOP step 8 (Synchronise) and CHANGE-SAFETY
 * step 9 (update affected tests and documentation). The Stop hook in
 * `scripts/hooks/docs-sync.mjs` is the in-session half and shares the rules
 * below, so the two can never disagree about what counts as code.
 *
 * ## What it decides
 *
 * FAIL when the change touches behaviour-bearing paths (src, supabase, e2e,
 * workflows, package.json, index.html, public) and touches no documentation
 * (a root `*.md`, anything under `docs/` or `qa/`), unless the pull request
 * body carries a line of the form
 *
 *     Docs: no impact (the reason, in words)
 *
 * which is the author saying, on the record, that they looked and nothing
 * needed to change. That is a legitimate answer; silence is not.
 *
 * Exempt: dependabot pull requests, and changes that touch only
 * `package-lock.json`. A dependency bump does not change what any document
 * says, and asking a bot for a rationale is a gate that trains people to
 * click past it.
 *
 * ## What it deliberately does NOT do
 *
 * It cannot tell whether the right document changed, or whether the change
 * was correct. It names the likely owners so the author knows where to look,
 * and stops there. A person decides; this only makes sure someone was asked.
 *
 * ## Usage
 *
 *   node scripts/check-docs-impact.mjs                 # diff against origin/main
 *   node scripts/check-docs-impact.mjs --base origin/x # diff against another base
 *   git diff --name-only ... | node scripts/check-docs-impact.mjs --stdin
 *
 * Reads PR_BODY, GITHUB_ACTOR and GITHUB_HEAD_REF from the environment. The
 * body is passed through an env var in CI, never interpolated into shell.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Paths whose change can alter what the product does or how it ships. */
const CODE_PATTERNS = [
  /^src\//u,
  /^supabase\//u,
  /^e2e\//u,
  /^\.github\/workflows\//u,
  /^package\.json$/u,
  /^index\.html$/u,
  /^public\//u,
];

/**
 * Likely owning documents, first match wins. These mirror the "Fact | Owning
 * document" table in docs/README.md; when that table moves a fact, move the
 * row here too. Ordered most specific first.
 */
const OWNERS = [
  {
    area: 'supabase/migrations',
    test: /^supabase\/migrations\//u,
    docs: ['docs/DATA-MODEL.md', 'docs/SAAS.md'],
  },
  {
    area: 'supabase/tests',
    test: /^supabase\/tests\//u,
    docs: ['docs/DATA-MODEL.md', 'qa/README.md'],
  },
  {
    area: 'supabase/functions',
    test: /^supabase\/functions\//u,
    docs: ['docs/API-SPEC.md', 'docs/SECURITY.md'],
  },
  {
    area: 'supabase (config)',
    test: /^supabase\//u,
    docs: ['docs/DEPLOYMENT.md', 'docs/SECURITY.md'],
  },
  {
    area: 'src/pages/admin',
    test: /^src\/pages\/admin\//u,
    docs: ['docs/UX-SPEC.md', 'docs/SAAS.md'],
  },
  { area: 'src/pages', test: /^src\/pages\//u, docs: ['docs/UX-SPEC.md'] },
  { area: 'src/App.tsx (routes)', test: /^src\/App\.tsx$/u, docs: ['docs/UX-SPEC.md'] },
  {
    area: 'src/components',
    test: /^src\/components\//u,
    docs: ['docs/DESIGN-SYSTEM.md', 'docs/UX-SPEC.md', 'docs/ACCESSIBILITY.md'],
  },
  {
    area: 'src/services',
    test: /^src\/services\//u,
    docs: ['docs/API-SPEC.md', 'docs/ARCHITECTURE.md'],
  },
  { area: 'src/hooks', test: /^src\/hooks\//u, docs: ['docs/ARCHITECTURE.md'] },
  {
    area: 'src/lib/notifications',
    test: /^src\/lib\/(?:notification|push)/u,
    docs: ['docs/NOTIFICATIONS-SPEC.md'],
  },
  { area: 'src/lib', test: /^src\/lib\//u, docs: ['docs/ARCHITECTURE.md'] },
  { area: 'src (other)', test: /^src\//u, docs: ['docs/ARCHITECTURE.md'] },
  { area: 'e2e', test: /^e2e\//u, docs: ['qa/README.md', 'qa/LAUNCH-CHECKLIST.md'] },
  {
    area: '.github/workflows',
    test: /^\.github\/workflows\//u,
    docs: ['docs/DEPLOYMENT.md', 'qa/README.md'],
  },
  {
    area: 'package.json',
    test: /^package\.json$/u,
    docs: ['docs/DEPLOYMENT.md', 'README.md'],
  },
  { area: 'index.html', test: /^index\.html$/u, docs: ['docs/DEPLOYMENT.md'] },
  {
    area: 'public',
    test: /^public\//u,
    docs: ['docs/DEPLOYMENT.md', 'docs/SECURITY.md'],
  },
];

/** Every change that alters behaviour may also belong in these. */
export const ALWAYS_CONSIDER = ['CHANGELOG.md', 'KNOWN-ISSUES.md'];

/**
 * `Docs: no impact (reason)` at the start of a line. The template's own
 * placeholder reasons are rejected, so an unedited template does not pass.
 */
const NO_IMPACT = /^[ \t]*Docs:\s*no impact\s*\((.+)\)/imu;
const PLACEHOLDER_REASONS = new Set(['reason', 'why', '...', '…', 'tbd', 'todo', 'n/a']);

const normalise = (path) => path.trim().replace(/^\.\//u, '');

export function isCodePath(path) {
  return CODE_PATTERNS.some((p) => p.test(path));
}

/** A root-level `*.md`, or anything under `docs/` or `qa/`. */
export function isDocPath(path) {
  if (/^(?:docs|qa)\//u.test(path)) return true;
  return !path.includes('/') && /\.md$/iu.test(path);
}

/** The author's stated reason, or null when the body carries none. */
export function noImpactReason(body) {
  const match = NO_IMPACT.exec(body ?? '');
  if (!match) return null;
  const reason = match[1].trim();
  if (!reason || PLACEHOLDER_REASONS.has(reason.toLowerCase())) return null;
  return reason;
}

/** Likely owning docs, grouped by the area of the change. */
export function owningDocs(files) {
  const byArea = new Map();
  for (const file of files) {
    const owner = OWNERS.find((o) => o.test.test(file));
    if (!owner) continue;
    const entry = byArea.get(owner.area) ?? { docs: owner.docs, files: [] };
    entry.files.push(file);
    byArea.set(owner.area, entry);
  }
  return byArea;
}

/**
 * The decision, with no I/O.
 *
 * @param {{ files: string[], body?: string, actor?: string, headRef?: string }} input
 * @returns {{ status: 'pass'|'fail'|'exempt', reason: string, codeFiles: string[],
 *   docFiles: string[], owners: Map<string, {docs: string[], files: string[]}> }}
 */
export function decideDocsImpact({ files, body = '', actor = '', headRef = '' }) {
  const changed = [...new Set(files.map(normalise).filter(Boolean))];
  const codeFiles = changed.filter(isCodePath);
  const docFiles = changed.filter(isDocPath);
  const owners = owningDocs(codeFiles);
  const base = { codeFiles, docFiles, owners };

  if (actor === 'dependabot[bot]' || headRef.startsWith('dependabot/')) {
    return { ...base, status: 'exempt', reason: 'dependabot pull request' };
  }
  if (changed.length > 0 && changed.every((f) => f === 'package-lock.json')) {
    return { ...base, status: 'exempt', reason: 'only package-lock.json changed' };
  }
  if (codeFiles.length === 0) {
    return { ...base, status: 'pass', reason: 'no behaviour-bearing paths changed' };
  }
  if (docFiles.length > 0) {
    return {
      ...base,
      status: 'pass',
      reason: `documentation updated (${docFiles.length} file(s))`,
    };
  }
  const stated = noImpactReason(body);
  if (stated) {
    return {
      ...base,
      status: 'pass',
      reason: `author declared no docs impact: ${stated}`,
    };
  }
  return {
    ...base,
    status: 'fail',
    reason:
      'code changed and no documentation changed, and the PR body has no `Docs: no impact (reason)` line',
  };
}

/** The owners as printable lines, shared with the Stop hook. */
export function formatOwners(owners) {
  const lines = [];
  for (const [area, { docs, files }] of owners) {
    lines.push(`  ${area} (${files.length} file(s)) -> ${docs.join(', ')}`);
  }
  return lines;
}

function changedFilesFromGit(base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').filter(Boolean);
}

function main(argv) {
  const useStdin = argv.includes('--stdin');
  const baseIdx = argv.indexOf('--base');
  const base = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/main';

  let files;
  try {
    files = useStdin
      ? readFileSync(0, 'utf8').split('\n').filter(Boolean)
      : changedFilesFromGit(base);
  } catch (err) {
    // Fail closed, like check:migrations: a diff that cannot be computed is
    // not evidence that nothing changed.
    console.error(
      `::error::Could not list changed files against ${base}: ${err.message}. ` +
        'Fetch full history (fetch-depth: 0) or pass --stdin.',
    );
    return 2;
  }

  const result = decideDocsImpact({
    files,
    body: process.env.PR_BODY ?? '',
    actor: process.env.GITHUB_ACTOR ?? '',
    headRef: process.env.GITHUB_HEAD_REF ?? '',
  });

  console.log(
    `Changed: ${files.length} file(s), ${result.codeFiles.length} behaviour-bearing, ${result.docFiles.length} documentation.`,
  );
  if (result.owners.size > 0) {
    console.log('Likely owning documents for this change:');
    for (const line of formatOwners(result.owners)) console.log(line);
    console.log(`  and, if behaviour changed: ${ALWAYS_CONSIDER.join(', ')}`);
    console.log('  (owners are listed in docs/README.md, "Fact | Owning document")');
  }

  if (result.status === 'fail') {
    console.error(`::error::Docs impact: ${result.reason}.`);
    console.error(
      'Update the owning document(s) above in this pull request, or add a line to the ' +
        'PR description reading `Docs: no impact (why nothing needed to change)`.',
    );
    return 1;
  }
  console.log(`\n✅ Docs impact: ${result.status} (${result.reason}).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
