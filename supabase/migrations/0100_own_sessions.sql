-- =====================================================================
-- 0100_own_sessions.sql — see where you are signed in, and sign the
-- other places out (docs/SAAS.md CAP-050)
--
-- The register recorded "no server-side registry, no per-device
-- revoke". The first half was wrong: `auth.sessions` has existed the
-- whole time and carries `created_at`, `refreshed_at`, `user_agent` and
-- `ip` per session. Nothing surfaced it, which is a different problem
-- with a much smaller fix.
--
-- What that absence costs is specific. Somebody who signs in on a ward
-- tablet, a phone and a home laptop has no way to know the tablet is
-- still signed in, and no way to do anything about it if they leave.
-- For a product where the shared device is the normal case — a clock-in
-- terminal by the door — that is the wrong default.
--
-- ## Reading the auth schema, carefully
--
-- `auth.sessions` is GoTrue's, not ours, and nothing here writes to it
-- except the revoke below. Both functions are SECURITY DEFINER and both
-- filter on `auth.uid()` as their FIRST condition, with no argument
-- that could widen the set — there is no session id to pass in, so
-- there is no way to ask about anybody else's.
--
-- The current session is identified by the `session_id` claim on the
-- caller's own JWT. That is the only way to tell "this device" from
-- "that device" without trusting the client to say which is which.
--
-- ## Revoking deletes rows, which is how GoTrue revokes
--
-- ## One dependency worth writing down
--
-- `auth.sessions` has RLS ENABLED with zero policies. That combination
-- means nobody sees anything unless they bypass RLS — verified on the
-- live project, where the definer role (`postgres`) has `rolbypassrls`
-- and DELETE on the table, while the table itself is owned by
-- `supabase_auth_admin`. If a future platform change removes that, both
-- functions below return nothing and revoke reports `0` rather than
-- failing, so the pgTAP test asserts on the counts rather than on the
-- absence of an error.
--
-- Removing a row from `auth.sessions` is what a sign-out does. The
-- refresh token stops working on the next attempt, which for an idle
-- tablet means the next time somebody wakes it. It is not instant: an
-- access token already issued stays valid until it expires (one hour on
-- this project). Saying "signed out everywhere else" and meaning "within
-- the hour" is the honest description, and the screen says the latter.
-- =====================================================================

create or replace function public.my_sessions()
returns table (
  session_id   uuid,
  created_at   timestamptz,
  refreshed_at timestamptz,
  user_agent   text,
  ip           text,
  is_current   boolean
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select s.id,
         s.created_at,
         -- `refreshed_at` is a bare timestamp in GoTrue's schema; it is UTC,
         -- so it is labelled rather than converted.
         (s.refreshed_at at time zone 'UTC')::timestamptz,
         s.user_agent,
         host(s.ip),
         s.id::text = (auth.jwt() ->> 'session_id')
    from auth.sessions s
   where s.user_id = auth.uid()
   order by s.refreshed_at desc nulls last, s.created_at desc;
$$;

comment on function public.my_sessions() is
  'Where the caller is signed in. Takes no argument on purpose: there is no session id to pass, so there is no way to ask about somebody else''s (CAP-050).';

revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

-- ── signing the other devices out ─────────────────────────────────────
--
-- Deliberately "all the others" rather than "this specific one". Picking a
-- session from a list means matching a row to a physical device by user
-- agent, and a person who cannot tell which "Mobile Safari on iOS" is the
-- lost phone will either pick wrong or not act. The safe action they
-- actually want is "everything except what I am holding".
create or replace function public.revoke_my_other_sessions()
returns integer
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_current uuid;
  v_count   integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  v_current := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  -- `is distinct from` rather than `<>`: a null current session — a token
  -- shape without the claim — must not silently make this a no-op that
  -- reports success. With null it removes every session including this one,
  -- which is the safe direction: the person is signed out and knows it.
  delete from auth.sessions s
   where s.user_id = auth.uid()
     and s.id is distinct from v_current;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.revoke_my_other_sessions() is
  'Signs out every session except the caller''s current one, and returns how many. Not instant: an already-issued access token stays valid until it expires (CAP-050).';

revoke all on function public.revoke_my_other_sessions() from public, anon;
grant execute on function public.revoke_my_other_sessions() to authenticated;
