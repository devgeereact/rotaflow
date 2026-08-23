-- =====================================================================
-- delete_organisation.test.sql — BUG-009: an organisation can be deleted.
--
-- Nothing in RotaFlow could delete a tenant. Not a missing button: five
-- database guards actively refused it, and they were only found one at a
-- time, each failure hiding the next. Four cascade-fired audit triggers
-- try to INSERT an audit_logs row referencing the organisation being
-- deleted (audit_logs_org_id_fkey), and memberships_keep_one_owner (0047)
-- refuses to remove the last owner with no exemption for "the whole
-- organisation is going away".
--
-- This test deletes a fully populated organisation. It is the only kind
-- of check that would have caught the problem: every one of those guards
-- is correct in isolation, reads correctly, and fails only when a real
-- delete runs against real cascades.
--
-- It also pins the two things that must NOT happen: the audit trail must
-- survive the tenant it describes, and another tenant's guards must stay
-- armed while this one is being deleted.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(13);

-- ---------- fixtures: two organisations, so isolation is testable ------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'doomed-owner@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-5555-5555-555555555555',
  'authenticated', 'authenticated', 'bystander-owner@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

insert into public.organisations (name, slug, created_by)
values ('Doomed Care Ltd', 'doomed-care', '44444444-4444-4444-4444-444444444444');

-- The id is carried in a transaction-local setting rather than looked up
-- again where it is needed. Two of the assertions below run as somebody who
-- CANNOT see this organisation — one deliberately (a different tenant's
-- owner), one because the row no longer exists — and a subquery for it there
-- returns null, which would make those tests pass or fail for reasons that
-- have nothing to do with what they are checking. A GUC is role-independent.
select set_config(
  'test.doomed_org',
  (select id::text from public.organisations where slug = 'doomed-care'),
  true);

insert into public.locations (org_id, name)
values ((select id from public.organisations where slug = 'doomed-care'), 'Doomed Site');

insert into public.staff_profiles (org_id, first_name, last_name)
values (
  (select id from public.organisations where slug = 'doomed-care'),
  'Dana', 'Doomed');

insert into public.rotas (org_id, location_id, name, period_start, period_end)
values (
  (select id from public.organisations where slug = 'doomed-care'),
  (select id from public.locations where name = 'Doomed Site'),
  'Doomed week', '2026-09-07', '2026-09-13');

insert into public.shifts (org_id, rota_id, location_id, starts_at, ends_at)
values (
  (select id from public.organisations where slug = 'doomed-care'),
  (select id from public.rotas where name = 'Doomed week'),
  (select id from public.locations where name = 'Doomed Site'),
  '2026-09-07T07:00:00Z', '2026-09-07T15:00:00Z');

-- An audit row that predates the deletion, so "the trail survives" is a
-- claim about real history rather than about the deletion event alone.
-- A rename is the cheapest way to make organisations_audit write one.
update public.organisations
   set name = 'Doomed Care Limited'
 where slug = 'doomed-care';

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
insert into public.organisations (name, slug, created_by)
values ('Bystander Ltd', 'bystander', '55555555-5555-5555-5555-555555555555');

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

-- ---------- 1. the preview counts what is about to go ------------------
select is(
  (select shifts::int from public.organisation_deletion_preview(
     (select id from public.organisations where slug = 'doomed-care'))),
  1,
  'the preview reports what the deletion will remove, before it happens'
);

-- ---------- 2. confirmation is required and is exact -------------------
select throws_ok(
  $$ select public.delete_organisation(
       (select id from public.organisations where slug = 'doomed-care'),
       'doomed care limited') $$,
  'ORG02',
  null,
  'a near-miss on the typed name is refused — the point is that it was read'
);

select is(
  (select count(*)::int from public.organisations where slug = 'doomed-care'),
  1,
  'and the refusal changed nothing'
);

-- ---------- 3. only an owner (or a platform admin) may delete ----------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

-- Not a subquery for the id: RLS hides the doomed organisation from this
-- user, so a lookup here would return null and the function would answer
-- "not found" — a pass for the wrong reason, proving nothing about who is
-- allowed to delete what.
select throws_ok(
  format(
    $$ select public.delete_organisation(%L::uuid, 'Doomed Care Limited') $$,
    current_setting('test.doomed_org')),
  '42501',
  null,
  'an owner of a DIFFERENT organisation cannot delete this one'
);

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

-- ---------- 4. the delete itself, through all five guards --------------
select lives_ok(
  $$ select public.delete_organisation(
       (select id from public.organisations where slug = 'doomed-care'),
       'Doomed Care Limited') $$,
  'BUG-009: a populated organisation deletes, cascades and all'
);

-- Everything from here is read as the session role rather than as a member of
-- the deleted organisation. Under RLS that member can no longer see any of
-- these rows — `is_org_member` has nothing left to match — so "count is zero"
-- would be true whether the cascade worked or not, and every assertion below
-- would pass for the wrong reason. Reading past RLS is what makes them mean
-- something.
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.organisations where slug = 'doomed-care'),
  0,
  'the organisation is gone'
);

select is(
  (select count(*)::int from public.shifts s
     where not exists (select 1 from public.organisations o where o.id = s.org_id)),
  0,
  'no orphaned shifts are left behind'
);

select is(
  (select count(*)::int from public.memberships m
     where not exists (select 1 from public.organisations o where o.id = m.org_id)),
  0,
  'no orphaned memberships are left behind — 0047 stood down for this org only'
);

-- ---------- 5. the audit trail outlives the tenant ---------------------
-- `audit_logs_select` requires `org_id is not null` plus org membership, and
-- the whole point of these rows is that their org_id is now null and the
-- organisation is gone: nobody could read them through that policy. A
-- platform administrator is the real-world reader; the session role stands in
-- for one.
select is(
  (select count(*)::int from public.audit_logs
    where action = 'org.deleted' and metadata->>'slug' = 'doomed-care'),
  1,
  'the deletion is recorded'
);

select is(
  (select org_id from public.audit_logs
    where action = 'org.deleted' and metadata->>'slug' = 'doomed-care'),
  null,
  'and the record survives the organisation it describes, org_id set null'
);

select is(
  (select org_name from public.audit_logs
    where action = 'org.deleted' and metadata->>'slug' = 'doomed-care'),
  'Doomed Care Limited',
  'still readable, because org_name was snapshotted alongside'
);

-- The pre-existing rename event, from before the deletion. If the cascade
-- had taken the trail with it, this would be zero.
select is(
  (select count(*)::int from public.audit_logs
    where action = 'org.renamed' and org_name = 'Doomed Care Limited'),
  1,
  'history written before the deletion survives it too'
);

-- ---------- 6. the bystander's guards were never lowered ---------------
-- The failure mode of the `disable trigger` workaround this migration
-- avoids: it would have unarmed 0047 for every tenant at once.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$ delete from public.memberships
      where org_id = (select id from public.organisations where slug = 'bystander') $$,
  '23514',
  null,
  'the other tenant still cannot delete its last owner'
);

select * from finish();
rollback;
