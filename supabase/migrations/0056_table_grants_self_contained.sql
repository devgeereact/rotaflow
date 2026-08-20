-- =====================================================================
-- 0056_table_grants_self_contained.sql
--
-- Makes the migration set reconstructible.
--
-- Until now no migration granted table privileges. Production works only
-- because Supabase's ambient `pg_default_acl` (set by the `postgres` and
-- `supabase_admin` roles when the project is provisioned) hands anon,
-- authenticated and service_role their privileges on every table created
-- in `public`. That default is a property of the hosted project, not of
-- this repo — so applying these 56 migrations to a fresh Postgres yields
-- a database where `authenticated` can do nothing at all.
--
-- Two consequences, one already live:
--   * `supabase test db` in CI (job `db-tests`) has been failing with
--     `permission denied for table organisations` since the pgTAP suite
--     was wired in. It is not reporting a production defect — it is
--     reporting that the local stack has no ambient defaults to inherit.
--   * A DR restore, a staging project, or any new environment built from
--     migrations alone would come up broken in the same way. With PITR
--     currently disabled, migrations ARE the recovery path.
--
-- The grants below are not idealised: they were read back from the live
-- project (`information_schema.role_table_grants`) and reproduce it
-- exactly, table by table. That is deliberate. This migration's job is to
-- make an existing, working state explicit — not to change it. On the
-- live database every statement here is a no-op.
--
-- In particular it preserves four narrowings that a blanket
-- `grant ... on all tables` would have silently re-widened, because GRANT
-- only ever adds and this migration runs last:
--
--   organisations                  authenticated has no UPDATE (0017)
--   profiles                       authenticated has no UPDATE
--   org_smtp_settings              authenticated has DELETE only — no
--                                  SELECT, so `smtp_pass` is unreadable;
--                                  reads go through org_smtp_settings_safe
--   platform_announcement_optouts  no UPDATE for anon or authenticated
--
-- Row access is still governed entirely by RLS. Every policy in `public`
-- is defined for role `public` with an `auth.uid()`-based predicate, so
-- anon's grants below are inert — `plans_select`, the most permissive of
-- them, is `auth.uid() is not null`. The grants are the outer envelope;
-- the policies are the lock. Tightening anon is worth doing, but it is a
-- security change and belongs in its own reviewed migration, not smuggled
-- into a CI fix where a regression could not be attributed.
--
-- NOTE FOR FUTURE MIGRATIONS: there is deliberately no
-- `alter default privileges` here. A new table gets no privileges until a
-- migration grants them explicitly. That is stricter than the hosted
-- default and it is the point — it keeps this file honest and stops a
-- sensitive table from inheriting anon access by accident.
-- =====================================================================

-- ---------- schema usage -------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- ---------- full CRUD for anon, authenticated and service_role -----
-- The org-scoped operational tables. RLS narrows every one of them to the
-- caller's organisation and role.
grant select, insert, update, delete on public.announcement_reads           to anon, authenticated, service_role;
grant select, insert, update, delete on public.announcements               to anon, authenticated, service_role;
grant select, insert, update, delete on public.app_settings                to anon, authenticated, service_role;
grant select, insert, update, delete on public.audit_logs                  to anon, authenticated, service_role;
grant select, insert, update, delete on public.availability                to anon, authenticated, service_role;
grant select, insert, update, delete on public.clock_events                to anon, authenticated, service_role;
grant select, insert, update, delete on public.departments                 to anon, authenticated, service_role;
grant select, insert, update, delete on public.documents                   to anon, authenticated, service_role;
grant select, insert, update, delete on public.emergency_contacts          to anon, authenticated, service_role;
grant select, insert, update, delete on public.integration_connector_stats to anon, authenticated, service_role;
grant select, insert, update, delete on public.invites                     to anon, authenticated, service_role;
grant select, insert, update, delete on public.leave_requests              to anon, authenticated, service_role;
grant select, insert, update, delete on public.locations                   to anon, authenticated, service_role;
grant select, insert, update, delete on public.memberships                 to anon, authenticated, service_role;
grant select, insert, update, delete on public.minimum_cover_rules         to anon, authenticated, service_role;
grant select, insert, update, delete on public.notifications               to anon, authenticated, service_role;
grant select, insert, update, delete on public.org_smtp_settings_safe      to anon, authenticated, service_role;
grant select, insert, update, delete on public.overtime_requests           to anon, authenticated, service_role;
grant select, insert, update, delete on public.platform_admins             to anon, authenticated, service_role;
grant select, insert, update, delete on public.platform_health_summary     to anon, authenticated, service_role;
grant select, insert, update, delete on public.platform_settings           to anon, authenticated, service_role;
grant select, insert, update, delete on public.push_subscriptions          to anon, authenticated, service_role;
grant select, insert, update, delete on public.rotas                       to anon, authenticated, service_role;
grant select, insert, update, delete on public.shift_swaps                 to anon, authenticated, service_role;
grant select, insert, update, delete on public.shift_templates             to anon, authenticated, service_role;
grant select, insert, update, delete on public.shift_types                 to anon, authenticated, service_role;
grant select, insert, update, delete on public.shifts                      to anon, authenticated, service_role;
grant select, insert, update, delete on public.staff_profiles              to anon, authenticated, service_role;
grant select, insert, update, delete on public.subscriptions               to anon, authenticated, service_role;
grant select, insert, update, delete on public.timesheets                  to anon, authenticated, service_role;

-- ---------- read-only for anon and authenticated -------------------
-- Platform-console and system tables. Writes are service_role only (or an
-- RPC); RLS still gates which rows a reader can see — most require
-- `is_platform_admin()`.
grant select on public.background_jobs                  to anon, authenticated;
grant select on public.feature_flag_changes             to anon, authenticated;
grant select on public.feature_flag_targets             to anon, authenticated;
grant select on public.feature_flags                    to anon, authenticated;
grant select on public.gdpr_requests                    to anon, authenticated;
grant select on public.incident_updates                 to anon, authenticated;
grant select on public.incidents                        to anon, authenticated;
grant select on public.integration_connectors           to anon, authenticated;
grant select on public.integration_sync_runs            to anon, authenticated;
grant select on public.invoices                         to anon, authenticated;
grant select on public.org_integrations                 to anon, authenticated;
grant select on public.plans                            to anon, authenticated;
grant select on public.platform_announcement_deliveries to anon, authenticated;
grant select on public.platform_announcements           to anon, authenticated;
grant select on public.platform_health_samples          to anon, authenticated;
grant select on public.platform_ip_allowlist            to anon, authenticated;
grant select on public.retention_policies               to anon, authenticated;
grant select on public.retention_runs                   to anon, authenticated;
grant select on public.support_access_sessions          to anon, authenticated;
grant select on public.support_case_messages            to anon, authenticated;
grant select on public.support_cases                    to anon, authenticated;

grant select, insert, update, delete on public.background_jobs                  to service_role;
grant select, insert, update, delete on public.feature_flag_changes             to service_role;
grant select, insert, update, delete on public.feature_flag_targets             to service_role;
grant select, insert, update, delete on public.feature_flags                    to service_role;
grant select, insert, update, delete on public.gdpr_requests                    to service_role;
grant select, insert, update, delete on public.incident_updates                 to service_role;
grant select, insert, update, delete on public.incidents                        to service_role;
grant select, insert, update, delete on public.integration_connectors           to service_role;
grant select, insert, update, delete on public.integration_sync_runs            to service_role;
grant select, insert, update, delete on public.invoices                         to service_role;
grant select, insert, update, delete on public.org_integrations                 to service_role;
grant select, insert, update, delete on public.plans                            to service_role;
grant select, insert, update, delete on public.platform_announcement_deliveries to service_role;
grant select, insert, update, delete on public.platform_announcements           to service_role;
grant select, insert, update, delete on public.platform_health_samples          to service_role;
grant select, insert, update, delete on public.platform_ip_allowlist            to service_role;
grant select, insert, update, delete on public.retention_policies               to service_role;
grant select, insert, update, delete on public.retention_runs                   to service_role;
grant select, insert, update, delete on public.support_access_sessions          to service_role;
grant select, insert, update, delete on public.support_case_messages            to service_role;
grant select, insert, update, delete on public.support_cases                    to service_role;

-- ---------- the four narrowed tables -------------------------------

-- organisations: `authenticated` deliberately has no table-level UPDATE.
-- 0017 revoked it so that renaming or re-plumbing an organisation can only
-- happen through an RPC that checks the caller is an owner. The
-- `organisations_update` policy still exists and still applies to the
-- roles that do hold UPDATE.
grant select, insert, update, delete on public.organisations to anon, service_role;
grant select, insert, delete         on public.organisations to authenticated;

-- profiles: same shape. A user edits their own profile through an RPC;
-- `profiles_update_own` covers the roles that hold UPDATE.
grant select, insert, update, delete on public.profiles to anon, service_role;
grant select, insert, delete         on public.profiles to authenticated;

-- org_smtp_settings: holds `smtp_pass`. `authenticated` gets DELETE and
-- nothing else — it cannot read the secret at all. Application reads go
-- through the `org_smtp_settings_safe` view, which omits the password
-- column; the only reader of the real table is the `test-smtp` Edge
-- Function, under service_role and behind an owner-only check.
grant select, insert, update, delete on public.org_smtp_settings to service_role;
grant delete                         on public.org_smtp_settings to authenticated;

-- platform_announcement_optouts: opting out is insert-or-delete. There is
-- no UPDATE path, so no UPDATE grant.
grant select, insert, update, delete on public.platform_announcement_optouts to service_role;
grant select, insert, delete         on public.platform_announcement_optouts to anon, authenticated;

-- ---------- sequences ----------------------------------------------
-- Reference sequences (support-case refs, incident refs, invoice numbers)
-- are advanced by INSERT defaults, so the inserting role needs USAGE.
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
