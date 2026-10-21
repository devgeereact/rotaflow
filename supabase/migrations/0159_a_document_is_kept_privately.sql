-- =====================================================================
-- 0159_a_document_is_kept_privately.sql: a staff document is uploaded to
-- a private bucket, opened through a short-lived signed link, and deleted
-- when its record, its person or its organisation goes (decision D4;
-- docs/SAAS.md GAP-056, GAP-084)
--
-- ## What was wrong
--
-- `documents.file_url` (0002) held whatever address somebody pasted. The
-- file behind it lived on a host nobody here controls, so:
--
--   * `anonymize_staff_member` (0111) deleted the row and left the scan of a
--     passport or a DBS certificate reachable at its URL (GAP-056);
--   * `delete_organisation` (0063, 0138) had the same hole for every file in
--     the tenant;
--   * nothing signed an upload, because there was no upload (GAP-084).
--
-- ## What this does
--
-- 1. A private Storage bucket, `staff-documents`. Every object lives at
--    `<org_id>/<staff_profile_id>/<file>`, so the path itself says whose it
--    is, and the policies below read nothing else. Not public: the only way
--    to open a file is a signed URL, which the app asks for at the moment of
--    opening and which expires a minute later.
-- 2. `documents.storage_path`, and `file_url` becomes optional. A row holds
--    exactly one of the two: a legacy pasted link stays readable exactly as
--    it was, and a new row points at its object. Nothing is backfilled,
--    because a pasted link cannot be turned into a file we hold.
-- 3. Policies on `storage.objects` that mirror `documents_select` and
--    `documents_write` (0002): the person themselves, or an owner or manager
--    of the organisation in the first path segment. No update policy, so an
--    upload can never overwrite another file.
-- 4. A queue, `storage_deletions`, filled by triggers in the same transaction
--    as the delete that made a file orphaned:
--      * a `documents` row deleted (by the app, by erasure, or by the cascade
--        from a deleted person or organisation) queues its object;
--      * a `staff_profiles` row deleted queues that person's folder;
--      * an `organisations` row deleted queues the whole tenant's folder.
--    Folders are queued as well as files so an object whose row was never
--    written (an upload interrupted before its insert) still goes.
--
-- ## Why a queue and not a delete here
--
-- Postgres cannot remove a Storage object in a supported way. Deleting the
-- `storage.objects` row leaves the bytes in the object store, and the hosted
-- platform refuses direct deletes from that table outright; only the Storage
-- API removes the file. So the database records what must go, durably and in
-- the same transaction as the erasure, and the `purge-storage` Edge Function
-- does the removal with the service role.
--
-- It is drained the way `notification_outbox` is (0069): a pg_cron job posts
-- each pending row to the function with the shared secret that 0091 keeps in
-- `vault`, then reconciles the response a tick later. The function's URL is
-- derived from `send_notification_url`, which already names this project's
-- functions host, so there is no new secret and nothing for anyone to set.
--
-- Until `purge-storage` is deployed (functions never deploy on merge), the
-- queue simply holds its rows: nothing is lost, and the first drain after the
-- deploy removes everything that was owed.
-- =====================================================================

-- ── 1. The bucket ─────────────────────────────────────────────────────
--
-- 10 MiB and five MIME types: a scan or a photograph of a certificate, not an
-- arbitrary file store. The limits are enforced by Storage itself, so a client
-- that skips the browser check is still refused.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-documents',
  'staff-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. A document holds a link or an object, never both ───────────────
alter table public.documents add column if not exists storage_path text;
alter table public.documents alter column file_url drop not null;

alter table public.documents
  drop constraint if exists documents_has_one_file;
alter table public.documents
  add constraint documents_has_one_file
  check ((file_url is null) <> (storage_path is null)) not valid;

-- The path must sit in this row's own organisation and person folder. Without
-- this, a manager could record a row in their organisation that points at an
-- object path naming another one, and the app would ask Storage to sign it.
-- Storage would refuse (the policies read the path), but the row should not
-- exist in the first place.
alter table public.documents
  drop constraint if exists documents_storage_path_is_its_own;
alter table public.documents
  add constraint documents_storage_path_is_its_own
  check (
    storage_path is null
    or (
      split_part(storage_path, '/', 1) = org_id::text
      and split_part(storage_path, '/', 2) = staff_profile_id::text
      and split_part(storage_path, '/', 3) <> ''
      and split_part(storage_path, '/', 4) = ''
    )
  ) not valid;

-- Every existing row has a link and no path, so both validate.
alter table public.documents validate constraint documents_has_one_file;
alter table public.documents validate constraint documents_storage_path_is_its_own;

create unique index if not exists documents_storage_path_key
  on public.documents (storage_path) where storage_path is not null;

comment on column public.documents.storage_path is
  'Object path in the private staff-documents bucket: <org_id>/<staff_profile_id>/<file>. Opened through a signed URL only. Null on a legacy row, which has file_url instead (0159).';
comment on column public.documents.file_url is
  'A pasted link, from before documents were stored privately. Read-only in practice: the app no longer writes one (0159). Exactly one of file_url and storage_path is set.';

-- ── 3. Who may read, upload and remove an object ──────────────────────
--
-- One helper, so the three policies cannot drift apart. It reads the path and
-- nothing else, and refuses anything that is not two UUID folders and a file
-- name before it casts, so a malformed name is a plain `false` rather than an
-- error. SECURITY INVOKER: the two helpers it calls are already definers.
create or replace function public.staff_document_path_allowed(p_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_name is null
      or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then false
    -- coalesce: a caller with no staff record in that organisation gets a
    -- null from my_staff_profile_id, and `false or null` is null. A policy
    -- reads null as no, but a helper that answers "maybe" is a trap for the
    -- next caller that is not a policy.
    else coalesce(
      public.has_org_role(split_part(p_name, '/', 1)::uuid, array['owner', 'manager'])
      or split_part(p_name, '/', 2)::uuid
         = public.my_staff_profile_id(split_part(p_name, '/', 1)::uuid),
      false)
  end;
$$;

comment on function public.staff_document_path_allowed(text) is
  'May the caller use this staff-documents object? True for the person in the second path segment, or an owner or manager of the organisation in the first. Mirrors documents_select and documents_write (0002). Read by the storage.objects policies (0159).';

revoke all on function public.staff_document_path_allowed(text) from public, anon;
grant execute on function public.staff_document_path_allowed(text) to authenticated;

drop policy if exists staff_documents_select on storage.objects;
create policy staff_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-documents' and public.staff_document_path_allowed(name));

drop policy if exists staff_documents_insert on storage.objects;
create policy staff_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-documents' and public.staff_document_path_allowed(name));

drop policy if exists staff_documents_delete on storage.objects;
create policy staff_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-documents' and public.staff_document_path_allowed(name));

-- ── 4. What must be removed from Storage ──────────────────────────────
--
-- `org_id` has no foreign key on purpose: the commonest reason for a row here
-- is that the organisation has just been deleted, and the row has to outlive
-- it until the file is gone.
create table if not exists public.storage_deletions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  bucket        text not null default 'staff-documents',
  path          text not null,
  is_folder     boolean not null default false,
  reason        text not null
                check (reason in ('document_removed', 'person_removed', 'organisation_deleted')),
  status        text not null default 'pending'
                check (status in ('pending', 'sent', 'done', 'abandoned')),
  attempts      integer not null default 0,
  request_id    bigint,
  last_error    text,
  created_at    timestamptz not null default timezone('utc', now()),
  dispatched_at timestamptz,
  completed_at  timestamptz
);

create index if not exists storage_deletions_pending_idx
  on public.storage_deletions (created_at) where status in ('pending', 'sent');

comment on table public.storage_deletions is
  'Files the database knows must leave Storage: written by triggers in the same transaction as the delete that orphaned them, drained by dispatch_storage_deletions() to the purge-storage Edge Function (0159). Service role only.';

-- Server-only. RLS on with no policy, and no grant to anyone a browser can be.
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from public, anon, authenticated;
grant select, insert, update, delete on public.storage_deletions to service_role;

-- ── 5. The triggers that fill it ──────────────────────────────────────
--
-- SECURITY DEFINER because the caller (a manager deleting a record, or the
-- erasure function) has no grant on the queue, and must not have one.
create or replace function public.queue_document_file_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.storage_path is not null then
      insert into public.storage_deletions (org_id, path, reason)
      values (old.org_id, old.storage_path, 'document_removed');
    end if;
    return old;
  end if;

  -- An update that changes or clears the path orphans the previous object.
  if old.storage_path is not null and old.storage_path is distinct from new.storage_path then
    insert into public.storage_deletions (org_id, path, reason)
    values (old.org_id, old.storage_path, 'document_removed');
  end if;
  return new;
end;
$$;

revoke all on function public.queue_document_file_deletion() from public, anon, authenticated;

drop trigger if exists documents_queue_file_deletion on public.documents;
create trigger documents_queue_file_deletion
  after delete or update of storage_path on public.documents
  for each row execute function public.queue_document_file_deletion();

create or replace function public.queue_person_folder_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_deletions (org_id, path, is_folder, reason)
  values (old.org_id, old.org_id::text || '/' || old.id::text, true, 'person_removed');
  return old;
end;
$$;

revoke all on function public.queue_person_folder_deletion() from public, anon, authenticated;

drop trigger if exists staff_profiles_queue_folder_deletion on public.staff_profiles;
create trigger staff_profiles_queue_folder_deletion
  after delete on public.staff_profiles
  for each row execute function public.queue_person_folder_deletion();

create or replace function public.queue_organisation_folder_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_deletions (org_id, path, is_folder, reason)
  values (old.id, old.id::text, true, 'organisation_deleted');
  return old;
end;
$$;

revoke all on function public.queue_organisation_folder_deletion() from public, anon, authenticated;

drop trigger if exists organisations_queue_folder_deletion on public.organisations;
create trigger organisations_queue_folder_deletion
  after delete on public.organisations
  for each row execute function public.queue_organisation_folder_deletion();

-- ── 6. The drain ──────────────────────────────────────────────────────
--
-- The same shape as dispatch_notification_outbox (0069): reconcile what was
-- posted a minute or more ago, then post what is waiting. `purge-storage`
-- answers 2xx only when the object or folder is gone, and a missing object
-- counts as gone, so a retry after a lost response is harmless.
create or replace function public.dispatch_storage_deletions()
returns integer
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_notify_url text;
  v_url        text;
  v_anon       text;
  v_secret     text;
  v_row        public.storage_deletions;
  v_resp       record;
  v_sent       integer := 0;
begin
  select decrypted_secret into v_notify_url
    from vault.decrypted_secrets where name = 'send_notification_url';
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'supabase_anon_key';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notification_function_secret';

  if v_notify_url is null or v_anon is null or v_secret is null then
    raise warning 'dispatch_storage_deletions: vault secrets missing (url=%, anon=%, secret=%)',
      v_notify_url is not null, v_anon is not null, v_secret is not null;
    return 0;
  end if;

  -- Same host, sibling function. `send_notification_url` ends in
  -- `/functions/v1/send-notification`; anything else is a configuration this
  -- drain does not understand, and it says so rather than guessing.
  if v_notify_url !~ '/send-notification/?$' then
    raise warning 'dispatch_storage_deletions: send_notification_url does not end in /send-notification';
    return 0;
  end if;
  v_url := regexp_replace(v_notify_url, '/send-notification/?$', '/purge-storage');

  -- 1. Reconcile.
  for v_row in
    select * from public.storage_deletions
     where status = 'sent' and request_id is not null
       and dispatched_at < timezone('utc', now()) - interval '1 minute'
  loop
    select status_code into v_resp
      from net._http_response where id = v_row.request_id;

    if v_resp.status_code between 200 and 299 then
      update public.storage_deletions
         set status = 'done', completed_at = timezone('utc', now()), request_id = null
       where id = v_row.id;
    else
      update public.storage_deletions
         set status     = case when attempts >= 5 then 'abandoned' else 'pending' end,
             last_error = coalesce('HTTP ' || v_resp.status_code, 'no response recorded'),
             request_id = null
       where id = v_row.id;
    end if;
  end loop;

  -- 2. Post what is waiting.
  for v_row in
    select * from public.storage_deletions
     where status = 'pending'
     order by created_at
     limit 20
  loop
    update public.storage_deletions
       set status        = 'sent',
           attempts      = attempts + 1,
           dispatched_at = timezone('utc', now()),
           request_id    = net.http_post(
             url     := v_url,
             body    := jsonb_build_object(
               'bucket', v_row.bucket,
               'path', v_row.path,
               'isFolder', v_row.is_folder
             ),
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || v_anon,
               'x-notification-secret', v_secret
             )
           )
     where id = v_row.id;
    v_sent := v_sent + 1;
  end loop;

  -- A finished row is the evidence that an erasure reached the file. Thirty
  -- days is long enough to answer "did it?" and short enough not to become a
  -- second register of who was erased.
  delete from public.storage_deletions
   where status = 'done' and completed_at < timezone('utc', now()) - interval '30 days';

  return v_sent;
end;
$$;

comment on function public.dispatch_storage_deletions() is
  'Posts pending storage_deletions rows to the purge-storage Edge Function and reconciles earlier posts. Run by pg_cron every five minutes (0159).';

revoke all on function public.dispatch_storage_deletions() from public, anon, authenticated;

select cron.unschedule('rotaflow-storage-deletions')
  where exists (select 1 from cron.job where jobname = 'rotaflow-storage-deletions');

select cron.schedule(
  'rotaflow-storage-deletions',
  '*/5 * * * *',
  $cron$select public.dispatch_storage_deletions();$cron$
);
