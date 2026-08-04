-- =====================================================================
-- 0020 — Data subject request register
--
-- 0011 gave an organisation owner the ability to export and anonymise one
-- staff member's data. That is the *action*. This is the *obligation*: a UK
-- GDPR data subject request arrives, a clock starts, and someone has to be
-- able to say what was done about it and when.
--
-- Those are different problems and they belong in different places. 0011's
-- function is per-tenant and lives on the staff screen where an owner uses it.
-- A request register is platform-level, because the request often arrives by
-- email to us rather than through the app, and because "show me every request
-- and how long it has been open" is the question an ICO enquiry opens with.
--
-- ## The deadline is the point
--
-- Article 12(3): one month from receipt, extendable by two further months for
-- complex or numerous requests, provided the subject is told within the first
-- month. Miss it and the breach is the lateness itself, regardless of how good
-- the eventual answer was.
--
-- So `due_on` is computed by the database on insert rather than supplied by a
-- client, and the extension is its own function that records a reason — an
-- extension nobody justified is indistinguishable from a missed deadline.
-- =====================================================================

create table if not exists public.gdpr_requests (
  id            uuid primary key default gen_random_uuid(),

  -- Nullable: a request can arrive before we know which tenant the person
  -- belongs to, and refusing to log it until that is resolved is how requests
  -- go unrecorded. It is filled in once identified.
  org_id        uuid references public.organisations(id) on delete set null,

  subject_email text not null check (position('@' in subject_email) > 1),
  subject_name  text,

  -- The Article 15–22 rights, named as the regulation names them. Not a free
  -- text field: "what kind of request was this" is the first thing an audit
  -- asks and a typo'd category is a request you cannot count.
  kind          text not null check (kind in (
                  'access', 'portability', 'rectification', 'erasure',
                  'restriction', 'objection')),

  status        text not null default 'received' check (status in (
                  'received', 'in_progress', 'awaiting_information',
                  'completed', 'refused')),

  received_on   date not null default current_date,

  -- Article 12(3), computed here so it cannot be supplied wrong by a caller.
  -- `+ interval '1 month'` is calendar arithmetic: 31 January + 1 month is
  -- 28 February, which is what "one month" means in law. Adding 30 days would
  -- give 2 March and quietly grant two extra days.
  due_on        date not null,

  -- The two-month extension, and why. Null until used.
  extended_to   date,
  extension_reason text,

  assigned_to   uuid references public.profiles(id) on delete set null,

  closed_at     timestamptz,
  outcome_note  text,

  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now()),

  constraint gdpr_due_after_receipt   check (due_on >= received_on),
  constraint gdpr_extension_is_later  check (extended_to is null or extended_to > due_on),
  -- A closed request must say what happened. An outcome-less 'completed' is
  -- the row that cannot be defended a year later.
  constraint gdpr_closed_has_outcome
    check (status not in ('completed','refused')
           or (closed_at is not null and outcome_note is not null))
);

comment on table public.gdpr_requests is
  'UK GDPR data subject requests and their statutory deadlines. Article 12(3): one month from receipt, extendable by two.';

create index if not exists gdpr_requests_open_idx
  on public.gdpr_requests (due_on)
  where status not in ('completed', 'refused');

create index if not exists gdpr_requests_org_idx
  on public.gdpr_requests (org_id, received_on desc);

drop trigger if exists gdpr_requests_set_updated_at on public.gdpr_requests;
create trigger gdpr_requests_set_updated_at
  before update on public.gdpr_requests
  for each row execute function public.set_updated_at();

-- ---------- Log a request ----------------------------------------------
create or replace function public.log_gdpr_request(
  p_subject_email text,
  p_subject_name  text,
  p_kind          text,
  p_org           uuid default null,
  p_received_on   date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid;
  v_received date := coalesce(p_received_on, current_date);
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform staff can log a data subject request'
      using errcode = '42501';
  end if;

  -- A request cannot have been received in the future; that is a typo, and the
  -- deadline it would produce is wrong in the direction that loses the case.
  if v_received > current_date then
    raise exception 'A request cannot be received in the future'
      using errcode = '22023';
  end if;

  insert into public.gdpr_requests
    (org_id, subject_email, subject_name, kind, received_on, due_on, assigned_to)
  values
    (p_org, lower(btrim(p_subject_email)), nullif(btrim(coalesce(p_subject_name,'')), ''),
     p_kind, v_received, (v_received + interval '1 month')::date, auth.uid())
  returning id into v_id;

  perform public.audit_write(
    p_org, 'gdpr.request_logged', 'gdpr_request', v_id,
    jsonb_build_object('kind', p_kind, 'received_on', v_received),
    'notice', 'both');

  return v_id;
end;
$$;

revoke all on function public.log_gdpr_request(text, text, text, uuid, date)
  from public, anon;
grant execute on function public.log_gdpr_request(text, text, text, uuid, date)
  to authenticated;

-- ---------- Move it along ----------------------------------------------
create or replace function public.set_gdpr_request_status(
  p_request uuid,
  p_status  text,
  p_note    text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r public.gdpr_requests;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform staff can update a data subject request'
      using errcode = '42501';
  end if;

  select * into r from public.gdpr_requests where id = p_request;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  -- Closing requires an outcome. Enforced here as well as in the CHECK so the
  -- caller gets a sentence rather than a constraint violation.
  if p_status in ('completed','refused')
     and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Closing a request needs an outcome note saying what was done'
      using errcode = '23514';
  end if;

  update public.gdpr_requests
     set status       = p_status,
         outcome_note = case when p_status in ('completed','refused')
                             then btrim(p_note) else outcome_note end,
         closed_at    = case when p_status in ('completed','refused')
                             then timezone('utc', now()) else null end
   where id = p_request;

  perform public.audit_write(
    r.org_id, 'gdpr.request_' || p_status, 'gdpr_request', p_request,
    jsonb_build_object('from', r.status, 'to', p_status),
    case when p_status = 'refused' then 'warning' else 'notice' end,
    'both');
end;
$$;

revoke all on function public.set_gdpr_request_status(uuid, text, text) from public, anon;
grant execute on function public.set_gdpr_request_status(uuid, text, text) to authenticated;

-- ---------- The Article 12(3) extension --------------------------------
create or replace function public.extend_gdpr_request(
  p_request uuid,
  p_reason  text
) returns date language plpgsql security definer set search_path = public as $$
declare
  r public.gdpr_requests;
  v_new date;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can extend a deadline'
      using errcode = '42501';
  end if;

  select * into r from public.gdpr_requests where id = p_request;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  if r.extended_to is not null then
    raise exception 'This request has already been extended'
      using errcode = '23505';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 15 then
    raise exception 'An extension needs a reason of at least 15 characters — complexity or number of requests'
      using errcode = '23514';
  end if;

  -- Two further months, from the original deadline. The subject must also be
  -- told within the first month; that is a communication this database cannot
  -- perform, which is why the console says so next to the button.
  v_new := (r.due_on + interval '2 months')::date;

  update public.gdpr_requests
     set extended_to = v_new, extension_reason = btrim(p_reason)
   where id = p_request;

  perform public.audit_write(
    r.org_id, 'gdpr.request_extended', 'gdpr_request', p_request,
    jsonb_build_object('from', r.due_on, 'to', v_new, 'reason', btrim(p_reason)),
    'warning', 'both');

  return v_new;
end;
$$;

revoke all on function public.extend_gdpr_request(uuid, text) from public, anon;
grant execute on function public.extend_gdpr_request(uuid, text) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.gdpr_requests enable row level security;

-- Platform staff see everything. An organisation's own owner sees requests
-- recorded against their organisation — they are the data controller for their
-- own staff, so a register they cannot read is a register that does not help
-- them meet their own obligation.
drop policy if exists gdpr_requests_select on public.gdpr_requests;
create policy gdpr_requests_select
  on public.gdpr_requests for select
  using (
    public.has_platform_role(
      array['platform_owner','platform_admin','platform_support','platform_finance'])
    or (org_id is not null and public.has_org_role(org_id, array['owner']))
  );

-- No insert, update or delete policy: every mutation goes through the
-- SECURITY DEFINER functions above, which is what makes the computed deadline,
-- the outcome-on-close rule and the extension reason impossible to bypass.
revoke insert, update, delete on public.gdpr_requests from anon, authenticated;
