-- =====================================================================
-- 0099_calendar_feed_tokens.sql — a rota that lands in somebody's own
-- calendar (docs/SAAS.md CAP-063)
--
-- `docs/PRD.md` claims a calendar subscription. What exists is an ICS
-- file download, which is a different thing and a worse one: a
-- downloaded file is a snapshot. Import it, then have the rota amended,
-- and the phone still shows last week's shifts — confidently, with a
-- reminder. That is worse than no calendar integration at all, and it
-- is the failure mode this product spends most of its effort avoiding.
--
-- A subscription is a URL the calendar re-reads. This is the token that
-- makes one possible.
--
-- ## The token is the credential, and that shapes everything
--
-- A calendar client cannot present a bearer header or refresh a
-- session; the secret has to be in the URL. So the design assumes the
-- URL will leak — into a screenshot, a shared family calendar, a
-- support ticket — and limits what it is worth:
--
--   * it reads ONE staff member's own shifts, nothing else. Not the
--     team's, not the org's;
--   * it is revocable and rotatable, per person, without touching
--     anything else;
--   * `last_used_at` records use, so a token nobody's calendar is
--     polling can be spotted and cleared.
--
-- It is deliberately NOT a password-equivalent. Losing one exposes the
-- times somebody is rostered to work — which matters, and is not the
-- same as account access. Treating it as though it were would mean
-- expiring it, and an expiring calendar feed silently stops updating,
-- which returns to the stale-snapshot failure above.
-- =====================================================================

create table if not exists public.calendar_feed_tokens (
  token            uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  created_at       timestamptz not null default timezone('utc', now()),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);

comment on table public.calendar_feed_tokens is
  'Subscription URLs for a person''s own rota. The token is the credential — a calendar client cannot present a header — so it reads one person''s shifts and nothing else, and is revocable per person (CAP-063).';

-- One LIVE token per person. Rotating issues a new row and revokes the old
-- one, so a lost URL stops working the moment somebody rotates, and the
-- history of what existed is not thrown away.
--
-- A partial UNIQUE INDEX rather than an EXCLUDE constraint: `exclude
-- (staff_profile_id with =)` needs `btree_gist`, and enabling an extension
-- to express "unique among the live rows" — which a unique index already
-- expresses — is a dependency bought for nothing. It doubles as the lookup
-- index the feed uses.
create unique index if not exists calendar_feed_tokens_one_live_idx
  on public.calendar_feed_tokens (staff_profile_id) where revoked_at is null;

alter table public.calendar_feed_tokens enable row level security;

-- A person may see whether they have a feed, and nothing about anybody
-- else's. Note this policy does NOT let them read the token column of
-- somebody else's row even within their own organisation: a manager has no
-- business holding a staff member's feed URL.
drop policy if exists calendar_feed_tokens_select on public.calendar_feed_tokens;
create policy calendar_feed_tokens_select
  on public.calendar_feed_tokens for select
  using (staff_profile_id = public.my_staff_profile_id(org_id));

revoke all on public.calendar_feed_tokens from anon, authenticated;
grant select on public.calendar_feed_tokens to authenticated;

-- ── issuing and revoking ──────────────────────────────────────────────
--
-- Functions rather than client writes: issuing is "revoke the old one and
-- create a new one", which must be one step. A client doing it in two can
-- leave a person with no feed, or two live ones, depending which half fails.
create or replace function public.issue_calendar_feed_token(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid;
  v_token uuid;
begin
  v_staff := public.my_staff_profile_id(p_org);
  if v_staff is null then
    -- Not a staff member of this organisation. An owner with no staff
    -- record has no shifts to publish, so there is nothing to subscribe to.
    raise exception 'You do not have a staff record in this organisation'
      using errcode = '42501';
  end if;

  update public.calendar_feed_tokens
     set revoked_at = timezone('utc', now())
   where staff_profile_id = v_staff and revoked_at is null;

  insert into public.calendar_feed_tokens (org_id, staff_profile_id)
  values (p_org, v_staff)
  returning token into v_token;

  return v_token;
end;
$$;

comment on function public.issue_calendar_feed_token(uuid) is
  'Issues a fresh subscription token for the caller''s own staff record, revoking any existing one in the same transaction. Rotating and creating are the same operation.';

create or replace function public.revoke_calendar_feed_token(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid;
begin
  v_staff := public.my_staff_profile_id(p_org);
  if v_staff is null then
    raise exception 'You do not have a staff record in this organisation'
      using errcode = '42501';
  end if;

  update public.calendar_feed_tokens
     set revoked_at = timezone('utc', now())
   where staff_profile_id = v_staff and revoked_at is null;
end;
$$;

revoke all on function public.issue_calendar_feed_token(uuid) from public, anon;
revoke all on function public.revoke_calendar_feed_token(uuid) from public, anon;
grant execute on function public.issue_calendar_feed_token(uuid) to authenticated;
grant execute on function public.revoke_calendar_feed_token(uuid) to authenticated;

-- ── what the feed reads ───────────────────────────────────────────────
--
-- The Edge Function serving the feed has no user session — the caller is a
-- calendar client with a URL. So the token lookup and the shift read happen
-- here, in one SECURITY DEFINER function granted to `service_role` only,
-- rather than the function holding a service-role client and deciding for
-- itself which rows to return.
--
-- Only PUBLISHED rotas. A draft is a manager's working copy, and a shift
-- appearing in somebody's phone before the rota is published would tell
-- them they are working a shift nobody has committed to.
create or replace function public.calendar_feed_shifts(p_token uuid)
returns table (
  shift_id      uuid,
  starts_at     timestamptz,
  ends_at       timestamptz,
  shift_type    text,
  location_name text,
  break_minutes integer,
  notes         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid;
begin
  select t.staff_profile_id into v_staff
    from public.calendar_feed_tokens t
   where t.token = p_token and t.revoked_at is null;

  if v_staff is null then
    return;  -- Unknown or revoked. No rows, and no clue which.
  end if;

  update public.calendar_feed_tokens
     set last_used_at = timezone('utc', now())
   where token = p_token;

  return query
  select s.id,
         s.starts_at,
         s.ends_at,
         st.name,
         l.name,
         coalesce(s.break_minutes, 0),
         s.notes
    from public.shifts s
    join public.rotas r on r.id = s.rota_id
    left join public.shift_types st on st.id = s.shift_type_id
    left join public.locations l on l.id = s.location_id
   where s.staff_profile_id = v_staff
     and s.status <> 'cancelled'
     and r.status = 'published'
     -- A rolling window. A calendar does not need the whole history, and a
     -- feed that grows without bound eventually times out on the client.
     and s.starts_at > timezone('utc', now()) - interval '30 days'
     and s.starts_at < timezone('utc', now()) + interval '180 days'
   order by s.starts_at;
end;
$$;

comment on function public.calendar_feed_shifts(uuid) is
  'The published shifts one feed token may see. service_role only: the Edge Function serving the feed has no user session, so the token lookup happens here rather than in a function holding a service-role client.';

revoke all on function public.calendar_feed_shifts(uuid) from public, anon, authenticated;
grant execute on function public.calendar_feed_shifts(uuid) to service_role;
