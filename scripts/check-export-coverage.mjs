#!/usr/bin/env node
/**
 * Every tenant table is in the organisation export, or excluded on purpose.
 *
 * ## Why this exists
 *
 * `exportOrganisationData` listed 19 tables. Forty carry an `org_id`. Missing
 * were the organisation's invoices, its staff inboxes and delivery record, its
 * minimum-cover rules, its integration configuration and history, its own GDPR
 * request log, its support cases, and the record of when platform staff had
 * support access to its data.
 *
 * None of that was a decision. Each table was added at some point and nobody
 * went back to the export, which is exactly the failure the export's own
 * comment warns about — "the risk in an export is a table quietly missing from
 * it" — and it had happened anyway, because a comment cannot check anything.
 *
 * It matters beyond tidiness. `/legal/privacy` tells people an organisation
 * can export everything it holds, and the product's own GDPR story rests on
 * that being true. An export that silently omits a third of the schema turns a
 * published statement into a false one.
 *
 * ## How it decides
 *
 * The migrations are the source of truth for which tables exist, because they
 * are what production is built from. Any `create table ... public.<name>` whose
 * body mentions `org_id` is a tenant table, and must appear in either
 * `EXPORTED_TABLES` or `DELIBERATELY_EXCLUDED` in
 * `src/services/orgLifecycleService.ts`.
 *
 * An exclusion needs a reason written next to it. That is the whole point: the
 * gate does not stop anybody leaving a table out, it stops them leaving it out
 * silently.
 */

import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const SERVICE = 'src/services/orgLifecycleService.ts';

/** Tables created by a migration whose definition carries an `org_id`. */
function tenantTables() {
  const found = new Set();

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
    const create = /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g;

    for (const match of sql.matchAll(create)) {
      const [, name, body] = match;
      // `org_id` as a column of its own, not a mention in a comment or a
      // foreign key on some other table's column.
      if (/^\s*org_id\s+uuid/m.test(body)) found.add(name);
    }

    // Migrations are read in order, so a table dropped later is not a tenant
    // table now. `shift_templates` was created by 0002 and removed by 0096
    // (CAP-005, deliberately), and demanding it be exported would be asking
    // for a table that does not exist.
    for (const match of sql.matchAll(/drop table (?:if exists )?public\.(\w+)/g)) {
      found.delete(match[1]);
    }
  }
  return found;
}

/** The two lists the service keeps, read as text rather than imported. */
function declaredTables() {
  const source = readFileSync(SERVICE, 'utf8');

  const exported = source.slice(
    source.indexOf('const EXPORTED_TABLES = ['),
    source.indexOf('] as const;'),
  );
  // Anchored on the DECLARATION, not the first mention: the name appears in
  // a docblock above `EXPORTED_TABLES`, and slicing from there ended the
  // array at the wrong `];` and found no exclusions at all — which the gate
  // then reported as seven missing tables. A parser that fails this way is
  // worse than none, because the failure looks like a real finding.
  const excludedStart = source.indexOf('DELIBERATELY_EXCLUDED: readonly');
  const excluded =
    excludedStart === -1
      ? ''
      : source.slice(excludedStart, source.indexOf('];', excludedStart));

  return {
    exported: new Set([...exported.matchAll(/'(\w+)'/g)].map((m) => m[1])),
    excluded: new Set([...excluded.matchAll(/table:\s*'(\w+)'/g)].map((m) => m[1])),
  };
}

const tenant = tenantTables();
const { exported, excluded } = declaredTables();

if (tenant.size === 0 || exported.size === 0) {
  console.error(
    '::error::Found no tenant tables or no export list. The parser has stopped matching — fix it rather than deleting this gate.',
  );
  process.exit(1);
}

let failed = false;

for (const table of [...tenant].sort()) {
  if (!exported.has(table) && !excluded.has(table)) {
    console.error(
      `::error file=${SERVICE}::${table} carries an org_id and is in neither EXPORTED_TABLES nor DELIBERATELY_EXCLUDED. Add it to the export, or exclude it with a reason a customer would accept.`,
    );
    failed = true;
  }
}

// A table listed in both, or one that no longer exists, is the other kind of
// drift: an export that tries to read something that is not there returns an
// error the caller records as "omitted", which reads as a permissions problem.
for (const table of [...exported].filter((t) => excluded.has(t))) {
  console.error(`::error file=${SERVICE}::${table} is both exported and excluded.`);
  failed = true;
}
for (const table of [...exported].filter((t) => !tenant.has(t))) {
  console.error(
    `::error file=${SERVICE}::${table} is exported but no migration creates it with an org_id.`,
  );
  failed = true;
}

if (failed) {
  console.error(
    '\n`/legal/privacy` tells customers they can export everything the product holds for them. That sentence is only true while this passes.',
  );
  process.exit(1);
}

console.log(
  `✅ All ${tenant.size} tenant tables accounted for: ${exported.size} exported, ${excluded.size} excluded with a reason.`,
);
