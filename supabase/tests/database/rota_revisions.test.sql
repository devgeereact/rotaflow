-- =====================================================================
-- rota_revisions.test.sql — regression guard for BUG-028 and BUG-035,
-- fixed by 0061_rota_revisions.sql.
--
-- BUG-028: the Rota Builder printed "Editing a shift returns its rota to
-- draft" above every published week, and no code path did it.
-- createShift/updateShift/deleteShift never touched the parent rota, so a
-- manager's edit reached staff phones the instant it was saved — no
-- republish, no notification, no published_at bump, and the screen saying
-- the opposite. The audit found it by reading the mutation paths; nothing
-- executable would have caught it, because "the UI claims X and the code
-- does Y" is not a type error.
--
-- These tests are written against the DATABASE, not the services, on
-- purpose. The old rule lived in one screen's copy; the new one has to
-- hold for a direct PostgREST call from curl with a valid manager JWT,
-- which is exactly what `set local role authenticated` + a jwt.claims GUC
-- reproduces here.
--
-- pgTAP, run via `supabase test db` (spins up its own local Postgres,
-- applies every migration, then this file).
-- =====================================================================

begin;
select plan(18);

-- ---------- fixtures --------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'rota-manager@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

-- on_org_created makes the creator an owner, which is the role the
-- revision functions check for.
insert into public.organisations (name, slug, created_by)
values ('Revision Test Org', 'revision-test-org', '33333333-3333-3333-3333-333333333333');

insert into public.locations (org_id, name)
values ((select id from public.organisations where slug = 'revision-test-org'), 'Main Site');

-- Fixtures are addressed by natural key throughout. The original and its
-- amendment share a name (begin_rota_revision copies it), so what tells
-- them apart is supersedes_rota_id — which stays set after publication and
-- is therefore stable for the whole file.

-- ---------- 1. a rota is born a draft ---------------------------------
-- Inserting one already published would put a week in front of staff
-- without passing through publish_rota: no audit event, no published_by,
-- and no chance to archive whatever it replaced.
select throws_ok(
  $$ insert into public.rotas (org_id, location_id, name, period_start, period_end, status)
     select (select id from public.organisations where slug = 'revision-test-org'),
            (select id from public.locations where name = 'Main Site'),
            'Pre-published', '2026-09-07', '2026-09-13', 'published' $$,
  'ROTA3',
  null,
  'a client cannot insert a rota that is already published'
);

insert into public.rotas (org_id, location_id, name, period_start, period_end)
values (
  (select id from public.organisations where slug = 'revision-test-org'),
  (select id from public.locations where name = 'Main Site'),
  'Week 37', '2026-09-07', '2026-09-13');

insert into public.shifts (org_id, rota_id, location_id, starts_at, ends_at)
select
  (select id from public.organisations where slug = 'revision-test-org'),
  (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null),
  (select id from public.locations where name = 'Main Site'),
  '2026-09-07T07:00:00Z', '2026-09-07T15:00:00Z';

-- ---------- 2. publishing goes through the function -------------------
select lives_ok(
  $$ select public.publish_rota((select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)) $$,
  'publish_rota publishes a draft'
);

select is(
  (select status from public.rotas where id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)),
  'published',
  'the rota is published'
);

select isnt(
  (select published_by from public.rotas where id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)),
  null,
  'publish_rota records who published it'
);

-- ---------- 3. the published rota is immutable ------------------------
-- The three mutation routes the audit found unguarded, exercised as raw
-- SQL under the manager's own role — i.e. as a direct API call, not
-- through any screen.
select throws_ok(
  $$ update public.shifts set starts_at = '2026-09-07T08:00:00Z'
      where id = (select id from public.shifts where rota_id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)) $$,
  'ROTA1',
  null,
  'BUG-028: a shift on a published rota cannot be edited in place'
);

select throws_ok(
  $$ delete from public.shifts where id = (select id from public.shifts where rota_id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)) $$,
  'ROTA1',
  null,
  'BUG-028: a shift on a published rota cannot be deleted'
);

select throws_ok(
  $$ insert into public.shifts (org_id, rota_id, location_id, starts_at, ends_at)
     select (select id from public.organisations where slug = 'revision-test-org'),
            (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null),
            (select id from public.locations where name = 'Main Site'),
            '2026-09-08T07:00:00Z', '2026-09-08T15:00:00Z' $$,
  'ROTA1',
  null,
  'BUG-028: a shift cannot be added to a published rota'
);

select throws_ok(
  $$ update public.rotas set status = 'draft'
      where id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null) $$,
  'ROTA3',
  null,
  'the status column cannot be written directly, only transitioned'
);

-- ---------- 4. amending copies the week forward -----------------------
select public.begin_rota_revision(
  (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null));

select is(
  (select count(*)::int from public.shifts where rota_id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null)),
  1,
  'the amendment starts from a copy of what staff can currently see'
);

select is(
  (select status from public.rotas where id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)),
  'published',
  'the original stays published while the amendment is edited (staff keep seeing it)'
);

-- Idempotent: a second call must not fork a second amendment, which is
-- what a double-clicked "Amend" button would do.
select is(
  (select (public.begin_rota_revision((select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null))).id),
  (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null),
  'begin_rota_revision is idempotent — a second call returns the same amendment'
);

select lives_ok(
  $$ update public.shifts set starts_at = '2026-09-07T08:00:00Z'
      where rota_id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null) $$,
  'the amendment itself is freely editable'
);

-- ---------- 5. unpublishing must not silently eat the amendment -------
select throws_ok(
  $$ select public.unpublish_rota((select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null)) $$,
  'ROTA8',
  null,
  'unpublish is refused while an amendment is open, rather than discarding it'
);

-- ---------- 6. publishing the amendment swaps the two, atomically -----
select public.publish_rota((select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null));

select is(
  (select string_agg(status, ',' order by status)
     from public.rotas where id in (
       (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is null), (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null))),
  'archived,published',
  'publishing the amendment archives the version it replaces'
);

-- The staff read path is `rota.status = published` and nothing else. One
-- version of the week, never two and never none, is the whole claim.
select is(
  (select count(*)::int
     from public.shifts s join public.rotas r on r.id = s.rota_id
    where r.org_id = (select id from public.organisations where slug = 'revision-test-org')
      and r.status = 'published'),
  1,
  'staff see exactly one version of the week — the newly published one'
);

select is(
  (select starts_at from public.shifts s join public.rotas r on r.id = s.rota_id
    where r.status = 'published' and r.org_id = (select id from public.organisations where slug = 'revision-test-org')),
  '2026-09-07T08:00:00Z'::timestamptz,
  'and it is the amended time, not the superseded one'
);

-- ---------- 7. BUG-035: a rota cannot vanish unaudited ----------------
-- 0016 audited `after update` only, so a deleted rota left no trace at
-- all and a production disappearance could not be attributed to anyone.
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.audit_logs
    where action = 'rota.deleted' and metadata->>'name' = 'Week 37'),
  0,
  'no deletion event before the delete (guards against a false positive below)'
);

delete from public.shifts where rota_id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null);
delete from public.rotas  where id = (select id from public.rotas where name = 'Week 37' and supersedes_rota_id is not null);

select is(
  (select count(*)::int from public.audit_logs
    where action = 'rota.deleted' and metadata->>'name' = 'Week 37'),
  1,
  'BUG-035: deleting a rota writes an audit event'
);

select * from finish();
rollback;
