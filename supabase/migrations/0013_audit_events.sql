-- 0013_audit_events.sql — make audit_logs an actual audit trail
--
-- P1-5 (docs/audit01.md). `audit_logs` has existed since 0002 with exactly one
-- writer: the `anonymize_staff_member` RPC in 0011. So it accumulates rows for
-- one event type and nothing else — no role changes, no rota publishes, no
-- invites. Building the designed Audit screen (design/Settingsaudit.png)
-- against that would produce a screen that looks broken.
--
-- For a multi-tenant app holding staff PII under UK GDPR the trail is an
-- accountability control: who changed this person's shift, who granted support
-- access, who exported a staff record. This migration writes the events.
--
-- ## Why triggers rather than client calls
--
-- The client is not trustworthy for audit. A browser session can simply not
-- send the audit write, or send a false one — and `notifications` already
-- establishes the pattern that rows nobody may forge are written server-side.
-- These triggers fire inside the same transaction as the change they record,
-- so an audited operation cannot happen without its audit row.
--
-- ## Why the audit insert cannot break the operation
--
-- Every insert below is structurally safe: `org_id` comes from the row being
-- changed, so it always satisfies the FK, and `actor_user_id` is nullable so a
-- service-role action is fine. It is still wrapped, because the failure mode
-- otherwise is that an audit-table problem stops a nurse publishing a rota.
-- Losing one audit row is recoverable; blocking the rota is not. The exception
-- branch re-raises as a WARNING so the failure is visible in the Postgres log
-- rather than silently swallowed.

-- ---------------------------------------------------------------------------
-- 1. Columns the designed screen needs and the table lacks.
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists ip_address inet,
  add column if not exists severity   text not null default 'info',
  add column if not exists area       text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audit_logs_severity_check'
  ) then
    alter table public.audit_logs
      add constraint audit_logs_severity_check
      check (severity in ('info', 'notice', 'warning', 'critical'));
  end if;
end $$;

comment on column public.audit_logs.ip_address is
  'Client IP when PostgREST forwarded one. NULL for anything a trigger '
  'recorded outside a request (a service-role job, a psql session).';
comment on column public.audit_logs.severity is
  'info | notice | warning | critical — drives the designed screen''s filter.';
comment on column public.audit_logs.area is
  'Coarse grouping for the screen''s filter: access, scheduling, staff, org.';

create index if not exists audit_logs_org_created_idx
  on public.audit_logs (org_id, created_at desc);
create index if not exists audit_logs_org_area_idx
  on public.audit_logs (org_id, area);

-- ---------------------------------------------------------------------------
-- 2. Helpers.
-- ---------------------------------------------------------------------------

-- The caller's IP as PostgREST forwards it. Returns NULL rather than raising
-- when there is no request context (a trigger firing under psql or a job), and
-- when the header is absent or unparseable — an audit row with no IP is worth
-- far more than a failed write.
create or replace function public.request_ip()
returns inet
language plpgsql
stable
as $$
declare
  raw text;
begin
  begin
    raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  exception when others then
    return null;
  end;
  if raw is null or raw = '' then
    return null;
  end if;
  -- x-forwarded-for may be a list; the client is the first entry.
  raw := split_part(raw, ',', 1);
  begin
    return trim(raw)::inet;
  exception when others then
    return null;
  end;
end $$;

-- Single place that writes the trail, so every trigger records the same shape
-- and the "never break the caller" guarantee lives in one function.
create or replace function public.write_audit_log(
  p_org_id      uuid,
  p_action      text,
  p_area        text,
  p_severity    text default 'info',
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id,
    metadata, ip_address, severity, area
  )
  values (
    p_org_id, auth.uid(), p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb), public.request_ip(),
    coalesce(p_severity, 'info'), p_area
  );
exception when others then
  -- See the header: an audit failure must not roll back the operation being
  -- audited. Surfaced as a WARNING so it is visible in the Postgres log.
  raise warning 'audit_logs write failed for action=% org=%: %',
    p_action, p_org_id, sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Events.
-- ---------------------------------------------------------------------------

-- Role changes. The highest-value event in the table: it is how someone gains
-- the ability to see or change everyone else's data.
create or replace function public.audit_membership_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log(
      new.org_id, 'membership.created', 'access', 'notice',
      'membership', new.id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform public.write_audit_log(
      new.org_id, 'membership.role_changed', 'access', 'warning',
      'membership', new.id,
      jsonb_build_object('user_id', new.user_id,
                         'from', old.role, 'to', new.role));
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log(
      old.org_id, 'membership.removed', 'access', 'warning',
      'membership', old.id,
      jsonb_build_object('user_id', old.user_id, 'role', old.role));
  end if;
  return null; -- AFTER trigger
end $$;

drop trigger if exists audit_memberships on public.memberships;
create trigger audit_memberships
  after insert or update or delete on public.memberships
  for each row execute function public.audit_membership_role_change();

-- Rota publish / unpublish. What staff actually see, and the thing most likely
-- to be disputed after the fact ("that shift was never published").
create or replace function public.audit_rota_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.write_audit_log(
      new.org_id,
      case when new.status = 'published' then 'rota.published' else 'rota.unpublished' end,
      'scheduling',
      'notice',
      'rota', new.id,
      jsonb_build_object('from', old.status, 'to', new.status,
                         'period_start', new.period_start));
  end if;
  return null;
end $$;

drop trigger if exists audit_rotas on public.rotas;
create trigger audit_rotas
  after update on public.rotas
  for each row execute function public.audit_rota_status_change();

-- Invites. An invite is a grant of access to an organisation's data.
create or replace function public.audit_invite_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- NOTE: `invites` has no `status` column. State is derived from the
  -- `accepted_at` / `revoked_at` timestamps (0006_invites.sql). Writing this
  -- against a `status` column — which is what the memberships and rotas
  -- triggers above use — would have failed on every invite write.
  if tg_op = 'INSERT' then
    perform public.write_audit_log(
      new.org_id, 'invite.issued', 'access', 'notice', 'invite', new.id,
      jsonb_build_object('email', new.email, 'role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.accepted_at is not null and old.accepted_at is null then
      perform public.write_audit_log(
        new.org_id, 'invite.accepted', 'access', 'notice', 'invite', new.id,
        jsonb_build_object('email', new.email, 'role', new.role,
                           'accepted_by', new.accepted_by));
    elsif new.revoked_at is not null and old.revoked_at is null then
      perform public.write_audit_log(
        new.org_id, 'invite.revoked', 'access', 'warning', 'invite', new.id,
        jsonb_build_object('email', new.email, 'role', new.role));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists audit_invites on public.invites;
create trigger audit_invites
  after insert or update on public.invites
  for each row execute function public.audit_invite_change();

-- ---------------------------------------------------------------------------
-- 4. Reading the trail — DELIBERATELY UNCHANGED.
-- ---------------------------------------------------------------------------
-- 0002 made `audit_logs_select` owner-only, grouped with `subscriptions` under
-- "owners/admin read only". This migration does not touch it.
--
-- The first draft of this file widened it to owner+manager, to match the
-- Settings tab gating added in #62. That was backwards. RLS is the boundary and
-- the UI follows it, never the reverse — so `settingsTabs.ts` was changed to
-- make Audit owner-only instead. Widening access to a trail of who changed
-- whose role is a security decision, and 0002 already made it deliberately.
--
-- There is still no client INSERT/UPDATE/DELETE policy, on purpose: the trail
-- is written exclusively by the SECURITY DEFINER functions above, so no browser
-- session can forge or erase an entry.

-- ---------------------------------------------------------------------------
-- NOT COVERED, deliberately — so nobody reads a gap as "it happened and we
-- missed it":
--
--   * Sign-in / sign-out. These live in Supabase's `auth` schema, which this
--     project does not own and should not trigger on. Capturing them needs an
--     Auth Hook, which is a separate piece of work.
--   * GDPR export. Currently a pure client-side read assembled in the browser
--     (gdprService), so there is no server-side moment to trigger on. It needs
--     to move behind an RPC before it can be audited honestly. `anonymize` IS
--     already audited, by 0011.
--   * Shift edits. Deliberately omitted for now: a rota builder drag can write
--     hundreds of shift rows in one publish cycle, and a row-level trigger
--     would bury every other event under thousands of entries. Wants a
--     statement-level summary, designed with the Audit screen.
-- ---------------------------------------------------------------------------
