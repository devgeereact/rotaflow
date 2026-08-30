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
 * ## Only new migrations
 *
 * Diffed against `origin/main`, so existing files are never re-litigated. An
 * applied migration cannot be made safer by editing it — this project's rule
 * is to add a new one — and re-flagging history trains everyone to ignore the
 * gate.
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

function newMigrations() {
  try {
    return execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=A', 'origin/main...HEAD', '--', DIR],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((f) => f.endsWith('.sql'));
  } catch {
    // Failing closed. A gate that silently passes when it cannot see the diff
    // is worse than no gate, because it is believed.
    console.error(
      '::error::Could not diff against origin/main, so migration safety was NOT checked.',
    );
    process.exit(1);
  }
}

const files = newMigrations();
if (files.length === 0) {
  console.log('No new migrations in this branch.');
  process.exit(0);
}

console.log(`Checking ${files.length} new migration(s):\n  ${files.join('\n  ')}\n`);

let failed = false;

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
