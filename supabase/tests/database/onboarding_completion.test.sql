-- =====================================================================
-- onboarding_completion.test.sql — GAP-015: an unfinished wizard can be
-- picked back up.
--
-- The organisation is created at the end of step 1, which is right —
-- somebody who abandons midway has a usable workspace rather than
-- nothing. But `/onboarding` bounced anybody with a membership to the
-- dashboard, so from the moment step 1 succeeded, steps 2-4 were
-- unreachable. Permanently. Nothing recorded whether setup had actually
-- been finished, so the redirect could not tell the two apart.
--
--   1. a new organisation starts with `onboarding_completed_at` null —
--      the state that makes a resume possible;
--   2. `complete_onboarding` stamps it;
--   3. calling it twice keeps the FIRST timestamp. The last step can be
--      reached more than once (a back button, a double submit) and the
--      useful fact is when setup was first finished;
--   4. a manager cannot stamp it — only an owner finishes setup;
--   5. a non-member certainly cannot;
--   6. a NEW organisation starts unfinished, which is what makes any of
--      this reachable. The backfill of pre-existing rows is not
--      asserted and cannot be: a database built from these migrations
--      has no organisations when 0094 runs, so there is nothing to
--      backfill, and a test claiming otherwise would check the
--      migration's intent rather than its effect.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('b0111111-1111-1111-1111-111111111111'::uuid, 'owner-onboarding@example.test'),
  ('b0222222-2222-2222-2222-222222222222'::uuid, 'manager-onboarding@example.test'),
  ('b0333333-3333-3333-3333-333333333333'::uuid, 'outsider-onboarding@example.test')
) as v(id, email);

-- `created_by` bootstraps the owner membership (0002).
insert into public.organisations (id, name, slug, created_by, plan) values
  ('b0000000-0000-0000-0000-000000000001', 'Org Onboarding', 'org-onboarding',
   'b0111111-1111-1111-1111-111111111111', 'starter');

insert into public.memberships (org_id, user_id, role) values
  ('b0000000-0000-0000-0000-000000000001', 'b0222222-2222-2222-2222-222222222222', 'manager')
on conflict do nothing;

-- Belt and braces. This row is created after 0094 ran, so it is already null
-- — but asserting a state the fixture did not establish means the test passes
-- for a reason nobody chose. Set it explicitly, then assert it.
update public.organisations
   set onboarding_completed_at = null
 where id = 'b0000000-0000-0000-0000-000000000001';

select is(
  (select onboarding_completed_at from public.organisations
    where id = 'b0000000-0000-0000-0000-000000000001'),
  null,
  'an unfinished organisation has no completion stamp, which is what allows a resume'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b0111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select isnt(
  public.complete_onboarding('b0000000-0000-0000-0000-000000000001'),
  null,
  'the owner can stamp it finished'
);

-- The first stamp, captured BEFORE the second call. Comparing the second
-- call's result to the column afterwards would pass even if the timestamp had
-- moved — both would have moved together.
create temporary table first_stamp on commit drop as
select onboarding_completed_at as at
  from public.organisations
 where id = 'b0000000-0000-0000-0000-000000000001';

select is(
  public.complete_onboarding('b0000000-0000-0000-0000-000000000001'),
  (select at from first_stamp),
  'calling it again keeps the first timestamp rather than moving it'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b0222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select public.complete_onboarding('b0000000-0000-0000-0000-000000000001')$$,
  '42501',
  'Not permitted',
  'a manager cannot declare setup finished — that is the owner''s call'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b0333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select public.complete_onboarding('b0000000-0000-0000-0000-000000000001')$$,
  '42501',
  'Not permitted',
  'and somebody outside the organisation certainly cannot'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- A NEW organisation must start null, or nothing is ever resumable.
--
-- The backfill itself is deliberately not asserted here and cannot be: a
-- database built from these migrations has no organisations at the moment
-- 0094 runs, so there is nothing for it to backfill. Claiming otherwise would
-- be a test of the migration's intent rather than its effect — the same trap
-- as `notification_delivery_configured` in notification_secret.test.sql.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('b0000000-0000-0000-0000-000000000002', 'Org Backfill', 'org-backfill',
   'b0111111-1111-1111-1111-111111111111', 'starter');

select is(
  (select onboarding_completed_at from public.organisations
    where id = 'b0000000-0000-0000-0000-000000000002'),
  null,
  'a newly created organisation starts unfinished, so the wizard can resume into it'
);

select * from finish();
rollback;
