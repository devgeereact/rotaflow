-- =====================================================================
-- 0162_a_photo_and_a_login_go_with_an_erasure.sql: a staff photo is an
-- upload to a private bucket that erasure removes, and closing an erasure
-- case removes the person's login (docs/SAAS.md GAP-056, GAP-057)
--
-- ## What was wrong
--
-- Two halves of an erasure were still missing after 0159 and 0160.
--
-- 1. `staff_profiles.photo_url` (0002) is a pasted link. `anonymize_staff_member`
--    (0111) nulls the column and leaves the picture reachable wherever it was
--    hosted, the same hole 0159 closed for documents.
-- 2. `set_gdpr_request_status` (0020) closes an erasure case with an outcome
--    note and never touches `auth.users`, so the person can still sign in to an
--    account whose data the organisation has been asked to erase (GAP-057).
--
-- ## What this does
--
-- Photos:
--
--   * a private bucket, `staff-photos`, laid out like `staff-documents`:
--     `<org_id>/<staff_profile_id>/<file>`. A sibling bucket rather than the
--     same one because the readers differ: a document is for the person and
--     their managers, a photo is how every colleague recognises them on the
--     rota, so any member of the organisation may read it. Writes stay with
--     the person and the organisation's owners and managers;
--   * `staff_profiles.photo_path`, granted and shown in `staff_profiles_visible`
--     like `photo_url`. A row holds a pasted link or a path, never both;
--   * replacing or clearing a photo queues the old object in
--     `storage_deletions` (0159), and deleting a person or an organisation now
--     queues their `staff-photos` folder beside their `staff-documents` one;
--   * `anonymize_staff_member` clears `photo_path` and queues both of the
--     person's folders, which also catches an upload whose record was never
--     saved (the gap 0159 recorded).
--
-- Logins:
--
--   * closing an erasure case as `completed` queues the subject's account in
--     `account_deletions` when an account with that address exists. The new
--     `delete-account` Edge Function removes it through the Auth Admin API,
--     drained by pg_cron exactly as `storage_deletions` is. Postgres could
--     delete the `auth.users` row itself, but that table belongs to the Auth
--     service, and the Admin API is the supported way to remove a user;
--   * two cases refuse to close, with a sentence, rather than queue a deletion
--     that would fail later: the subject is the last owner of an organisation
--     (`memberships_keep_one_owner`, 0047, would refuse the cascade), or holds
--     a platform role. Both need a person's decision first, not a retry.
--
-- The deletion cascades the way 0066 made possible: profiles, memberships and
-- platform grants go, `staff_profiles.user_id` and every `created_by` become
-- null, and `audit_logs` keeps its rows with the actor link severed, which
-- `audit_logs_immutable` (0066) allows. No guard is disabled or widened here.
--
-- Until `purge-storage` and `delete-account` are deployed (functions never
-- deploy on merge), both queues hold their rows and nothing is lost.
-- =====================================================================

-- ── 1. The bucket ─────────────────────────────────────────────────────
--
-- 2 MiB and three image types: a head-and-shoulders picture, not a document.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-photos',
  'staff-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. A photo is a link or an object, never both ─────────────────────
alter table public.staff_profiles add column if not exists photo_path text;

alter table public.staff_profiles
  drop constraint if exists staff_profiles_one_photo;
alter table public.staff_profiles
  add constraint staff_profiles_one_photo
  check (photo_url is null or photo_path is null) not valid;

-- The path must sit in this row's own organisation and person folder, for the
-- reason 0159 gives for documents: the row should not be able to point at
-- somebody else's object even though Storage would refuse to sign it.
alter table public.staff_profiles
  drop constraint if exists staff_profiles_photo_path_is_its_own;
alter table public.staff_profiles
  add constraint staff_profiles_photo_path_is_its_own
  check (
    photo_path is null
    or (
      split_part(photo_path, '/', 1) = org_id::text
      and split_part(photo_path, '/', 2) = id::text
      and split_part(photo_path, '/', 3) <> ''
      and split_part(photo_path, '/', 4) = ''
    )
  ) not valid;

-- Every existing row has no path, so both validate.
alter table public.staff_profiles validate constraint staff_profiles_one_photo;
alter table public.staff_profiles validate constraint staff_profiles_photo_path_is_its_own;

comment on column public.staff_profiles.photo_path is
  'Object path in the private staff-photos bucket: <org_id>/<staff_profile_id>/<file>. Shown through a signed URL. Null when the row has a legacy photo_url or no photo (0162).';

-- A column grant does not cover a column added later (0150), and
-- `staff_profile_column_visibility.test.sql` fails until the new column is
-- either granted or masked. A photo is shown to colleagues, so it is granted.
grant select (photo_path) on public.staff_profiles to authenticated;

-- 0150's view, unchanged, with the new column appended. CREATE OR REPLACE VIEW
-- can only add columns at the end, which is where it goes.
create or replace view public.staff_profiles_visible as
select
  sp.id,
  sp.org_id,
  sp.user_id,
  sp.first_name,
  sp.last_name,
  sp.job_title,
  sp.job_title_id,
  sp.department_id,
  sp.contract_type,
  sp.weekly_hours,
  sp.skills,
  sp.photo_url,
  sp.active,
  sp.created_at,
  sp.updated_at,
  case when priv.allowed then sp.payroll_id end        as payroll_id,
  case when priv.allowed then sp.start_date end        as start_date,
  case when priv.allowed then sp.phone end             as phone,
  case when priv.allowed then sp.email end             as email,
  case when priv.allowed then sp.holiday_allowance end as holiday_allowance,
  sp.photo_path
from public.staff_profiles sp
cross join lateral (
  select
    has_org_role(sp.org_id, array['owner', 'manager'])
    or sp.id = my_staff_profile_id(sp.org_id) as allowed
) priv
-- LOAD-BEARING, as in 0150: the view is definer-rights.
where (select is_org_member(sp.org_id));

-- ── 3. Who may read, upload and remove a photo ────────────────────────
--
-- Reading: any member of the organisation in the first path segment, because
-- colleagues see each other's pictures on the rota, the team list and swaps.
-- Writing and removing: the same rule as a document (0159), the person or an
-- owner or manager, so `staff_document_path_allowed` is reused for those.
create or replace function public.staff_photo_path_readable(p_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_name is null
      or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      then false
    else coalesce(public.is_org_member(split_part(p_name, '/', 1)::uuid), false)
  end;
$$;

comment on function public.staff_photo_path_readable(text) is
  'May the caller see this staff-photos object? True for any member of the organisation in the first path segment. Read by the storage.objects select policy (0162).';

revoke all on function public.staff_photo_path_readable(text) from public, anon;
grant execute on function public.staff_photo_path_readable(text) to authenticated;

drop policy if exists staff_photos_select on storage.objects;
create policy staff_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-photos' and public.staff_photo_path_readable(name));

drop policy if exists staff_photos_insert on storage.objects;
create policy staff_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-photos' and public.staff_document_path_allowed(name));

drop policy if exists staff_photos_delete on storage.objects;
create policy staff_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-photos' and public.staff_document_path_allowed(name));

-- ── 4. The queue learns about photos ──────────────────────────────────
alter table public.storage_deletions
  drop constraint if exists storage_deletions_reason_check;
alter table public.storage_deletions
  add constraint storage_deletions_reason_check
  check (reason in ('document_removed', 'photo_removed', 'person_removed',
                    'person_erased', 'organisation_deleted'));

create or replace function public.queue_photo_file_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.photo_path is not null and old.photo_path is distinct from new.photo_path then
    insert into public.storage_deletions (org_id, bucket, path, reason)
    values (old.org_id, 'staff-photos', old.photo_path, 'photo_removed');
  end if;
  return new;
end;
$$;

revoke all on function public.queue_photo_file_deletion() from public, anon, authenticated;

drop trigger if exists staff_profiles_queue_photo_deletion on public.staff_profiles;
create trigger staff_profiles_queue_photo_deletion
  after update of photo_path on public.staff_profiles
  for each row execute function public.queue_photo_file_deletion();

-- 0159's two folder triggers, now naming both buckets.
create or replace function public.queue_person_folder_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_deletions (org_id, bucket, path, is_folder, reason)
  select old.org_id, b.bucket, old.org_id::text || '/' || old.id::text, true, 'person_removed'
    from (values ('staff-documents'), ('staff-photos')) as b(bucket);
  return old;
end;
$$;

create or replace function public.queue_organisation_folder_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_deletions (org_id, bucket, path, is_folder, reason)
  select old.id, b.bucket, old.id::text, true, 'organisation_deleted'
    from (values ('staff-documents'), ('staff-photos')) as b(bucket);
  return old;
end;
$$;

-- ── 5. Erasure clears the photo and sweeps both folders ───────────────
--
-- 0111's function, unchanged except for `photo_path = null` and the folder
-- sweep. The pgTAP gate in erasure_coverage.test.sql reads this function's
-- text, so the new column has to be cleared here or the build fails.
create or replace function public.anonymize_staff_member(
  p_org uuid,
  p_staff_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only the organisation owner can erase a staff member''s data'
      using errcode = '42501';
  end if;

  select exists(
    select 1 from public.staff_profiles
    where id = p_staff_profile_id and org_id = p_org
  ) into v_exists;
  if not v_exists then
    raise exception 'Staff member not found in this organisation' using errcode = 'P0002';
  end if;

  delete from public.emergency_contacts where staff_profile_id = p_staff_profile_id;
  delete from public.documents where staff_profile_id = p_staff_profile_id;

  update public.calendar_feed_tokens
     set revoked_at = timezone('utc', now())
   where staff_profile_id = p_staff_profile_id
     and revoked_at is null;

  perform set_config('rotaflow.allow_payroll_id_change', 'true', true);

  update public.staff_profiles
     set first_name = 'Deleted',
         last_name = 'Member',
         email = null,
         phone = null,
         photo_url = null,
         photo_path = null,
         payroll_id = null,
         user_id = null,
         active = false
   where id = p_staff_profile_id;

  -- New in 0162. The row survives an erasure, so the person-folder trigger
  -- never fires; queue both folders here. That removes the photo and the
  -- documents already queued above, and anything uploaded whose record was
  -- never written. The SECURITY DEFINER above is what lets this insert reach
  -- a table the owner has no grant on.
  insert into public.storage_deletions (org_id, bucket, path, is_folder, reason)
  select p_org, b.bucket, p_org::text || '/' || p_staff_profile_id::text, true, 'person_erased'
    from (values ('staff-documents'), ('staff-photos')) as b(bucket);

  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'gdpr_anonymize', 'staff_profile', p_staff_profile_id, '{}'::jsonb);
end;
$$;

revoke all on function public.anonymize_staff_member(uuid, uuid) from public, anon;
grant execute on function public.anonymize_staff_member(uuid, uuid) to authenticated;

-- ── 6. Logins owed to an erasure ──────────────────────────────────────
--
-- `user_id` has no foreign key on purpose: the row must outlive the account it
-- names, as evidence the deletion happened.
create table if not exists public.account_deletions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  gdpr_request_id uuid references public.gdpr_requests(id) on delete set null,
  status          text not null default 'pending'
                  check (status in ('pending', 'sent', 'done', 'abandoned')),
  attempts        integer not null default 0,
  request_id      bigint,
  last_error      text,
  created_at      timestamptz not null default timezone('utc', now()),
  dispatched_at   timestamptz,
  completed_at    timestamptz
);

create index if not exists account_deletions_pending_idx
  on public.account_deletions (created_at) where status in ('pending', 'sent');

comment on table public.account_deletions is
  'Logins owed to a completed erasure case: written by set_gdpr_request_status, drained by dispatch_account_deletions() to the delete-account Edge Function (0162). Service role only.';

alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;
grant select, insert, update, delete on public.account_deletions to service_role;

-- 0020's function, with the erasure branch added. Everything else is as it was.
create or replace function public.set_gdpr_request_status(
  p_request uuid,
  p_status  text,
  p_note    text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r      public.gdpr_requests;
  v_user uuid;
  v_queued boolean := false;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform staff can update a data subject request'
      using errcode = '42501';
  end if;

  select * into r from public.gdpr_requests where id = p_request;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  if p_status in ('completed','refused')
     and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Closing a request needs an outcome note saying what was done'
      using errcode = '23514';
  end if;

  -- New in 0162. A completed erasure removes the subject's login, if they have
  -- one. Checked before the update so a refusal leaves the case open.
  if r.kind = 'erasure' and p_status = 'completed' then
    select u.id into v_user
      from auth.users u
     where lower(u.email) = r.subject_email
     limit 1;

    if v_user is not null then
      if exists (
        select 1 from public.platform_admins pa
         where pa.user_id = v_user and pa.revoked_at is null
      ) then
        raise exception 'This person holds a platform role. Revoke it before closing the erasure, so the account can be removed'
          using errcode = '42501';
      end if;

      if exists (
        select 1 from public.memberships m
         where m.user_id = v_user and m.role = 'owner'
           and not exists (
             select 1 from public.memberships o
              where o.org_id = m.org_id and o.role = 'owner' and o.id <> m.id)
      ) then
        raise exception 'This person is the only owner of an organisation. Transfer ownership or delete the organisation before closing the erasure'
          using errcode = '23514';
      end if;

      insert into public.account_deletions (user_id, gdpr_request_id)
      values (v_user, p_request);
      v_queued := true;
    end if;
  end if;

  update public.gdpr_requests
     set status       = p_status,
         outcome_note = case when p_status in ('completed','refused')
                             then btrim(p_note) else outcome_note end,
         closed_at    = case when p_status in ('completed','refused')
                             then timezone('utc', now()) else null end
   where id = p_request;

  perform public.audit_write(
    r.org_id, 'gdpr.request_' || p_status, 'gdpr_request', p_request,
    jsonb_build_object('from', r.status, 'to', p_status, 'account_deletion_queued', v_queued),
    case when p_status = 'refused' then 'warning' else 'notice' end,
    'both');
end;
$$;

revoke all on function public.set_gdpr_request_status(uuid, text, text) from public, anon;
grant execute on function public.set_gdpr_request_status(uuid, text, text) to authenticated;

-- ── 7. The drain ──────────────────────────────────────────────────────
--
-- The shape of dispatch_storage_deletions (0159). `delete-account` answers 2xx
-- only when the user is gone, and a user already gone counts as gone.
create or replace function public.dispatch_account_deletions()
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
  v_row        public.account_deletions;
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
    raise warning 'dispatch_account_deletions: vault secrets missing (url=%, anon=%, secret=%)',
      v_notify_url is not null, v_anon is not null, v_secret is not null;
    return 0;
  end if;

  if v_notify_url !~ '/send-notification/?$' then
    raise warning 'dispatch_account_deletions: send_notification_url does not end in /send-notification';
    return 0;
  end if;
  v_url := regexp_replace(v_notify_url, '/send-notification/?$', '/delete-account');

  -- 1. Reconcile.
  for v_row in
    select * from public.account_deletions
     where status = 'sent' and request_id is not null
       and dispatched_at < timezone('utc', now()) - interval '1 minute'
  loop
    select status_code into v_resp
      from net._http_response where id = v_row.request_id;

    if v_resp.status_code between 200 and 299 then
      update public.account_deletions
         set status = 'done', completed_at = timezone('utc', now()), request_id = null
       where id = v_row.id;
    else
      update public.account_deletions
         set status     = case when attempts >= 5 then 'abandoned' else 'pending' end,
             last_error = coalesce('HTTP ' || v_resp.status_code, 'no response recorded'),
             request_id = null
       where id = v_row.id;
    end if;
  end loop;

  -- 2. Post what is waiting.
  for v_row in
    select * from public.account_deletions
     where status = 'pending'
     order by created_at
     limit 20
  loop
    update public.account_deletions
       set status        = 'sent',
           attempts      = attempts + 1,
           dispatched_at = timezone('utc', now()),
           request_id    = net.http_post(
             url     := v_url,
             body    := jsonb_build_object('userId', v_row.user_id),
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || v_anon,
               'x-notification-secret', v_secret
             )
           )
     where id = v_row.id;
    v_sent := v_sent + 1;
  end loop;

  -- Kept for a year, not thirty days: this is the evidence an erasure case
  -- points at, and it holds an id, not a name or an address.
  delete from public.account_deletions
   where status = 'done' and completed_at < timezone('utc', now()) - interval '1 year';

  return v_sent;
end;
$$;

comment on function public.dispatch_account_deletions() is
  'Posts pending account_deletions rows to the delete-account Edge Function and reconciles earlier posts. Run by pg_cron every five minutes (0162).';

revoke all on function public.dispatch_account_deletions() from public, anon, authenticated;

select cron.unschedule('rotaflow-account-deletions')
  where exists (select 1 from cron.job where jobname = 'rotaflow-account-deletions');

select cron.schedule(
  'rotaflow-account-deletions',
  '*/5 * * * *',
  $cron$select public.dispatch_account_deletions();$cron$
);
