-- =====================================================================
-- rls_invariants.test.sql — the rules CLAUDE.md states and nothing checked
--
-- `CLAUDE.md` says, under "Multi-tenancy guardrails":
--
--   "A new table enables RLS with membership-scoped policies
--    (`is_org_member`, `has_org_role`) BEFORE it is used."
--   "`anon` holds nothing in `public` beyond schema usage and one
--    function grant (0075)."
--
-- Both were true when this test was written, verified against
-- production. Neither was enforced by anything. A table added without
-- `enable row level security` is not a bug that shows up as an error —
-- it is every tenant reading every other tenant's rows, silently, until
-- somebody notices. That is the single worst failure this product can
-- have, and it was resting on whoever wrote the migration remembering.
--
-- Six tables were added on 2026-08-31 alone. All six were fine. The
-- seventh is the one this exists for.
--
--   1. every base table in `public` has RLS enabled;
--   2. every table `authenticated` can read has at least one policy —
--      RLS with no policy denies everything, which is safe, but a grant
--      plus no policy is a table somebody meant to expose and did not,
--      so it is worth failing on;
--   3. `anon` holds no table privilege in `public` at all;
--   4. neither does `PUBLIC`, which is the one that grants silently to
--      every role including `anon`.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(4);

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity),
  '',
  'every table in public has row level security enabled'
);

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and not exists (
        select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname
      )),
  '',
  'every table authenticated can read has a policy deciding which rows'
);

select is(
  (select coalesce(string_agg(distinct table_name, ', '), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  '',
  'anon holds no table privilege in public'
);

select is(
  (select coalesce(string_agg(distinct table_name, ', '), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'PUBLIC'),
  '',
  'and neither does PUBLIC, which would grant to every role at once'
);

select * from finish();
rollback;
