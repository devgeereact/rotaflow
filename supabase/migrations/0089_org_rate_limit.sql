-- =====================================================================
-- 0089_org_rate_limit.sql — an organisation's AI spend is bounded, not
-- just each member's (docs/SAAS.md HARDEN-004)
--
-- 0085 capped the assistant at 30 calls an hour PER USER, which bounds
-- one person and not the bill. An organisation with twenty managers has
-- a ceiling of 600 calls an hour, and each one sends the whole period's
-- staff, shifts, leave and availability as context. Nobody is abusing
-- anything in that picture; the ceiling is simply in the wrong unit.
-- The invoice arrives per organisation, so the limit belongs there too.
--
-- ## Why a third function rather than opening up the second
--
-- `consume_rate_limit` takes its subject as an argument and is revoked
-- from every client role: a limiter whose subject the caller names is a
-- way to exhaust somebody else's allowance. `consume_my_rate_limit`
-- fixes the subject to `auth.uid()`, which is exactly right for a
-- per-user bucket and cannot express a per-org one.
--
-- So this takes an org id — and checks membership before using it. That
-- is what makes naming the subject safe here: a member can only consume
-- the bucket of an organisation they belong to, which they could consume
-- anyway by making the requests. A non-member gets a refusal, not a
-- lever on somebody else's quota.
-- =====================================================================

create or replace function public.consume_org_rate_limit(
  p_bucket text,
  p_org    uuid,
  p_limit  integer,
  p_window interval
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Same fixed list as `consume_my_rate_limit`, for the same reason: an
  -- invented bucket name is an unlimited private allowance, which is a
  -- limiter that only limits the honest.
  if p_bucket not in ('ai_assistant_org') then
    raise exception 'Unknown rate limit bucket: %', p_bucket using errcode = '22023';
  end if;

  -- The check that makes an argument-taking limiter safe.
  if not public.is_org_member(p_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  perform public.consume_rate_limit(p_bucket, p_org::text, p_limit, p_window);
end;
$$;

comment on function public.consume_org_rate_limit(text, uuid, integer, interval) is
  'A per-organisation limiter. The subject is an org id rather than auth.uid(), and membership is checked first — so a caller can only spend an allowance they are already able to spend. Buckets are a fixed list.';

revoke all on function public.consume_org_rate_limit(text, uuid, integer, interval)
  from public, anon;
grant execute on function public.consume_org_rate_limit(text, uuid, integer, interval)
  to authenticated;
