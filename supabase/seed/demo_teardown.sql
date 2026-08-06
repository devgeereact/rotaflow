-- =====================================================================
-- demo_teardown.sql. Remove everything demo_seed.sql created
--
-- Deletes the demo organisations (cascading to every child row) and the
-- eight demo login accounts, then clears the Super Admin flag.
--
-- It only touches rows it can derive itself, so organisations created
-- through the app are untouched.
--
-- NOTE: it does NOT delete gakinz101@gmail.com, that is a real account.
-- The Super Admin flag is cleared; comment that statement out to keep it.
-- =====================================================================

create or replace function pg_temp.demo_uuid(p_key text)
returns uuid language sql immutable as $$
  select md5('rotaflow-demo-v1:' || p_key)::uuid;
$$;

-- Organisations: ON DELETE CASCADE clears locations, departments, staff,
-- shift types/templates, rotas, shifts, availability, leave, overtime,
-- swaps, clock events, timesheets, emergency contacts, documents,
-- announcements, notifications, invites, subscriptions and audit logs.
-- Both id namespaces: `org:N` is the v1 single-week seed, `v2:org:N` the
-- current three-month one. Dropping both leaves nothing orphaned whichever
-- version last ran.
delete from public.organisations
where id in (
  pg_temp.demo_uuid('org:1'), pg_temp.demo_uuid('org:2'), pg_temp.demo_uuid('org:3'),
  pg_temp.demo_uuid('org:4'), pg_temp.demo_uuid('org:5'),
  pg_temp.demo_uuid('v2:org:1'), pg_temp.demo_uuid('v2:org:2'), pg_temp.demo_uuid('v2:org:3'),
  pg_temp.demo_uuid('v2:org:4'), pg_temp.demo_uuid('v2:org:5')
);

-- Demo accounts. profiles + app_settings cascade from auth.users.
-- Listed exactly, not matched with LIKE: a pattern would also delete a real
-- account that happened to use the same plus-address shape.
delete from auth.users where email in (
  'gakinz101+demo.owner@gmail.com',
  'gakinz101+demo.manager1@gmail.com',
  'gakinz101+demo.manager2@gmail.com',
  'gakinz101+demo.staff1@gmail.com',
  'gakinz101+demo.staff2@gmail.com',
  'gakinz101+demo.staff3@gmail.com',
  'gakinz101+demo.staff4@gmail.com',
  'gakinz101+demo.worker@gmail.com'
);

-- Hand the platform-admin flag back.
update public.profiles set is_platform_admin = false
where email = 'gakinz101@gmail.com';

select
  (select count(*) from public.organisations
     where settings->>'demo' = 'true')                              as demo_orgs_left,
  (select count(*) from auth.users
     where email like 'gakinz101+demo.%@gmail.com')                 as demo_users_left,
  (select count(*) from public.organisations)                       as organisations_total;
