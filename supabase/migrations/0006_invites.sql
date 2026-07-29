-- =====================================================================
-- 0006_invites.sql — invite a user to join an organisation
--
-- Until now onboarding was create-only: there was no mechanism to add a
-- second user to an org, which made every staff-facing screen untestable
-- with a real staff account. This adds the missing link.
--
-- Design notes, because two of these are security-load-bearing:
--
-- 1. ONLY A HASH OF THE TOKEN IS STORED. The raw token is returned exactly
--    once, by create_invite(), so it can be put in an email link. A dump of
--    this table therefore yields no usable invite links. sha256() is a core
--    Postgres function (PG11+), so this needs no extension.
--
-- 2. REDEMPTION CANNOT GO THROUGH RLS. The invitee is authenticated but is
--    not yet a member of the org, so any org-scoped policy on `invites`
--    correctly hides the row from the very person who needs it. This is the
--    same bootstrap problem that broke org creation in 0003. Redemption
--    therefore runs in SECURITY DEFINER functions, and the table itself
--    stays locked to owners/managers of the org. Do not add a permissive
--    select policy to "make it work" — that would expose every pending
--    invite in the system.
--
-- 3. The invited email must match the caller's verified email. Without that
--    check, anyone who obtains a token (forwarded email, shared inbox, a
--    link in a screenshot) can join the tenant as whatever role it grants.
-- =====================================================================

create table if not exists public.invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  -- Stored lower-cased; all comparisons are made lower-cased.
  email        text not null,
  role         text not null default 'staff'
                 check (role in ('owner','manager','staff')),
  -- sha256 hex of the raw token. The raw token is never persisted.
  token_hash   text not null unique,
  invited_by   uuid references public.profiles(id) on delete set null,
  expires_at   timestamptz not null default timezone('utc', now()) + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles(id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default timezone('utc', now()),
  updated_at   timestamptz not null default timezone('utc', now()),
  constraint invites_email_lowercase check (email = lower(email))
);

create index if not exists invites_org_idx        on public.invites (org_id);
create index if not exists invites_email_idx      on public.invites (lower(email));
create index if not exists invites_token_hash_idx on public.invites (token_hash);

-- At most one *live* invite per (org, email). Accepted/revoked/expired rows
-- stay for audit, so this is a partial index rather than a plain unique.
create unique index if not exists invites_one_pending_per_email
  on public.invites (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

drop trigger if exists invites_set_updated_at on public.invites;
create trigger invites_set_updated_at
  before update on public.invites
  for each row execute function public.set_updated_at();

-- ---------- RLS: owners/managers of the org only ----------------------
-- Deliberately no policy that lets an invitee read their own row; see note 2.
alter table public.invites enable row level security;

drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select
  using (public.has_org_role(org_id, array['owner','manager']));

drop policy if exists invites_write on public.invites;
create policy invites_write on public.invites for all
  using (public.has_org_role(org_id, array['owner','manager']))
  with check (public.has_org_role(org_id, array['owner','manager']));

-- =====================================================================
-- create_invite — mint an invite and return the raw token ONCE
-- =====================================================================
create or replace function public.create_invite(
  p_org   uuid,
  p_email text,
  p_role  text default 'staff'
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

  insert into public.invites (org_id, email, role, token_hash, invited_by)
  values (
    p_org,
    v_email,
    p_role,
    encode(sha256(v_token::bytea), 'hex'),
    auth.uid()
  )
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;

-- =====================================================================
-- preview_invite — what does this token point at?
--
-- Lets the accept-invite screen say "You've been invited to X as a manager"
-- before the user has an account. Returns nothing for an invalid, expired,
-- revoked or already-accepted token, so it cannot be used to probe for
-- valid orgs. The caller already holds the token, so revealing the org name
-- and target email to them discloses nothing they were not sent.
-- =====================================================================
create or replace function public.preview_invite(p_token text)
returns table (org_name text, role text, email text, expires_at timestamptz)
language sql security definer stable set search_path = public as $$
  select o.name, i.role, i.email, i.expires_at
    from public.invites i
    join public.organisations o on o.id = i.org_id
   where i.token_hash = encode(sha256(p_token::bytea), 'hex')
     and i.accepted_at is null
     and i.revoked_at is null
     and i.expires_at > timezone('utc', now());
$$;

-- =====================================================================
-- accept_invite — redeem a token and join the organisation
-- =====================================================================
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

  select lower(email) into v_user_email from public.profiles where id = auth.uid();
  if v_user_email is null then
    raise exception 'No profile for the current user' using errcode = 'P0002';
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

  -- See note 3: without this, a forwarded link is a free pass into the tenant.
  if lower(v_invite.email) <> v_user_email then
    raise exception 'This invitation was sent to a different email address'
      using errcode = '42501';
  end if;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_invite.org_id, auth.uid(), v_invite.role, 'active')
  on conflict (org_id, user_id)
    do update set role = excluded.role, status = 'active';

  update public.invites
     set accepted_at = timezone('utc', now()),
         accepted_by = auth.uid()
   where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

-- The anon role must not be able to mint invites; redemption and preview are
-- reachable by any signed-in user (they still need a valid token).
revoke all on function public.create_invite(uuid, text, text)  from public, anon;
revoke all on function public.accept_invite(text)              from public, anon;
revoke all on function public.preview_invite(text)             from public, anon;
grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text)             to authenticated;
grant execute on function public.preview_invite(text)            to authenticated, anon;
