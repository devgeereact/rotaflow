-- =====================================================================
-- 0024 — Support cases
--
-- The Support Centre has shown a case queue, a first-response median, a
-- resolution median and a CSAT score, all invented. This is the queue.
--
-- ## Why first response is a column and not a derived time
--
-- "Median first response" is the number a support team is actually judged on,
-- and deriving it from the first message of the right kind means every reader
-- has to agree on what counts — an auto-acknowledgement? an internal note?
-- `first_response_at` is stamped once, by the function that posts the first
-- public reply from a platform agent, and it never moves. One definition, in
-- one place, that a query cannot get subtly wrong.
--
-- ## Internal notes
--
-- `support_case_messages.is_internal` marks a note the customer must never
-- see. The read policy is written so that an organisation member simply cannot
-- select those rows — hiding them in the client would put customer-visible
-- privacy on the honesty of a query somewhere.
-- =====================================================================

create table if not exists public.support_cases (
  id             uuid primary key default gen_random_uuid(),

  reference      text not null unique,

  -- Nullable: a case can arrive from someone whose tenant is not yet known —
  -- a prospect, or a staff member emailing from a personal address.
  org_id         uuid references public.organisations(id) on delete set null,

  -- Who raised it. Also nullable, for the same reason.
  requester_id   uuid references public.profiles(id) on delete set null,
  requester_name  text,
  requester_email text not null check (position('@' in requester_email) > 1),

  subject        text not null check (length(btrim(subject)) > 0),

  category       text not null default 'question'
                   check (category in ('question','bug','billing','feature','incident','access')),

  priority       text not null default 'normal'
                   check (priority in ('urgent','high','normal','low')),

  status         text not null default 'open'
                   check (status in ('open','pending','on_hold','resolved','closed')),

  assigned_to    uuid references public.profiles(id) on delete set null,

  first_response_at timestamptz,
  resolved_at       timestamptz,

  -- 1–5, set by the requester after resolution. Null means not asked or not
  -- answered; a default of 5 would quietly inflate every average.
  csat           integer check (csat between 1 and 5),
  csat_comment   text,

  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now()),

  constraint support_cases_resolved_has_time
    check (status not in ('resolved','closed') or resolved_at is not null),
  constraint support_cases_csat_after_resolution
    check (csat is null or resolved_at is not null)
);

comment on table public.support_cases is
  'The support queue. First response and resolution times are stamped once, by the functions that cause them.';

create sequence if not exists public.support_case_reference_seq start with 4120;

create index if not exists support_cases_open_idx
  on public.support_cases (priority, created_at)
  where status in ('open','pending','on_hold');

create index if not exists support_cases_org_idx
  on public.support_cases (org_id, created_at desc);

create table if not exists public.support_case_messages (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.support_cases(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  -- Who is speaking. A customer cannot post as staff: the function sets this
  -- from the caller's platform role rather than from an argument.
  author_side text not null check (author_side in ('customer','platform')),
  body        text not null check (length(btrim(body)) > 0),
  -- A note for colleagues. Never returned to a tenant reader — see the policy.
  is_internal boolean not null default false,
  created_at  timestamptz not null default timezone('utc', now())
);

comment on table public.support_case_messages is
  'Case correspondence. Internal notes are excluded by the read policy, not by the client.';

create index if not exists support_case_messages_case_idx
  on public.support_case_messages (case_id, created_at);

drop trigger if exists support_cases_set_updated_at on public.support_cases;
create trigger support_cases_set_updated_at
  before update on public.support_cases
  for each row execute function public.set_updated_at();

-- ---------- Open a case -------------------------------------------------
create or replace function public.open_support_case(
  p_subject  text,
  p_body     text,
  p_category text default 'question',
  p_priority text default 'normal',
  p_org      uuid default null,
  p_requester_email text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_ref   text;
  v_email text;
  v_name  text;
  v_org   uuid := p_org;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open a support case' using errcode = '42501';
  end if;

  select p.email, p.full_name into v_email, v_name
    from public.profiles p where p.id = auth.uid();

  -- Platform staff may raise a case on a tenant's behalf and name the address
  -- it came from. A customer may not: they are the requester.
  if public.is_platform_admin() then
    v_email := coalesce(nullif(btrim(coalesce(p_requester_email,'')),''), v_email);
  elsif v_org is not null and not public.is_org_member(v_org) then
    raise exception 'You are not a member of that organisation' using errcode = '42501';
  end if;

  v_ref := 'CASE-' || lpad(nextval('public.support_case_reference_seq')::text, 4, '0');

  insert into public.support_cases
    (reference, org_id, requester_id, requester_name, requester_email,
     subject, category, priority)
  values
    (v_ref, v_org, auth.uid(), v_name, v_email,
     btrim(p_subject), p_category, p_priority)
  returning id into v_id;

  insert into public.support_case_messages
    (case_id, author_id, author_name, author_side, body)
  values
    (v_id, auth.uid(), v_name,
     case when public.is_platform_admin() then 'platform' else 'customer' end,
     btrim(p_body));

  perform public.audit_write(
    v_org, 'support_case.opened', 'support_case', v_id,
    jsonb_build_object('reference', v_ref, 'after', p_priority),
    case when p_priority = 'urgent' then 'warning' else 'info' end,
    'both');

  return v_id;
end;
$$;

revoke all on function public.open_support_case(text, text, text, text, uuid, text)
  from public, anon;
grant execute on function public.open_support_case(text, text, text, text, uuid, text)
  to authenticated;

-- ---------- Reply -------------------------------------------------------
create or replace function public.reply_to_support_case(
  p_case     uuid,
  p_body     text,
  p_internal boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        public.support_cases;
  v_msg    uuid;
  v_name   text;
  v_side   text;
begin
  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  v_side := case when public.is_platform_admin() then 'platform' else 'customer' end;

  if v_side = 'customer' then
    if c.requester_id is distinct from auth.uid()
       and not (c.org_id is not null and public.has_org_role(c.org_id, array['owner'])) then
      raise exception 'You cannot reply to that case' using errcode = '42501';
    end if;
    if p_internal then
      raise exception 'Only platform staff can write an internal note'
        using errcode = '42501';
    end if;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.support_case_messages
    (case_id, author_id, author_name, author_side, body, is_internal)
  values (p_case, auth.uid(), v_name, v_side, btrim(p_body), p_internal)
  returning id into v_msg;

  -- The first public reply from platform staff is the first response, and it
  -- is stamped exactly once. An internal note is not a response to anyone.
  if v_side = 'platform' and not p_internal and c.first_response_at is null then
    update public.support_cases
       set first_response_at = timezone('utc', now()),
           status = case when status = 'open' then 'pending' else status end
     where id = p_case;
  end if;

  return v_msg;
end;
$$;

revoke all on function public.reply_to_support_case(uuid, text, boolean) from public, anon;
grant execute on function public.reply_to_support_case(uuid, text, boolean) to authenticated;

-- ---------- Move it along ----------------------------------------------
create or replace function public.set_support_case_status(
  p_case   uuid,
  p_status text,
  p_note   text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.support_cases;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform support staff can change a case status'
      using errcode = '42501';
  end if;

  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  update public.support_cases
     set status      = p_status,
         resolved_at = case when p_status in ('resolved','closed')
                            then coalesce(resolved_at, timezone('utc', now()))
                            else null end
   where id = p_case;

  if nullif(btrim(coalesce(p_note,'')),'') is not null then
    insert into public.support_case_messages
      (case_id, author_id, author_side, body, is_internal)
    values (p_case, auth.uid(), 'platform', btrim(p_note), true);
  end if;

  perform public.audit_write(
    c.org_id, 'support_case.' || p_status, 'support_case', p_case,
    jsonb_build_object('reference', c.reference, 'before', c.status, 'after', p_status),
    'info', 'platform_only');
end;
$$;

revoke all on function public.set_support_case_status(uuid, text, text) from public, anon;
grant execute on function public.set_support_case_status(uuid, text, text) to authenticated;

create or replace function public.assign_support_case(p_case uuid, p_agent uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.support_cases;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform support staff can assign a case'
      using errcode = '42501';
  end if;

  -- Assigning a case to a customer would put a tenant name in the agent
  -- column and give them nothing: they cannot see the queue.
  if p_agent is not null and not exists (
       select 1 from public.platform_admins a
        where a.user_id = p_agent and a.revoked_at is null) then
    raise exception 'A case can only be assigned to platform staff'
      using errcode = '23514';
  end if;

  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  update public.support_cases set assigned_to = p_agent where id = p_case;
end;
$$;

revoke all on function public.assign_support_case(uuid, uuid) from public, anon;
grant execute on function public.assign_support_case(uuid, uuid) to authenticated;

-- ---------- Satisfaction -------------------------------------------------
create or replace function public.rate_support_case(
  p_case    uuid,
  p_score   integer,
  p_comment text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.support_cases;
begin
  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  -- The requester rates it, not the team that answered it.
  if c.requester_id is distinct from auth.uid() then
    raise exception 'Only the person who raised a case can rate it'
      using errcode = '42501';
  end if;
  if c.resolved_at is null then
    raise exception 'Rate a case once it has been resolved' using errcode = '22023';
  end if;

  update public.support_cases
     set csat = p_score, csat_comment = nullif(btrim(coalesce(p_comment,'')),'')
   where id = p_case;
end;
$$;

revoke all on function public.rate_support_case(uuid, integer, text) from public, anon;
grant execute on function public.rate_support_case(uuid, integer, text) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.support_cases         enable row level security;
alter table public.support_case_messages enable row level security;

drop policy if exists support_cases_select on public.support_cases;
create policy support_cases_select
  on public.support_cases for select
  using (
    public.is_platform_admin()
    or requester_id = auth.uid()
    or (org_id is not null and public.has_org_role(org_id, array['owner']))
  );

-- Internal notes are excluded here, in the policy. A client-side filter would
-- mean one forgotten `.eq()` shows a customer what the team said about them.
drop policy if exists support_case_messages_select on public.support_case_messages;
create policy support_case_messages_select
  on public.support_case_messages for select
  using (
    public.is_platform_admin()
    or (
      not is_internal
      and exists (
        select 1 from public.support_cases c
         where c.id = case_id
           and (c.requester_id = auth.uid()
                or (c.org_id is not null and public.has_org_role(c.org_id, array['owner'])))
      )
    )
  );

revoke insert, update, delete on public.support_cases         from anon, authenticated;
revoke insert, update, delete on public.support_case_messages from anon, authenticated;
