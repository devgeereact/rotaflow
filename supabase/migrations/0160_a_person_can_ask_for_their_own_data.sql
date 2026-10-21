-- =====================================================================
-- 0160 — A person can ask for their own data (GAP-057)
--
-- `0020` built the register a UK GDPR request belongs in: a computed
-- one-month deadline, an extension that needs a reason, and no closing a
-- request without saying what was done. Only platform staff could write to
-- it, so the only way in was an email to support that somebody then typed
-- up. The Privacy Notice said so plainly. It was an honest interim, and
-- this is the end of it.
--
-- Two functions, both scoped to the caller and to nothing else:
--
--   * `request_my_data(kind, org)` files a request in the SAME register,
--     through the same deadline arithmetic, for the signed-in person. The
--     subject email comes from `auth.users`, never from the caller, so
--     there is no argument that names somebody else.
--   * `my_data_requests()` lists the caller's own requests: kind, status
--     and dates. Not the outcome note, which is written for the case file
--     and is sent to the person by email when the case closes.
--
-- ## Why not open `log_gdpr_request` to everyone
--
-- That function takes a subject email and an organisation as arguments,
-- which is right for staff typing up an emailed request and wrong for a
-- browser: it would let one person file a request in another person's
-- name. A separate function with no such argument is smaller than a
-- branch inside the old one.
--
-- ## Repeats
--
-- A second request of the same kind while the first is still open returns
-- the open one rather than starting a second clock. Pressing the button
-- twice is not two requests, and a register full of duplicates is a
-- register nobody can count. Five open requests in total is the ceiling;
-- past that the person is told to wait for one to close.
-- =====================================================================

-- SAFETY(grant_execute): both functions take the subject from auth.uid() and
-- read or write only that person's rows; the organisation argument is checked
-- with is_org_member. Asserted in supabase/tests/database/own_data_requests.test.sql.

create or replace function public.request_my_data(
  p_kind text,
  p_org  uuid default null
) returns table (id uuid, due_on date, already_open boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_id    uuid;
  v_due   date;
  v_open  int;
begin
  if v_uid is null then
    raise exception 'Sign in to ask for your data' using errcode = '42501';
  end if;

  -- The four a person can sensibly start from a button. Restriction and
  -- objection need a conversation about what to restrict or object to, and
  -- stay with the support route.
  if p_kind not in ('access', 'portability', 'rectification', 'erasure') then
    raise exception 'That kind of request cannot be made here' using errcode = '22023';
  end if;

  -- Naming an organisation is optional, and when given it must be one the
  -- caller belongs to: a request is not a way to attach your name to a
  -- tenant you have never been part of.
  if p_org is not null and not public.is_org_member(p_org) then
    raise exception 'You are not a member of that organisation' using errcode = '42501';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or position('@' in v_email) <= 1 then
    raise exception 'Your account has no email address to answer to' using errcode = '22023';
  end if;

  select r.id, r.due_on into v_id, v_due
    from public.gdpr_requests r
   where r.subject_email = v_email
     and r.kind = p_kind
     and r.status not in ('completed', 'refused')
   order by r.received_on
   limit 1;

  if found then
    return query select v_id, v_due, true;
    return;
  end if;

  select count(*) into v_open
    from public.gdpr_requests r
   where r.subject_email = v_email
     and r.status not in ('completed', 'refused');

  if v_open >= 5 then
    raise exception 'You already have five open requests. We will answer those first.'
      using errcode = '54000';
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '') into v_name
    from public.profiles p where p.id = v_uid;

  insert into public.gdpr_requests
    (org_id, subject_email, subject_name, kind, received_on, due_on)
  values
    (p_org, v_email, v_name, p_kind, current_date,
     (current_date + interval '1 month')::date)
  returning gdpr_requests.id, gdpr_requests.due_on into v_id, v_due;

  perform public.audit_write(
    p_org, 'gdpr.request_logged', 'gdpr_request', v_id,
    jsonb_build_object('kind', p_kind, 'received_on', current_date, 'self_service', true),
    'notice', 'both');

  return query select v_id, v_due, false;
end;
$$;

comment on function public.request_my_data(text, uuid) is
  'Files a UK GDPR request for the signed-in person in the 0020 register. The subject is auth.uid(); there is no argument that names anybody else (GAP-057).';

revoke all on function public.request_my_data(text, uuid) from public, anon;
grant execute on function public.request_my_data(text, uuid) to authenticated;

create or replace function public.my_data_requests()
returns table (
  id          uuid,
  kind        text,
  status      text,
  received_on date,
  due_on      date,
  extended_to date,
  closed_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.status, r.received_on, r.due_on, r.extended_to, r.closed_at
    from public.gdpr_requests r
   where auth.uid() is not null
     and r.subject_email = (
       select lower(btrim(u.email)) from auth.users u where u.id = auth.uid())
   order by r.received_on desc, r.created_at desc;
$$;

comment on function public.my_data_requests() is
  'The signed-in person''s own data requests: kind, status and dates, not the outcome note. Takes no argument, so there is no way to ask about somebody else (GAP-057).';

revoke all on function public.my_data_requests() from public, anon;
grant execute on function public.my_data_requests() to authenticated;
