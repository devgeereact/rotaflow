-- =====================================================================
-- personal_preferences.test.sql — 0163, profile-prefs (docs/UX-SPEC.md)
--
-- Three preferences joined `app_settings`. The boundary is the existing
-- own-row policy, so the assertions are about that boundary still holding
-- for the new columns, and about the defaults being today's behaviour:
--
--   1-3. a new account gets 24h, monday and immediate, so nobody's screen
--        changes when the migration lands;
--   4.   the person can change their own three;
--   5.   and the change is stored;
--   6.   they cannot see a second person's row;
--   7.   an update aimed at the second person's row changes nothing;
--   8-10. each column refuses a value outside its list;
--   11.  `anon` cannot read the table at all.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('e1111111-1111-1111-1111-111111111111'::uuid, 'mine-prefs@example.test'),
  ('e2222222-2222-2222-2222-222222222222'::uuid, 'theirs-prefs@example.test')
) as v(id, email);

select is(
  (select time_format from public.app_settings
    where user_id = 'e1111111-1111-1111-1111-111111111111'),
  '24h', 'a new account defaults to the 24-hour clock');
select is(
  (select week_start from public.app_settings
    where user_id = 'e1111111-1111-1111-1111-111111111111'),
  'monday', 'a new account defaults to weeks starting on Monday');
select is(
  (select digest_frequency from public.app_settings
    where user_id = 'e1111111-1111-1111-1111-111111111111'),
  'immediate', 'a new account defaults to immediate notifications');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true);

select lives_ok(
  $$update public.app_settings
       set time_format = '12h', week_start = 'sunday', digest_frequency = 'daily'
     where user_id = 'e1111111-1111-1111-1111-111111111111'$$,
  'a person can change their own three preferences');

select results_eq(
  $$select time_format, week_start, digest_frequency from public.app_settings
     where user_id = 'e1111111-1111-1111-1111-111111111111'$$,
  $$values ('12h'::text, 'sunday'::text, 'daily'::text)$$,
  'the change is stored');

select is(
  (select count(*)::int from public.app_settings
    where user_id = 'e2222222-2222-2222-2222-222222222222'),
  0, 'a second person''s preferences are invisible');

update public.app_settings set time_format = '12h'
 where user_id = 'e2222222-2222-2222-2222-222222222222';

reset role;
select is(
  (select time_format from public.app_settings
    where user_id = 'e2222222-2222-2222-2222-222222222222'),
  '24h', 'an update aimed at a second person''s row changes nothing');

select throws_ok(
  $$update public.app_settings set time_format = '13h'
     where user_id = 'e1111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'time_format refuses a value outside its list');
select throws_ok(
  $$update public.app_settings set week_start = 'wednesday'
     where user_id = 'e1111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'week_start refuses a value outside its list');
select throws_ok(
  $$update public.app_settings set digest_frequency = 'hourly'
     where user_id = 'e1111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'digest_frequency refuses a value outside its list');

select ok(
  not has_table_privilege('anon', 'public.app_settings', 'select'),
  'anon cannot read app_settings');

select * from finish();
rollback;
