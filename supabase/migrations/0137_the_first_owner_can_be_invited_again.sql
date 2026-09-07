-- =====================================================================
-- 0137_the_first_owner_can_be_invited_again.sql — restoring the bootstrap
-- branch `0126` dropped
--
-- ## The regression
--
-- `0052_admin_assisted_org_creation.sql` gave `create_invite` a bootstrap
-- exception: a platform administrator may invite the very FIRST owner into an
-- organisation that has no memberships at all. Without it, admin-assisted
-- organisation creation is impossible by construction, because there is nobody
-- in the new organisation to hold the `owner` role the guard demands.
--
-- `0126_an_invited_assignment_is_kept.sql` rewrote the whole function to add
-- `p_department` and `p_location`. It rebuilt both guards from the `0006` text
-- and silently dropped `0052`'s clauses. The word "bootstrap" does not appear
-- anywhere in `0126`.
--
-- Reproduced against a rebuilt local database, as a `platform_owner` with an
-- `aal2` session, on an organisation with zero memberships:
--
--   is_platform_admin | has_platform_role(owner) | has_org_role(owner,manager)
--   t                 | t                        | f
--   ERROR:  Only owners and managers can invite people
--   CONTEXT: PL/pgSQL function create_invite(uuid,text,text,uuid,uuid) line 13
--
-- ## Why this is larger than one button
--
-- `admin_create_organisation_with_invite` calls
-- `create_invite(v_org_id, p_owner_email, 'owner')` internally, so the entire
-- sales-led path — create the tenant, invite its first owner — fails with the
-- same error, not just the re-invite control on the organisation detail page.
-- The operator sees "Only owners and managers can invite people", which is
-- meaningless addressed to a platform owner.
--
-- ## Two latent failures downstream, fixed here as well
--
-- Restoring the function alone would move the failure rather than end it.
-- Both of these are unreachable today only because nothing gets past
-- `create_invite`:
--
--   * `invites_select` (`0006`, never re-issued — `0118` replaced only
--     `invites_write`) is `has_org_role(org_id, ['owner','manager'])`.
--     `supabase/functions/send-invite` looks the invite up under the CALLER's
--     JWT, so a platform admin would read zero rows and the function would
--     answer `404 {"error":"Invite not found"}` for an invitation it had just
--     created.
--   * `record_invite_send` (`0129`) carries the same predicate and would raise
--     `42501`. `src/services/inviteService.ts` swallows that to Sentry, so
--     `last_sent_at` and `send_error` would stay null and the invitation would
--     read as "never sent" forever, with nothing shown to the operator.
--
-- ## The shape of the exception, and why it is narrow
--
-- In all three places the platform branch requires ALL of:
--   * `has_platform_role(['platform_owner','platform_admin'])` — not support,
--     not finance, and `has_platform_role` carries `0102`'s MFA condition;
--   * the invitation is for the `owner` role;
--   * the organisation has no memberships at all.
--
-- The third condition is what keeps this a bootstrap rather than a back door.
-- The moment the first owner accepts, the organisation has a membership and
-- the exception stops applying to it permanently — a platform administrator
-- cannot use this to invite themselves into a live tenant. That is the same
-- reasoning `0052` gave, restored verbatim rather than reinvented.
--
-- ## Rollback
--
-- Re-issue `create_invite` from `0126`, `invites_select` from `0006` and
-- `record_invite_send` from `0129`. No table is touched and no grant widened.
-- =====================================================================

-- ---------- create_invite, at the 0126 signature ----------------------
--
-- Reproduced from `0126` in full, with `0052`'s two clauses restored. The
-- department and location validation, the rate limit, the supersede and the
-- token generation are unchanged.

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
  -- Read once. Every guard below asks the same question, and re-evaluating it
  -- between them would let a membership created concurrently change the answer
  -- half way through the function.
  v_bootstrap boolean := public.has_platform_role(
                           array['platform_owner','platform_admin'])
                         and not exists (
                           select 1 from public.memberships m where m.org_id = p_org);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the role check must be explicit here.
  -- The second branch is the bootstrap: a platform administrator inviting the
  -- first owner into an organisation nobody belongs to yet (0052, restored).
  if not (
    public.has_org_role(p_org, array['owner','manager'])
    or (v_bootstrap and p_role = 'owner')
  ) then
    raise exception 'Only owners and managers can invite people'
      using errcode = '42501';
  end if;

  -- Only an owner may hand out ownership — except in the bootstrap case,
  -- where there is no owner to check against yet. This is not a second gate
  -- being widened; it is the same bootstrap fact carried down.
  if p_role = 'owner'
     and not public.has_org_role(p_org, array['owner'])
     and not v_bootstrap then
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

revoke all on function public.create_invite(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_invite(uuid, text, text, uuid, uuid) to authenticated;

comment on function public.create_invite(uuid, text, text, uuid, uuid) is
  'Creates an invitation. Owners and managers of the organisation, plus the 0052 bootstrap: a platform owner or administrator inviting the FIRST owner into an organisation with no memberships. Restored by 0137 after 0126 dropped it.';

-- ---------- invites_select --------------------------------------------
--
-- So `send-invite`, which reads under the caller's JWT, can find the row it
-- was just asked to send. Same three conditions, expressed against the row.

drop policy if exists invites_select on public.invites;

create policy invites_select on public.invites
  for select
  using (
    public.has_org_role(org_id, array['owner','manager'])
    or (
      role = 'owner'
      and public.has_platform_role(array['platform_owner','platform_admin'])
      and not exists (select 1 from public.memberships m where m.org_id = invites.org_id)
    )
  );

comment on policy invites_select on public.invites is
  'Owners and managers of the organisation, plus a platform administrator reading the first-owner invitation for an organisation nobody has joined yet (0137). send-invite reads under the caller''s JWT, so without this branch it answers 404 for an invitation it just created.';

-- ---------- record_invite_send ----------------------------------------
--
-- Reproduced from `0129` with the same exception, so a bootstrap send is
-- recorded rather than silently failing into Sentry.

create or replace function public.record_invite_send(
  p_invite uuid,
  p_sent   boolean,
  p_error  text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select org_id, role into v_org, v_role from public.invites where id = p_invite;
  if v_org is null then
    raise exception 'Invitation not found' using errcode = 'INV01';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the membership check is explicit —
  -- the same roles `create_invite` admits, bootstrap included.
  if not (
    public.has_org_role(v_org, array['owner','manager'])
    or (
      v_role = 'owner'
      and public.has_platform_role(array['platform_owner','platform_admin'])
      and not exists (select 1 from public.memberships m where m.org_id = v_org)
    )
  ) then
    raise exception 'Only owners and managers can send invitations'
      using errcode = '42501';
  end if;

  update public.invites
     set last_sent_at = case when p_sent then timezone('utc', now()) else last_sent_at end,
         -- Cleared on success. A stale failure sitting beside a delivered
         -- invitation would send a manager chasing a problem that is over.
         send_error   = case when p_sent then null else left(btrim(coalesce(p_error, 'The mail server did not accept it.')), 300) end
   where id = p_invite;
end;
$$;

revoke all on function public.record_invite_send(uuid, boolean, text) from public, anon;
grant execute on function public.record_invite_send(uuid, boolean, text) to authenticated;
