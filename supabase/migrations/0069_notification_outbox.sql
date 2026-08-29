-- =====================================================================
-- 0069_notification_outbox.sql — publishing a rota carries its own
-- notification, server-side (docs/SAAS.md GAP-026)
--
-- #166 made a failed dispatch queue in the browser's IndexedDB outbox and
-- retry, which closed the common failure: a blocked or 5xx request to
-- `inn.gs` after the publish had already landed. What it could not close is
-- the browser itself. Close the tab before the outbox write flushes and the
-- event is gone, and nothing anywhere knows a notification was owed.
--
-- The fix is to stop making the client responsible for announcing something
-- the database already knows happened. `publish_rota` is a transaction; a
-- trigger on it can record the intent in the same transaction, so the
-- notification exists or the publish does not. Nothing about a tab, a
-- network, or a content blocker can separate the two after that.
--
-- SHAPE
--
--   rotas: status -> 'published'
--     -> trigger enqueues one notification_outbox row, recipients resolved
--        in SQL from the rota's own shifts
--     -> pg_cron every minute calls dispatch_notification_outbox()
--     -> that posts to the send-notification Edge Function via pg_net
--     -> the response is reconciled on a later pass; failures retry, up to
--        a cap, then stop and stay visible
--
-- WHY THE CLIENT DISPATCH FOR THIS EVENT GOES AWAY
--
-- Both paths firing would notify every affected person twice.
-- `RotaBuilderPage` no longer sends `rota/published`; the trigger owns it.
-- The other three events (leave, swap, announcement) still dispatch from
-- the client, because no trigger covers them yet — they are not part of
-- this change and the register still tracks them.
--
-- SECRETS ARE NOT IN THIS FILE
--
-- The drain needs the function URL, an anon JWT for the platform gate, and
-- NOTIFICATION_FUNCTION_SECRET. All three are read from `vault` by name at
-- call time. A migration is committed to a public repository and must never
-- carry a credential, so provisioning them is a separate operator step —
-- and until they exist the drain does nothing and says so, rather than
-- failing in a way that looks like no work to do.
--
-- MIGRATION RISK. Enables one extension, adds one table, one trigger, two
-- functions and one cron job. It alters no existing table and rewrites no
-- data. Reversible: drop the cron job, the trigger, the functions and the
-- table. The database still has no backups (GAP-001), so nothing here
-- touches a row that already exists.
-- =====================================================================

-- pg_net: the only way Postgres can make an outbound HTTP call on this
-- platform. `http` is also available but is synchronous and would hold a
-- transaction open across a network call; pg_net queues and returns.
create extension if not exists pg_net with schema extensions;

create table if not exists public.notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,

  -- The Inngest-style event name, kept so this table can carry more than
  -- rota publications later without a schema change.
  event_name   text not null,

  -- Exactly the body send-notification expects: orgId, userIds, type, title.
  payload      jsonb not null,

  status       text not null default 'pending'
                 check (status in ('pending', 'sent', 'failed', 'abandoned')),
  attempts     integer not null default 0,

  -- pg_net's request id, so a later pass can look the outcome up in
  -- net._http_response rather than assuming the post worked.
  request_id   bigint,
  last_error   text,

  created_at   timestamptz not null default timezone('utc', now()),
  dispatched_at timestamptz
);

comment on table public.notification_outbox is
  'Notifications the database knows are owed. Written in the same transaction as the event that caused them, so a closed browser tab cannot lose one. Drained by dispatch_notification_outbox() on a pg_cron schedule.';

create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (status, created_at)
  where status = 'pending';
create index if not exists notification_outbox_org_idx
  on public.notification_outbox (org_id, created_at desc);

alter table public.notification_outbox enable row level security;

-- Owners and managers see their own org's queue, so "were they told?" has an
-- answer before delivery is even attempted. No client write policy: rows come
-- from triggers, and the drain runs as the cron owner.
drop policy if exists notification_outbox_select on public.notification_outbox;
create policy notification_outbox_select
  on public.notification_outbox for select
  using (public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

-- ── enqueue on publish ────────────────────────────────────────────────
--
-- Fires on the same status transition `audit_rota_status` (0061) already
-- watches, and deliberately does NOT fire for 'archived' — a superseded
-- rota is history, and its staff are being told about the revision that
-- replaced it, not about the one going away.
create or replace function public.enqueue_rota_published_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_ids uuid[];
  v_title    text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status <> 'published' then
    return new;
  end if;

  -- Who this rota actually affects: the people holding a shift in it. A
  -- staff_profile with no linked login cannot be notified, so nulls are
  -- dropped rather than carried through as a recipient that does not exist.
  select array_agg(distinct sp.user_id)
    into v_user_ids
    from public.shifts s
    join public.staff_profiles sp on sp.id = s.staff_profile_id
   where s.rota_id = new.id
     and sp.user_id is not null
     and s.status <> 'cancelled';

  if v_user_ids is null or array_length(v_user_ids, 1) is null then
    return new;
  end if;

  v_title := to_char(new.period_start, 'DD Mon') || ' – ' ||
             to_char(new.period_end,   'DD Mon YYYY') ||
             case when new.supersedes_rota_id is not null
                  then ' updated' else ' published' end;

  insert into public.notification_outbox (org_id, event_name, payload)
  values (
    new.org_id,
    'rota/published',
    jsonb_build_object(
      'orgId',   new.org_id,
      'userIds', to_jsonb(v_user_ids),
      'type',    'rota',
      'title',   v_title
    )
  );

  return new;
end;
$$;

drop trigger if exists rotas_enqueue_publish_notification on public.rotas;
create trigger rotas_enqueue_publish_notification
  after update on public.rotas
  for each row execute function public.enqueue_rota_published_notification();

revoke all on function public.enqueue_rota_published_notification()
  from public, anon, authenticated;

-- ── drain ─────────────────────────────────────────────────────────────
--
-- Two passes in one call, deliberately in this order:
--   1. reconcile anything posted on a previous run, so a 5xx becomes a
--      retry rather than a row that claims it was sent;
--   2. post what is pending.
--
-- MAX_ATTEMPTS is 5, matching the client outbox's own cap for the same
-- reason: it bounds an item failing for a reason we cannot classify,
-- without giving up on a transient one.
create or replace function public.dispatch_notification_outbox()
returns integer language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_url    text;
  v_anon   text;
  v_secret text;
  v_row    public.notification_outbox;
  v_resp   record;
  v_sent   integer := 0;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'send_notification_url';
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'supabase_anon_key';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notification_function_secret';

  -- Fail closed AND loudly. A missing secret must not look like an empty
  -- queue, which is exactly the class of silence this whole change exists
  -- to remove.
  if v_url is null or v_anon is null or v_secret is null then
    raise warning 'dispatch_notification_outbox: vault secrets missing (url=%, anon=%, secret=%)',
      v_url is not null, v_anon is not null, v_secret is not null;
    return 0;
  end if;

  -- 1. Reconcile. pg_net writes the response asynchronously, so anything
  --    posted more than a minute ago has either landed or timed out.
  for v_row in
    select * from public.notification_outbox
     where status = 'sent' and request_id is not null
       and dispatched_at < timezone('utc', now()) - interval '1 minute'
  loop
    select status_code, content into v_resp
      from net._http_response where id = v_row.request_id;

    if v_resp.status_code is null or v_resp.status_code >= 300 then
      update public.notification_outbox
         set status     = case when attempts >= 5 then 'abandoned' else 'pending' end,
             last_error = coalesce('HTTP ' || v_resp.status_code, 'no response recorded'),
             request_id = null
       where id = v_row.id;
    end if;
  end loop;

  -- 2. Post what is waiting. Small batch: a cron tick should finish quickly,
  --    and anything left is picked up sixty seconds later.
  for v_row in
    select * from public.notification_outbox
     where status = 'pending'
     order by created_at
     limit 20
  loop
    update public.notification_outbox
       set status        = 'sent',
           attempts      = attempts + 1,
           dispatched_at = timezone('utc', now()),
           request_id    = net.http_post(
             url     := v_url,
             body    := v_row.payload,
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || v_anon,
               'x-notification-secret', v_secret
             )
           )
     where id = v_row.id;
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.dispatch_notification_outbox() from public, anon, authenticated;

-- Every minute. The retention job (0029) runs nightly at 02:15; this one is
-- frequent and cheap, and does nothing at all when the queue is empty.
select cron.unschedule('rotaflow-notification-outbox')
  where exists (select 1 from cron.job where jobname = 'rotaflow-notification-outbox');

select cron.schedule(
  'rotaflow-notification-outbox',
  '* * * * *',
  $cron$select public.dispatch_notification_outbox();$cron$
);
