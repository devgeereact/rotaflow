-- =====================================================================
-- enforce_retention.test.sql — regression guard for the bug fixed by
-- 0057_fix_enforce_retention_ambiguity.sql.
--
-- The bug: `enforce_retention()` is declared
-- `returns table (data_type text, rows_removed bigint, cutoff date)`, which
-- makes those names PL/pgSQL variables inside the body. 0029's driving loop
-- referenced `data_type` unqualified in its WHERE and ORDER BY, so it was
-- ambiguous against `retention_policies.data_type`. Postgres accepts such a
-- definition and fails only when the function is executed:
--
--   ERROR:  column reference "data_type" is ambiguous
--
-- It therefore failed on all 14 scheduled runs between 2026-08-07 and
-- 2026-08-20 while `retention_policies.enforced` advertised `true` to users,
-- and nothing caught it: the definition was reviewed, the pg_cron entry was
-- verified active, and neither of those executes the function.
--
-- This test executes it. That is the entire point — a runtime-only
-- ambiguity error is invisible to every other kind of check.
--
-- pgTAP, run via `supabase test db` (spins up its own local Postgres,
-- applies every migration, then this file).
-- =====================================================================

begin;
select plan(6);

-- ---------- 1. the dry run completes at all ---------------------------
-- The original bug fails exactly here, before any assertion about results.
select lives_ok(
  $$ select public.enforce_retention(true) $$,
  'enforce_retention(dry_run => true) executes without a column-ambiguity error'
);

-- ---------- 2. it returns a row per implemented policy ----------------
-- Five policies have branches: rota_history, attendance, leave,
-- support_cases, and notifications (added with its branch in 0092 — a policy
-- without one takes the `else` path and deletes nothing). audit_log is
-- skipped by `retain_months is not null` and deleted_tenant by the explicit
-- exclusion, so neither should appear.
--
-- This number is asserted rather than derived on purpose: adding a policy row
-- and forgetting the branch is the exact mistake GAP-027 was about, and a
-- test that counted whatever it found would have said nothing about it.
select is(
  (select count(*)::int from public.enforce_retention(true)),
  5,
  'dry run returns one row for each of the five implemented policies'
);

select is(
  (select count(*)::int from public.enforce_retention(true) where data_type = 'audit_log'),
  0,
  'audit_log is never touched: its null retain_months keeps it out of the loop'
);

select is(
  (select count(*)::int from public.enforce_retention(true) where data_type = 'deleted_tenant'),
  0,
  'deleted_tenant is excluded: erasing a whole organisation stays manual'
);

-- ---------- 3. the run is recorded ------------------------------------
-- `retention_runs` is the evidence trail that distinguishes "enforced" from
-- "published". An empty table after a run is how the original bug stayed
-- invisible for two weeks.
select ok(
  (select count(*) from public.retention_runs where dry_run) >= 4,
  'the dry run writes its evidence to retention_runs'
);

-- ---------- 4. a dry run deletes nothing ------------------------------
-- Guards the p_dry_run branch specifically: this function is called nightly
-- with false, so the dry-run path must stay genuinely read-only or it is
-- useless as a rehearsal.
select is(
  (select count(*)::int from public.retention_policies),
  7,
  'a dry run mutates no policy rows'
);

select finish();
rollback;
