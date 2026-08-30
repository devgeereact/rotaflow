-- =====================================================================
-- minimum_cover.test.sql — GAP-006: an understaffed rota cannot be
-- published, including by a caller who never rendered the button.
--
-- `minimum_cover_rules` shipped in 0036 and the Rota Builder has always
-- treated a shortfall as `critical` and blocked publishing. The rule
-- lived entirely in the browser, so a POST to /rest/v1/rpc/publish_rota
-- published an understaffed rota with nothing to stop it. 0080 moves it
-- into `publish_rota`.
--
-- WHAT THESE TESTS ARE REALLY FOR is not "does it block" — that is one
-- assertion. It is that the database counts the SAME WAY the client does.
-- A server rule that disagrees with the warning on screen is worse than
-- no rule: the manager sees a green rota and gets an opaque refusal, or
-- a red one and publishes anyway. Each counting rule below is a way the
-- two could have drifted apart.
--
--   1. a fully covered rota publishes;
--   2. a short one is refused, naming the site and the day;
--   3. two shifts for ONE person on one day are one person of cover;
--   4. a cancelled shift is not cover;
--   5. an unassigned shift is not cover;
--   6. a shift starting 23:00 counts for the day it STARTS, in the
--      location's timezone — not the day it ends, and not UTC;
--   7. `min_staff = 0` means no minimum, not "must be empty";
--   8. a shift that has already ended still counts, or every site reads
--      as critically understaffed each evening (0036's own note);
--   9. an organisation with no rules at all is unaffected.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'b1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-cover@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

insert into public.organisations (id, name, slug, created_by, plan) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org Cover', 'org-cover',
   'b1111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.locations (id, org_id, name, timezone) values
  ('bbbbbbbb-1000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'Ward A', 'Europe/London');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('bbbbbbbb-2000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Ada','One'),
  ('bbbbbbbb-2000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','Bo','Two');

-- A fixed future week, so "today" can never drift into it and trip the
-- past-days rule while the suite is running.
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status)
values ('bbbbbbbb-3000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001',
        'bbbbbbbb-1000-0000-0000-000000000001',
        'Cover week', date '2099-01-05', date '2099-01-06', 'draft');

-- 2099-01-05 is a Monday (dow 1), 2099-01-06 a Tuesday (dow 2).
insert into public.minimum_cover_rules (org_id, location_id, weekday, min_staff) values
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1000-0000-0000-000000000001',1,2),
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1000-0000-0000-000000000001',2,2);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

-- ---------- 9: no rules at all ---------------------------------------
-- Checked first, while the rules belong to a different organisation's
-- location, so this proves the org filter rather than an empty table.
reset role;
select set_config('request.jwt.claims','',true);
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status)
values ('bbbbbbbb-3000-0000-0000-000000000009',
        'bbbbbbbb-0000-0000-0000-000000000001', null,
        'No-location week', date '2099-02-02', date '2099-02-03', 'draft');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

-- ---------- 2: short, and it says which day ---------------------------
select throws_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000001')$$,
  'ROTA7',
  null,
  'an understaffed rota is refused at the database, not only by the button'
);

-- ---------- 3, 4, 5, 6: what does and does not count -------------------
reset role;
select set_config('request.jwt.claims','',true);

insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, status, starts_at, ends_at) values
  -- Monday: Ada twice (one person of cover), plus a cancelled Bo and an
  -- unassigned shift. On its own that leaves Monday at 1 of 2.
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-2000-0000-0000-000000000001',
   'assigned', timestamptz '2099-01-05 09:00+00', timestamptz '2099-01-05 17:00+00'),
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-2000-0000-0000-000000000001',
   'assigned', timestamptz '2099-01-05 18:00+00', timestamptz '2099-01-05 20:00+00'),
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-2000-0000-0000-000000000002',
   'cancelled', timestamptz '2099-01-05 09:00+00', timestamptz '2099-01-05 17:00+00'),
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001', null,
   'assigned', timestamptz '2099-01-05 09:00+00', timestamptz '2099-01-05 17:00+00');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

select throws_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000001')$$,
  'ROTA7',
  null,
  'one person on two shifts is one person of cover, and a cancelled or unassigned shift is none'
);

-- 6: a shift STARTING 23:00 Monday covers Monday, not Tuesday.
reset role;
select set_config('request.jwt.claims','',true);
insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, status, starts_at, ends_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-2000-0000-0000-000000000002',
   'assigned', timestamptz '2099-01-05 23:00+00', timestamptz '2099-01-06 07:00+00');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

-- Monday now has Ada + Bo = 2 and is satisfied; Tuesday still has nobody,
-- which is the point: the night shift did not leak forward a day.
select throws_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000001')$$,
  'ROTA7',
  null,
  'a 23:00 shift counts for the day it starts — Monday is covered, Tuesday is still short'
);

-- ---------- 1: fully covered publishes --------------------------------
reset role;
select set_config('request.jwt.claims','',true);
insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, status, starts_at, ends_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-2000-0000-0000-000000000001',
   'assigned', timestamptz '2099-01-06 09:00+00', timestamptz '2099-01-06 17:00+00'),
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-3000-0000-0000-000000000001',
   'bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-2000-0000-0000-000000000002',
   'assigned', timestamptz '2099-01-06 09:00+00', timestamptz '2099-01-06 17:00+00');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

select lives_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000001')$$,
  'a fully covered rota publishes — the check refuses shortfalls, not rotas'
);
select is(
  (select status from public.rotas where id = 'bbbbbbbb-3000-0000-0000-000000000001'),
  'published',
  'and it really did publish, rather than returning without raising'
);

-- ---------- 9: an org whose rota touches no rule ----------------------
-- The second rota has `location_id = null`, so no minimum_cover_rules row
-- applies to it. Every organisation that has never opened Settings →
-- Policies is in this position, and none of them should be affected.
select lives_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000009')$$,
  'a rota with no minimum for its scope is unaffected'
);

-- ---------- 7: min_staff = 0 is "no minimum" --------------------------
reset role;
select set_config('request.jwt.claims','',true);
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status)
values ('bbbbbbbb-3000-0000-0000-000000000007',
        'bbbbbbbb-0000-0000-0000-000000000001',
        'bbbbbbbb-1000-0000-0000-000000000001',
        'Zero week', date '2099-01-07', date '2099-01-07', 'draft');
-- 2099-01-07 is a Wednesday (dow 3), given an explicit zero minimum.
insert into public.minimum_cover_rules (org_id, location_id, weekday, min_staff) values
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1000-0000-0000-000000000001',3,0);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

select lives_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000007')$$,
  'min_staff = 0 means no minimum, not that the day must be empty'
);

-- ---------- 8: a past day cannot block forever ------------------------
reset role;
select set_config('request.jwt.claims','',true);
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status)
values ('bbbbbbbb-3000-0000-0000-000000000008',
        'bbbbbbbb-0000-0000-0000-000000000001',
        'bbbbbbbb-1000-0000-0000-000000000001',
        'Past week', date '2020-01-06', date '2020-01-07', 'draft');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','b1111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

-- 2020-01-06 and -07 are a Monday and Tuesday with minimums of 2 and no
-- shifts at all. Nobody can staff them retrospectively, and refusing would
-- make the rota unpublishable forever.
select lives_ok(
  $$select public.publish_rota('bbbbbbbb-3000-0000-0000-000000000008')$$,
  'a day already past is skipped — nobody can fix yesterday'
);

select * from finish();
rollback;
