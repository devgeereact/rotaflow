-- =====================================================================
-- erasure_tail.test.sql: a staff photo and a login go with an erasure (0162)
--
-- Two halves of an erasure that 0159 and 0160 left open:
--
--   * a photo is a private upload. Its path sits in its own folder, any
--     colleague may see it, replacing it queues the old file, and erasing or
--     deleting the person queues their photo folder beside their documents;
--   * closing an erasure case as completed queues the person's login for the
--     delete-account function, and refuses to close when the deletion would
--     fail later (the last owner of an organisation, or a platform role).
--
-- The last assertion deletes the queued login the way the Auth Admin API does
-- (a delete from auth.users) and checks the cascade completes: the guards 0066
-- loosened for this must still let it through, and the audit row must stay.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('e0000000-0000-4000-8000-0000000000a1'::uuid, 'tail-owner-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000a2'::uuid, 'tail-leaver@example.test'),
  ('e0000000-0000-4000-8000-0000000000a3'::uuid, 'tail-colleague@example.test'),
  ('e0000000-0000-4000-8000-0000000000b1'::uuid, 'tail-owner-b@example.test'),
  ('e0000000-0000-4000-8000-0000000000c1'::uuid, 'tail-platform@example.test'),
  ('e0000000-0000-4000-8000-0000000000c2'::uuid, 'tail-support@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('e1000000-0000-4000-8000-00000000000a', 'Tail A', 'tail-a-erasure',
   'e0000000-0000-4000-8000-0000000000a1', 'enterprise'),
  ('e1000000-0000-4000-8000-00000000000b', 'Tail B', 'tail-b-erasure',
   'e0000000-0000-4000-8000-0000000000b1', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('e1000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-0000000000a2', 'staff'),
  ('e1000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-0000000000a3', 'staff')
on conflict do nothing;

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('e2000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-00000000000a',
   'e0000000-0000-4000-8000-0000000000a2', 'Lee', 'Leaver'),
  ('e2000000-0000-4000-8000-0000000000a3', 'e1000000-0000-4000-8000-00000000000a',
   'e0000000-0000-4000-8000-0000000000a3', 'Cal', 'Colleague');

insert into public.platform_admins (user_id, role) values
  ('e0000000-0000-4000-8000-0000000000c1', 'platform_admin'),
  ('e0000000-0000-4000-8000-0000000000c2', 'platform_support');

-- ── the bucket and the column ──────────────────────────────────────────

select is(
  (select public from storage.buckets where id = 'staff-photos'),
  false,
  'the staff-photos bucket exists and is private');

select throws_ok(
  $$update public.staff_profiles
       set photo_path = 'e1000000-0000-4000-8000-00000000000b/e2000000-0000-4000-8000-0000000000a2/x.jpg'
     where id = 'e2000000-0000-4000-8000-0000000000a2'$$,
  '23514', null,
  'a photo path in another organisation''s folder is refused');

select throws_ok(
  $$update public.staff_profiles
       set photo_url = 'https://example.test/me.jpg',
           photo_path = 'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/x.jpg'
     where id = 'e2000000-0000-4000-8000-0000000000a2'$$,
  '23514', null,
  'a row holds a pasted link or a stored photo, never both');

update public.staff_profiles
   set photo_path = 'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/first.jpg'
 where id = 'e2000000-0000-4000-8000-0000000000a2';
update public.staff_profiles
   set photo_path = 'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/second.jpg'
 where id = 'e2000000-0000-4000-8000-0000000000a2';

select is(
  (select count(*)::int from public.storage_deletions
    where bucket = 'staff-photos' and reason = 'photo_removed' and not is_folder
      and path = 'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/first.jpg'),
  1,
  'replacing a photo queues the old file');

-- ── who may see and change a photo ─────────────────────────────────────

set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-0000000000a3', 'role', 'authenticated')::text, true);
select ok(
  public.staff_photo_path_readable(
    'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/second.jpg'),
  'a colleague in the same organisation may see the photo');
select ok(
  not public.staff_document_path_allowed(
    'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/second.jpg'),
  'but may not replace or remove it');

select set_config('request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select ok(
  not public.staff_photo_path_readable(
    'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2/second.jpg'),
  'another organisation''s owner may not see it');
select is(
  public.staff_photo_path_readable('not/a/real/path'),
  false,
  'a malformed path is a plain no, not an error');

select set_config('request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select count(*) from public.account_deletions$$,
  '42501', null,
  'a signed-in user cannot read the login deletion queue');

-- ── closing an erasure case ────────────────────────────────────────────

reset role;
insert into public.gdpr_requests (id, subject_email, kind, received_on, due_on) values
  ('e3000000-0000-4000-8000-000000000001', 'tail-leaver@example.test', 'erasure',
   current_date, current_date + 30),
  ('e3000000-0000-4000-8000-000000000002', 'tail-owner-b@example.test', 'erasure',
   current_date, current_date + 30),
  ('e3000000-0000-4000-8000-000000000003', 'tail-support@example.test', 'erasure',
   current_date, current_date + 30),
  ('e3000000-0000-4000-8000-000000000004', 'tail-colleague@example.test', 'erasure',
   current_date, current_date + 30),
  ('e3000000-0000-4000-8000-000000000005', 'nobody-here@example.test', 'erasure',
   current_date, current_date + 30);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-0000000000c1', 'role', 'authenticated')::text, true);

select throws_ok(
  $$select public.set_gdpr_request_status(
      'e3000000-0000-4000-8000-000000000002', 'completed', 'Record anonymised.')$$,
  '23514', null,
  'an erasure cannot close while the person is the only owner of an organisation');

select throws_ok(
  $$select public.set_gdpr_request_status(
      'e3000000-0000-4000-8000-000000000003', 'completed', 'Record anonymised.')$$,
  '42501', null,
  'nor while the person holds a platform role');

select public.set_gdpr_request_status(
  'e3000000-0000-4000-8000-000000000004', 'refused', 'Retention obligation applies.');
select public.set_gdpr_request_status(
  'e3000000-0000-4000-8000-000000000005', 'completed', 'No account and no record found.');
select public.set_gdpr_request_status(
  'e3000000-0000-4000-8000-000000000001', 'completed', 'Record anonymised.');

reset role;

select is(
  (select count(*)::int from public.account_deletions
    where user_id = 'e0000000-0000-4000-8000-0000000000a2'
      and gdpr_request_id = 'e3000000-0000-4000-8000-000000000001'
      and status = 'pending'),
  1,
  'a completed erasure queues the person''s login');

select is(
  (select count(*)::int from public.account_deletions
    where user_id = 'e0000000-0000-4000-8000-0000000000a3'),
  0,
  'a refused erasure queues nothing');

select is(
  (select count(*)::int from public.account_deletions),
  1,
  'and an erasure for an address with no account queues nothing either');

select is(
  (select status from public.gdpr_requests where id = 'e3000000-0000-4000-8000-000000000002'),
  'received',
  'a refusal to close leaves the case open');

-- ── erasure clears the photo and sweeps both folders ───────────────────

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select public.anonymize_staff_member(
  'e1000000-0000-4000-8000-00000000000a', 'e2000000-0000-4000-8000-0000000000a2');
reset role;

select is(
  (select photo_path from public.staff_profiles where id = 'e2000000-0000-4000-8000-0000000000a2'),
  null,
  'erasure clears the stored photo');

select is(
  (select array_agg(bucket order by bucket) from public.storage_deletions
    where is_folder and reason = 'person_erased'
      and path = 'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a2'),
  array['staff-documents', 'staff-photos'],
  'and queues the person''s document and photo folders, so an unsaved upload goes too');

delete from public.staff_profiles where id = 'e2000000-0000-4000-8000-0000000000a3';

select is(
  (select array_agg(bucket order by bucket) from public.storage_deletions
    where is_folder and reason = 'person_removed'
      and path = 'e1000000-0000-4000-8000-00000000000a/e2000000-0000-4000-8000-0000000000a3'),
  array['staff-documents', 'staff-photos'],
  'deleting a person queues both of their folders');

-- ── the login can actually go ──────────────────────────────────────────
--
-- What the Auth Admin API does. The cascade passes through memberships
-- (memberships_keep_one_owner: not an owner, so allowed) and the audit row's
-- actor link (audit_logs_immutable: a value going null, allowed since 0066).
delete from auth.users where id = 'e0000000-0000-4000-8000-0000000000a2';

select is(
  (select count(*)::int from public.audit_logs
    where entity_type = 'staff_profile'
      and entity_id = 'e2000000-0000-4000-8000-0000000000a2'
      and action = 'gdpr_anonymize'),
  1,
  'the login is deleted, and the audit record of the erasure survives it');

select * from finish();
rollback;
