-- =====================================================================
-- function_grant_invariants.test.sql — the other half of the rule
-- `rls_invariants.test.sql` already guards
--
-- That test asserts `anon` holds no TABLE privilege in `public`. This
-- one asserts the same about FUNCTIONS, because a function is the other
-- way a row leaves the database — a `security definer` function runs as
-- its owner and RLS does not apply to it at all.
--
-- It exists because the rule failed silently. `0075` swept every
-- function that existed and then tried to make it stick with
--
--   alter default privileges in schema public revoke all on functions from anon;
--
-- which cannot work: PostgreSQL's built-in default grants EXECUTE to
-- **PUBLIC**, and `anon` inherits through it, so revoking a default
-- "from anon" removes an entry that was never there. Twelve migrations
-- later, `leave_days` (0109) and `erasure_retained_columns` (0111) were
-- both public-executable and nothing noticed. `0112` fixes the default;
-- this makes sure the next one cannot repeat it.
--
-- Neither of those two leaked anything — one is date arithmetic, the
-- other returns column names. That is exactly why it went unseen for as
-- long as it did, and why the check has to be structural rather than a
-- reviewer's attention.
--
-- ## Trigger functions are excluded, deliberately
--
-- A function returning `trigger` cannot be invoked over PostgREST: the
-- call raises "trigger functions can only be called as triggers", and
-- firing a trigger does not test EXECUTE on its function at all. So the
-- grant on those 23 is noise rather than exposure, and failing on it
-- would train somebody to add exclusions to this file.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(3);

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_function_result(p.oid) <> 'trigger'
      and p.proname <> 'preview_invite'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  '',
  'anon can execute no function in public except preview_invite'
);

-- The one that actually bites: a PUBLIC grant reaches every role at
-- once, including roles added later, and reads as absent in any check
-- that looks for `anon` by name.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_function_result(p.oid) <> 'trigger'
      and p.proname <> 'preview_invite'
      and p.proacl::text like '%=X/%'),
  '',
  'and no function carries a bare PUBLIC execute grant'
);

-- Asserting the exception exists, not just that everything else does
-- not. If `preview_invite` ever loses its grant the invitation screen
-- breaks for exactly the people who cannot report it — logged-out
-- users holding a link — and both assertions above would still pass.
select ok(
  has_function_privilege('anon', 'public.preview_invite(text)', 'EXECUTE'),
  'preview_invite is still reachable by anon, which the invite screen needs'
);

select * from finish();
rollback;
