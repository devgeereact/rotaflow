-- =====================================================================
-- open_shifts_visible_without_a_staff_record.test.sql — BUG-086, `0135`
--
-- `0103` gated the whole of `open_shifts` on the caller having a staff
-- profile. That answers "which shifts could I take", and the screen it
-- feeds asks a second question for an owner or a manager: "what is not
-- covered". An owner with no staff record — invited into an existing
-- organisation rather than founding one, or with an archived record —
-- was told "Nothing needs covering" while a night shift sat open.
--
-- A false negative on a coverage screen is the worst shape it could
-- take: an empty state reads as good news, so nobody looks again.
--
--   1. an owner with NO staff record sees the uncovered shift;
--   2. `clashes_with_mine` is FALSE for them, not null — they work
--      nothing, so they overlap nothing, and a null would render as
--      "clashes" at the first `?? true` somebody writes;
--   3. a member of ANOTHER organisation still sees nothing. The
--      function is SECURITY DEFINER and `is_org_member` is the boundary
--      being relied on now that the profile lookup no longer gates it;
--   4. that owner still cannot CLAIM. Visibility widened; the write did
--      not.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'deskowner@example.test'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'founder-cover@example.test'),
  ('c4444444-4444-4444-4444-444444444444'::uuid, 'outsider-cover@example.test')
) as v(id, email);

-- Three users, and the separation between them is the whole fixture.
--
-- `created_by` is a THIRD account, not the outsider, because `0048`/`0049`
-- bootstrap an owner membership for whoever creates an organisation. The
-- first version of this test made the outsider the creator of both, which
-- silently made them an owner of the organisation they were supposed to be
-- outside — and assertion 3 duly failed with "have: 1". The function was
-- right and the fixture was wrong, which is the more common way round and
-- the reason this comment is here.
--
-- It is also not the owner under test: `0121` gives the FOUNDER a staff
-- record, and the point of this test is an owner who has none.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('c0000000-0000-0000-0000-000000000001', 'Cover Org', 'cover-org',
   'c2222222-2222-2222-2222-222222222222', 'enterprise'),
  ('c0000000-0000-0000-0000-000000000002', 'Rival Org', 'rival-cover',
   'c4444444-4444-4444-4444-444444444444', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('c0000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'owner')
on conflict do nothing;

-- The founder's own staff record, created by `0121`'s trigger, is removed
-- so that NOBODY in this organisation has a staff profile at all. The
-- outsider is a member of the rival organisation only.
delete from public.staff_profiles
 where org_id = 'c0000000-0000-0000-0000-000000000001';

insert into public.locations (id, org_id, name, timezone) values
  ('c0100000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'Night Wing', 'Europe/London');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('c0300000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'c0100000-0000-0000-0000-000000000001', 'Published week',
   current_date, current_date + 6, 'published', 'c2222222-2222-2222-2222-222222222222');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  ('c0400000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'c0300000-0000-0000-0000-000000000001', 'c0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '1 day',
   timezone('utc', now()) + interval '1 day 8 hours', 'open');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.open_shifts('c0000000-0000-0000-0000-000000000001')),
  1,
  'an owner with no staff record sees the uncovered shift'
);

select is(
  (select clashes_with_mine
     from public.open_shifts('c0000000-0000-0000-0000-000000000001')
    limit 1),
  false,
  'clashes_with_mine is false, not null, for a caller who works nothing'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c4444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.open_shifts('c0000000-0000-0000-0000-000000000001')),
  0,
  'a member of another organisation still sees nothing'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.claim_open_shift('c0400000-0000-0000-0000-000000000001') $$,
  null,
  'the owner with no staff record still cannot claim the shift'
);

select * from finish();
rollback;
