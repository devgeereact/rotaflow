-- =====================================================================
-- table_grant_invariants.test.sql — the client's writes need a GRANT on
-- the COLUMN, not only a policy on the table (docs/SAAS.md GAP-061)
--
-- `rls_invariants.test.sql` asserts every table has RLS and a policy.
-- `function_grant_invariants.test.sql` asserts who may EXECUTE. Neither
-- asks the question that broke sign-up: **may `authenticated` write this
-- column?**
--
-- A policy filters the rows a role may already touch; it cannot grant
-- the privilege to touch them. `organisations_update` was exactly right
-- — `has_org_role(id, ARRAY['owner'])` on both sides — while
-- `industry`, `country` and `timezone` were outside the column grant
-- `0017` drew, so every new customer got a 403 on onboarding step 2 and
-- nobody could finish the wizard. `0117` extends the grant; this stops
-- the next column going unnoticed.
--
-- ## Why this is column-level and not `has_table_privilege`
--
-- Two tables here are deliberately column-scoped — `0017` on
-- `organisations` so an owner cannot lift their own suspension, `0015`
-- on `profiles` so nobody can set their own `is_platform_admin`, `0010`
-- on `org_smtp_settings` so `smtp_pass` is never read back.
--
-- That makes the coarse checks actively misleading in both directions.
-- `has_table_privilege('authenticated','public.organisations','UPDATE')`
-- reads **false** even when the app works perfectly, because a column
-- grant does not satisfy a table-level test. And
-- `has_any_column_privilege(...,'UPDATE')` reads **true** even with the
-- bug present, because `name` was granted all along. A test built on
-- either would have said nothing useful on the day this broke. So the
-- assertions below name columns.
--
-- ## Shown to fail on the real defect
--
-- With `0117` reverted and the database rebuilt, assertion 1 returns
-- exactly:
--
--   organisations.contact_email, organisations.contact_phone,
--   organisations.country, organisations.industry,
--   organisations.timezone, org_smtp_settings.verified_at
--
-- which is the complete set `src/` writes and the database refused, and
-- reads empty once `0117` is applied. It detects the thing it claims to
-- rather than being satisfied by a query that cannot return a row.
--
-- ## Keeping the list honest
--
-- pgTAP cannot read `src/`. The pairs below were derived by walking
-- every `.from('<table>').update(...)` and `.upsert(...)` in the client.
-- Add a column to one of those writes and you add a row here in the same
-- change, or this fails.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(4);

-- ---------------------------------------------------------------------
-- 1. Every column the client writes is actually writable.
-- ---------------------------------------------------------------------
select is(
  (
    select coalesce(string_agg(need.tbl || '.' || need.col, ', ' order by need.tbl, need.col), '')
      from (
        values
          -- orgService.updateOrganisation / mergeOrgSettings, written by
          -- OnboardingPage step 2 and SettingsOrganisationPage. `plan` is
          -- absent on purpose since `0120`: it is the entitlement column and
          -- only a paid subscription sets it, so it appears in the negative
          -- assertion below instead.
          ('organisations',     'name'),
          ('organisations',     'slug'),
          ('organisations',     'settings'),
          ('organisations',     'industry'),
          ('organisations',     'country'),
          ('organisations',     'timezone'),
          ('organisations',     'contact_email'),
          ('organisations',     'contact_phone'),
          -- profileService.updateProfile, written by ProfilePage.
          ('profiles',          'full_name'),
          -- smtpSettingsService: upsert writes the first six, and
          -- updateOrgSmtpFields additionally clears verified_at.
          ('org_smtp_settings', 'smtp_host'),
          ('org_smtp_settings', 'smtp_port'),
          ('org_smtp_settings', 'smtp_user'),
          ('org_smtp_settings', 'smtp_pass'),
          ('org_smtp_settings', 'from_email'),
          ('org_smtp_settings', 'from_name'),
          ('org_smtp_settings', 'verified_at')
      ) as need(tbl, col)
     where to_regclass('public.' || need.tbl) is not null
       and not has_column_privilege('authenticated', 'public.' || need.tbl, need.col, 'UPDATE')
  ),
  '',
  'authenticated can update every column the client writes'
);

-- ---------------------------------------------------------------------
-- 2 and 3. The columns that must stay out of reach of a browser, and
-- the reason `0117` is column-scoped rather than the table grant
-- PostgreSQL's own error hint tells you to run.
-- ---------------------------------------------------------------------
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'UPDATE'),
  'authenticated cannot update profiles.is_platform_admin'
);

select is(
  (
    select coalesce(string_agg(col, ', ' order by col), '')
      from unnest(array[
        'status',
        'suspended_at',
        'suspended_reason',
        'support_access_allowed',
        'plan',
        'is_demo',
        'onboarding_completed_at',
        'created_by'
      ]) as col
     where has_column_privilege('authenticated', 'public.organisations', col, 'UPDATE')
  ),
  '',
  'authenticated cannot update the organisations columns the platform owns'
);

-- ---------------------------------------------------------------------
-- 4. `anon` still writes nothing. Restated here because `0117` is the
--    first migration in a while to hand out a write privilege.
-- ---------------------------------------------------------------------
select is(
  (
    select coalesce(string_agg(distinct table_name, ', ' order by table_name), '')
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee = 'anon'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  '',
  'anon holds no write privilege on any table in public'
);

select * from finish();
rollback;
