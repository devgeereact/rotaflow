-- =====================================================================
-- 0051_admin_assisted_org_creation.sql — platform-admin-created orgs
--
-- Today the only way an organisation comes into existence is self-serve
-- signup (organisations_insert, 0002), which requires auth.uid() =
-- created_by. There is no path for a platform admin to create an org on
-- behalf of a prospect who contacted sales directly.
--
-- Two changes:
--
-- 1. create_invite()'s permission checks (0006) get a bootstrap
--    alternative — a platform admin inviting the very first owner into a
--    genuinely member-less org. Both gates need it, or the function
--    accepts the admin past the first check and rejects them at the
--    second ("only an owner may hand out ownership").
--
-- 2. A new RPC, admin_create_organisation_with_invite, that atomically:
--    inserts the org (with created_by = null so on_org_created never fires
--    and no membership row is created), creates the subscription at the
--    negotiated price, and creates the owner invite for the real contact.
--    All-or-nothing, platform-admin-only. The platform admin never holds
--    membership, not even transiently within the transaction.
-- =====================================================================

-- ---------- create_invite(): bootstrap exception on both gates --------
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
  if not (
    public.has_org_role(p_org, array['owner','manager'])
    or (
      public.has_platform_role(array['platform_owner','platform_admin'])
      and p_role = 'owner'
      and not exists (select 1 from public.memberships m where m.org_id = p_org)
    )
  ) then
    raise exception 'Only owners and managers can invite people'
      using errcode = '42501';
  end if;

  -- Only an owner may hand out ownership — the bootstrap case is a platform
  -- admin inviting the very first owner into a genuinely ownerless org,
  -- which is exactly the case above already validated; no separate owner
  -- to check against yet, so it is not a second gate to widen, it is the
  -- same bootstrap fact carried down.
  if p_role = 'owner'
     and not public.has_org_role(p_org, array['owner'])
     and not (
       public.has_platform_role(array['platform_owner','platform_admin'])
       and not exists (select 1 from public.memberships m where m.org_id = p_org)
     ) then
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

-- ---------- admin_create_organisation_with_invite ----------------------
create or replace function public.admin_create_organisation_with_invite(
  p_name          text,
  p_slug          text,
  p_plan          text,
  p_owner_email   text,
  p_price_pence   integer default null  -- null = use the plan's list price
) returns table (org_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_invite record;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can create an organisation this way'
      using errcode = '42501';
  end if;

  if p_plan not in ('starter','professional','business','enterprise') then
    raise exception 'Unknown plan: %', p_plan using errcode = '22023';
  end if;

  -- created_by is deliberately left null: on_org_created (0002) only fires
  -- `when (new.created_by is not null)`, so leaving it null means the
  -- trigger never runs and no membership row is ever inserted for this
  -- platform admin — not even transiently within this same transaction.
  -- That is a stronger guarantee than insert-then-delete, which would also
  -- collide with memberships_keep_one_owner_trigger (0047): deleting an
  -- org's only owner row is exactly the transition that trigger exists to
  -- block, so an insert-then-delete approach can never succeed.
  insert into public.organisations (name, slug, plan)
  values (p_name, p_slug, p_plan)
  returning id into v_org_id;

  insert into public.subscriptions (org_id, plan, status, price_pence, started_at)
  values (v_org_id, p_plan, 'active', p_price_pence, timezone('utc', now()));

  select * into v_invite from public.create_invite(v_org_id, p_owner_email, 'owner');

  return query select v_org_id, v_invite.token, v_invite.expires_at;
end;
$$;

revoke all on function public.admin_create_organisation_with_invite(text, text, text, text, integer) from public, anon;
grant execute on function public.admin_create_organisation_with_invite(text, text, text, text, integer) to authenticated;
