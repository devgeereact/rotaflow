-- =====================================================================
-- 0067_notification_deliveries.sql — record whether a notification landed
--
-- `send-notification` has always computed the answer and thrown it away.
-- It builds `results = { push: {sent, expired, failed}, email: {sent,
-- skipped, failed} }`, returns it to an Inngest step nothing reads, and
-- the knowledge dies there. So a manager who publishes a rota has no way
-- to find out whether the people it affects were actually told, and the
-- "Delivery" block the notifications settings screen documents as missing
-- has no data source to be built on (docs/SAAS.md GAP-004).
--
-- One row per recipient per channel per event. That grain is deliberate:
-- "did James get told" and "did email work for James" are different
-- questions, and collapsing them into one row per notification cannot
-- answer the second.
--
-- WHY NOT A COLUMN ON `notifications`
--
-- `notifications` only exists for the in-app channel, and only when the
-- org has that channel switched on. Email and push happen whether or not
-- an inbox row was written, so hanging delivery off that table would lose
-- exactly the sends most worth tracking. There is also no useful id to
-- hang it from: the in-app rows are inserted in bulk without `returning`.
--
-- ADDITIVE AND REVERSIBLE. One new table, its indexes, its policies and
-- its grants. It alters no existing table, moves no data, and drops
-- nothing, so it is the safest class of change to apply to a database
-- with no backups (docs/SAAS.md GAP-001). Reversing it is `drop table
-- public.notification_deliveries`.
--
-- RETENTION IS NOT WIRED UP, deliberately. `enforce_retention` (0029) is
-- an if/elsif chain over hardcoded `data_type` values, so adding a
-- `retention_policies` row for this table without also extending that
-- function would log a nightly error and delete nothing. Extending a
-- SECURITY DEFINER function that runs against production every night is a
-- separate change with its own risk, and is tracked as GAP-027 rather
-- than smuggled in here. Until then this table grows without bound.
-- =====================================================================

create table if not exists public.notification_deliveries (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations(id) on delete cascade,

  -- The recipient. `profiles`, not `staff_profiles`: notifications are
  -- addressed to a login, and a staff record may not have one yet.
  user_id    uuid not null references public.profiles(id) on delete cascade,

  -- Mirrors NOTIFICATION_CHANNELS in src/lib/orgPreferences.ts. 'sms' is
  -- absent on purpose, matching `notifications.channel`'s own note: there
  -- is no SMS provider, so a delivery row claiming one would be fiction.
  channel    text not null check (channel in ('in_app', 'email', 'push')),

  -- 'sent'      — the provider accepted it. Not proof it was displayed.
  -- 'failed'    — the attempt errored.
  -- 'skipped'   — deliberately not attempted (no SMTP configured, the org
  --               muted this channel, the person opted out).
  -- 'expired'   — a push subscription the browser has discarded (404/410).
  status     text not null check (status in ('sent', 'failed', 'skipped', 'expired')),

  -- The dispatch type: 'rota', 'leave', 'swap', 'announcement'. Free text
  -- rather than a check constraint, because the set is defined in the app
  -- (EVENT_KEY_BY_TYPE) and a constraint here would turn adding a new
  -- notification into a migration.
  event_type text not null,

  -- Why, when the status alone is not enough to act on: the SMTP error, or
  -- 'recipient opted out'. Never a credential or a message body.
  detail     text,

  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.notification_deliveries is
  'One row per recipient per channel per notification: was this person told, on which channel, and did it land. Written only by the send-notification Edge Function (service_role).';
comment on column public.notification_deliveries.status is
  '"sent" means the provider accepted it, not that a human saw it. Displaying a push additionally requires the service worker in public/push-sw.js.';

-- The manager view is "this org's recent deliveries, newest first", so the
-- index matches that predicate rather than org_id alone.
create index if not exists notification_deliveries_org_created_idx
  on public.notification_deliveries (org_id, created_at desc);

-- "Was I told?" for one person.
create index if not exists notification_deliveries_user_idx
  on public.notification_deliveries (user_id, created_at desc);

alter table public.notification_deliveries enable row level security;

-- Owners and managers see their org's delivery record; a person can always
-- see their own. Staff cannot read each other's — whether a colleague's
-- email bounced is not their business, and `has_org_role` is what separates
-- the two. Platform admins reach it only through an active support session,
-- because `has_org_role` routes through `has_support_access` since 0028.
drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select
  on public.notification_deliveries for select
  using (
    public.has_org_role(org_id, array['owner', 'manager'])
    or user_id = auth.uid()
  );

-- No client write policy at all. Rows are written by send-notification with
-- the service_role key, exactly as `notifications` is (0002), so a browser
-- session can never fabricate a delivery record saying someone was told.
--
-- Grants are narrow on purpose. 0056 handed `anon` and `authenticated` full
-- CRUD on every table it touched, which is inert only because every policy
-- predicate is auth.uid()-based (docs/SAAS.md HARDEN-001). A new table does
-- not inherit that mistake: select only, and nothing for anon.
revoke all on public.notification_deliveries from anon, authenticated;
grant select on public.notification_deliveries to authenticated;
