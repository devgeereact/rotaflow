-- =====================================================================
-- 0010_org_smtp_settings.sql — per-organisation SMTP credentials
--
-- Each org can supply its own SMTP account so notification emails come from
-- their own domain/mailbox rather than a shared system sender — real
-- deliverability for a care home or agency looks like it came from them, not
-- from a third-party SaaS. send-notification (0007) falls back to the global
-- SMTP_* secrets when an org has not configured its own.
--
-- The password column is the one genuinely new risk in this schema: it is a
-- third-party mail credential, not just tenant data. The protection is one
-- real layer, not RLS itself:
--
-- The `for all` write policy below supplies a USING clause, so it also
-- governs SELECT — an owner's row-level access to org_smtp_settings is not
-- blocked by RLS. What actually keeps `smtp_pass` from ever coming back
-- through the client is the column-level GRANT just below the policy: it
-- lists every column except `smtp_pass` for `authenticated`'s SELECT grant,
-- full stop — no policy change could accidentally re-expose it, because the
-- privilege to read that column doesn't exist for that role at all.
-- `org_smtp_settings_safe` is what the UI actually queries (same columns,
-- friendlier surface); this is the same non-negotiable as never re-showing a
-- saved password in any settings form.
--
-- Only the send-notification and test-smtp Edge Functions (service_role,
-- bypasses RLS and column grants both) ever read smtp_pass — same posture as
-- VAPID_PRIVATE_KEY.
-- =====================================================================

create table if not exists public.org_smtp_settings (
  org_id       uuid primary key references public.organisations(id) on delete cascade,
  smtp_host    text not null,
  smtp_port    integer not null default 587,
  smtp_user    text not null,
  smtp_pass    text not null,
  from_email   text not null,
  from_name    text,
  -- Set true only after test-smtp actually succeeds — "saved" and "known to
  -- work" are different claims, and the UI must not conflate them.
  verified_at  timestamptz,
  created_at   timestamptz not null default timezone('utc', now()),
  updated_at   timestamptz not null default timezone('utc', now())
);

drop trigger if exists org_smtp_settings_set_updated_at on public.org_smtp_settings;
create trigger org_smtp_settings_set_updated_at
  before update on public.org_smtp_settings
  for each row execute function public.set_updated_at();

alter table public.org_smtp_settings enable row level security;

-- Owner-only for every command, including SELECT (see file header on why
-- that matters for smtp_pass). has_org_role, not is_org_member: this is
-- billing-adjacent, org-secret configuration, not something every staff
-- member should even be able to attempt to change.
drop policy if exists org_smtp_settings_write on public.org_smtp_settings;
create policy org_smtp_settings_write on public.org_smtp_settings for all
  using (public.has_org_role(org_id, array['owner']))
  with check (public.has_org_role(org_id, array['owner']));

revoke all on public.org_smtp_settings from authenticated, anon;
grant select (org_id, smtp_host, smtp_port, smtp_user, from_email, from_name, verified_at, created_at, updated_at),
      insert (org_id, smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name),
      update (smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name),
      delete
  on public.org_smtp_settings to authenticated;

-- The view the app actually queries for display.
--
-- WITHOUT security_invoker, a view's RLS is evaluated as the VIEW OWNER, not
-- the querying session — and every migration in this project runs as the
-- `postgres` superuser, which is exempt from RLS entirely (RLS never applies
-- to a table's owner, or to any role with BYPASSRLS, regardless of policy).
-- A view created the ordinary way here would silently return every org's
-- host/username/from-address to every authenticated user, no policy violated,
-- because none would even be checked. security_invoker=true (Postgres 15+,
-- what Supabase runs) forces the view to run with the QUERYING role's own
-- permissions, so has_org_role(org_id, ['owner']) from org_smtp_settings_write
-- is what actually gates it — same as querying the base table directly.
create or replace view public.org_smtp_settings_safe
  with (security_invoker = true) as
  select org_id, smtp_host, smtp_port, smtp_user, from_email, from_name,
         verified_at, created_at, updated_at
    from public.org_smtp_settings;

grant select on public.org_smtp_settings_safe to authenticated;
