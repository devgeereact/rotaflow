-- =====================================================================
-- 0086_rate_limit_invites.sql — invitations get a ceiling (docs/SAAS.md
-- GAP-009)
--
-- `create_invite` mints an invitation and `send-invite` mails it through
-- our SMTP. Nothing bounded how often, so a loop did not cost us money —
-- it cost us the sending domain. A few thousand invitations to addresses
-- that never asked for them is how rotaflow.space stops being
-- deliverable, and no rate limit added afterwards undoes that.
--
-- The limit is per ORGANISATION, not per user: the resource being
-- protected is our domain reputation, which does not care which of an
-- org's managers sent the mail.
--
-- Placed after the email-format check and before any write. An address
-- that is not an address must not consume the allowance, or the cheapest
-- way to lock an organisation out of inviting anyone is to send it
-- rubbish.
--
-- The rest of the function is 0006's, unchanged. It is reproduced in
-- full because `create or replace` needs the whole body, not because
-- anything else about it moved.
--
-- MIGRATION RISK. One function replaced, same signature, so no grant
-- moves. A legitimate caller sees no difference; there is no bulk import
-- in the product, so nothing types 60 invitations in an hour today.
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

  -- Rate limit AFTER the cheap validation and BEFORE any write (0085). An
  -- address that is not an address should not consume somebody's allowance,
  -- and a caller must not be able to burn the quota by sending rubbish.
  --
  -- Per organisation rather than per user: the resource being protected is
  -- our sending domain, and it does not care which of an org's managers sent
  -- the mail. 60 an hour is far above any real use — invitations are typed
  -- one at a time, there is no bulk import (GAP-022) — and far below what it
  -- takes to get a domain blocklisted. Revisit it the day CSV import lands.
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
