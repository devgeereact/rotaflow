-- =====================================================================
-- medical_notes_purged.test.sql: emergency contacts hold no medical notes
-- (0164, GAP-058)
--
-- The column is gone, the rest of the table still works for an owner under
-- RLS, a write that names the old column is refused, and erasure still
-- removes a person's contacts.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(6);

select hasnt_column(
  'public', 'emergency_contacts', 'medical_notes',
  'emergency_contacts no longer has a medical_notes column');

select columns_are(
  'public', 'emergency_contacts',
  array['id', 'org_id', 'staff_profile_id', 'name', 'relationship', 'phone',
        'secondary_phone', 'created_at', 'updated_at'],
  'emergency_contacts keeps exactly the columns the app names');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', 'e6400000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'mn-owner@example.test', 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('e6410000-0000-4000-8000-00000000000a', 'Purge Org', 'purge-org-0164',
   'e6400000-0000-4000-8000-0000000000a1', 'enterprise');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('e6420000-0000-4000-8000-0000000000b1', 'e6410000-0000-4000-8000-00000000000a',
   'Ada', 'Contact');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'e6400000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

select lives_ok(
  $$insert into public.emergency_contacts (org_id, staff_profile_id, name, relationship, phone)
    values ('e6410000-0000-4000-8000-00000000000a',
            'e6420000-0000-4000-8000-0000000000b1', 'Grace', 'Sister', '07700 900000')$$,
  'an owner can still add an emergency contact');

select is(
  (select count(*)::int from public.emergency_contacts
    where staff_profile_id = 'e6420000-0000-4000-8000-0000000000b1'),
  1,
  'the owner reads the contact back under RLS');

select throws_ok(
  $$insert into public.emergency_contacts (org_id, staff_profile_id, name, phone, medical_notes)
    values ('e6410000-0000-4000-8000-00000000000a',
            'e6420000-0000-4000-8000-0000000000b1', 'Alan', '07700 900001', 'x')$$,
  '42703', null,
  'a write naming medical_notes is refused: the column does not exist');

select public.anonymize_staff_member(
  'e6410000-0000-4000-8000-00000000000a', 'e6420000-0000-4000-8000-0000000000b1');
reset role;

select is(
  (select count(*)::int from public.emergency_contacts
    where staff_profile_id = 'e6420000-0000-4000-8000-0000000000b1'),
  0,
  'erasure still removes the person''s emergency contacts');

select * from finish();
rollback;
