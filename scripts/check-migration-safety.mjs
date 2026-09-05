#!/usr/bin/env node
/**
 * Migration safety gate (docs/SAAS.md GAP-002).
 *
 * Migrations auto-apply to production the moment a pull request merges, and
 * there are no backups (GAP-001). So a destructive statement has already run
 * against the only copy of the data by the time anyone could object, and "CI
 * was green" says nothing about whether that was survivable — `db-tests` runs
 * against an empty local database, where dropping a column costs nothing.
 *
 * This does not judge whether a change is correct. It finds statements that
 * are IRREVERSIBLE or that SILENTLY WIDEN ACCESS, and requires the author to
 * have written down why this one is safe. A gate that simply refused them
 * would be worked around inside a week; one that asks for a sentence is
 * answerable, and leaves the reasoning beside the SQL where the next person
 * reads it.
 *
 * ## Declaring a statement
 *
 * Put a line anywhere in the migration:
 *
 *     -- SAFETY(drop_column): the column has never been written; see 0058
 *
 * A bare `-- SAFETY: <why>` covers every rule in that file, which is right for
 * a migration doing one deliberate thing and too blunt for one doing several.
 *
 * ## Which migrations are checked
 *
 * Added migrations are scanned in full. Existing ones are never re-litigated:
 * an applied migration cannot be made safer by editing it — this project's
 * rule is to add a new one — and re-flagging history trains everyone to
 * ignore the gate.
 *
 * MODIFIED and DELETED migrations are a different failure, and are refused
 * outright. Editing a migration that has already run changes what every
 * future rebuild replays while leaving production exactly as it was, so the
 * schema the history describes and the schema that exists diverge silently.
 * That is how `0113` came to be needed. The audit (RF-14) found this gate
 * looked only at additions, so a modification passed it without a word.
 *
 * ## Which base ref
 *
 * `git diff A...B` already means "since the merge base", but the base ref
 * itself is now explicit — `--base <ref>`, or `MIGRATION_CHECK_BASE` — because
 * the previous version hard-coded `origin/main` and therefore printed "No new
 * migrations in this branch" when run ON main. That is a vacuous pass, and it
 * reads exactly like a real one. It now names the base it used, and says so
 * when the comparison was empty by definition.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DIR = 'supabase/migrations';

/**
 * Statement-level rules. Anchored to the start of a statement, which matters:
 * `revoke truncate ... from authenticated` REMOVES that privilege and is the
 * opposite of dangerous. An unanchored match called `0075` — the migration
 * that took TRUNCATE away from everyone — a destructive change.
 */
const RULES = [
  {
    id: 'drop_table',
    match: (st) => /^drop\s+table\b/.test(st),
    why: 'Drops a table. With no backups this is unrecoverable the moment it merges.',
  },
  {
    id: 'drop_column',
    match: (st) => /^alter\s+table\b/.test(st) && /\bdrop\s+column\b/.test(st),
    why: 'Drops a column and everything in it. Consider leaving it unused for a release first.',
  },
  {
    id: 'truncate',
    match: (st) => /^truncate\b/.test(st),
    why: 'Empties a table. RLS does not apply to TRUNCATE, and it cannot be undone once merged.',
  },
  {
    id: 'delete_without_where',
    match: (st) => /^delete\s+from\b/.test(st) && !/\bwhere\b/.test(st),
    why: 'DELETE with no WHERE removes every row in the table.',
  },
  {
    id: 'update_without_where',
    match: (st) => /^update\s+\w/.test(st) && /\bset\b/.test(st) && !/\bwhere\b/.test(st),
    why: 'UPDATE with no WHERE rewrites every row in the table.',
  },
  {
    id: 'disable_rls',
    match: (st) => /\bdisable\s+row\s+level\s+security\b/.test(st),
    why: 'Turns RLS off. Every policy on the table stops applying and tenants can read each other.',
  },
  {
    id: 'grant_to_anon',
    // `grant usage on schema ... to anon` is excluded on purpose: PostgREST
    // cannot reach even `preview_invite` without it, so every deployment needs
    // it and flagging it would teach people to declare by reflex. A grant on a
    // TABLE or FUNCTION to anon is the one worth a sentence.
    match: (st) =>
      /^grant\b/.test(st) &&
      /\banon\b/.test(st) &&
      !/^grant\s+usage\s+on\s+schema\b/.test(st),
    why: 'Grants a table or function privilege to anon, the unauthenticated role. 0075 removed every one of these deliberately.',
  },
  {
    id: 'drop_function',
    // `create or replace` is the ordinary way to change a function and is not
    // this. A DROP is different: between the migration applying and the new
    // bundle reaching a browser, every client still calling the old signature
    // gets PGRST202 and the feature is simply broken for them. Sometimes that
    // is unavoidable — `0126` had to drop a three-argument `create_invite`
    // because the five-argument replacement made the call ambiguous — which is
    // exactly the kind of thing worth one sentence in the file.
    match: (st) => /^drop\s+function\b/.test(st),
    why: 'Drops a function. Any client still calling that signature fails until it reloads, and a rollback cannot bring the old body back.',
  },
  {
    id: 'alter_column_type',
    match: (st) => /^alter\s+table\b/.test(st) && /\balter\s+column\b.*\btype\b/.test(st),
    why: 'Changes a column type. Rewrites the table, and can lose precision or fail on real data the empty test database never had.',
  },
];

/** Rules that cannot be judged one statement at a time. */
const FILE_RULES = [
  {
    id: 'drop_policy_without_replacement',
    match: (sql) => /\bdrop\s+policy\b/.test(sql) && !/\bcreate\s+policy\b/.test(sql),
    why: 'Drops a policy and creates none. The table is then exposed to whatever the GRANTs allow.',
  },
  {
    id: 'security_definer_without_search_path',
    // Counted rather than paired: a file with three definers and two pinned
    // search paths has one that is not, wherever in the file it sits.
    match: (sql) =>
      (sql.match(/\bsecurity\s+definer\b/g) ?? []).length >
      (sql.match(/\bset\s+search_path\b/g) ?? []).length,
    why: 'A SECURITY DEFINER function without `set search_path` can be hijacked through a caller-controlled schema.',
  },
];

/** Strip comments, so a rule cannot fire on prose describing it. */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Split into statements so a rule can anchor to the start of one.
 *
 * Dollar-quoted bodies are replaced first: a plpgsql function is full of
 * semicolons, and splitting inside one yields fragments that match nothing
 * while hiding the real statements around them. Those bodies are still read by
 * the file-level rules, which is where the checks that care about them live.
 */
function statements(sql) {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' $body$ ')
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
}

/** `--base <ref>`, else MIGRATION_CHECK_BASE, else origin/main. */
function baseRef() {
  const flag = process.argv.indexOf('--base');
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
  return process.env.MIGRATION_CHECK_BASE || 'origin/main';
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Migration files added, changed or removed since the merge base. */
function changedMigrations(base) {
  const collect = (filter) =>
    git(['diff', '--name-only', `--diff-filter=${filter}`, `${base}...HEAD`, '--', DIR])
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.endsWith('.sql'));

  return {
    added: collect('A'),
    // R and C are renames and copies. Renaming an applied migration is the
    // same problem as editing one: the recorded name is what
    // `supabase_migrations.schema_migrations` holds, so a rebuild replays a
    // file production has no record of ever running.
    changed: collect('MRC'),
    deleted: collect('D'),
  };
}

const base = baseRef();

let diff;
try {
  // Resolve the ref first, so "no such ref" is reported as itself rather than
  // as an empty diff that reads like a pass. Failing closed: a gate that
  // silently passes when it cannot see the diff is worse than no gate,
  // because it is believed.
  git(['rev-parse', '--verify', `${base}^{commit}`]);
  diff = changedMigrations(base);
} catch {
  console.error(
    `::error::Could not diff ${DIR} against '${base}', so migration safety was NOT checked. ` +
      'Fetch the base ref, or name one with --base <ref>.',
  );
  process.exit(1);
}

let failed = false;

// An already-applied migration is history. Changing or removing one leaves
// production untouched while every future rebuild replays something else.
for (const file of [...diff.changed, ...diff.deleted]) {
  const verb = diff.deleted.includes(file) ? 'deleted' : 'modified';
  console.error(
    `::error file=${file}::This migration was ${verb}. A migration that has already run is history: ` +
      'editing it changes what a rebuilt database becomes without changing production, and the two then ' +
      'disagree with nothing to show for it. Add a new migration instead.',
  );
  failed = true;
}

const files = diff.added;

if (files.length === 0 && !failed) {
  // Name the base, so an empty result can be told apart from a real pass. Run
  // on main itself, `origin/main...HEAD` is empty by definition, and the old
  // wording read as though something had been checked (RF-14).
  const head = git(['rev-parse', '--short', 'HEAD']);
  const sameCommit = git(['rev-parse', base]) === git(['rev-parse', 'HEAD']);
  console.log(
    `No migrations added between ${base} and HEAD (${head}).` +
      (sameCommit
        ? ` NOTE: ${base} IS HEAD, so this comparison is empty by definition and checked nothing.` +
          ' Name a range with --base <ref>.'
        : ''),
  );
  process.exit(0);
}

if (files.length > 0) {
  console.log(
    `Checking ${files.length} added migration(s) against ${base}:\n  ${files.join('\n  ')}\n`,
  );
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const sql = stripComments(raw);
  const lowered = sql.replace(/\s+/g, ' ').toLowerCase();

  // Declarations are read from the RAW file: they live in a comment.
  const declaredAll = /--\s*SAFETY\s*:/i.test(raw);
  const declaredFor = (id) =>
    declaredAll || new RegExp(`--\\s*SAFETY\\(${id}\\)\\s*:`, 'i').test(raw);

  const flagged = [];
  for (const statement of statements(sql)) {
    for (const rule of RULES) {
      if (rule.match(statement) && !flagged.includes(rule)) flagged.push(rule);
    }
  }
  for (const rule of FILE_RULES) {
    if (rule.match(lowered) && !flagged.includes(rule)) flagged.push(rule);
  }

  for (const rule of flagged) {
    if (declaredFor(rule.id)) {
      console.log(`  declared  ${file}: ${rule.id}`);
      continue;
    }
    console.error(
      `::error file=${file}::${rule.id} — ${rule.why}\n` +
        `If this is right, say so in the migration: "-- SAFETY(${rule.id}): <why>". ` +
        `That sentence is what a reviewer, and whoever has to restore this database, will read.`,
    );
    failed = true;
  }
}

if (failed) {
  console.error(
    '\nMigrations apply to production on merge and there are no backups (GAP-001), ' +
      'so an undeclared destructive statement is a decision nobody reviewed.',
  );
  process.exit(1);
}

console.log('\n✅ No undeclared destructive statements.');
