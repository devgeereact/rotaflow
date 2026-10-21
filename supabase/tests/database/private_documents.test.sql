-- =====================================================================
-- private_documents.test.sql — GAP-056, GAP-084 (0159): a staff document is
-- kept in a private bucket that only its person and their organisation's
-- managers can use, and a delete anywhere above it queues the file.
--
-- The policies on storage.objects read the object path and nothing else, so
-- the helper behind them is asserted directly for each kind of caller: the
-- organisation's owner, the person, a colleague, and another tenant's owner.
-- Then the triggers: deleting a document, a person and an organisation must
-- each leave a row in storage_deletions, in the same transaction, because
-- that queue is the only way the file is ever removed.
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
  ('d0000000-0000-4000-8000-0000000000a1'::uuid, 'doc-owner-a@example.test'),
  ('d0000000-0000-4000-8000-0000000000a2'::uuid, 'doc-staff-a@example.test'),
  ('d0000000-0000-4000-8000-0000000000a3'::uuid, 'doc-colleague-a@example.test'),
  ('d0000000-0000-4000-8000-0000000000b1'::uuid, 'doc-owner-b@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('d1000000-0000-4000-8000-00000000000a', 'Docs A', 'docs-a-private',
   'd0000000-0000-4000-8000-0000000000a1', 'enterprise'),
  ('d1000000-0000-4000-8000-00000000000b', 'Docs B', 'docs-b-private',
   'd0000000-0000-4000-8000-0000000000b1', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('d1000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a2', 'staff'),
  ('d1000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a3', 'staff')
on conflict do nothing;

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('d2000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-00000000000a',
   'd0000000-0000-4000-8000-0000000000a2', 'Sam', 'Staff'),
  ('d2000000-0000-4000-8000-0000000000a3', 'd1000000-0000-4000-8000-00000000000a',
   'd0000000-0000-4000-8000-0000000000a3', 'Cal', 'Colleague');

-- ---------- the bucket ------------------------------------------------
select is(
  (select public from storage.buckets where id = 'staff-documents'),
  false,
  'the staff-documents bucket exists and is private');

select is(
  (select file_size_limit from storage.buckets where id = 'staff-documents'),
  10485760::bigint,
  'and refuses a file over 10 MiB');

-- ---------- who may use a path ----------------------------------------
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select ok(
  public.staff_document_path_allowed(
    'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/x-passport.pdf'),
  'the organisation''s owner may use a staff member''s document');

select set_config('request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);
select ok(
  public.staff_document_path_allowed(
    'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/x-passport.pdf'),
  'the person may use their own document');

select set_config('request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-0000000000a3', 'role', 'authenticated')::text, true);
select ok(
  not public.staff_document_path_allowed(
    'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/x-passport.pdf'),
  'a colleague in the same organisation may not');

select set_config('request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select ok(
  not public.staff_document_path_allowed(
    'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/x-passport.pdf'),
  'another organisation''s owner may not');

select ok(
  not public.staff_document_path_allowed('not-a-uuid/also-not/x.pdf'),
  'a malformed path is refused, not an error');
select ok(
  not public.staff_document_path_allowed(
    'd1000000-0000-4000-8000-00000000000b/d2000000-0000-4000-8000-0000000000a2/a/b.pdf'),
  'a nested path is refused even in the caller''s own organisation');

-- ---------- the queue is server-only ----------------------------------
select throws_ok(
  $$select count(*) from public.storage_deletions$$,
  '42501', null,
  'a signed-in user cannot read the deletion queue');

select ok(
  not has_function_privilege('authenticated', 'public.dispatch_storage_deletions()', 'EXECUTE'),
  'nor run its drain');

-- ---------- a document holds one file, in its own folder --------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

select throws_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name)
    values ('d1000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-0000000000a2', 'id', 'none')$$,
  '23514', null,
  'a document with neither a link nor a file is refused');

select throws_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name, storage_path)
    values ('d1000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-0000000000a2', 'id', 'elsewhere',
            'd1000000-0000-4000-8000-00000000000b/d2000000-0000-4000-8000-0000000000a2/x.pdf')$$,
  '23514', null,
  'a document pointing into another organisation''s folder is refused');

select throws_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name, file_url, storage_path)
    values ('d1000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-0000000000a2', 'id', 'both',
            'https://example.test/a.pdf',
            'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/both.pdf')$$,
  '23514', null,
  'and so is one with both');

select lives_ok(
  $$insert into public.documents (id, org_id, staff_profile_id, type, name, storage_path)
    values ('d3000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-00000000000a',
            'd2000000-0000-4000-8000-0000000000a2', 'id', 'Passport',
            'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/p-passport.pdf')$$,
  'a manager can record a stored file in the person''s folder');

select lives_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name, file_url)
    values ('d1000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-0000000000a2', 'id', 'Legacy',
            'https://example.test/legacy.pdf')$$,
  'a legacy pasted link is still a valid row');

-- ---------- every delete above a file queues it -----------------------
delete from public.documents where id = 'd3000000-0000-4000-8000-000000000001';

reset role;

select is(
  (select count(*)::int from public.storage_deletions
    where path = 'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a2/p-passport.pdf'
      and reason = 'document_removed' and status = 'pending'),
  1,
  'deleting a document queues its file, even when a manager did it');

select is(
  (select count(*)::int from public.storage_deletions where path like '%legacy%'),
  0,
  'a legacy link queues nothing, because there is no file of ours behind it');

delete from public.staff_profiles where id = 'd2000000-0000-4000-8000-0000000000a3';

select is(
  (select count(*)::int from public.storage_deletions
    where path = 'd1000000-0000-4000-8000-00000000000a/d2000000-0000-4000-8000-0000000000a3'
      and is_folder and reason = 'person_removed'),
  1,
  'deleting a person queues their whole folder');

-- Through the real deletion function, as that organisation's owner, so the
-- cascade and the guards it has to pass are the ones production runs.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select public.delete_organisation('d1000000-0000-4000-8000-00000000000b'::uuid, 'Docs B');
reset role;

select is(
  (select count(*)::int from public.storage_deletions
    where path = 'd1000000-0000-4000-8000-00000000000b'
      and is_folder and reason = 'organisation_deleted'),
  1,
  'deleting an organisation queues its whole folder, and the row outlives it');

select * from finish();
rollback;
