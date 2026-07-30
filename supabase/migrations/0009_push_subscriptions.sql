-- =====================================================================
-- 0009_push_subscriptions.sql — Web Push subscription storage
--
-- Nothing in 0001/0002 stores a PushSubscription (endpoint + keys) — the
-- `subscriptions` table from 0002 is billing/plan state, unrelated. This is
-- the table Web Push clock-in/leave/swap/rota notifications need to exist at
-- all: the send-notification Edge Function reads it to know where to push.
--
-- Keyed by user, not staff_profile_id: a platform admin or an owner with no
-- staff record still has an account and can still receive notifications.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- Unique per endpoint, not per user: the same person subscribes separately
  -- from a phone and a laptop and both must receive a push.
  endpoint     text not null unique,
  p256dh       text not null,
  auth_key     text not null,
  created_at   timestamptz not null default timezone('utc', now())
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Own rows only. No org_id here on purpose — a subscription belongs to a
-- browser/device the user is signed into, not to a tenant, and a user's
-- notifications already span whichever orgs they belong to.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_write on public.push_subscriptions;
create policy push_subscriptions_write on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
