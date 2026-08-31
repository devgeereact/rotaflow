-- =====================================================================
-- role_delegation.test.sql — CAP-090
--
-- "Deputy Manager" was a display label. A manager going away for a
-- fortnight could either be promoted-and-hopefully-demoted, or leave
-- every request unanswered until they were back.
--
--   1. a staff member has no managerial authority to begin with;
--   2. a live delegation gives them `manager`;
--   3. and NOT `owner` — an owner who delegates gets a deputy manager,
--      not somebody who can delete the organisation. This is the
--      assertion the design decision rests on;
--   4. an EXPIRED delegation gives nothing. It ends by time rather than
--      by somebody remembering, which is the failure mode of the
--      temporary promotion it replaces;
--   5. so does a revoked one;
--   6. a delegate cannot delegate onwards — authority that chains is
--      authority nobody can reason about;
--   7. a staff member cannot delegate at all;
--   8. nor can anybody delegate to somebody outside the organisation;
--   9. the delegator can end it;
--  10. and the delegation is visible to the organisation, so a person
--      whose leave was approved by somebody unexpected can see why.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('e9111111-1111-1111-1111-111111111111'::uuid, 'owner-del@example.test'),
  ('e9222222-2222-2222-2222-222222222222'::uuid, 'deputy-del@example.test'),
  ('e9333333-3333-3333-3333-333333333333'::uuid, 'third-del@example.test'),
  ('e9444444-4444-4444-4444-444444444444'::uuid, 'outsider-del@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('e9000000-0000-0000-0000-000000000001', 'Org Del', 'org-del',
   'e9111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('e9000000-0000-0000-0000-000000000001', 'e9222222-2222-2222-2222-222222222222', 'staff'),
  ('e9000000-0000-0000-0000-000000000001', 'e9333333-3333-3333-3333-333333333333', 'staff')
on conflict do nothing;

-- Helper: what `has_org_role` says for a given user and role set. Created
-- BEFORE dropping to `authenticated`, which may not create objects in
-- pg_temp on every configuration.
create or replace function pg_temp.role_at(p_user uuid, p_roles text[])
returns boolean language plpgsql as $$
declare
  v_result boolean;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true);
  select public.has_org_role('e9000000-0000-0000-0000-000000000001', p_roles) into v_result;
  return v_result;
end;
$$;

set local role authenticated;

select ok(
  not pg_temp.role_at('e9222222-2222-2222-2222-222222222222', array['owner', 'manager']),
  'a staff member has no managerial authority to begin with'
);

-- The owner delegates to the deputy for a week.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e9111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

create temporary table delegation on commit drop as
select public.delegate_role(
  'e9000000-0000-0000-0000-000000000001'::uuid,
  'e9222222-2222-2222-2222-222222222222'::uuid,
  timezone('utc', now()) + interval '7 days') as id;

select ok(
  pg_temp.role_at('e9222222-2222-2222-2222-222222222222', array['owner', 'manager']),
  'a live delegation gives them manager'
);

select ok(
  not pg_temp.role_at('e9222222-2222-2222-2222-222222222222', array['owner']),
  'and NOT owner — a deputy cannot delete the organisation or change billing'
);

-- Expire it by moving the window into the past.
reset role;
update public.role_delegations
   set starts_at = timezone('utc', now()) - interval '30 days',
       ends_at   = timezone('utc', now()) - interval '1 day'
 where id = (select id from delegation);
set local role authenticated;

select ok(
  not pg_temp.role_at('e9222222-2222-2222-2222-222222222222', array['manager']),
  'an expired delegation gives nothing — it ends by time, not by memory'
);

reset role;
update public.role_delegations
   set starts_at = timezone('utc', now()) - interval '1 day',
       ends_at   = timezone('utc', now()) + interval '7 days',
       revoked_at = timezone('utc', now())
 where id = (select id from delegation);
set local role authenticated;

select ok(
  not pg_temp.role_at('e9222222-2222-2222-2222-222222222222', array['manager']),
  'and neither does a revoked one'
);

-- Put it back, live, for the chaining assertions.
reset role;
update public.role_delegations set revoked_at = null where id = (select id from delegation);
set local role authenticated;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e9222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.delegate_role(
       'e9000000-0000-0000-0000-000000000001'::uuid,
       'e9333333-3333-3333-3333-333333333333'::uuid,
       timezone('utc', now()) + interval '1 day') $$,
  '42501',
  'Only an owner or manager may delegate cover',
  'a delegate cannot delegate onwards — authority that chains cannot be reasoned about'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e9333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.delegate_role(
       'e9000000-0000-0000-0000-000000000001'::uuid,
       'e9222222-2222-2222-2222-222222222222'::uuid,
       timezone('utc', now()) + interval '1 day') $$,
  '42501',
  'Only an owner or manager may delegate cover',
  'and a plain staff member cannot delegate at all'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e9111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.delegate_role(
       'e9000000-0000-0000-0000-000000000001'::uuid,
       'e9444444-4444-4444-4444-444444444444'::uuid,
       timezone('utc', now()) + interval '1 day') $$,
  '42501',
  'That person is not in this organisation',
  'nor can cover be handed to somebody outside the organisation'
);

select lives_ok(
  $$ select public.revoke_delegation((select id from delegation)) $$,
  'the person who arranged the cover can end it'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e9333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.role_delegations),
  1,
  'and the organisation can see who was covering, so an unexpected approval is explicable'
);

select * from finish();
rollback;
