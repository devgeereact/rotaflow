-- =====================================================================
-- 0112_function_grants_default_closed.sql — stop new functions being
-- executable by `anon` unless somebody says so (docs/SAAS.md HARDEN-002)
--
-- ## What is actually wrong
--
-- `docs/SAAS.md` HARDEN-002 says, and has said since 2026-08-30:
--
--   "`PUBLIC` and `anon` execute revoked on every callable function
--    except `preview_invite`, the only thing the logged-out app calls."
--
-- Read against the live catalogue on 2026-08-31, that is no longer true.
-- Excluding trigger functions, `anon` can execute three:
--
--   preview_invite(text)                     -- deliberate, documented
--   leave_days(date,date,boolean,boolean)    -- added by 0109, today
--   erasure_retained_columns()               -- added by 0111, today
--
-- Both of the new ones carry `=X/postgres` in `proacl`. The empty
-- grantee is **PUBLIC**, and `anon` inherits EXECUTE through it.
--
-- ## Why 0075's sweep did not hold
--
-- `0075` revoked execute on every function that existed at the time
-- `from public, anon` — correct, and `labour_cost` and `open_shifts`
-- show migrations since have often remembered to do the same. It then
-- tried to make that permanent:
--
--   alter default privileges in schema public revoke all on functions from anon;
--
-- That line cannot work, and the reason is worth stating precisely:
-- **PostgreSQL's built-in default is EXECUTE to PUBLIC, not to `anon`.**
-- Revoking a default "from anon" removes an entry that was never there;
-- the grant `anon` actually receives arrives through PUBLIC. So every
-- function created after `0075` has been public-executable again unless
-- its own migration remembered an explicit revoke, and two out of the
-- twelve written on 2026-08-31 did not.
--
-- ## This is hygiene, not an incident
--
-- Neither leaks anything. `leave_days` is date arithmetic over its four
-- arguments and touches no table. `erasure_retained_columns` returns a
-- list of COLUMN NAMES that GDPR erasure deliberately keeps, which is
-- schema metadata already visible to anyone reading this public
-- repository. Nobody's data was reachable.
--
-- What is worth fixing is the class. A rule that holds only while each
-- author remembers it is not a rule, and this one is invisible when
-- broken: a function with a PUBLIC grant behaves identically to one
-- without, right up until the function it is attached to reads a table.
--
-- ## Three parts, smallest first
--
-- Idempotent throughout: revoking a privilege that is absent is a no-op,
-- and the default-privileges statement is declarative.
-- =====================================================================

-- ── 1. the two that slipped through ──────────────────────────────────
revoke execute on function public.leave_days(date, date, boolean, boolean)
  from public, anon;
revoke execute on function public.erasure_retained_columns()
  from public, anon;

-- `authenticated` and `service_role` keep theirs — both are granted
-- explicitly by 0109 and 0111 and are unaffected by a PUBLIC revoke.

-- ── 2. every other function in public, swept the same way ────────────
--
-- 0075 did this once. Doing it again is cheap and catches anything
-- added between then and now that also forgot. `preview_invite` is
-- re-granted below rather than excluded here, so the exception is
-- stated in one place instead of hidden inside a filter.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
  end loop;
end;
$$;

-- The one exception, restated where it can be read.
--
-- SAFETY(grant_to_anon): this re-grants a privilege `anon` already holds,
-- it does not add one. The sweep immediately above revokes execute on every
-- function in `public` from `public, anon`, which would otherwise take
-- `preview_invite` with it and break the invitation screen for the only
-- people who use it — logged-out visitors holding a link, who by definition
-- cannot report it from inside the app. Restating the grant here rather
-- than excluding the function from the loop keeps the exception in one
-- readable place instead of hidden in a filter condition. `preview_invite`
-- (0006) returns an organisation name and an inviter's name for a token the
-- caller must already possess, and nothing else; it has been anon-callable
-- since 0075 audited it and left it deliberately.
grant execute on function public.preview_invite(text) to anon;

-- ── 3. default closed from here on ───────────────────────────────────
--
-- This is the line 0075 meant to write. `from public` rather than
-- `from anon`, because PUBLIC is where the default grant lives.
--
-- Scoped to the role that owns these objects: ALTER DEFAULT PRIVILEGES
-- only affects objects created by the role it names, and every function
-- in `public` here is owned by `postgres`.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- A new function is therefore executable by nobody until its migration
-- grants it, which is the same shape as the RLS rule in CLAUDE.md:
-- closed until somebody argues for opening it, in a diff a reviewer sees.
--
-- Guarded by `function_grant_invariants.test.sql`, which fails the build
-- on any non-trigger function in `public` that `anon` or `PUBLIC` can
-- execute other than `preview_invite`.
