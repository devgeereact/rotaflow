-- =====================================================================
-- 0016_audit_events.sql — make audit_logs an actual accountability record
-- Additive & idempotent. Closes audit01 §P1-5.
--
-- ## The state this fixes
--
-- `audit_logs` has existed since 0002 with RLS enabled and no client write
-- policy, and in the whole system it has exactly ONE writer: the
-- `anonymize_staff_member` RPC in 0011. No role change, rota publish, invite,
-- org edit or export is recorded. audit01 calls writing the missing events
-- "the highest-value schema work outstanding", and until it lands the audit
-- screens are honest about being empty rather than being an audit trail.
--
-- ## Why org_id becomes nullable, and why the read policy stays safe
--
-- Platform-level events (a platform role granted, a flag flipped) belong to
-- no organisation. Making `org_id` nullable is what lets them be recorded at
-- all, and the existing owner-only read policy stays correct for free:
-- `has_org_role(null, …)` evaluates `exists(… where m.org_id = null …)` →
-- false, `or is_platform_admin()`. So a null-org row is visible to platform
-- administrators and to nobody else, which is exactly the desired semantics.
-- The policy is still rewritten below, for an explicit `visibility` column
-- and for Profile → Activity, not because nullability forced it.
--
-- ## Why the actor's name is snapshotted rather than joined
--
-- `auditService` joins `profiles!audit_logs_actor_user_id_fkey`. Before 0015
-- that join resolved to null for every actor except the reader themselves,
-- and even after 0015 it only resolves for platform admins. Widening
-- `profiles` so co-members can read each other's email addresses to fix an
-- audit screen would be a far larger privacy change than the problem
-- deserves. Snapshotting the name at write time is also simply more correct:
-- an audit record should say who acted *then*, not who that account is now.
-- =====================================================================

-- ---------- Shape ------------------------------------------------------
alter table public.audit_logs alter column org_id drop not null;

alter table public.audit_logs
  add column if not exists org_name    text,
  add column if not exists actor_email text,
  add column if not exists actor_name  text,
  add column if not exists severity    text not null default 'info'
        check (severity in ('info','notice','warning','critical')),
  add column if not exists scope       text not null default 'org'
        check (scope in ('org','platform')),
  add column if not exists visibility  text not null default 'org'
        check (visibility in ('org','platform_only')),
  add column if not exists ip_address  inet,
  add column if not exists user_agent  text;

-- An audit trail that a tenant deletion erases is not an audit trail. The
-- org's name is snapshotted alongside for the same reason as the actor's, so
-- an orphaned row still renders as something a human can read.
alter table public.audit_logs drop constraint if exists audit_logs_org_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_org_id_fkey
  foreign key (org_id) references public.organisations(id) on delete set null;

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx   on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_action_idx  on public.audit_logs (action);
create index if not exists audit_logs_platform_idx
  on public.audit_logs (created_at desc) where org_id is null;

-- ---------- Immutability -----------------------------------------------
-- A trigger, not a policy. RLS does not apply to the table owner and
-- `service_role` carries BYPASSRLS, so "no UPDATE policy" does not actually
-- stop an Edge Function bug from rewriting history. A trigger is bypassed by
-- neither, which makes it the only control that holds against the roles this
-- system actually uses.
--
-- Consequence, stated deliberately: the only way to remove an audit row
-- becomes a superuser session disabling this trigger. That is the point. It
-- also means audit rows cannot be scrubbed by a GDPR erasure — so nothing
-- beyond the actor's name and email goes in them, and the trail is retained
-- as a legitimate-interest record under a stated retention period.
--
-- The one permitted UPDATE is the FK detach above. `on delete set null` is a
-- referential action, and referential actions fire triggers — so a blanket
-- block here would make `delete from organisations` fail outright with
-- "audit_logs is append-only", i.e. a tenant could never be deleted. The
-- exception is written as narrowly as it can be: org_id non-null → null and
-- every other column bit-identical. It is a visibility *reduction* (the read
-- policy requires `org_id is not null` for any non-platform reader), it
-- cannot alter what an event says, and reaching it at all requires
-- table-owner or service_role privileges.
create or replace function public.audit_logs_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.org_id is not null and new.org_id is null
     and new.id            is not distinct from old.id
     and new.org_name      is not distinct from old.org_name
     and new.actor_user_id is not distinct from old.actor_user_id
     and new.actor_email   is not distinct from old.actor_email
     and new.actor_name    is not distinct from old.actor_name
     and new.action        is not distinct from old.action
     and new.entity_type   is not distinct from old.entity_type
     and new.entity_id     is not distinct from old.entity_id
     and new.metadata      is not distinct from old.metadata
     and new.severity      is not distinct from old.severity
     and new.scope         is not distinct from old.scope
     and new.visibility    is not distinct from old.visibility
     and new.created_at    is not distinct from old.created_at then
    return new;
  end if;

  raise exception 'audit_logs is append-only (attempted %)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- NOT `force row level security`, deliberately. FORCE applies RLS to the
-- table owner as well — and `audit_logs` has no INSERT policy at all, by
-- design. Every writer here (audit_write, and 0011's anonymize_staff_member)
-- is SECURITY DEFINER and depends on the owner's RLS bypass to insert, so
-- FORCE would silently break the entire audit trail rather than harden it.
-- Immutability is enforced by the trigger above, which nothing bypasses —
-- not BYPASSRLS, not table ownership.

-- ---------- Read -------------------------------------------------------
-- Isolation argument, written so it can be checked: a row is readable by a
-- non-platform user ONLY when `org_id` is non-null AND they hold owner in
-- that exact org, or they are the actor. No clause matches on anything a
-- caller supplies. Platform-internal rows carry `org_id is null` and
-- `visibility = 'platform_only'`, and neither branch can reach them.
--
-- Support-access events are written the other way on purpose — the tenant's
-- own `org_id` with `visibility = 'org'` — because the customer seeing
-- "RotaFlow support opened your data at 14:02" in Settings → Audit is the
-- accountability control, and it costs nothing.
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using (
    public.is_platform_admin()
    or (
      visibility = 'org'
      and org_id is not null
      and (
        public.has_org_role(org_id, array['owner'])
        -- Profile → Activity. A deliberate widening beyond owner-only: these
        -- are the reader's own actions. It carries an obligation, kept by the
        -- trigger bodies below rather than trusted to callers — `metadata` on
        -- an event an ordinary member can read must not embed identifiers
        -- they did not already see.
        or actor_user_id = auth.uid()
      )
    )
  );
-- Still no client INSERT/UPDATE/DELETE policy. Writes go through the
-- SECURITY DEFINER paths below.

-- ---------- The internal writer ----------------------------------------
-- Not callable by the client, and that is precisely what makes events
-- written by the triggers below trustworthy in a way `log_audit_event` can
-- never be.
create or replace function public.audit_write(
  p_org         uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb,
  p_severity    text,
  p_visibility  text default 'org'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email    text;
  v_name     text;
  v_org_name text;
begin
  select p.email, p.full_name into v_email, v_name
    from public.profiles p where p.id = auth.uid();
  select o.name into v_org_name
    from public.organisations o where o.id = p_org;

  insert into public.audit_logs (
    org_id, org_name, actor_user_id, actor_email, actor_name,
    action, entity_type, entity_id, metadata, severity, scope, visibility)
  values (
    p_org, v_org_name, auth.uid(), v_email, v_name,
    p_action, p_entity_type, p_entity_id,
    -- A trigger fired by an Edge Function running as service_role has no
    -- auth.uid(). An event with no actor must say why rather than looking
    -- like an anonymous user action.
    coalesce(p_metadata, '{}'::jsonb)
      || case when auth.uid() is null
              then jsonb_build_object('via', 'service_role')
              else '{}'::jsonb end,
    p_severity,
    case when p_org is null then 'platform' else 'org' end,
    p_visibility);
end;
$$;

revoke all on function public.audit_write(uuid, text, text, uuid, jsonb, text, text)
  from public, anon, authenticated;

-- =====================================================================
-- Triggers — events the database can observe for itself
--
-- Deliberately NOT on `shifts`: publishing a rota writes hundreds of rows,
-- and auditing each one would turn this table into a second shifts table.
-- Rota activity is audited at the `rotas` level, where the decision happens.
-- =====================================================================

-- ---------- memberships: role and status changes -----------------------
create or replace function public.audit_membership_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- An updated_at bump is not an event.
  if tg_op = 'UPDATE'
     and new.role   is not distinct from old.role
     and new.status is not distinct from old.status then
    return null;
  end if;

  perform public.audit_write(
    coalesce(new.org_id, old.org_id),
    case tg_op when 'INSERT' then 'membership.added'
               when 'DELETE' then 'membership.removed'
               else 'membership.changed' end,
    'membership',
    coalesce(new.id, old.id),
    jsonb_strip_nulls(jsonb_build_object(
      'user_id',     coalesce(new.user_id, old.user_id),
      'from_role',   old.role,   'to_role',   new.role,
      'from_status', old.status, 'to_status', new.status)),
    case when new.role = 'owner' and old.role is distinct from 'owner'
         then 'warning' else 'notice' end);
  return null;
end;
$$;

drop trigger if exists memberships_audit on public.memberships;
create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function public.audit_membership_change();

-- ---------- rotas: publish / unpublish ---------------------------------
create or replace function public.audit_rota_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  perform public.audit_write(
    new.org_id,
    case when new.status = 'published' then 'rota.published' else 'rota.unpublished' end,
    'rota', new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'name',         new.name,
      'period_start', new.period_start,
      'period_end',   new.period_end,
      'location_id',  new.location_id)),
    'notice');
  return null;
end;
$$;

drop trigger if exists rotas_audit on public.rotas;
create trigger rotas_audit
  after update on public.rotas
  for each row execute function public.audit_rota_status();

-- ---------- invites: issued / revoked / accepted -----------------------
-- `invites` has no status column — the lifecycle is expressed by
-- accepted_at and revoked_at, so transitions are derived from those.
create or replace function public.audit_invite_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'invite.issued';
  elsif old.revoked_at is null and new.revoked_at is not null then
    v_action := 'invite.revoked';
  elsif old.accepted_at is null and new.accepted_at is not null then
    v_action := 'invite.accepted';
  else
    return null;
  end if;

  perform public.audit_write(
    new.org_id, v_action, 'invite', new.id,
    -- The invited address is the subject of the event, and every reader of
    -- an invite event is an org owner or the actor who issued it. The raw
    -- token is never touched here; only its hash exists in the row at all.
    jsonb_build_object('email', new.email, 'role', new.role),
    'notice');
  return null;
end;
$$;

drop trigger if exists invites_audit on public.invites;
create trigger invites_audit
  after insert or update on public.invites
  for each row execute function public.audit_invite_change();

-- ---------- organisations: plan and settings ---------------------------
create or replace function public.audit_organisation_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plan is distinct from old.plan then
    perform public.audit_write(
      new.id, 'org.plan_changed', 'organisation', new.id,
      jsonb_build_object('from_plan', old.plan, 'to_plan', new.plan),
      'warning');
  end if;

  -- The settings blob is untyped and six screens write it (audit01 P1-4).
  -- Recording that it changed is useful; dumping its contents into an audit
  -- row would copy an unbounded, unreviewed payload into an append-only
  -- table nobody can later redact.
  if new.settings is distinct from old.settings then
    perform public.audit_write(
      new.id, 'org.settings_changed', 'organisation', new.id,
      '{}'::jsonb, 'notice');
  end if;

  if new.name is distinct from old.name or new.slug is distinct from old.slug then
    perform public.audit_write(
      new.id, 'org.renamed', 'organisation', new.id,
      jsonb_build_object('from_name', old.name, 'to_name', new.name,
                         'from_slug', old.slug, 'to_slug', new.slug),
      'notice');
  end if;
  return null;
end;
$$;

drop trigger if exists organisations_audit on public.organisations;
create trigger organisations_audit
  after update on public.organisations
  for each row execute function public.audit_organisation_change();

-- ---------- platform_admins: granted / revoked (platform-scoped) -------
create or replace function public.audit_platform_admin_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'platform_role.granted';
  elsif tg_op = 'DELETE' then
    v_action := 'platform_role.deleted';
  elsif old.revoked_at is null and new.revoked_at is not null then
    v_action := 'platform_role.revoked';
  elsif new.role is distinct from old.role
        or (old.revoked_at is not null and new.revoked_at is null) then
    v_action := 'platform_role.granted';
  else
    return null;
  end if;

  -- org_id null → scope 'platform', and visibility platform_only so a
  -- customer's owner never sees RotaFlow's internal staffing changes.
  perform public.audit_write(
    null, v_action, 'platform_admin', null,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id',   coalesce(new.user_id, old.user_id),
      'from_role', old.role,
      'to_role',   new.role)),
    'critical', 'platform_only');
  return null;
end;
$$;

drop trigger if exists platform_admins_audit on public.platform_admins;
create trigger platform_admins_audit
  after insert or update or delete on public.platform_admins
  for each row execute function public.audit_platform_admin_change();

-- =====================================================================
-- The client-callable writer — only for events with no row to watch
-- =====================================================================
-- An export is a read. A login happens in the `auth` schema. A file download
-- leaves no trace in `public` at all. No trigger can see any of them, so
-- these need a client call — but a client-callable audit writer records
-- INTENT, not proof, because the caller chooses the action string. Two
-- constraints keep that from becoming a forgery tool: a whitelist, so nobody
-- can seed a plausible false trail of events the product does not emit; and
-- an org-membership check, so nobody can write into another tenant's history.
create or replace function public.log_audit_event(
  p_org         uuid,
  p_action      text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_action not in (
      'gdpr.export','gdpr.export_denied',
      'report.exported','timesheet.exported','staff.exported') then
    raise exception 'Unknown audit action: %', p_action using errcode = '22023';
  end if;

  if p_org is null then
    raise exception 'An organisation is required for this event'
      using errcode = '22023';
  end if;

  if not public.is_org_member(p_org) then
    raise exception 'Cannot write audit events for another organisation'
      using errcode = '42501';
  end if;

  perform public.audit_write(
    p_org, p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb), 'info', 'org');
end;
$$;

revoke all on function public.log_audit_event(uuid, text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.log_audit_event(uuid, text, text, uuid, jsonb)
  to authenticated;

-- ---------- Backfill the one pre-existing writer -----------------------
-- 0011's anonymize_staff_member inserts directly. Left as-is: it is correct,
-- and re-pointing it at audit_write() would mean editing a shipped migration.
-- Its rows simply carry null actor_name/org_name, which the reader renders as
-- the actor id — accurate, if less friendly, and only for historic rows.
