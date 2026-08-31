-- =====================================================================
-- calendar_feed.test.sql — CAP-063
--
-- `docs/PRD.md` claimed a calendar subscription; what existed was an ICS
-- file download. A file is a snapshot: import it, have the rota amended,
-- and the phone shows last week's shifts confidently, with a reminder.
--
-- The token in the feed URL IS the credential — a calendar client cannot
-- present a header — so these assertions are mostly about how little it
-- is worth if it leaks.
--
--   1. issuing gives a token;
--   2. issuing again REVOKES the first. Rotating and creating are the
--      same operation, so somebody who has shared a URL by accident
--      fixes it with the button they used to get it;
--   3. the feed returns that person's published shifts;
--   4. and NOT a draft rota's — a shift on somebody's phone before the
--      rota is published tells them they are working a shift nobody has
--      committed to;
--   5. and not a cancelled shift;
--   6. and NOT anybody else's shifts, which is the whole containment
--      argument for putting a secret in a URL;
--   7. a revoked token returns nothing;
--   8. `authenticated` cannot call the feed reader at all — it is
--      granted to `service_role`, so a signed-in user cannot hand it
--      somebody else's token and read their rota.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('f9111111-1111-1111-1111-111111111111'::uuid, 'owner-cal@example.test'),
  ('f9222222-2222-2222-2222-222222222222'::uuid, 'staff-cal@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('f9000000-0000-0000-0000-000000000001', 'Org Cal', 'org-calendar',
   'f9111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('f9000000-0000-0000-0000-000000000001', 'f9222222-2222-2222-2222-222222222222', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('f9100000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001',
   'Ward A', 'Europe/London');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('f9200000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001',
   'f9222222-2222-2222-2222-222222222222', 'Sam', 'Staff'),
  ('f9200000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000001',
   null, 'Other', 'Person');

-- One published rota and one draft, both inside the feed's window.
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('f9300000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001',
   'f9100000-0000-0000-0000-000000000001', 'Published week',
   current_date, current_date + 6, 'published', 'f9111111-1111-1111-1111-111111111111'),
  ('f9300000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000001',
   'f9100000-0000-0000-0000-000000000001', 'Draft week',
   current_date + 7, current_date + 13, 'draft', 'f9111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  -- Sam's, published: the one event the feed should carry.
  ('f9400000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001',
   'f9300000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001',
   'f9200000-0000-0000-0000-000000000001',
   timezone('utc', now()) + interval '1 day',
   timezone('utc', now()) + interval '1 day 8 hours', 'assigned'),
  -- Sam's, but cancelled.
  ('f9400000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000001',
   'f9300000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001',
   'f9200000-0000-0000-0000-000000000001',
   timezone('utc', now()) + interval '2 days',
   timezone('utc', now()) + interval '2 days 8 hours', 'cancelled'),
  -- Sam's, but on the DRAFT rota.
  ('f9400000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-000000000001',
   'f9300000-0000-0000-0000-000000000002', 'f9100000-0000-0000-0000-000000000001',
   'f9200000-0000-0000-0000-000000000001',
   timezone('utc', now()) + interval '8 days',
   timezone('utc', now()) + interval '8 days 8 hours', 'assigned'),
  -- Somebody else's, published.
  ('f9400000-0000-0000-0000-000000000004', 'f9000000-0000-0000-0000-000000000001',
   'f9300000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001',
   'f9200000-0000-0000-0000-000000000002',
   timezone('utc', now()) + interval '1 day',
   timezone('utc', now()) + interval '1 day 8 hours', 'assigned');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f9222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

create temporary table issued on commit drop as
select public.issue_calendar_feed_token('f9000000-0000-0000-0000-000000000001') as token;

select isnt((select token from issued), null, 'issuing gives a feed token');

create temporary table reissued on commit drop as
select public.issue_calendar_feed_token('f9000000-0000-0000-0000-000000000001') as token;

select is(
  (select count(*)::int from public.calendar_feed_tokens
    where staff_profile_id = 'f9200000-0000-0000-0000-000000000001'
      and revoked_at is null),
  1,
  'issuing again revokes the first — rotating and creating are one operation'
);

reset role;

-- The feed reader is service_role only, so these run as the table owner.
select is(
  (select count(*)::int from public.calendar_feed_shifts((select token from reissued))),
  1,
  'the feed carries the published shift, and only that one'
);

select is(
  (select shift_id from public.calendar_feed_shifts((select token from reissued))),
  'f9400000-0000-0000-0000-000000000001'::uuid,
  'specifically: not the draft, not the cancelled one, not the colleague''s'
);

select is(
  (select count(*)::int from public.calendar_feed_shifts((select token from issued))),
  0,
  'the revoked token returns nothing'
);

select is(
  (select count(*)::int from public.calendar_feed_shifts(gen_random_uuid())),
  0,
  'and an unknown token returns nothing, with no hint which it was'
);

select ok(
  (select last_used_at is not null from public.calendar_feed_tokens
    where token = (select token from reissued)),
  'use is recorded, so a feed nobody is polling can be spotted'
);

select ok(
  not has_function_privilege('authenticated', 'public.calendar_feed_shifts(uuid)', 'EXECUTE'),
  'a signed-in user cannot call the feed reader and hand it somebody else''s token'
);

select * from finish();
rollback;
