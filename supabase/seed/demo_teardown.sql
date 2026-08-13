-- =====================================================================
-- demo_teardown.sql. Remove everything demo_seed.sql (v3) created
--
-- Deletes the five demo companies (cascading to every child row: branches,
-- departments, staff, shift types/templates, rotas, shifts, availability,
-- leave, overtime, swaps, clock events, timesheets, emergency contacts,
-- documents, announcements, notifications, invites, audit logs and a
-- subscription), the platform team's `platform_admins` grants, and every
-- login account it created.
--
-- It only touches rows it can derive itself, so organisations created
-- through the app — including "City Hospital Care Group", "GAKINZ" and any
-- real customer signup — are untouched. `is_demo` is NOT used as a filter
-- anywhere in this file: it was blanket-backfilled onto every organisation
-- that existed when migration 0035 shipped, including those real ones, so
-- it cannot safely stand in for "created by this seed".
--
-- NOTE: it does NOT delete `dev@rota.gakinz.com` or `gakinz101@gmail.com`.
-- The first is the real Super Admin login; its `platform_owner` grant is
-- left in place (comment out that DELETE below to also revoke it — think
-- carefully first, that account is the real way into the live console).
-- The second is the owner's own real mailbox.
-- =====================================================================

alter table public.memberships disable trigger memberships_audit;
alter table public.memberships disable trigger memberships_keep_one_owner_trigger;

delete from public.organisations
where slug in ('northgate-care', 'harbour-view-hotels', 'brightside-retail',
               'clearway-logistics', 'meridian-security');

alter table public.memberships enable trigger memberships_audit;
alter table public.memberships enable trigger memberships_keep_one_owner_trigger;

-- The RotaFlow platform team's platform_admins grants (admin/support/finance
-- — not the Super Admin, see above).
delete from public.platform_admins
where user_id in (
  select id from auth.users where email in (
    'gakinz101+platform.admin1@gmail.com','gakinz101+platform.admin2@gmail.com',
    'gakinz101+platform.admin3@gmail.com','gakinz101+platform.support1@gmail.com',
    'gakinz101+platform.support2@gmail.com','gakinz101+platform.support3@gmail.com',
    'gakinz101+platform.finance1@gmail.com','gakinz101+platform.finance2@gmail.com'
  )
);

-- Every login account this seed created: the platform team plus the five
-- companies' owner/manager/supervisor/staff logins. profiles + app_settings
-- cascade from auth.users. Listed exactly, not matched with LIKE.
delete from auth.users where email in (
  'gakinz101+platform.admin1@gmail.com','gakinz101+platform.admin2@gmail.com',
  'gakinz101+platform.admin3@gmail.com','gakinz101+platform.support1@gmail.com',
  'gakinz101+platform.support2@gmail.com','gakinz101+platform.support3@gmail.com',
  'gakinz101+platform.finance1@gmail.com','gakinz101+platform.finance2@gmail.com',
  'gakinz101+demo.northgate.owner@gmail.com','gakinz101+demo.northgate.b1sup@gmail.com',
  'gakinz101+demo.northgate.b2mgr@gmail.com','gakinz101+demo.northgate.b2sup@gmail.com',
  'gakinz101+demo.northgate.staff@gmail.com',
  'gakinz101+demo.harbour.owner@gmail.com','gakinz101+demo.harbour.b1sup@gmail.com',
  'gakinz101+demo.harbour.b2mgr@gmail.com','gakinz101+demo.harbour.b2sup@gmail.com',
  'gakinz101+demo.harbour.staff@gmail.com',
  'gakinz101+demo.brightside.owner@gmail.com','gakinz101+demo.brightside.b1sup@gmail.com',
  'gakinz101+demo.brightside.b2mgr@gmail.com','gakinz101+demo.brightside.b2sup@gmail.com',
  'gakinz101+demo.brightside.staff@gmail.com',
  'gakinz101+demo.clearway.owner@gmail.com','gakinz101+demo.clearway.b1sup@gmail.com',
  'gakinz101+demo.clearway.b2mgr@gmail.com','gakinz101+demo.clearway.b2sup@gmail.com',
  'gakinz101+demo.clearway.staff@gmail.com',
  'gakinz101+demo.meridian.owner@gmail.com','gakinz101+demo.meridian.b1sup@gmail.com',
  'gakinz101+demo.meridian.b2mgr@gmail.com','gakinz101+demo.meridian.b2sup@gmail.com',
  'gakinz101+demo.meridian.staff@gmail.com'
);

-- The old v2 demo's eight accounts, in case this runs against a project
-- that never rebuilt onto v3.
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

select
  (select count(*) from public.organisations
     where slug in ('northgate-care','harbour-view-hotels','brightside-retail',
                    'clearway-logistics','meridian-security'))    as demo_orgs_left,
  (select count(*) from auth.users
     where email like 'gakinz101+demo.%@gmail.com'
        or email like 'gakinz101+platform.%@gmail.com')           as demo_users_left,
  (select count(*) from public.organisations)                     as organisations_total;
