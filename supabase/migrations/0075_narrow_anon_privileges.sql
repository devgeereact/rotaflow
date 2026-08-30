-- =====================================================================
-- 0075_narrow_anon_privileges.sql — `anon` stops holding privileges it
-- has never needed (docs/SAAS.md HARDEN-001, HARDEN-002)
--
-- 0056 made the grants explicit and said of this, deliberately:
--
--     "Tightening anon is worth doing, but it is a security change and
--      belongs in its own reviewed migration, not smuggled into a CI fix
--      where a regression could not be attributed."
--
-- This is that migration.
--
-- ## What was verified first, against the live database
--
-- Revoking a privilege is only safe if nothing uses it, and grepping 74
-- migrations does not answer that — grants and policies get replaced.
-- So this was settled by reading the live catalogue:
--
--   * **Every policy in `public` requires an identity.** Zero policies
--     have a predicate free of `auth.uid()`, `is_org_member`,
--     `has_org_role`, `is_platform_admin`, `has_platform_role`,
--     `has_support_access` or `my_staff_profile_id`. Zero tables have
--     RLS disabled. Zero RLS-enabled tables lack a policy. So an anon
--     session can already read no row of any table.
--   * **All three views are `security_invoker = true`**, so the
--     underlying RLS applies to them too. A non-invoker view with an
--     anon grant would have been a real leak; there is none.
--   * **The only thing the logged-out app calls is `preview_invite`**,
--     which is `security definer` and keeps its anon grant. `/invite/
--     :token` has to render who invited someone before they have an
--     account.
--
-- ## Two things that were NOT inert
--
-- 1. **`touch_org_activity` is an unauthenticated write.** It is
--    `security definer`, takes an organisation id, and had no membership
--    check — so anyone could `POST /rest/v1/rpc/touch_org_activity` with
--    an org id and set that organisation's `last_activity_at` to now.
--    That column is not decorative: `tenantHealth.healthBand` derives
--    "needs attention" and "at risk" from it, and the platform console's
--    "Tenants active today" tile counts it. A dormant tenant could be
--    made to look active, which is precisely the signal support uses to
--    notice churn. Fixed below with the same `is_org_member` guard 0074
--    added to the entitlement functions, and revoked from anon besides.
--
-- 2. **`anon` held TRUNCATE, REFERENCES and TRIGGER on every table**,
--    not the CRUD set 0056 recorded — the hosted default ACL grants
--    `arwdDxtm`, which is wider than the file that documented it.
--    **RLS does not filter TRUNCATE.** It is unreachable today only
--    because `anon` is NOLOGIN and PostgREST never issues TRUNCATE — a
--    property of a component we do not control, not of this schema.
--    "Inert" was the right word for the CRUD grants and the wrong one
--    for this.
--
-- ## Why the default privileges change too
--
-- 0056 says "a new table gets no privileges until a migration grants
-- them explicitly". That is true of a fresh Postgres built from these
-- migrations, and **false on the hosted project**, where
-- `pg_default_acl` grants `anon=arwdDxtm` on every table created in
-- `public`. Without the ALTER DEFAULT PRIVILEGES below, the next
-- migration that creates a table would silently hand anon full CRUD
-- again and quietly undo this file.
--
-- Only `anon` is narrowed. `authenticated` and `service_role` keep their
-- defaults on purpose: making a new table dead-on-arrival for
-- `authenticated` would turn a forgotten GRANT into a silent 401 in a
-- feature nobody had reason to suspect, and that footgun is worse than
-- the tidiness.
--
-- ## Trigger functions are deliberately left alone
--
-- Fifteen `returns trigger` functions also carry PUBLIC EXECUTE.
-- Postgres refuses to call a trigger function directly — "trigger
-- functions can only be called as triggers" — before it runs a line of
-- the body, so the grant confers nothing. Revoking would be cosmetic,
-- and getting the privilege model of trigger execution wrong would break
-- every INSERT in the product. Not worth it for zero gain.
--
-- ## MIGRATION RISK
--
-- The highest-risk file in this series so far, so, precisely:
--
--   * Nothing that works today stops working. Anon can read no row now
--     and will read no row after; the difference is that it will be
--     refused by a missing grant rather than by an empty policy result.
--   * `authenticated` and `service_role` keep every EXECUTE they hold.
--     Every function below carries an explicit `authenticated=X` and
--     `service_role=X` entry, so revoking from PUBLIC cannot strip them
--     — this was checked in the catalogue, not assumed.
--   * `authenticated` loses only TRUNCATE, REFERENCES and TRIGGER. Its
--     SELECT/INSERT/UPDATE/DELETE are not touched at all, which is what
--     preserves 0056's four deliberate narrowings (organisations and
--     profiles without UPDATE, org_smtp_settings DELETE-only,
--     platform_announcement_optouts without UPDATE) rather than
--     re-deriving them and risking one.
--   * `usage on schema public` stays for anon. Without it PostgREST
--     cannot reach `preview_invite` and the invite page breaks.
--
-- Reversible by re-running 0056's grants and re-granting execute.
-- =====================================================================

-- ---------- 1. The unauthenticated write ----------------------------
create or replace function public.touch_org_activity(p_org uuid)
returns void language sql security definer set search_path = public as $$
  update public.organisations
     set last_activity_at = timezone('utc', now())
   where id = p_org
     and public.is_org_member(p_org)
     and (last_activity_at is null
          or last_activity_at < timezone('utc', now()) - interval '5 minutes');
$$;

comment on function public.touch_org_activity(uuid) is
  'Bumps last_activity_at, at most once every five minutes, for an organisation the caller belongs to. The membership check is the point: this column feeds tenantHealth.healthBand and the console''s active-tenant count, and without it any anonymous caller could make a dormant tenant look active.';

-- ---------- 2. Anon holds nothing on any table or view --------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Schema usage stays: PostgREST needs it to reach `preview_invite`, and
-- without that the public invite page cannot render.
grant usage on schema public to anon;

-- ---------- 3. Nobody holds TRUNCATE/REFERENCES/TRIGGER -------------
-- Surgical on purpose. Touching authenticated's SELECT/INSERT/UPDATE/DELETE
-- here would risk re-widening one of 0056's four narrowings.
revoke truncate, references, trigger on all tables in schema public
  from authenticated;

-- ---------- 4. Callable functions, PUBLIC and anon ------------------
-- The six security predicates and everything else an anon session could
-- reach at /rest/v1/rpc/. `authenticated` keeps each one explicitly, which
-- matters because the policies themselves call them: a policy expression is
-- evaluated as the querying role, so revoking from authenticated would break
-- every table in the product.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       -- Trigger functions: see the header. Postgres will not call one
       -- directly, so the grant confers nothing.
       and p.prorettype <> 'pg_catalog.trigger'::regtype
       -- The one function the logged-out app genuinely calls.
       and p.proname <> 'preview_invite'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
  end loop;
end;
$$;

-- ---------- 5. Stop the defaults handing it all back ----------------
-- Without this, the next migration that creates a table re-grants anon full
-- CRUD from `pg_default_acl` and silently undoes everything above.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
