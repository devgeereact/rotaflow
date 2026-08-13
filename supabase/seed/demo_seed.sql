-- =====================================================================
-- demo_seed.sql. RotaFlow showcase dataset (v3, SaaS team + 5 companies)
--
-- Rebuilt 2026-08-13 around the real org shape: a RotaFlow SaaS support/
-- ops team (no organisation of their own — they administer the platform)
-- plus five customer companies, each with TWO branches, 3-15 staff per
-- branch including a manager and a supervisor. Every section of the app
-- is populated, and a set of deliberate problems is planted so the demo
-- exercises the warning, conflict and shortage paths rather than only the
-- happy one.
--
-- Supersedes the v2 five-location-per-org shape (30/15/15/15/15 on one
-- head office each). That structure is gone; this is a clean rebuild, not
-- a migration between the two.
--
-- RUN IT:  paste the whole file into the Supabase SQL editor and run once,
--          or POST it to /v1/projects/<ref>/database/query. Run it as a
--          single unit. It uses session-local temp tables.
--
-- IDEMPOTENT BY RESET: every company/branch/staff id is derived
-- deterministically from a key, so re-running DELETES the five companies
-- (cascading to all their rows) and rebuilds them. All dates are relative
-- to `current_date`, so a re-run re-centres the whole three months on
-- today. Re-running is the supported way to refresh the demo.
--
-- SAFETY: the reset below deletes organisations by their exact slug, not
-- by `is_demo` — that flag was blanket-backfilled onto every organisation
-- that existed when 0035 shipped, which includes real ones ("City
-- Hospital Care Group", "GAKINZ", and any real customer signup such as
-- "Harni MCare"). `is_demo` is not a safe delete filter on this project.
-- This script only ever touches the five slugs it created itself, plus
-- the accounts it created or the platform team it manages by exact email.
--
-- Teardown: supabase/seed/demo_teardown.sql
-- Docs:     supabase/seed/README.md, docs/ACCOUNTS.md
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Deterministic ids. Same key -> same uuid, forever. Session-local, so
-- nothing is installed into the production schema.
-- ---------------------------------------------------------------------
create or replace function pg_temp.demo_uuid(p_key text)
returns uuid language sql immutable as $$
  select md5('rotaflow-demo-v1:' || p_key)::uuid;
$$;

-- =====================================================================
-- 0. Reset. Both this script's own companies (idempotent re-run) and the
--    old v2 demo, deleted by exact slug either way.
--
-- `memberships_audit` (AFTER DELETE) calls `audit_write()`, which inserts an
-- `audit_logs` row referencing `org_id` -- but by the time that trigger fires
-- mid-cascade, the parent `organisations` row is already gone, so
-- `audit_logs`'s own FK on `org_id` rejects it. Disabled only for this one
-- statement. `memberships_keep_one_owner_trigger` (0047, BEFORE DELETE) hits
-- the same class of problem cascading through an org's last owner row.
-- Also disabled only for this statement.
-- =====================================================================
alter table public.memberships disable trigger memberships_audit;
alter table public.memberships disable trigger memberships_keep_one_owner_trigger;

delete from public.organisations
where slug in ('northgate-care', 'harbour-view-hotels', 'brightside-retail',
               'clearway-logistics', 'meridian-security');

alter table public.memberships enable trigger memberships_audit;
alter table public.memberships enable trigger memberships_keep_one_owner_trigger;

-- The old v2 demo's eight login accounts. Fully replaced by the company
-- accounts below (different emails), so these are simply removed. Listed
-- exactly, not matched with LIKE, so a real account never gets caught by a
-- pattern. `dev@rota.gakinz.com` and `gakinz101@gmail.com` are NOT here:
-- the first is the real Super Admin login (kept and repurposed below), the
-- second is the owner's own real mailbox.
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

-- =====================================================================
-- 1. Accounts.
--
-- The Super Admin, the RotaFlow platform team (support/admin/finance —
-- no organisation of their own), and the five companies' owner/manager/
-- supervisor/staff logins.
--
-- PASSWORDS ARE DELIBERATELY LITERAL, NOT A CHANGE-ME GUARD. This
-- repository is public, so these are real, working credentials for real,
-- email-confirmed accounts the moment this runs — that trade-off was
-- discussed with the project owner and chosen deliberately: the Super
-- Admin account (full cross-tenant access) gets its own stronger password,
-- kept different from every other seeded account; everything else
-- (platform support/admin/finance staff, and all five companies' staff,
-- who only ever reach their own tenant under RLS) uses one simple shared
-- password. See docs/ACCOUNTS.md.
-- =====================================================================
do $accounts$
declare
  c_owner_email    constant text := 'dev@rota.gakinz.com';
  c_owner_password constant text := 'Testing123.';
  c_password       constant text := 'Testing';

  u_keys   text[] := array[
    -- platform team (8) ---------------------------------------------
    'plat_admin1','plat_admin2','plat_admin3',
    'plat_support1','plat_support2','plat_support3',
    'plat_finance1','plat_finance2',
    -- Northgate Care Group (Healthcare) ------------------------------
    'co1_owner','co1_b1sup','co1_b2mgr','co1_b2sup','co1_stafftest',
    -- Harbour View Hotels (Hospitality) -------------------------------
    'co2_owner','co2_b1sup','co2_b2mgr','co2_b2sup','co2_stafftest',
    -- Brightside Retail (Retail) ---------------------------------------
    'co3_owner','co3_b1sup','co3_b2mgr','co3_b2sup','co3_stafftest',
    -- Clearway Logistics (Logistics) ------------------------------------
    'co4_owner','co4_b1sup','co4_b2mgr','co4_b2sup','co4_stafftest',
    -- Meridian Security (Security) ---------------------------------------
    'co5_owner','co5_b1sup','co5_b2mgr','co5_b2sup','co5_stafftest'
  ];
  u_emails text[] := array[
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
  ];
  u_names  text[] := array[
    'Efe Solomon','Naomi Clarke','Callum Reid',
    'Ijeoma Bello','Harry Dunn','Freya Cole',
    'Martin Osei','Yasmin Farooq',
    'Grace Odum','Ellie Marsh','Samuel Pike','Wendy Osei','Leon Baptiste',
    'Amelia Hart','Noah Fenwick','Isla Duncan','Marcus Yeo','Priya Chandra',
    'Connor Blake','Zara Ahmed','Ryan Coates','Nadia Ferreira','Ben Okonkwo',
    'Karl Whitworth','Dana Michaels','Josh Kaminski','Fiona Pryce','Aaron Mensah',
    'Victor Adeyemi','Holly Grant','Femi Balogun','Chloe Nash','Ibrahim Diallo'
  ];
  -- Platform role for the first 8 keys; null (no platform_admins row) for
  -- every company account, which only ever reaches its own tenant via RLS.
  u_roles  text[] := array[
    'platform_admin','platform_admin','platform_admin',
    'platform_support','platform_support','platform_support',
    'platform_finance','platform_finance',
    null,null,null,null,null,
    null,null,null,null,null,
    null,null,null,null,null,
    null,null,null,null,null,
    null,null,null,null,null
  ];

  v_admin   uuid;
  v_uid     uuid;
  v_new     uuid;
  v_final   uuid;
  v_has_pid boolean;
  j         integer;
begin
  v_has_pid := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id');

  -- ---- the Super Admin. Must already exist (sign up in the app first).
  select id into v_admin from auth.users where lower(email) = c_owner_email;
  if v_admin is null then
    raise exception
      'No auth user for %. Sign up in the app first, then re-run this seed.', c_owner_email;
  end if;

  update public.profiles
     set full_name = 'Gideon Akinlotan'
   where id = v_admin;

  update auth.users
     set encrypted_password = extensions.crypt(c_owner_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_admin;

  insert into public.platform_admins (user_id, role, granted_by, note)
  values (v_admin, 'platform_owner', v_admin, 'Real Super Admin. Owner of the SaaS app, not a demo fixture.')
  on conflict (user_id) do update
    set role = 'platform_owner', revoked_at = null, revoked_by = null,
        updated_at = timezone('utc', now());

  -- ---- everyone else: platform team + five companies' staff.
  for j in 1..array_length(u_keys, 1) loop
    select id into v_uid from auth.users where lower(email) = u_emails[j];

    if v_uid is null then
      v_new := pg_temp.demo_uuid('user:' || u_keys[j]);

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_new, 'authenticated', 'authenticated',
        u_emails[j], extensions.crypt(c_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', u_names[j]),
        now(), now(), '', '', '', ''
      );

      if v_has_pid then
        insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                     last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), v_new,
                jsonb_build_object('sub', v_new::text, 'email', u_emails[j],
                                   'email_verified', true, 'phone_verified', false),
                'email', v_new::text, now(), now(), now());
      else
        insert into auth.identities (id, user_id, identity_data, provider,
                                     last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), v_new,
                jsonb_build_object('sub', v_new::text, 'email', u_emails[j],
                                   'email_verified', true, 'phone_verified', false),
                'email', now(), now(), now());
      end if;
      v_final := v_new;
    else
      update auth.users
         set encrypted_password = extensions.crypt(c_password, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
      v_final := v_uid;
    end if;

    update public.profiles p set full_name = u_names[j]
     from auth.users au
    where au.id = p.id and lower(au.email) = u_emails[j];

    if u_roles[j] is not null then
      insert into public.platform_admins (user_id, role, granted_by, note)
      values (v_final, u_roles[j], v_admin, 'Seeded RotaFlow platform team member (demo_seed.sql v3)')
      on conflict (user_id) do update
        set role = u_roles[j], revoked_at = null, revoked_by = null,
            updated_at = timezone('utc', now());
    end if;
  end loop;
end;
$accounts$;

-- =====================================================================
-- 2. Catalogue temp tables. Everything below is built set-based off
--    these, the same reason v2 was: seventeen weeks across five
--    companies is too much data for row-at-a-time PL/pgSQL to finish
--    inside one API request.
-- =====================================================================
drop table if exists
  d_admin, d_org, d_branch, d_dep, d_palette, d_sty, d_line, d_skill,
  d_login, d_user, d_week, d_pat, d_stf, d_worked;

create temp table d_admin as
select id from auth.users where lower(email) = 'dev@rota.gakinz.com';

-- ---- companies --------------------------------------------------------
create temp table d_org (
  i int, name text, slug text, plan text, industry text, org_size text,
  sub_provider text, sub_status text, mgr_title text, sup_title text, n_pat int
);
insert into d_org (i, name, slug, plan, industry, org_size, sub_provider, sub_status,
                   mgr_title, sup_title, n_pat) values
  (1, 'Northgate Care Group',  'northgate-care',       'business',     'Healthcare',
      '11-50', 'paypal',     'active',   'Registered Manager', 'Deputy Manager', 6),
  (2, 'Harbour View Hotels',   'harbour-view-hotels',  'professional', 'Hospitality',
      '11-50', 'apple_pay',  'active',   'General Manager',    'Front Desk Supervisor', 3),
  (3, 'Brightside Retail',     'brightside-retail',    'professional', 'Retail',
      '11-50', 'google_pay', 'active',   'Store Manager',      'Assistant Manager', 3),
  (4, 'Clearway Logistics',    'clearway-logistics',   'business',     'Logistics',
      '11-50', 'paypal',     'active',   'Site Manager',       'Shift Supervisor', 3),
  (5, 'Meridian Security',     'meridian-security',    'starter',      'Security',
      '1-10',  'apple_pay',  'trialing', 'Security Manager',   'Control Room Supervisor', 3);

-- ---- branches (2 per company; headcount 3-15, includes manager+supervisor)
create temp table d_branch (
  org_i int, j int, name text, address text, lat numeric, lon numeric,
  radius int, n_staff int
);
insert into d_branch (org_i, j, name, address, lat, lon, radius, n_staff) values
  (1, 1, 'Northgate House',              '14 Northgate Road, Leeds LS1 4AB',              53.8008, -1.5491, 120, 15),
  (1, 2, 'Willow Court',                 '8 Willow Lane, Leeds LS2 9JT',                  53.8067, -1.5550, 120, 10),
  (2, 1, 'Harbour View Brighton',        '2 Kings Road, Brighton BN1 1NB',                50.8214, -0.1500, 100, 8),
  (2, 2, 'Harbour View Whitby',          '5 Pier Road, Whitby YO21 3PU',                  54.4863, -0.6133, 100, 6),
  (3, 1, 'Brightside Arndale',           '1 Market Street, Manchester M4 3AQ',            53.4830, -2.2380, 80,  10),
  (3, 2, 'Brightside Trafford',          '7 The Dome, Trafford Centre, Manchester M17 8DA', 53.4652, -2.3480, 80, 7),
  (4, 1, 'Clearway Daventry DC',         'Royal Oak Way, Daventry NN11 8QL',              52.2610, -1.1500, 300, 12),
  (4, 2, 'Clearway Warrington Hub',      'Kingsland Grange, Warrington WA1 4RW',          53.4100, -2.5470, 300, 9),
  (5, 1, 'Meridian Canary Wharf',        '30 Bank Street, London E14 5NR',                51.5040, -0.0190, 150, 5),
  (5, 2, 'Meridian Birmingham Central',  '120 Colmore Row, Birmingham B3 3BD',            52.4810, -1.9030, 120, 3);

-- ---- departments (org-wide: listDepartments() is org-scoped) ----------
create temp table d_dep (org_i int, k int, name text);
insert into d_dep (org_i, k, name) values
  (1,1,'Nursing'),(1,2,'Care'),(1,3,'Kitchen'),(1,4,'Housekeeping'),(1,5,'Reception'),
  (2,1,'Front Desk'),(2,2,'Housekeeping'),(2,3,'Food & Beverage'),(2,4,'Maintenance'),(2,5,'Events'),
  (3,1,'Sales Floor'),(3,2,'Stockroom'),(3,3,'Checkout'),(3,4,'Visual Merchandising'),(3,5,'Click & Collect'),
  (4,1,'Inbound'),(4,2,'Outbound'),(4,3,'Transport'),(4,4,'Fleet Maintenance'),(4,5,'Goods-In QC'),
  (5,1,'Static Guarding'),(5,2,'Mobile Patrol'),(5,3,'Control Room'),(5,4,'Event Security'),(5,5,'Key Holding');

-- ---- shift types --------------------------------------------------------
-- `colour` is restricted to the eight swatches in src/lib/shiftPalette.ts.
create temp table d_palette (k int, colour text, break_minutes int);
insert into d_palette (k, colour, break_minutes) values
  (1,'#56AACD',30),(2,'#C48FD6',30),(3,'#6CA0EB',45),(4,'#C69A45',30),(5,'#4FB39A',60),(6,'#86AC6A',0);

create temp table d_sty (org_i int, k int, name text, t_start time, t_end time, category text);
insert into d_sty (org_i, k, name, t_start, t_end, category) values
  (1,1,'Early','07:00','15:00','day'),        (1,2,'Late','14:00','22:00','day'),
  (1,3,'Night','21:45','07:15','night'),      (1,4,'Twilight','17:00','23:00','evening'),
  (1,5,'Long Day','08:00','20:00','day'),     (1,6,'On-Call','09:00','17:00','on_call'),
  (2,1,'Breakfast','06:00','14:00','day'),    (2,2,'Reception Day','08:00','16:00','day'),
  (2,3,'Evening','15:00','23:00','evening'),  (2,4,'Night Porter','22:30','06:30','night'),
  (2,5,'Banquet','16:00','00:00','evening'),  (2,6,'Housekeeping AM','07:30','15:30','day'),
  (3,1,'Opening','08:30','16:30','day'),      (3,2,'Mid','11:00','19:00','day'),
  (3,3,'Closing','13:30','21:30','evening'),  (3,4,'Stock Delivery','05:00','11:00','early'),
  (3,5,'Weekend Peak','10:00','18:00','day'), (3,6,'Click & Collect','12:00','20:00','day'),
  (4,1,'Day Shift','06:00','14:00','day'),    (4,2,'Back Shift','14:00','22:00','evening'),
  (4,3,'Night Shift','22:00','06:00','night'),(4,4,'Weekend Cover','08:00','20:00','day'),
  (4,5,'Driver Trunk','04:00','12:00','early'),(4,6,'Goods-In','09:00','17:00','day'),
  (5,1,'Day Guard','07:00','19:00','day'),    (5,2,'Night Guard','19:00','07:00','night'),
  (5,3,'Control Room AM','06:00','14:00','day'), (5,4,'Control Room PM','14:00','22:00','evening'),
  (5,5,'Event Cover','16:00','02:00','evening'), (5,6,'Mobile Patrol','10:00','18:00','day');

-- ---- line-staff job titles (managers/supervisors use d_org.mgr/sup_title)
create temp table d_line (org_i int, k int, title text);
insert into d_line (org_i, k, title) values
  (1,1,'Senior Nurse'),(1,2,'Care Assistant'),(1,3,'Kitchen Assistant'),
  (1,4,'Senior Care Assistant'),(1,5,'Housekeeping Assistant'),(1,6,'Receptionist'),
  (2,1,'Housekeeping Lead'),(2,2,'Night Porter'),(2,3,'F&B Assistant'),
  (2,4,'Events Coordinator'),(2,5,'Front Desk Assistant'),(2,6,'Porter'),
  (3,1,'Sales Advisor'),(3,2,'Stock Assistant'),(3,3,'Checkout Assistant'),
  (3,4,'Click & Collect Assistant'),(3,5,'Visual Merchandiser'),(3,6,'Sales Assistant'),
  (4,1,'LGV Driver'),(4,2,'Warehouse Operative'),(4,3,'Forklift Operator'),
  (4,4,'Transport Planner'),(4,5,'Goods-In Checker'),(4,6,'Picker'),
  (5,1,'Static Guard'),(5,2,'Mobile Patrol Officer'),(5,3,'Event Steward'),
  (5,4,'Key Holder'),(5,5,'Control Room Operator'),(5,6,'Door Supervisor');

create temp table d_skill (org_i int, k int, skills text);
insert into d_skill (org_i, k, skills) values
  (1,1,'Safeguarding,Medication,First Aid'),(1,2,'Safeguarding,Moving & Handling,First Aid'),
  (1,3,'Medication,Wound Care,IV'),(1,4,'Moving & Handling,Dementia Care'),
  (1,5,'Food Hygiene L2,Allergen Awareness'),(1,6,'Safeguarding,Medication,Dementia Care'),
  (2,1,'Front Office,Revenue Management'),(2,2,'Opera PMS,Customer Service'),
  (2,3,'COSHH,Team Leading'),(2,4,'Fire Marshal,First Aid'),
  (2,5,'Food Hygiene L2,Barista'),(2,6,'Events,Licensing'),
  (3,1,'People Management,Loss Prevention'),(3,2,'Merchandising,Cash Handling'),
  (3,3,'Customer Service,Till'),(3,4,'Manual Handling,Stock Control'),
  (3,5,'Cash Handling,Age Verification'),(3,6,'Click & Collect,Stock Control'),
  (4,1,'Team Leading,Manual Handling'),(4,2,'LGV C+E,Digi Tacho,ADR'),
  (4,3,'Manual Handling,Picking'),(4,4,'Counterbalance FLT,Reach FLT'),
  (4,5,'Route Planning,WMS'),(4,6,'Goods-In QC,Manual Handling'),
  (5,1,'SIA Door Supervisor,First Aid'),(5,2,'CCTV (PSS),Control Room'),
  (5,3,'SIA Security Guard,Fire Marshal'),(5,4,'SIA Security Guard,Driving'),
  (5,5,'SIA Door Supervisor,Crowd Safety'),(5,6,'SIA Security Guard,Key Holding');

-- ---- who owns / manages / supervises each company, by exact seeded email
create temp table d_login (org_i int, tag text, email text, first_name text, last_name text);
insert into d_login (org_i, tag, email, first_name, last_name) values
  (1,'owner','gakinz101+demo.northgate.owner@gmail.com','Grace','Odum'),
  (1,'b1sup','gakinz101+demo.northgate.b1sup@gmail.com','Ellie','Marsh'),
  (1,'stafftest','gakinz101+demo.northgate.staff@gmail.com','Leon','Baptiste'),
  (1,'b2mgr','gakinz101+demo.northgate.b2mgr@gmail.com','Samuel','Pike'),
  (1,'b2sup','gakinz101+demo.northgate.b2sup@gmail.com','Wendy','Osei'),
  (2,'owner','gakinz101+demo.harbour.owner@gmail.com','Amelia','Hart'),
  (2,'b1sup','gakinz101+demo.harbour.b1sup@gmail.com','Noah','Fenwick'),
  (2,'stafftest','gakinz101+demo.harbour.staff@gmail.com','Priya','Chandra'),
  (2,'b2mgr','gakinz101+demo.harbour.b2mgr@gmail.com','Isla','Duncan'),
  (2,'b2sup','gakinz101+demo.harbour.b2sup@gmail.com','Marcus','Yeo'),
  (3,'owner','gakinz101+demo.brightside.owner@gmail.com','Connor','Blake'),
  (3,'b1sup','gakinz101+demo.brightside.b1sup@gmail.com','Zara','Ahmed'),
  (3,'stafftest','gakinz101+demo.brightside.staff@gmail.com','Ben','Okonkwo'),
  (3,'b2mgr','gakinz101+demo.brightside.b2mgr@gmail.com','Ryan','Coates'),
  (3,'b2sup','gakinz101+demo.brightside.b2sup@gmail.com','Nadia','Ferreira'),
  (4,'owner','gakinz101+demo.clearway.owner@gmail.com','Karl','Whitworth'),
  (4,'b1sup','gakinz101+demo.clearway.b1sup@gmail.com','Dana','Michaels'),
  (4,'stafftest','gakinz101+demo.clearway.staff@gmail.com','Aaron','Mensah'),
  (4,'b2mgr','gakinz101+demo.clearway.b2mgr@gmail.com','Josh','Kaminski'),
  (4,'b2sup','gakinz101+demo.clearway.b2sup@gmail.com','Fiona','Pryce'),
  (5,'owner','gakinz101+demo.meridian.owner@gmail.com','Victor','Adeyemi'),
  (5,'b1sup','gakinz101+demo.meridian.b1sup@gmail.com','Holly','Grant'),
  (5,'stafftest','gakinz101+demo.meridian.staff@gmail.com','Ibrahim','Diallo'),
  (5,'b2mgr','gakinz101+demo.meridian.b2mgr@gmail.com','Femi','Balogun'),
  (5,'b2sup','gakinz101+demo.meridian.b2sup@gmail.com','Chloe','Nash');

create temp table d_user as
select l.org_i, l.tag, u.id
from d_login l
join auth.users u on lower(u.email) = lower(l.email);

-- ---- the three-month window ----------------------------------------
-- w = 0..16 : three completed weeks of history, this week (w = 3), then
-- thirteen weeks ahead. Anchored on current_date, so a re-run always
-- yields "this month plus the two after it" with real history behind it.
create temp table d_week as
select w,
       (date_trunc('week', current_date)::date - 21 + (w * 7))     as ws,
       (date_trunc('week', current_date)::date - 21 + (w * 7) + 6) as we
from generate_series(0, 16) w;

-- ---- rotating patterns ----------------------------------------------
-- One row per (roster size, pattern, weekday). dow: 0 = Monday.
create temp table d_pat(n_pat int, pattern int, sty_k int, dow int);
insert into d_pat (n_pat, pattern, sty_k, dow) values
  -- flagship, 6 patterns (Northgate) -------------------------------------
  (6,1,1,0),(6,1,1,1),(6,1,1,2),(6,1,1,3),(6,1,1,4),          -- Earlies, Mon-Fri
  (6,2,2,0),(6,2,2,1),(6,2,2,2),(6,2,2,3),(6,2,2,4),          -- Lates, Mon-Fri
  (6,3,3,2),(6,3,3,3),(6,3,3,4),(6,3,3,5),(6,3,3,6),          -- Nights, Wed-Sun
  (6,4,5,0),(6,4,5,1),(6,4,5,2),(6,4,5,5),(6,4,5,6),          -- Long days, Mon-Wed + weekend
  (6,5,4,3),(6,5,4,4),(6,5,4,5),(6,5,4,6),                    -- Twilights, Thu-Sun
  (6,6,1,5),(6,6,1,6),(6,6,1,0),(6,6,1,1),(6,6,1,2),          -- Weekend-in earlies, Sat-Wed
  -- everyone else, 3 patterns ---------------------------------------------
  (3,1,1,0),(3,1,1,1),(3,1,1,2),(3,1,1,3),(3,1,1,4),
  (3,2,2,2),(3,2,2,3),(3,2,2,4),(3,2,2,5),(3,2,2,6),
  (3,3,3,5),(3,3,3,6),(3,3,3,0),(3,3,3,1),(3,3,3,2);

-- ---- staff ----------------------------------------------------------
-- local_idx 1 = branch manager (owner at branch 1, manager at branch 2),
-- local_idx 2 = supervisor, local_idx 3.. = line staff. `n` is a running
-- per-company index across both branches (branch 1 first).
create temp table d_stf as
with branch_off as (
  select b.org_i, b.j, b.n_staff,
         coalesce(sum(b.n_staff) over (
           partition by b.org_i order by b.j
           rows between unbounded preceding and 1 preceding), 0)::int as staff_offset
  from d_branch b
),
base as (
  select bo.org_i, bo.j as loc_j, (bo.staff_offset + gs.local_idx) as n, gs.local_idx,
         pg_temp.demo_uuid(format('v3:org:%s', o.i)) as org_id,
         o.slug, o.n_pat, o.mgr_title, o.sup_title
  from branch_off bo
  join d_org o on o.i = bo.org_i
  cross join lateral generate_series(1, bo.n_staff) as gs(local_idx)
),
tagged as (
  select b.*,
    case when local_idx = 1 and loc_j = 1 then 'owner'
         when local_idx = 2 and loc_j = 1 then 'b1sup'
         when local_idx = 3 and loc_j = 1 then 'stafftest'
         when local_idx = 1 and loc_j = 2 then 'b2mgr'
         when local_idx = 2 and loc_j = 2 then 'b2sup'
    end as tag,
    case when local_idx = 1 then 1
         when local_idx = 2 then 2
         else ((local_idx - 3) % n_pat) + 1 end as pattern
  from base b
)
select
  t.org_i, t.n, t.loc_j, t.org_id, t.slug, t.n_pat, t.pattern, t.tag as user_key,
  pg_temp.demo_uuid(format('v3:stf:%s:%s', t.org_i, t.n)) as id,
  coalesce(ln.first_name,
    (array['Hannah','Owen','Leila','Ryan','Nia','Victor','Karol','Denise','Femi','Ruth',
           'Nathan','Aisha','Gary','Elena','Josh','Bethany','Chris','Diana','Ethan','Farah',
           'Alex','Olivia','Michael','Emily','Sarah','Liam','Rosa','Chen','Ade','Marie',
           'Isla','Callum','Jonah','Keira','Bilal','Tara','Noah','Zara','Kofi','Lena'])[
      ((t.n * 7 + t.org_i * 11) % 40) + 1]) as first_name,
  coalesce(ln.last_name,
    (array['Clarke','Price','Ahmed','Docherty','Bevan','Mensah','Wisniewski','Hughes','Balogun','Kelly',
           'Boateng','Malik','Sutcliffe','Petrova','Lambert','Johnson','Brown','Davis','Wright','Hussain',
           'Morgan','Patel','Reid','Fraser','Doyle','Osei','Nowicki','Ferreira','Adeoye','Quinn',
           'Baxter','Mullen','Sharma','Ellis','Rahman','Griffiths','Sandhu','Novak','Byrne','Achebe'])[
      ((t.n * 13 + t.org_i * 5) % 40) + 1]) as last_name,
  case when t.local_idx = 1 then t.mgr_title
       when t.local_idx = 2 then t.sup_title
       else li.title end as job_title,
  ((t.pattern - 1) % 5) + 1 as dept_k,
  sk.skills,
  case when t.n % 7 = 0 then 'zero_hours'
       when t.n % 5 = 0 then 'part_time'
       when t.n % 11 = 0 then 'casual'
       else 'full_time' end as contract_type,
  case when t.n % 7 = 0 then 0.0
       when t.n % 5 = 0 then 22.5
       when t.n % 11 = 0 then 16.0
       else 37.5 end as weekly_hours
from tagged t
left join d_login ln on ln.org_i = t.org_i and ln.tag = t.tag
left join d_line  li on li.org_i = t.org_i and li.k = ((t.pattern - 1) % 6) + 1
left join d_skill sk on sk.org_i = t.org_i and sk.k = ((t.pattern - 1) % 6) + 1;

-- =====================================================================
-- 3. Core rows
-- =====================================================================
insert into public.organisations (id, name, slug, plan, settings, created_by, is_demo)
select pg_temp.demo_uuid(format('v3:org:%s', o.i)), o.name, o.slug, o.plan,
       jsonb_build_object('industry', o.industry, 'size', o.org_size,
                          'locale', 'en-GB', 'timezone', 'Europe/London',
                          'week_starts_on', 'monday', 'demo', true),
       a.id, true
from d_org o cross join d_admin a;

insert into public.subscriptions (id, org_id, plan, status, provider, provider_ref, current_period_end)
select pg_temp.demo_uuid(format('v3:sub:%s', o.i)),
       pg_temp.demo_uuid(format('v3:org:%s', o.i)),
       o.plan, o.sub_status, o.sub_provider, 'demo_' || o.slug, now() + interval '30 days'
from d_org o;

insert into public.locations (id, org_id, name, address, latitude, longitude, timezone, geofence_radius_m)
select pg_temp.demo_uuid(format('v3:loc:%s:%s', b.org_i, b.j)),
       pg_temp.demo_uuid(format('v3:org:%s', b.org_i)),
       b.name, b.address, b.lat, b.lon, 'Europe/London', b.radius
from d_branch b;

insert into public.departments (id, org_id, location_id, name)
select pg_temp.demo_uuid(format('v3:dep:%s:%s', d.org_i, d.k)),
       pg_temp.demo_uuid(format('v3:org:%s', d.org_i)),
       null, d.name
from d_dep d;

insert into public.shift_types (id, org_id, name, colour, default_start, default_end, is_paid, category)
select pg_temp.demo_uuid(format('v3:sty:%s:%s', s.org_i, s.k)),
       pg_temp.demo_uuid(format('v3:org:%s', s.org_i)),
       s.name, p.colour, s.t_start, s.t_end, s.category <> 'on_call', s.category
from d_sty s
join d_palette p on p.k = s.k;

-- Templates: every shift type at both branches.
insert into public.shift_templates (id, org_id, name, shift_type_id, location_id, department_id,
                                    start_time, end_time, break_minutes, required_skills)
select pg_temp.demo_uuid(format('v3:tpl:%s:%s:%s', s.org_i, s.k, b.j)),
       pg_temp.demo_uuid(format('v3:org:%s', s.org_i)),
       format('%s · %s', s.name, b.name),
       pg_temp.demo_uuid(format('v3:sty:%s:%s', s.org_i, s.k)),
       pg_temp.demo_uuid(format('v3:loc:%s:%s', b.org_i, b.j)),
       pg_temp.demo_uuid(format('v3:dep:%s:%s', s.org_i, ((s.k - 1) % 5) + 1)),
       s.t_start, s.t_end, p.break_minutes,
       string_to_array(
         (select st.skills from d_stf st
           where st.org_i = s.org_i and st.pattern = least(s.k, st.n_pat) limit 1), ',')
from d_sty s
join d_palette p on p.k = s.k
join d_branch b on b.org_i = s.org_i;

insert into public.staff_profiles (
  id, org_id, user_id, first_name, last_name, job_title, department_id,
  contract_type, weekly_hours, holiday_allowance, skills, payroll_id,
  start_date, phone, active)
select s.id, s.org_id,
       (select u.id from d_user u where u.org_i = s.org_i and u.tag = s.user_key),
       s.first_name, s.last_name, s.job_title,
       pg_temp.demo_uuid(format('v3:dep:%s:%s', s.org_i, s.dept_k)),
       s.contract_type, s.weekly_hours, 28.0,
       string_to_array(s.skills, ','),
       format('%s-%s', upper(left(s.slug, 3)), lpad((100 + s.n)::text, 4, '0')),
       current_date - (120 + (s.n * 37) + (s.org_i * 23)),
       format('+4477%s%s', lpad(s.org_i::text, 2, '0'), lpad((100000 + s.n * 137)::text, 7, '0')),
       true
from d_stf s;

-- Memberships for every login-backed staff row: owner at branch 1, manager
-- for the other three leads, staff for the one testable line-staff login.
insert into public.memberships (id, org_id, user_id, role, status)
select pg_temp.demo_uuid(format('v3:mem:%s:%s', s.org_i, s.n)), s.org_id,
       (select u.id from d_user u where u.org_i = s.org_i and u.tag = s.user_key),
       case when s.user_key = 'owner' then 'owner'
            when s.user_key in ('b1sup','b2mgr','b2sup') then 'manager'
            else 'staff' end,
       'active'
from d_stf s
where s.user_key is not null
on conflict (org_id, user_id) do nothing;

-- =====================================================================
-- 4. Rotas, one per branch per week, for all seventeen weeks.
--
-- Load-bearing, not tidiness: RotaBuilderPage calls
-- getOrCreateRotaForPeriod(org, location, Monday..Sunday) and then reads
-- shifts *by rota id*. A week with no rota row for a branch gets a fresh
-- empty draft on open, and the seeded shifts, attached to some other
-- rota, never appear.
-- =====================================================================
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, published_at)
select pg_temp.demo_uuid(format('v3:rota:%s:%s:%s', b.org_i, b.j, wk.w)),
       pg_temp.demo_uuid(format('v3:org:%s', b.org_i)),
       pg_temp.demo_uuid(format('v3:loc:%s:%s', b.org_i, b.j)),
       format('%s. W/c %s', b.name, to_char(wk.ws, 'DD Mon YYYY')),
       wk.ws, wk.we,
       case when wk.w >= 15 then 'draft' else 'published' end,
       case when wk.w >= 15 then null
            else (least(wk.ws, current_date) - 9)::timestamptz end
from d_branch b cross join d_week wk;

-- =====================================================================
-- 5. Shifts. The rolling three-month rota.
-- =====================================================================
insert into public.shifts (
  id, org_id, rota_id, location_id, department_id, staff_profile_id,
  shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
select
  pg_temp.demo_uuid(format('v3:sft:%s:%s:%s:%s', s.org_i, s.n, wk.w, p.dow)),
  s.org_id,
  pg_temp.demo_uuid(format('v3:rota:%s:%s:%s', s.org_i, s.loc_j, wk.w)),
  pg_temp.demo_uuid(format('v3:loc:%s:%s', s.org_i, s.loc_j)),
  pg_temp.demo_uuid(format('v3:dep:%s:%s', s.org_i, s.dept_k)),
  s.id,
  pg_temp.demo_uuid(format('v3:sty:%s:%s', s.org_i, ty.k)),
  ((wk.ws + p.dow)::timestamp + ty.t_start) at time zone 'Europe/London',
  ((wk.ws + p.dow + case when ty.t_end <= ty.t_start then 1 else 0 end)::timestamp + ty.t_end)
    at time zone 'Europe/London',
  pal.break_minutes,
  case
    when ((wk.ws + p.dow)::timestamp + ty.t_start) at time zone 'Europe/London' < now()
      then 'confirmed'
    when wk.w <= 5 then 'confirmed'
    else 'assigned'
  end,
  pal.colour,
  case when (s.n + wk.w) % 23 = 0 then 'Covering annual leave.'
       when (s.n + wk.w) % 29 = 0 then 'Induction buddy for a new starter.'
  end
from d_stf s
join d_pat p on p.n_pat = s.n_pat and p.pattern = s.pattern
cross join d_week wk
join d_sty ty
  on ty.org_i = s.org_i
 -- Pattern 6 (Northgate only) alternates earlies and lates week by week.
 and ty.k = case when s.pattern = 6 and wk.w % 2 = 1 then 2 else p.sty_k end
join d_palette pal on pal.k = ty.k;

-- =====================================================================
-- 6. Deliberate problems. Everything above is a healthy rota; a demo
--    that only shows a healthy rota never exercises the warnings.
-- =====================================================================

-- (a) SHORTAGE: unfill weekend night cover at branch 2 of two companies,
--     spread across the three months so the shortage view is never empty.
update public.shifts s
   set staff_profile_id = null,
       status = 'open',
       notes = 'Open shift. Needs cover.'
from d_stf st, d_week wk
where s.staff_profile_id = st.id
  and wk.w in (5, 7, 9, 12, 14)
  and s.starts_at >= (wk.ws::timestamp at time zone 'Europe/London')
  and s.starts_at <  ((wk.ws + 7)::timestamp at time zone 'Europe/London')
  and st.org_i in (2, 4)
  and st.loc_j = 2
  and st.pattern = least(3, st.n_pat)
  and extract(dow from s.starts_at at time zone 'Europe/London') in (0, 6);

-- (b) DOUBLE BOOKING: the branch-1 owner/manager of every company, on two
--     overlapping shifts next week.
insert into public.shifts (
  id, org_id, rota_id, location_id, department_id, staff_profile_id,
  shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
select
  pg_temp.demo_uuid(format('v3:clash:%s', s.org_i)),
  s.org_id,
  pg_temp.demo_uuid(format('v3:rota:%s:%s:%s', s.org_i, s.loc_j, 4)),
  pg_temp.demo_uuid(format('v3:loc:%s:%s', s.org_i, s.loc_j)),
  pg_temp.demo_uuid(format('v3:dep:%s:%s', s.org_i, s.dept_k)),
  s.id, pg_temp.demo_uuid(format('v3:sty:%s:%s', s.org_i, 2)),
  ((wk.ws + 1)::timestamp + time '12:00') at time zone 'Europe/London',
  ((wk.ws + 1)::timestamp + time '20:00') at time zone 'Europe/London',
  30, 'assigned', (select colour from d_palette where k = 2),
  'Added by hand. Overlaps an existing shift.'
from d_stf s
join d_week wk on wk.w = 4
where s.user_key = 'owner';

-- (c) LEAVE CLASH: approved leave that still has shifts rostered inside it,
--     two weeks out, a future error rather than a historical one.
insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date, end_date,
                                   status, reason, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v3:lveclash:%s', s.org_i)), s.org_id, s.id,
       'holiday',
       (select ws from d_week where w = 5), (select ws + 4 from d_week where w = 5),
       'approved', 'Approved before the rota was built. Shifts still stand.',
       (select id from d_admin), now() - interval '6 days'
from d_stf s
where s.user_key = 'b1sup';

-- (d) REST BREACH: a late finishing 22:00 followed by an early starting
--     07:00. Nine hours' rest, under the eleven the WTR expects. The
--     branch-2 supervisor is on the Late pattern by construction, so this
--     is a genuine out-of-pattern early tacked onto their real rota.
insert into public.shifts (
  id, org_id, rota_id, location_id, department_id, staff_profile_id,
  shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
select
  pg_temp.demo_uuid(format('v3:rest:%s', s.org_i)),
  s.org_id,
  pg_temp.demo_uuid(format('v3:rota:%s:%s:%s', s.org_i, s.loc_j, 4)),
  pg_temp.demo_uuid(format('v3:loc:%s:%s', s.org_i, s.loc_j)),
  pg_temp.demo_uuid(format('v3:dep:%s:%s', s.org_i, s.dept_k)),
  s.id, pg_temp.demo_uuid(format('v3:sty:%s:%s', s.org_i, 1)),
  ((wk.ws + 5)::timestamp + ty.t_start) at time zone 'Europe/London',
  ((wk.ws + 5)::timestamp + ty.t_end) at time zone 'Europe/London',
  pal.break_minutes, 'assigned', pal.colour,
  'Back-to-back with the late the night before.'
from d_stf s
join d_sty ty on ty.org_i = s.org_i and ty.k = 1
join d_palette pal on pal.k = 1
join d_week wk on wk.w = 4
where s.user_key = 'b2sup';

-- (e) UNAVAILABILITY, including one that conflicts with a rostered shift.
insert into public.availability (id, org_id, staff_profile_id, weekday, date,
                                 start_time, end_time, status, recurring)
select pg_temp.demo_uuid(format('v3:avl:%s:%s', s.org_i, s.n)), s.org_id, s.id,
       case when s.n % 4 = 3 then null else (s.n % 7) end,
       case when s.n % 4 = 3 then (select ws + (s.n % 5) from d_week where w = 6) end,
       case when s.n % 3 = 0 then time '09:00' end,
       case when s.n % 3 = 0 then time '17:00' end,
       case when s.n % 3 = 0 then 'preferred' else 'unavailable' end,
       s.n % 4 <> 3
from d_stf s
where s.n % 2 = 1;

-- The standing clash: the branch-2 manager works Mondays (pattern 1), so
-- "unavailable every Monday" is a conflict the rota warnings should
-- surface every single week.
insert into public.availability (id, org_id, staff_profile_id, weekday, date,
                                 start_time, end_time, status, recurring)
select pg_temp.demo_uuid(format('v3:avlclash:%s', s.org_i)), s.org_id, s.id,
       0, null, null, null, 'unavailable', true
from d_stf s
where s.user_key = 'b2mgr';

-- (f) EXPIRED / EXPIRING DOCUMENTS, staggered on purpose.
insert into public.documents (id, org_id, staff_profile_id, type, name, file_url,
                              issued_at, expires_at)
select pg_temp.demo_uuid(format('v3:doc:%s:%s:%s', s.org_i, s.n, t.k)),
       s.org_id, s.id,
       (array['contract','dbs','right_to_work','training','visa'])[t.k],
       format('%s, %s %s',
              (array['Employment contract','DBS certificate','Right to work check',
                     'Mandatory training record','Visa / share code'])[t.k],
              s.first_name, s.last_name),
       format('https://ik.imagekit.io/demo/rotaflow/%s/%s-%s.pdf', s.slug,
              (array['contract','dbs','right_to_work','training','visa'])[t.k], s.n),
       current_date - 400 + (t.k * 30),
       case
         when s.n % 9 = 0 and t.k = 2 then current_date - 12
         when s.n % 6 = 0 and t.k = 4 then current_date + 5
         when s.n % 6 = 3 and t.k = 3 then current_date + 21
         when t.k = 1 then null
         else current_date + 300 + (s.n * 7)
       end
from d_stf s cross join generate_series(1, 5) t(k)
where s.n % 2 = 0 or t.k <= 2;

-- =====================================================================
-- 7. Requests, timesheets and communications, spread across the window.
-- =====================================================================

-- ---- leave: a mix across all three months, all three states ----------
insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date, end_date,
                                   status, reason, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v3:lve:%s:%s', s.org_i, s.n)), s.org_id, s.id,
       (array['holiday','sick','holiday','unpaid','holiday','compassionate'])[((s.n - 1) % 6) + 1],
       (select ws from d_week where w = ((s.n * 3) % 17)) + (s.n % 4),
       (select ws from d_week where w = ((s.n * 3) % 17)) + (s.n % 4) + ((s.n % 5) + 1),
       (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1],
       (array['Family holiday booked in the spring','Flu. GP note supplied',
              'Half-term break with the kids','Moving house','Long weekend away',
              'Wedding in the family'])[((s.n - 1) % 6) + 1],
       case when (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1] <> 'pending'
            then (select id from d_admin) end,
       case when (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1] <> 'pending'
            then now() - ((s.n % 12) || ' days')::interval end
from d_stf s;

-- ---- overtime --------------------------------------------------------
insert into public.overtime_requests (id, org_id, staff_profile_id, date, hours,
                                      status, note, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v3:ovt:%s:%s', s.org_i, s.n)), s.org_id, s.id,
       (select ws from d_week where w = ((s.n * 5) % 17)) + (s.n % 6),
       (1.5 + (s.n % 4))::numeric(5,2),
       (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1],
       format('Extra cover at %s',
              (select b.name from d_branch b where b.org_i = s.org_i and b.j = s.loc_j)),
       case when (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1] <> 'pending'
            then (select id from d_admin) end,
       case when (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1] <> 'pending'
            then now() - ((s.n % 9) || ' days')::interval end
from d_stf s
where s.n % 2 = 0;

-- ---- timesheets: one per completed week, computed from real shifts ----
insert into public.timesheets (id, org_id, staff_profile_id, period_start, period_end,
                               total_minutes, status)
select pg_temp.demo_uuid(format('v3:tms:%s:%s:%s', s.org_i, s.n, wk.w)),
       s.org_id, s.id, wk.ws, wk.we,
       coalesce(sum((extract(epoch from (sh.ends_at - sh.starts_at)) / 60)::integer
                    - sh.break_minutes), 0)::integer,
       case when wk.w <= 1 then 'approved'
            when wk.w = 2 then 'submitted'
            else 'open' end
from d_stf s
cross join d_week wk
left join public.shifts sh
  on sh.staff_profile_id = s.id
 and sh.starts_at >= (wk.ws::timestamp at time zone 'Europe/London')
 and sh.starts_at <  ((wk.ws + 7)::timestamp at time zone 'Europe/London')
where wk.w <= 3
group by s.org_i, s.n, s.org_id, s.id, wk.w, wk.ws, wk.we;

-- ---- emergency contacts ---------------------------------------------
insert into public.emergency_contacts (id, org_id, staff_profile_id, name, relationship,
                                       phone, secondary_phone, medical_notes)
select pg_temp.demo_uuid(format('v3:emc:%s:%s', s.org_i, s.n)), s.org_id, s.id,
       format('%s %s', (array['Marie','Ade','Rosa','Chen','Nadia','Paul','Iris'])[((s.n - 1) % 7) + 1],
              s.last_name),
       (array['Partner','Parent','Sibling','Spouse','Friend'])[((s.n - 1) % 5) + 1],
       format('+4477115%s%s', s.org_i, lpad((s.n * 13)::text, 5, '0')),
       case when s.n % 2 = 0 then format('+4477226%s%s', s.org_i, lpad((s.n * 17)::text, 5, '0')) end,
       case when s.n % 9 = 3 then 'Carries an inhaler (asthma).'
            when s.n % 9 = 5 then 'Nut allergy. EpiPen in locker.' end
from d_stf s;

-- ---- announcements: one a week across the history and this week -------
insert into public.announcements (id, org_id, author_user_id, scope, location_id,
                                  department_id, title, body, urgent, published_at)
select pg_temp.demo_uuid(format('v3:ann:%s:%s', o.i, wk.w)),
       pg_temp.demo_uuid(format('v3:org:%s', o.i)), (select id from d_admin),
       (array['org','location','department','org','org','org'])[(wk.w % 6) + 1],
       case when (array['org','location','department','org','org','org'])[(wk.w % 6) + 1] = 'location'
            then pg_temp.demo_uuid(format('v3:loc:%s:%s', o.i, (wk.w % 2) + 1)) end,
       case when (array['org','location','department','org','org','org'])[(wk.w % 6) + 1] = 'department'
            then pg_temp.demo_uuid(format('v3:dep:%s:%s', o.i, (wk.w % 5) + 1)) end,
       (array[
         'Rota published. Please check your shifts',
         'Fire drill this Thursday at 14:00',
         'New starters joining the team this month',
         'Reminder: submit your timesheets by Sunday',
         'URGENT: severe weather. Site cover plan',
         'Autumn training dates are open for booking',
         'Payroll cut-off moves forward this month'])[(wk.w % 7) + 1]
         || ' (w/c ' || to_char(wk.ws, 'DD Mon') || ')',
       (array[
         'The rota for this week is live in RotaFlow. Please review your shifts and raise any swap requests before Friday.',
         'A full evacuation drill takes place on Thursday at 14:00. Assembly point is the main car park. Please make sure visitors are escorted out.',
         'Please join us in welcoming our newest team members. Their induction runs across their first two shifts. Do say hello.',
         'Timesheets close at 23:59 on Sunday. Anything submitted after that lands in the following pay run.',
         'Amber weather warning in force. If you cannot travel safely, call the on-call number before your shift starts. Do not travel and do not no-show.',
         'Autumn mandatory training dates are now bookable. Places are limited and expiring certificates are prioritised.',
         'Payroll cut-off is two working days earlier this month. Approve and submit timesheets accordingly.'])[(wk.w % 7) + 1],
       (wk.w % 7) = 4,
       (least(wk.ws, current_date) - 2)::timestamptz
from d_org o cross join d_week wk
where wk.w <= 6;

-- ---- notifications ---------------------------------------------------
insert into public.notifications (id, org_id, user_id, type, title, body, channel, read_at)
select pg_temp.demo_uuid(format('v3:ntf:%s:%s', s.org_i, s.n)), s.org_id,
       (select u.id from d_user u where u.org_i = s.org_i and u.tag = s.user_key),
       (array['rota_published','leave_approved','swap_request','announcement','shift_reminder'])[((s.n - 1) % 5) + 1],
       (array['Rota published','Leave approved','Swap request awaiting you',
              'New announcement','Shift starts in 2 hours'])[((s.n - 1) % 5) + 1],
       (array['The rota for this week has been published. Tap to view your shifts.',
              'Your holiday request has been approved by your manager.',
              'A colleague has asked to swap a shift with you. Tap to accept or decline.',
              'A new announcement has been posted for your organisation.',
              'Your next shift starts in 2 hours. Remember to clock in on arrival.'])[((s.n - 1) % 5) + 1],
       (array['push','email','push','push','push'])[((s.n - 1) % 5) + 1],
       case when s.n % 3 = 0 then now() - ((s.n % 5) || ' hours')::interval end
from d_stf s
where s.user_key is not null;

-- Extra unread notifications for each company's staff-test login, so the
-- bell carries a badge the moment you sign in as the line-staff view.
insert into public.notifications (id, org_id, user_id, type, title, body, channel, read_at)
select pg_temp.demo_uuid(format('v3:ntfw:%s:%s', s.org_i, g)), s.org_id,
       (select u.id from d_user u where u.org_i = s.org_i and u.tag = 'stafftest'),
       (array['shift_reminder','swap_request','rota_published','announcement'])[g],
       (array['Your next shift starts soon','Swap request awaiting you',
              'Next month''s rota is published','Weather warning for your site'])[g],
       (array['Tap to see the details and clock in when you arrive.',
              'A colleague has asked to swap a shift with you.',
              'Your shifts for the next four weeks are now visible.',
              'Amber warning in force. Call in before travelling if unsafe.'])[g],
       'push', null
from d_stf s cross join generate_series(1, 4) g
where s.user_key = 'stafftest';

-- ---- pending invites --------------------------------------------------
insert into public.invites (id, org_id, email, role, token_hash, invited_by, expires_at)
select pg_temp.demo_uuid(format('v3:inv:%s:%s', o.i, j)),
       pg_temp.demo_uuid(format('v3:org:%s', o.i)),
       format('new.starter%s@%s.example', j, o.slug),
       (array['staff','staff','manager','staff','staff'])[j],
       encode(sha256(extensions.gen_random_bytes(32)), 'hex'),
       (select id from d_admin), now() + ((j + 2) || ' days')::interval
from d_org o cross join generate_series(1, 5) j;

-- ---- audit log --------------------------------------------------------
insert into public.audit_logs (id, org_id, actor_user_id, action, entity_type,
                               entity_id, metadata, created_at)
select pg_temp.demo_uuid(format('v3:aud:%s:%s', o.i, j)),
       pg_temp.demo_uuid(format('v3:org:%s', o.i)), (select id from d_admin),
       (array['org.created','rota.published','staff.invited','leave.approved',
              'settings.updated','rota.published','document.expired','shift.reassigned'])[j],
       (array['organisation','rota','invite','leave_request',
              'organisation','rota','document','shift'])[j],
       null,
       jsonb_build_object('source', 'demo_seed', 'org', o.slug),
       now() - ((20 - (j * 2)) || ' days')::interval
from d_org o cross join generate_series(1, 8) j
on conflict (id) do nothing;

-- =====================================================================
-- 8. Shift swaps. Needs shifts, so it runs after them.
-- =====================================================================
insert into public.shift_swaps (id, org_id, shift_id, requested_by, target_staff_profile_id,
                                status, note, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v3:swp:%s:%s', c.org_i, c.rn)), c.org_id, c.id, c.staff_profile_id,
       (select s2.id from d_stf s2
         where s2.org_i = c.org_i and s2.loc_j = c.loc_j and s2.pattern <> c.pattern
         order by s2.n limit 1),
       (array['pending','pending','accepted','approved','rejected','pending','accepted','approved'])[c.rn],
       format('Can anyone cover %s? Happy to swap for a later shift.',
              to_char(c.starts_at at time zone 'Europe/London', 'Dy DD Mon')),
       case when (array['pending','pending','accepted','approved','rejected','pending','accepted','approved'])[c.rn]
                 in ('approved','rejected') then (select id from d_admin) end,
       case when (array['pending','pending','accepted','approved','rejected','pending','accepted','approved'])[c.rn]
                 in ('approved','rejected') then now() - interval '1 day' end
from (
  select sh.id, sh.org_id, sh.staff_profile_id, sh.starts_at,
         st.org_i, st.loc_j, st.pattern,
         row_number() over (partition by sh.org_id order by sh.starts_at, sh.id) as rn
  from public.shifts sh
  join d_stf st on st.id = sh.staff_profile_id
  where sh.starts_at > now()
) c
where c.rn <= 8;

-- =====================================================================
-- 9. Clock events.
--
-- Every finished shift in the last four weeks gets a realistic in/out pair
-- with deterministic minute jitter, plus break events on the long shifts,
-- so Timesheets and the attendance views have genuine history. Deliberate
-- anomalies follow, and finally the people who are clocked in right now.
-- =====================================================================
create temp table d_worked as
select sh.id, sh.org_id, sh.staff_profile_id, sh.starts_at, sh.ends_at, sh.break_minutes,
       l.latitude, l.longitude, l.name as loc_name,
       (extract(epoch from sh.starts_at)::bigint / 60) as seed_min,
       row_number() over (partition by sh.org_id order by sh.starts_at desc, sh.id) as recency
from public.shifts sh
join public.locations l on l.id = sh.location_id
join d_stf st on st.id = sh.staff_profile_id
where sh.ends_at < now()
  and sh.starts_at > now() - interval '28 days';

-- (a) NO-SHOW: two recent shifts per company with no clock events at all.
--     (b) MISSING CLOCK-OUT: one clocked in and never out.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v3:clk:in:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'in',
       w.starts_at + make_interval(mins => (case when w.seed_min % 11 = 0 then 18 + (w.seed_min % 13)
                                                 else (w.seed_min % 9) - 4 end)::integer),
       w.latitude, w.longitude, 6.0 + (w.seed_min % 12), 'gps', w.loc_name, true
from d_worked w
where w.recency not in (3, 9);

insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v3:clk:out:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'out',
       w.ends_at + make_interval(mins => ((w.seed_min % 7) - 2)::integer),
       w.latitude, w.longitude, 6.0 + (w.seed_min % 12), 'gps', w.loc_name, true
from d_worked w
where w.recency not in (2, 3, 9);

-- Break events on the long shifts, so a break-aware timesheet has data.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v3:clk:bs:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'break_start',
       w.starts_at + interval '4 hours' + make_interval(mins => (w.seed_min % 20)::integer),
       w.latitude, w.longitude, 9.0, 'gps', w.loc_name, true
from d_worked w
where w.break_minutes >= 45 and w.recency not in (3, 9);

insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v3:clk:be:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'break_end',
       w.starts_at + interval '4 hours' + make_interval(mins => ((w.seed_min % 20) + w.break_minutes)::integer),
       w.latitude, w.longitude, 9.0, 'gps', w.loc_name, true
from d_worked w
where w.break_minutes >= 45 and w.recency not in (3, 9);

-- (c) OFFLINE, NOT YET SYNCED: events created on a phone with no signal.
update public.clock_events c
   set synced = false, method = 'manual'
  from d_worked w
 where c.shift_id = w.id and w.recency in (5, 6);

-- (d) CLOCKED IN RIGHT NOW. Whoever is genuinely mid-shift.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v3:clk:live:' || sh.id::text), sh.org_id, sh.staff_profile_id, sh.id, 'in',
       sh.starts_at + make_interval(mins => ((extract(epoch from sh.starts_at)::bigint / 60) % 7 - 3)::integer),
       l.latitude, l.longitude, 10.0, 'gps', l.name, true
from public.shifts sh
join public.locations l on l.id = sh.location_id
join d_stf st on st.id = sh.staff_profile_id
where sh.starts_at <= now() and sh.ends_at > now();

-- Fallback: if a company happens to have nobody mid-shift at the hour the
-- seed runs, the Clock In screen still needs a live state to show.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid(format('v3:clk:livefb:%s', s.org_i)), s.org_id, s.id, null, 'in',
       now() - interval '2 hours',
       l.lat, l.lon, 12.0, 'gps', l.name, true
from d_stf s
join d_branch l on l.org_i = s.org_i and l.j = s.loc_j
where s.user_key = 'owner'
  and not exists (
    select 1
    from public.shifts sh2
    where sh2.org_id = s.org_id
      and sh2.staff_profile_id is not null
      and sh2.starts_at <= now() and sh2.ends_at > now());

-- =====================================================================
-- Verification. All five companies should report a full three months.
-- =====================================================================
select o.name,
       (select count(*) from public.memberships       x where x.org_id = o.id) as members,
       (select count(*) from public.locations         x where x.org_id = o.id) as branches,
       (select count(*) from public.staff_profiles    x where x.org_id = o.id) as staff,
       (select count(*) from public.shift_types       x where x.org_id = o.id) as shift_types,
       (select count(*) from public.shift_templates   x where x.org_id = o.id) as templates,
       (select count(*) from public.rotas             x where x.org_id = o.id) as rotas,
       (select count(*) from public.shifts            x where x.org_id = o.id) as shifts,
       (select count(*) from public.shifts            x where x.org_id = o.id and x.status = 'open') as open_shifts,
       (select count(*) from public.shifts            x where x.org_id = o.id and x.starts_at <  now()) as past_shifts,
       (select count(*) from public.shifts            x where x.org_id = o.id and x.starts_at >= now()) as future_shifts,
       (select count(*) from public.availability      x where x.org_id = o.id) as availability,
       (select count(*) from public.leave_requests    x where x.org_id = o.id) as leave,
       (select count(*) from public.overtime_requests x where x.org_id = o.id) as overtime,
       (select count(*) from public.shift_swaps       x where x.org_id = o.id) as swaps,
       (select count(*) from public.clock_events      x where x.org_id = o.id) as clock_events,
       (select count(*) from public.timesheets        x where x.org_id = o.id) as timesheets,
       (select count(*) from public.documents         x where x.org_id = o.id) as documents,
       (select count(*) from public.announcements     x where x.org_id = o.id) as announcements,
       (select count(*) from public.notifications     x where x.org_id = o.id) as notifications,
       (select count(*) from public.invites           x where x.org_id = o.id) as invites,
       (select count(*) from public.audit_logs        x where x.org_id = o.id) as audit_logs,
       (select min(period_start) from public.rotas    x where x.org_id = o.id) as rota_from,
       (select max(period_end)   from public.rotas    x where x.org_id = o.id) as rota_to
from public.organisations o
where o.slug in ('northgate-care','harbour-view-hotels','brightside-retail',
                 'clearway-logistics','meridian-security')
order by o.name;
