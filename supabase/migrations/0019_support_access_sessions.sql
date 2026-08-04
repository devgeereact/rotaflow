-- =====================================================================
-- 0019 — Temporary support access
--
-- 0017 added `organisations.support_access_allowed` and said of it:
--
--   "Read by the console today and enforced by nothing, which is the same
--    honest position as `status`: it records the customer's preference so a
--    support administrator can respect it, and 0019's session table is where
--    it becomes a precondition."
--
-- This is that migration. The flag stops being advisory: `request_support_access`
-- refuses outright when a customer has turned it off, in the database, where a
-- console screen cannot route around it.
--
-- ## Why a session table rather than a boolean on the admin
--
-- "Which platform staff can see this tenant" is not a state, it is a series of
-- events with reasons attached. A boolean answers "can Erin see Sunnyvale right
-- now"; it cannot answer "who looked at Sunnyvale in March, why, under which
-- ticket, and for how long" — which is the question a customer's DPO actually
-- asks, and the one an ICO enquiry asks after that. Rows answer both.
--
-- ## What this migration does NOT do
--
-- It does not grant anything. A row here records that access was requested,
-- justified and time-boxed; it does not itself widen any RLS policy, because
-- platform administrators already hold cross-tenant read through
-- `has_platform_role()`. Making that read *conditional* on an open session is a
-- much larger change — it touches every policy in 0015 and needs the RLS test
-- suite that does not exist yet — and doing half of it here would produce the
-- worst outcome: a table that looks like an access control and is not one.
--
-- So this is an accountability record, and it says so on the screen. The
-- follow-up is gating `has_platform_role` on an open session for the
-- `platform_support` role, which is where it actually buys something.
-- =====================================================================

create table if not exists public.support_access_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  admin_user_id uuid not null references public.profiles(id) on delete restrict,

  -- Free text, and required. A dropdown of canned reasons would be filled in
  -- by reflex; a sentence someone had to type is the thing that makes an
  -- auditor's job possible.
  reason        text not null check (length(btrim(reason)) >= 15),

  -- The support ticket this hangs off. Not a foreign key: cases live in a
  -- helpdesk this database does not own, and a soft reference that survives
  -- that system being replaced is worth more than referential integrity here.
  case_ref      text not null check (length(btrim(case_ref)) >= 3),

  scope         text not null default 'read'
                  check (scope in ('read', 'read_write')),

  granted_at    timestamptz not null default timezone('utc', now()),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles(id) on delete set null,
  revoke_reason text,

  constraint support_access_expires_after_grant check (expires_at > granted_at),
  -- A session cannot be revoked before it started. Cheap, and it catches a
  -- clock-skew bug that would otherwise only show up in an audit export.
  constraint support_access_revoked_after_grant
    check (revoked_at is null or revoked_at >= granted_at)
);

comment on table public.support_access_sessions is
  'Time-boxed, justified records of platform staff accessing a tenant. An accountability trail, not an access grant — see the header of migration 0019.';

create index if not exists support_access_org_idx
  on public.support_access_sessions (org_id, granted_at desc);

-- Partial index on the open sessions: the banner query runs on every tenant
-- page load, and it only ever asks about rows that have not been revoked.
create index if not exists support_access_open_idx
  on public.support_access_sessions (org_id, expires_at)
  where revoked_at is null;

-- ---------- Status, derived rather than stored -------------------------
-- Deliberately a function, not a column. A stored 'active'/'expired' would be
-- wrong the moment the clock passed `expires_at` and would need a cron job to
-- stay true — a status that requires a scheduled task to remain correct is a
-- status that will be incorrect.
create or replace function public.support_access_status(
  s public.support_access_sessions
) returns text language sql immutable as $$
  select case
    when s.revoked_at is not null then 'revoked'
    when s.expires_at <= timezone('utc', now()) then 'expired'
    else 'active'
  end;
$$;

-- ---------- Request ----------------------------------------------------
create or replace function public.request_support_access(
  p_org      uuid,
  p_reason   text,
  p_case_ref text,
  p_scope    text,
  p_minutes  integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_allowed boolean;
  v_status  text;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform staff can request support access'
      using errcode = '42501';
  end if;

  select o.support_access_allowed, o.status
    into v_allowed, v_status
    from public.organisations o
   where o.id = p_org;

  if not found then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  -- 0017's promise, kept. The customer's opt-out is enforced here rather than
  -- in the console, so it holds however the function is called.
  if not v_allowed then
    raise exception
      'This organisation has turned off platform support access. Ask an owner to re-enable it before requesting a session.'
      using errcode = '42501';
  end if;

  -- Bounds, not suggestions. Fifteen minutes to twenty-four hours matches the
  -- durations the console offers; a request outside that range is a bug or an
  -- attempt to mint a standing grant, and neither should succeed quietly.
  if p_minutes is null or p_minutes < 15 or p_minutes > 1440 then
    raise exception 'Support access must last between 15 minutes and 24 hours'
      using errcode = '22023';
  end if;

  if p_scope not in ('read', 'read_write') then
    raise exception 'Scope must be read or read_write' using errcode = '22023';
  end if;

  -- One open session per administrator per tenant. Without this, clicking the
  -- button twice produces two overlapping grants and the revoke button only
  -- closes one of them.
  if exists (
    select 1 from public.support_access_sessions s
     where s.org_id = p_org
       and s.admin_user_id = auth.uid()
       and s.revoked_at is null
       and s.expires_at > timezone('utc', now())
  ) then
    raise exception 'You already have an open support session for this organisation'
      using errcode = '23505';
  end if;

  insert into public.support_access_sessions
    (org_id, admin_user_id, reason, case_ref, scope, expires_at)
  values
    (p_org, auth.uid(), btrim(p_reason), btrim(p_case_ref), p_scope,
     timezone('utc', now()) + make_interval(mins => p_minutes))
  returning id into v_id;

  -- Visibility 'both': the tenant's own owner must be able to see that this
  -- happened. An access record only the accessor can read is not a record.
  perform public.audit_write(
    p_org,
    'support_access.granted',
    'support_access_session',
    v_id,
    jsonb_build_object(
      'case_ref', btrim(p_case_ref),
      'scope', p_scope,
      'minutes', p_minutes,
      'reason', btrim(p_reason)),
    'warning',
    'both');

  return v_id;
end;
$$;

revoke all on function public.request_support_access(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.request_support_access(uuid, text, text, text, integer)
  to authenticated;

-- ---------- Revoke -----------------------------------------------------
-- Either side may end a session: the platform administrator who opened it, a
-- platform owner or admin, or — importantly — an owner of the tenant being
-- looked at. A customer who cannot end the session is not really in control of
-- their own data.
create or replace function public.revoke_support_access(
  p_session uuid,
  p_reason  text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  s public.support_access_sessions;
begin
  select * into s from public.support_access_sessions where id = p_session;
  if not found then
    raise exception 'Support session not found' using errcode = 'P0002';
  end if;

  if not (
    s.admin_user_id = auth.uid()
    or public.has_platform_role(array['platform_owner','platform_admin'])
    or public.has_org_role(s.org_id, array['owner'])
  ) then
    raise exception 'You cannot revoke this support session' using errcode = '42501';
  end if;

  -- Idempotent: revoking an already-closed session is a no-op rather than an
  -- error, so a double-click or a retry after a timeout cannot rewrite the
  -- original revocation time.
  if s.revoked_at is not null then
    return;
  end if;

  update public.support_access_sessions
     set revoked_at = timezone('utc', now()),
         revoked_by = auth.uid(),
         revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_session;

  perform public.audit_write(
    s.org_id,
    'support_access.revoked',
    'support_access_session',
    p_session,
    jsonb_build_object('case_ref', s.case_ref, 'reason', p_reason),
    'warning',
    'both');
end;
$$;

revoke all on function public.revoke_support_access(uuid, text) from public, anon;
grant execute on function public.revoke_support_access(uuid, text) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.support_access_sessions enable row level security;

-- Read: platform staff see every session; an org's own members see sessions
-- against their org. The second half is the point — a customer must be able to
-- audit who looked at their data without asking us for an export.
drop policy if exists support_access_select on public.support_access_sessions;
create policy support_access_select
  on public.support_access_sessions for select
  using (
    public.has_platform_role(
      array['platform_owner','platform_admin','platform_support','platform_finance'])
    or org_id in (select public.my_active_org_ids())
  );

-- No insert, update or delete policy anywhere. Both mutations go through the
-- SECURITY DEFINER functions above, which is what makes the reason, the case
-- reference, the duration bounds and the customer's opt-out impossible to
-- bypass by writing to the table directly.
revoke insert, update, delete on public.support_access_sessions
  from anon, authenticated;
