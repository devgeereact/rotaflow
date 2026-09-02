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
-- ## This test has been shown to fail on the real defect
--
-- A green assertion proves nothing on its own — it is satisfied just as
-- well by a query that can never return a row. The PUBLIC assertion below
-- was run against **production, before `0112` applied**, and returned
-- exactly `erasure_retained_columns, leave_days`: the two functions this
-- migration exists for, and nothing else. So it detects the thing it
-- claims to, and it will read empty once `0112` is applied rather than
-- because it cannot see.
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
select plan(5);

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
--
-- Read through `aclexplode` rather than by matching the ACL as text.
-- The first version of this test used `proacl::text like '%=X/%'` and
-- failed against every function in the schema, because `postgres=X/postgres`
-- contains that substring too — PUBLIC is the entry whose grantee is
-- EMPTY (`{=X/postgres,...}`), not any entry with an execute bit.
-- `aclexplode` reports PUBLIC as grantee OID 0, which cannot be confused
-- with a named role.
--
-- A NULL `proacl` counts as a failure as well, and that is the case worth
-- catching: NULL means "nothing was ever granted or revoked", which in
-- PostgreSQL is not "closed" but the built-in default of EXECUTE to
-- PUBLIC. It is the exact state 0112 exists to stop new functions being
-- created in, and it is invisible to any check that only reads the ACL
-- entries that exist.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_function_result(p.oid) <> 'trigger'
      and p.proname <> 'preview_invite'
      and (
        p.proacl is null
        or exists (
          select 1 from aclexplode(p.proacl) a
           where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
      )),
  '',
  'and no function carries a bare PUBLIC execute grant, or a null ACL that means one'
);

-- Asserting the exception exists, not just that everything else does
-- not. If `preview_invite` ever loses its grant the invitation screen
-- breaks for exactly the people who cannot report it — logged-out
-- users holding a link — and both assertions above would still pass.
select ok(
  has_function_privilege('anon', 'public.preview_invite(text)', 'EXECUTE'),
  'preview_invite is still reachable by anon, which the invite screen needs'
);

-- ── the other direction: closed to anon is not the only way to be wrong ──
--
-- `0075` closed the `anon` hole by revoking EXECUTE `from public, anon`.
-- PUBLIC was also the only path by which `authenticated` held EXECUTE on
-- the four helpers every RLS policy calls, so the same statement quietly
-- shut signed-in users out of every table in the schema. It was invisible
-- on production, which carries a `pg_default_acl` entry granting
-- `authenticated` at creation time, and invisible in CI, whose image
-- carried the same one. On an image without it — the one restoring from
-- this migration history would use — 172 of the 364 assertions in this
-- suite could not reach a table at all.
--
-- So the invariant has two halves, and only one of them was written down.
-- This is the other: the roles that are supposed to hold EXECUTE must
-- actually hold it. See `0113`.
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), '')
     from unnest(array[
       'public.is_org_member(uuid)',
       'public.has_org_role(uuid,text[])',
       'public.my_staff_profile_id(uuid)',
       'public.is_platform_admin()'
     ]) as fn
    where not has_function_privilege('authenticated', fn, 'EXECUTE')),
  '',
  'authenticated can execute every helper the RLS policies call'
);

-- And the nine server-only functions stay shut to a browser. Four other
-- files assert this one function at a time, in the context of the feature
-- each protects; stating the whole set once means a tenth added later is
-- a decision somebody makes rather than a default nobody sees.
select is(
  (select coalesce(string_agg(fn, ', ' order by fn), '')
     from unnest(array[
       'public.announcement_audience(uuid)',
       'public.audit_write(uuid,text,text,uuid,jsonb,text,text)',
       'public.calendar_feed_shifts(uuid)',
       'public.consume_rate_limit(text,text,integer,interval)',
       'public.dispatch_notification_outbox()',
       'public.enforce_retention(boolean)',
       'public.enqueue_scheduled_alerts()',
       'public.probe_platform_health()',
       'public.verify_notification_secret(text)'
     ]) as fn
    where has_function_privilege('authenticated', fn, 'EXECUTE')),
  '',
  'and cannot execute any of the nine that only the server may call'
);

select * from finish();
rollback;
