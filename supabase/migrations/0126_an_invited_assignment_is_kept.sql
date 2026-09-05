-- =====================================================================
-- 0126 · An invited assignment survives acceptance
--
-- Closes the second half of the 5 September 2026 audit's RF-11.
--
-- "Invite your team" has offered a Department and a Location for each
-- person since the screen was built. Neither was ever stored:
-- `create_invite` took org, email and role, `invites` had no column for
-- either, and `StepInviteTeam` said so in a code comment nobody
-- administering an organisation ever reads. A manager assigned twenty
-- people to sites during onboarding, saw the choices in the review table,
-- and every one of them joined unassigned.
--
-- The controls are kept and made real rather than removed. The assignment
-- is the manager's actual intent, it is cheap to hold, and applying it at
-- acceptance is the only moment the staff record and the account are known
-- to be the same person.
--
-- Both are validated against the inviting organisation inside the function,
-- not trusted from the caller: a foreign key alone would accept another
-- tenant's location id, and the resulting staff record would name a site
-- its organisation does not own.
--
-- SAFETY(drop_function): two nullable columns, two function replacements,
-- and `create_invite(uuid, text, text)` is DROPPED. It has to be: the new
-- signature defaults its two extra parameters, so leaving the old one in
-- place would make every existing three-argument call ambiguous
-- ("function public.create_invite(uuid, text, text) is not unique") and
-- break invitations outright. Dropping it is what keeps those callers
-- working — a three-argument call then resolves to the new function and
-- records no assignment, exactly as before. No table, column or row is
-- removed, and no invitation changes.
-- =====================================================================

alter table public.invites
  add column if not exists department_id uuid
    references public.departments(id) on delete set null,
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;

comment on column public.invites.department_id is
  'The department this person was invited into, applied to their staff record when they accept. Null when none was chosen — most invitations. Validated against the inviting org by create_invite (0126).';
comment on column public.invites.location_id is
  'The site this person was invited to work at, applied as a staff_locations row on acceptance. Same validation as department_id.';

-- ── create_invite, now carrying the assignment ───────────────────────
-- New parameters are defaulted, so every existing caller — including an
-- older client bundle still in a service worker cache — keeps working
-- unchanged and simply records no assignment.
-- The three-argument form must go before the five-argument one exists.
-- Postgres treats them as different functions, and a call supplying three
-- arguments would match both, so both being present is not a compatible
-- overload — it is an ambiguity error on every invitation.
drop function if exists public.create_invite(uuid, text, text);

create or replace function public.create_invite(
  p_org        uuid,
  p_email      text,
  p_role       text default 'staff',
  p_department uuid default null,
  p_location   uuid default null
)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_token text;
  v_row   public.invites;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the role check must be explicit here.
  if not public.has_org_role(p_org, array['owner','manager']) then
    raise exception 'Only owners and managers can invite people'
      using errcode = '42501';
  end if;

  -- Only an owner may hand out ownership.
  if p_role = 'owner' and not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only an owner can invite another owner'
      using errcode = '42501';
  end if;

  if p_role not in ('owner','manager','staff') then
    raise exception 'Unknown role: %', p_role using errcode = '22023';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address'
      using errcode = '22023';
  end if;

  -- The assignment must belong to the inviting organisation. A foreign key
  -- would happily accept another tenant's id, and this function is SECURITY
  -- DEFINER, so RLS is not standing behind it.
  if p_department is not null and not exists (
    select 1 from public.departments d where d.id = p_department and d.org_id = p_org
  ) then
    raise exception 'That department is not part of this organisation'
      using errcode = '42501';
  end if;

  if p_location is not null and not exists (
    select 1 from public.locations l where l.id = p_location and l.org_id = p_org
  ) then
    raise exception 'That location is not part of this organisation'
      using errcode = '42501';
  end if;

  -- Rate limit AFTER the cheap validation and BEFORE any write (0085). An
  -- address that is not an address should not consume somebody's allowance,
  -- and a caller must not be able to burn the quota by sending rubbish.
  perform public.consume_rate_limit('invite', p_org::text, 60, interval '1 hour');

  -- Already a member? Inviting again would create a confusing dead link.
  if exists (
    select 1 from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.org_id = p_org and lower(p.email) = v_email
  ) then
    raise exception 'That person is already a member of this organisation'
      using errcode = '23505';
  end if;

  -- Supersede any live invite so the partial unique index cannot trip and the
  -- newest link is the only working one.
  update public.invites
     set revoked_at = timezone('utc', now())
   where org_id = p_org
     and lower(email) = v_email
     and accepted_at is null
     and revoked_at is null;

  -- Two UUIDv4s = 244 bits of entropy, no pgcrypto dependency.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invites (
    org_id, email, role, token_hash, invited_by, department_id, location_id)
  values (
    p_org,
    v_email,
    p_role,
    encode(sha256(v_token::bytea), 'hex'),
    auth.uid(),
    p_department,
    p_location
  )
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;

-- ── accept_invite, now applying it ───────────────────────────────────
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite     public.invites;
  v_user_email text;
  v_staff_id   uuid;
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

  -- RF-11: apply the assignment the manager chose when they sent this.
  -- Only onto a staff record that exists and has no department already —
  -- an invitation is an intent from before this person joined, and it must
  -- not overwrite what a manager has since set deliberately.
  select id into v_staff_id
    from public.staff_profiles
   where org_id = v_invite.org_id and user_id = auth.uid()
   limit 1;

  if v_staff_id is not null and v_invite.department_id is not null then
    update public.staff_profiles
       set department_id = v_invite.department_id
     where id = v_staff_id and department_id is null;
  end if;

  if v_staff_id is not null and v_invite.location_id is not null then
    insert into public.staff_locations (org_id, staff_profile_id, location_id)
    values (v_invite.org_id, v_staff_id, v_invite.location_id)
    on conflict do nothing;
  end if;

  update public.invites
     set accepted_at = timezone('utc', now()),
         accepted_by = auth.uid()
   where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────
-- The new create_invite signature is a DIFFERENT function to Postgres, so it
-- carries none of 0113's grants. Written down here for the reason 0113
-- exists: production grants through a default ACL the local image lacks.
revoke all on function public.create_invite(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_invite(uuid, text, text, uuid, uuid) to authenticated;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
