-- =====================================================================
-- 0085_rate_limiting.sql — the three things GAP-009 names actually have
-- a ceiling (docs/SAAS.md GAP-009)
--
-- "Unlimited org creation, unlimited invites, uncapped AI spend." All
-- three were true, and each fails differently:
--
--   * ORG CREATION — any signed-in account could create organisations in
--     a loop. Nothing bills for them and nothing cleans them up.
--   * INVITES — `create_invite` sends mail through our SMTP. A script
--     does not cost us money, it costs us the sending domain: a few
--     thousand invitations to addresses that did not ask for them is how
--     rotaflow.space stops being deliverable, and that is not something
--     a rate limit can fix afterwards.
--   * AI — every call spends real money at OpenRouter. That one is
--     capped here per user, and per REQUEST in the Edge Function, which
--     had no `max_tokens` at all.
--
-- ## The subject is derived, never passed
--
-- `consume_rate_limit` takes a subject and stays revoked from every
-- client role. Clients get `consume_my_rate_limit`, which uses
-- `auth.uid()` and cannot be pointed at anybody else. That distinction
-- is the whole security of this: a limiter that lets a caller name its
-- own subject is a denial-of-service tool, because the cheapest thing to
-- do with it is exhaust somebody else's allowance.
--
-- ## Exact, not approximate
--
-- Two simultaneous requests could both count nine of ten and both
-- proceed, so this takes a transaction-scoped advisory lock on the
-- bucket and subject. That makes the count exact and costs one lock per
-- call. A rate limiter is allowed to be approximate; one guarding spend
-- may as well not be.
--
-- ## The numbers, and why
--
--   ai_assistant   30 per hour per user. A manager trying several
--                  phrasings of a week is well inside it; a loop is not.
--   invite         60 per hour per organisation. There is no bulk import
--                  (GAP-022), so invitations are typed one at a time and
--                  no real workflow reaches this. Revisit it the day CSV
--                  import lands, or it becomes the thing blocking a
--                  customer's first day.
--   org_create      5 per hour per user. Self-serve signup creates one.
--
-- They are deliberately generous. A limit tight enough to annoy a real
-- user gets raised by whoever is annoyed, and then it is not a limit.
--
-- MIGRATION RISK. One new table, two functions, one trigger. The trigger
-- skips `created_by is null`, which is the platform-admin path
-- (`admin_create_organisation_with_invite`, already role-gated) — so
-- sales-led creation is not caught by a limit meant for self-serve.
-- Nothing existing is rewritten.
-- =====================================================================

create table if not exists public.rate_limit_events (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  subject    text not null,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.rate_limit_events is
  'One row per rate-limited action. Pruned by the limiter itself on each call, so it stays proportional to the window rather than growing forever.';

create index if not exists rate_limit_events_lookup_idx
  on public.rate_limit_events (bucket, subject, created_at desc);

alter table public.rate_limit_events enable row level security;

-- No policy at all, deliberately: nothing outside the limiter has any reason
-- to read this, and every writer is security definer.
revoke all on public.rate_limit_events from anon, authenticated;

-- ── the limiter ───────────────────────────────────────────────────────
create or replace function public.consume_rate_limit(
  p_bucket  text,
  p_subject text,
  p_limit   integer,
  p_window  interval
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if p_subject is null or btrim(p_subject) = '' then
    raise exception 'A rate limit needs a subject' using errcode = '22023';
  end if;

  -- Transaction-scoped, so it releases on commit or rollback without a
  -- cleanup path. Two hashtext arguments rather than one concatenated string:
  -- it keeps 'a' + 'bc' from colliding with 'ab' + 'c'.
  perform pg_advisory_xact_lock(hashtext(p_bucket), hashtext(p_subject));

  -- Prune this subject's expired rows first, so the table stays proportional
  -- to the window. Cheap: it is the same index range the count below reads.
  delete from public.rate_limit_events
   where bucket = p_bucket
     and subject = p_subject
     and created_at < timezone('utc', now()) - p_window;

  select count(*) into v_count
    from public.rate_limit_events
   where bucket = p_bucket
     and subject = p_subject
     and created_at >= timezone('utc', now()) - p_window;

  if v_count >= p_limit then
    raise exception
      'Too many attempts. The limit is % every %; try again shortly.',
      p_limit, p_window
      using errcode = 'P0001';
  end if;

  insert into public.rate_limit_events (bucket, subject)
  values (p_bucket, p_subject);
end;
$$;

comment on function public.consume_rate_limit(text, text, integer, interval) is
  'Records an action and raises P0001 when the subject is over its limit. Takes an arbitrary subject, so it is revoked from every client role — see consume_my_rate_limit for the callable form.';

-- Revoked from clients on purpose. A caller able to name its own subject
-- could exhaust another user's allowance, which turns a rate limit into a
-- denial-of-service tool.
revoke all on function public.consume_rate_limit(text, text, integer, interval)
  from public, anon, authenticated;

-- ── the callable form ─────────────────────────────────────────────────
create or replace function public.consume_my_rate_limit(
  p_bucket text,
  p_limit  integer,
  p_window interval
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- The bucket is checked against a fixed list rather than trusted. Without
  -- it a caller could invent a bucket name and get an unlimited private
  -- allowance, which is a limiter that only limits the honest.
  if p_bucket not in ('ai_assistant') then
    raise exception 'Unknown rate limit bucket: %', p_bucket using errcode = '22023';
  end if;

  -- The subject is auth.uid(), never an argument.
  perform public.consume_rate_limit(p_bucket, auth.uid()::text, p_limit, p_window);
end;
$$;

comment on function public.consume_my_rate_limit(text, integer, interval) is
  'The client-callable limiter. The subject is always auth.uid(), so a caller cannot exhaust somebody else''s allowance, and the bucket must be one this function knows.';

revoke all on function public.consume_my_rate_limit(text, integer, interval)
  from public, anon;
grant execute on function public.consume_my_rate_limit(text, integer, interval)
  to authenticated;

-- ── org creation ──────────────────────────────────────────────────────
create or replace function public.limit_org_creation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- `created_by is null` is the platform-admin path
  -- (admin_create_organisation_with_invite, 0084), which is already gated on
  -- has_platform_role. A limit meant for self-serve signup should not stop
  -- somebody onboarding customers for a living.
  if new.created_by is null then
    return new;
  end if;

  perform public.consume_rate_limit('org_create', new.created_by::text, 5, interval '1 hour');
  return new;
end;
$$;

drop trigger if exists organisations_limit_creation on public.organisations;
create trigger organisations_limit_creation
  before insert on public.organisations
  for each row execute function public.limit_org_creation();

revoke all on function public.limit_org_creation() from public, anon, authenticated;
