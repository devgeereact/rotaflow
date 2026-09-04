-- =====================================================================
-- 0113_function_grants_are_in_the_history.sql — say out loud who may
-- execute each function, instead of inheriting it from the image
-- (docs/SAAS.md GAP-038)
--
-- ## The bug, stated plainly
--
-- Rebuild this database from `supabase/migrations` and no signed-in user
-- can read anything. Not one table: every RLS policy in `0002` is
-- `using (public.is_org_member(org_id))`, and on a fresh database
-- `authenticated` has no EXECUTE on `is_org_member`. The policy raises
-- `permission denied for function is_org_member`, and the row is refused.
--
-- Measured on 2026-09-02 against `supabase/postgres:17.6.1.143`:
--
--   supabase db reset && supabase test db
--     → Result: FAIL, 192 of 364 assertions ran; the rest could not
--       reach a table at all
--   grant execute on the four helpers → 364 of 364 run
--
-- Bisected by resetting to each version in turn: the grant is present at
-- `0074` and gone at `0075`.
--
-- ## Why production is fine, and why that is the worrying part
--
-- Nothing in this repository ever granted EXECUTE to `authenticated`. It
-- arrived through PostgreSQL's built-in default, EXECUTE to PUBLIC, and
-- `0075` swept that away (`revoke ... from public, anon`) to close an
-- `anon` hole. `authenticated` was collateral, invisibly, because the
-- hosted project happens to carry a default privilege the local image
-- does not:
--
--   production   pg_default_acl postgres/public/f
--                = {postgres=X, authenticated=X, service_role=X}
--   local image  = {postgres=X}
--
-- So on production every function is created already granted, and the
-- sweep took nothing that mattered. The migration history has been
-- relying on an environment default for a month, and the only place that
-- shows is a database built somewhere else — which is precisely the
-- database you build when restoring from a backup, and `GAP-001` says
-- there are no backups, so the migration history *is* the recovery path.
--
-- It also means the RLS suite has been proving things about a privilege
-- model that is not production's.
--
-- ## What this does
--
-- Restates production's live grant contract, read out of its catalogue on
-- 2026-09-02, as SQL. On production every statement below is a no-op: the
-- privilege is already held. Everywhere else it is the difference between
-- a working database and a dead one.
--
-- The split is production's own, not a new policy invented here:
--
--   `authenticated`   88 functions the browser calls, plus the four RLS
--                     helpers every policy depends on
--   `service_role`    all 97, being the role Edge Functions and the
--                     cron drain run as
--
-- The nine that `authenticated` deliberately does NOT get are the
-- server-only ones, and four separate pgTAP files already assert that a
-- signed-in user cannot call them:
-- `calendar_feed_shifts`, `verify_notification_secret`,
-- `consume_rate_limit`, `enqueue_scheduled_alerts`,
-- `dispatch_notification_outbox`, `enforce_retention`,
-- `probe_platform_health`, `audit_write`, `announcement_audience`.
--
-- `anon` is untouched: `0112` left it holding `preview_invite` alone, and
-- `function_grant_invariants.test.sql` fails the build if that changes.
--
-- Idempotent. Granting a privilege already held is a no-op.
-- =====================================================================

-- ── service_role: every function in public ───────────────────────────
--
-- Written as a sweep rather than 97 lines because the rule is "all of
-- them" — a new function should be callable by the role that runs the
-- Edge Functions, and stating that as a loop keeps it true for the next
-- one. `authenticated` below is the opposite case: a list, because
-- membership of it is a decision.
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
       and p.prorettype <> 'trigger'::regtype
  loop
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end;
$$;

-- ── authenticated: the functions a signed-in browser may call ────────
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.add_incident_update(uuid,text,text) to authenticated;
grant execute on function public.admin_create_organisation_with_invite(text,text,text,text,integer) to authenticated;
grant execute on function public.anonymize_staff_member(uuid,uuid) to authenticated;
grant execute on function public.apply_swap_reassignment(uuid) to authenticated;
grant execute on function public.assign_support_case(uuid,uuid) to authenticated;
grant execute on function public.begin_rota_revision(uuid) to authenticated;
grant execute on function public.claim_open_shift(uuid) to authenticated;
grant execute on function public.complete_onboarding(uuid) to authenticated;
grant execute on function public.connect_integration(uuid,text,text) to authenticated;
grant execute on function public.consume_my_rate_limit(text,integer,interval) to authenticated;
grant execute on function public.consume_org_rate_limit(text,uuid,integer,interval) to authenticated;
grant execute on function public.create_invite(uuid,text,text) to authenticated;
grant execute on function public.create_platform_announcement(text,text,text,text,text[],text,timestamp with time zone) to authenticated;
grant execute on function public.current_pay_rates(uuid) to authenticated;
grant execute on function public.declare_incident(text,text,text,text,timestamp with time zone) to authenticated;
grant execute on function public.delegate_role(uuid,uuid,timestamp with time zone,text) to authenticated;
grant execute on function public.delete_organisation(uuid,text) to authenticated;
grant execute on function public.discard_rota_revision(uuid) to authenticated;
grant execute on function public.erasure_retained_columns() to authenticated;
grant execute on function public.extend_gdpr_request(uuid,text) to authenticated;
grant execute on function public.flag_enabled_for_org(text,uuid) to authenticated;
grant execute on function public.grant_platform_role(uuid,text) to authenticated;
grant execute on function public.has_org_role(uuid,text[]) to authenticated;
grant execute on function public.has_platform_role(text[]) to authenticated;
grant execute on function public.has_support_access(uuid,boolean) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.issue_calendar_feed_token(uuid) to authenticated;
grant execute on function public.issue_invoice(uuid,date,date,integer) to authenticated;
grant execute on function public.labour_cost(uuid,date,date,boolean) to authenticated;
grant execute on function public.leave_days(date,date,boolean,boolean) to authenticated;
grant execute on function public.log_audit_event(uuid,text,text,uuid,jsonb) to authenticated;
grant execute on function public.log_gdpr_request(text,text,text,uuid,date) to authenticated;
grant execute on function public.mark_announcement_read(uuid) to authenticated;
grant execute on function public.my_active_org_ids() to authenticated;
grant execute on function public.my_feature_access(uuid) to authenticated;
grant execute on function public.my_mfa_status() to authenticated;
grant execute on function public.my_platform_role() to authenticated;
grant execute on function public.my_sessions() to authenticated;
grant execute on function public.my_staff_profile_id(uuid) to authenticated;
grant execute on function public.notification_delivery_configured() to authenticated;
grant execute on function public.open_shifts(uuid) to authenticated;
grant execute on function public.open_support_case(text,text,text,text,uuid,text) to authenticated;
grant execute on function public.org_has_feature(uuid,text) to authenticated;
grant execute on function public.organisation_deletion_preview(uuid) to authenticated;
grant execute on function public.overtime_evidence(uuid,uuid,date) to authenticated;
grant execute on function public.platform_auth_facts_summary() to authenticated;
grant execute on function public.platform_location_counts() to authenticated;
grant execute on function public.platform_staff_counts() to authenticated;
grant execute on function public.platform_tenant_counts(uuid) to authenticated;
grant execute on function public.platform_totals() to authenticated;
grant execute on function public.platform_user_auth_facts(uuid) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.publish_platform_announcement(uuid) to authenticated;
grant execute on function public.publish_rota(uuid) to authenticated;
grant execute on function public.rate_support_case(uuid,integer,text) to authenticated;
grant execute on function public.record_health_sample(text,text,integer,text) to authenticated;
grant execute on function public.remind_announcement_unread(uuid) to authenticated;
grant execute on function public.render_notification(uuid,text,jsonb,text) to authenticated;
grant execute on function public.repeat_rota_weeks(uuid,integer) to authenticated;
grant execute on function public.reply_to_support_case(uuid,text,boolean) to authenticated;
grant execute on function public.request_support_access(uuid,text,text,text,integer) to authenticated;
grant execute on function public.resolve_incident(uuid,text) to authenticated;
grant execute on function public.revoke_calendar_feed_token(uuid) to authenticated;
grant execute on function public.revoke_delegation(uuid) to authenticated;
grant execute on function public.revoke_my_other_sessions() to authenticated;
grant execute on function public.revoke_platform_role(uuid) to authenticated;
grant execute on function public.revoke_support_access(uuid,text) to authenticated;
grant execute on function public.rota_amendment_changes(uuid) to authenticated;
grant execute on function public.set_feature_flag(text,boolean,integer,text[]) to authenticated;
grant execute on function public.set_feature_flag_target(text,uuid,boolean) to authenticated;
grant execute on function public.set_gdpr_request_status(uuid,text,text) to authenticated;
grant execute on function public.set_invoice_status(uuid,text,text) to authenticated;
grant execute on function public.set_org_integration_status(uuid,text,text) to authenticated;
grant execute on function public.set_org_status(uuid,text,text) to authenticated;
grant execute on function public.set_org_support_access(uuid,boolean) to authenticated;
grant execute on function public.set_platform_mfa_required(boolean) to authenticated;
grant execute on function public.set_support_case_status(uuid,text,text) to authenticated;
grant execute on function public.slug_available(text) to authenticated;
grant execute on function public.slug_available(text,uuid) to authenticated;
grant execute on function public.staff_at_location(uuid) to authenticated;
grant execute on function public.subscription_mrr_pence(uuid) to authenticated;
grant execute on function public.support_access_status(support_access_sessions) to authenticated;
grant execute on function public.support_sla_state(uuid) to authenticated;
grant execute on function public.touch_org_activity(uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid,uuid) to authenticated;
grant execute on function public.unpublish_rota(uuid) to authenticated;

-- ── default closed stays default closed ──────────────────────────────
--
-- `0112` set `alter default privileges for role postgres in schema public
-- revoke execute on functions from public`, so a function added after this
-- migration is executable by nobody until its own migration says
-- otherwise — including by `authenticated`. That is the intended shape:
-- the grant is a line in a diff a reviewer sees, not a property of
-- whichever image the runner pulled that morning.
--
-- Guarded by `function_grant_invariants.test.sql`, which now asserts both
-- directions: `anon` and `PUBLIC` can execute nothing but `preview_invite`,
-- and `authenticated` CAN execute the four helpers every RLS policy calls.
