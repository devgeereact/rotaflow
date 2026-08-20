-- =====================================================================
-- 0053_link_staff_profiles_to_accounts.sql — close the gap that leaves a
-- published rota invisible to the staff member it was published for
--
-- `accept_invite()` (0006/0037) has only ever created a `memberships` row.
-- `staff_profiles` (the HR record a manager builds through Add Staff) has
-- never had anything link it to that membership: `user_id` stays null
-- forever unless something sets it, and nothing did. Every screen that
-- answers "what does the signed-in staff member see" — the Schedule page,
-- clock-in, the AI assistant's grounding query — reads through
-- `my_staff_profile_id()`, which is `select ... where user_id = auth.uid()`.
-- With no link, that query is always empty: a manager can publish a rota,
-- assign a real shift to a real staff record, and the person it's assigned
-- to sees "not scheduled" regardless. Confirmed live via a full onboarding
-- + invite + assign + publish smoke test, 2026-08-20.
--
-- `staff_profiles` cannot be joined to `memberships`/`profiles` by user_id
-- (that's the whole problem) and has no email column to join by either. Two
-- changes close both directions of the ordering:
--
-- 1. A new nullable `email` column on `staff_profiles`, used only for this
--    linking — not for sending mail from. A manager can set it when the HR
--    record is created (before or after the person is invited) or by
--    editing an existing unlinked record retroactively.
-- 2. A trigger that auto-links whenever `email` is set/changed and no link
--    exists yet, matching against an already-active membership in the same
--    org — handles "Add Staff first, invite accepted after".
-- 3. `accept_invite()` also auto-links any staff_profiles row still waiting
--    on this exact email — handles "invite accepted first, Add Staff after".
--
-- Neither path ever overwrites an existing, already-correct `user_id`.
-- =====================================================================

alter table public.staff_profiles
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'staff_profiles_email_lowercase'
       and conrelid = 'public.staff_profiles'::regclass
  ) then
    alter table public.staff_profiles
      add constraint staff_profiles_email_lowercase check (email = lower(email));
  end if;
end $$;

comment on column public.staff_profiles.email is
  'Used only to auto-link this HR record to the person''s real login once they accept an invite. Not a contact/notification address.';

create index if not exists staff_profiles_email_idx
  on public.staff_profiles (org_id, lower(email))
  where email is not null;

-- ---------- 1. Auto-link on insert/update of email ----------------------
create or replace function public.staff_profiles_auto_link_account()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.user_id is null then
    select m.user_id into new.user_id
      from public.memberships m
      join public.profiles p on p.id = m.user_id
     where m.org_id = new.org_id
       and m.status = 'active'
       and lower(p.email) = lower(new.email)
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_auto_link_account_trigger on public.staff_profiles;
create trigger staff_profiles_auto_link_account_trigger
  before insert or update of email, org_id on public.staff_profiles
  for each row execute function public.staff_profiles_auto_link_account();

-- ---------- 2. Protect `email` the same way `user_id` etc are protected -
-- 0042 lets a staff member self-edit only phone/photo_url; extend that
-- restriction to the new column so a staff member cannot self-relink (or
-- unlink) their own record.
create or replace function public.staff_profiles_restrict_self_edit()
returns trigger language plpgsql as $$
begin
  if public.has_org_role(new.org_id, array['owner', 'manager']) then
    return new;
  end if;

  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.job_title is distinct from old.job_title
     or new.department_id is distinct from old.department_id
     or new.contract_type is distinct from old.contract_type
     or new.weekly_hours is distinct from old.weekly_hours
     or new.holiday_allowance is distinct from old.holiday_allowance
     or new.skills is distinct from old.skills
     or new.payroll_id is distinct from old.payroll_id
     or new.start_date is distinct from old.start_date
     or new.active is distinct from old.active
     or new.user_id is distinct from old.user_id
     or new.org_id is distinct from old.org_id
     or new.email is distinct from old.email
  then
    raise exception 'You can only update your phone number and photo on your own profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------- 3. accept_invite(): link the other direction too ------------
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite     public.invites;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept this invitation' using errcode = '28000';
  end if;

  select lower(email) into v_user_email from auth.users where id = auth.uid();
  if v_user_email is null then
    raise exception 'No account for the current user' using errcode = 'P0002';
  end if;

  select * into v_invite
    from public.invites
   where token_hash = encode(sha256(p_token::bytea), 'hex')
   for update;

  if v_invite.id is null then
    raise exception 'This invitation link is not valid' using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'This invitation has been revoked' using errcode = 'P0002';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invitation has already been used' using errcode = 'P0002';
  end if;
  if v_invite.expires_at <= timezone('utc', now()) then
    raise exception 'This invitation has expired' using errcode = 'P0002';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'This invitation was sent to a different email address'
      using errcode = '42501';
  end if;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_invite.org_id, auth.uid(), v_invite.role, 'active')
  on conflict (org_id, user_id)
    do update set role = excluded.role, status = 'active';

  -- The other half of staff_profiles_auto_link_account: a manager who built
  -- the HR record (with email) before this invite was ever accepted. Never
  -- overwrites an already-linked row.
  update public.staff_profiles
     set user_id = auth.uid()
   where org_id = v_invite.org_id
     and user_id is null
     and lower(email) = v_user_email;

  update public.invites
     set accepted_at = timezone('utc', now()),
         accepted_by = auth.uid()
   where id = v_invite.id;

  return v_invite.org_id;
end;
$$;
