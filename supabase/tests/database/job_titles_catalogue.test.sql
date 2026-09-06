-- =====================================================================
-- job_titles_catalogue.test.sql — the rules `0127` moved out of the
-- picker and into the database.
--
-- A colour picker that greys out a taken swatch is a courtesy. It stops
-- nothing: two managers with the form open both see indigo as free, both
-- press Save, and the organisation ends up with two occupations wearing
-- one colour and nothing on screen to say the colour has stopped meaning
-- one thing. The same is true of "that name already exists" — between the
-- check and the insert, somebody else can take it.
--
-- So the rules live in the schema, and this file is what proves they are
-- there:
--
--   1. names are unique per organisation, compared without regard to
--      capitals or extra spaces;
--   2. one colour per ACTIVE title per organisation;
--   3. archiving releases the colour back to the palette;
--   4. the same name and the same colour may exist independently in a
--      different tenant;
--   5. only a palette id is accepted as a colour;
--   6. a manager cannot edit the catalogue unless the organisation has
--      said so, and an owner always can;
--   7. a staff record cannot be given another organisation's job title;
--   8. no tenant role can read another tenant's catalogue.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'jt-owner@example.test'),
  ('c1222222-2222-2222-2222-222222222222'::uuid, 'jt-manager@example.test'),
  ('c1333333-3333-3333-3333-333333333333'::uuid, 'jt-other-owner@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('c1000000-0000-0000-0000-000000000001', 'Titles A', 'titles-a',
   'c1111111-1111-1111-1111-111111111111', 'starter'),
  ('c1000000-0000-0000-0000-000000000002', 'Titles B', 'titles-b',
   'c1333333-3333-3333-3333-333333333333', 'starter');

insert into public.memberships (org_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'c1222222-2222-2222-2222-222222222222',
   'manager')
on conflict do nothing;

-- ---------- 1. names fold case and whitespace -------------------------
insert into public.job_titles (id, org_id, name, colour) values
  ('c1a00000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   'Senior Carer', 'indigo');

select is(
  (select name_normalised from public.job_titles
    where id = 'c1a00000-0000-0000-0000-000000000001'),
  'senior carer',
  'the comparison form is generated from the display name'
);

select throws_ok(
  $$insert into public.job_titles (org_id, name)
    values ('c1000000-0000-0000-0000-000000000001', '  senior   CARER ')$$,
  '23505',
  null,
  'a case and spacing variant is refused as the same title'
);

-- ---------- 2. one colour per active title ----------------------------
select throws_ok(
  $$insert into public.job_titles (org_id, name, colour)
    values ('c1000000-0000-0000-0000-000000000001', 'Registered Nurse', 'indigo')$$,
  '23505',
  null,
  'a second active title cannot take a colour that is already in use'
);

select lives_ok(
  $$insert into public.job_titles (id, org_id, name, colour)
    values ('c1a00000-0000-0000-0000-000000000002',
            'c1000000-0000-0000-0000-000000000001', 'Registered Nurse', 'sky')$$,
  'but a free colour is accepted'
);

-- A title with no colour is legitimate and does not collide with another
-- one. Null means "no colour", never "pick one".
select lives_ok(
  $$insert into public.job_titles (org_id, name)
    values ('c1000000-0000-0000-0000-000000000001', 'Bank Staff')$$,
  'and several titles may have no colour at all'
);

-- ---------- 3. archiving releases the colour --------------------------
update public.job_titles set active = false
 where id = 'c1a00000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into public.job_titles (org_id, name, colour)
    values ('c1000000-0000-0000-0000-000000000001', 'Ward Clerk', 'indigo')$$,
  'archiving a title hands its colour back to the palette'
);

-- ---------- 4. tenants are independent --------------------------------
select lives_ok(
  $$insert into public.job_titles (org_id, name, colour)
    values ('c1000000-0000-0000-0000-000000000002', 'Senior Carer', 'sky')$$,
  'the same name and colour may exist in a different organisation'
);

-- ---------- 5. only palette ids are colours ---------------------------
select throws_ok(
  $$insert into public.job_titles (org_id, name, colour)
    values ('c1000000-0000-0000-0000-000000000001', 'Invented', '#ff00ff')$$,
  '23514',
  null,
  'a raw hex is refused — colour is a palette id, not a free value'
);

-- ---------- 6. who may edit --------------------------------------------
-- Absent setting means owner-only, so the permissive case has to be chosen
-- deliberately rather than being the default nobody noticed.
select ok(
  public.can_manage_job_titles('c1000000-0000-0000-0000-000000000001')
    is not null,
  'the predicate is callable'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1222222-2222-2222-2222-222222222222',
                    'role', 'authenticated')::text,
  true);

select ok(
  not public.can_manage_job_titles('c1000000-0000-0000-0000-000000000001'),
  'a manager may not edit the catalogue by default'
);

select is(
  (select count(*)::int from public.job_titles
    where org_id = 'c1000000-0000-0000-0000-000000000002'),
  0,
  'and cannot see another organisation''s catalogue at all'
);

reset role;
select set_config('request.jwt.claims', '', true);

update public.organisations
   set settings = jsonb_build_object('job_titles_managed_by', 'managers')
 where id = 'c1000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1222222-2222-2222-2222-222222222222',
                    'role', 'authenticated')::text,
  true);

select ok(
  public.can_manage_job_titles('c1000000-0000-0000-0000-000000000001'),
  'and may once the organisation has said so'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------- 7. a title belongs to its own organisation ----------------
insert into public.staff_profiles (id, org_id, first_name, last_name)
values ('c1b00000-0000-0000-0000-000000000001',
        'c1000000-0000-0000-0000-000000000001', 'Ada', 'Chen');

select throws_ok(
  $$update public.staff_profiles
       set job_title_id = (select id from public.job_titles
                            where org_id = 'c1000000-0000-0000-0000-000000000002'
                            limit 1)
     where id = 'c1b00000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a staff record cannot be given another organisation''s job title'
);

-- ---------- 8. nothing is open to anon --------------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_titles'
      and grantee = 'anon'),
  0,
  'anon holds no privilege on the catalogue'
);

select * from finish();
rollback;
