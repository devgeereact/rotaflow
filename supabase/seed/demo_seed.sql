-- =====================================================================
-- demo_seed.sql. RotaFlow showcase dataset (v2, three-month build)
--
-- Builds five demo organisations with a *rolling three-month rota*. The
-- current month plus the two after it, with three weeks of completed
-- history behind it. Every section of the app is populated, and a set of
-- deliberate problems is planted so the demo exercises the warning,
-- conflict and shortage paths rather than only the happy one.
--
-- RUN IT:  paste the whole file into the Supabase SQL editor and run once,
--          or POST it to /v1/projects/<ref>/database/query. Run it as a
--          single unit. It uses session-local temp tables.
--
-- IDEMPOTENT BY RESET: every id is derived deterministically from a key, so
-- re-running DELETES the demo organisations (cascading to all their rows)
-- and rebuilds them. All dates are relative to `current_date`, so a re-run
-- re-centres the whole three months on today. Re-running is the supported
-- way to refresh the demo before a client call.
--
-- SAFETY: it only ever touches rows whose ids it derives itself, plus the
-- eight demo auth users. Organisations created through the app, including
-- "City Hospital Care Group" and "GAKINZ". Are never read or written.
--
-- Teardown: supabase/seed/demo_teardown.sql
-- Docs:     supabase/seed/README.md
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

-- ---------------------------------------------------------------------
-- Reset. Both the v1 keys (`org:N`) and the v2 keys (`v2:org:N`) are
-- dropped, so upgrading from the old single-week seed leaves nothing
-- orphaned. Every domain table FKs org_id ON DELETE CASCADE.
-- ---------------------------------------------------------------------
delete from public.organisations
where id in (
  pg_temp.demo_uuid('org:1'), pg_temp.demo_uuid('org:2'), pg_temp.demo_uuid('org:3'),
  pg_temp.demo_uuid('org:4'), pg_temp.demo_uuid('org:5'),
  pg_temp.demo_uuid('v2:org:1'), pg_temp.demo_uuid('v2:org:2'), pg_temp.demo_uuid('v2:org:3'),
  pg_temp.demo_uuid('v2:org:4'), pg_temp.demo_uuid('v2:org:5')
);

-- =====================================================================
-- 0. Accounts. The platform admin plus eight role accounts.
-- =====================================================================
do $accounts$
declare
  -- SET THIS BEFORE RUNNING. Deliberately not a real value: this repository
  -- is public, so any password committed here is a public credential for
  -- real, email-confirmed accounts on the live project.
  c_password  constant text := 'CHANGE-ME-BEFORE-SEEDING';
  c_admin_email constant text := 'gakinz101@gmail.com';

  -- Plus-addressed on the owner's real mailbox: deliverable (so password
  -- resets and magic links actually arrive) and incapable of bouncing,
  -- which a fake domain would do. Supabase already flagged bounce rate.
  u_keys   text[] := array['owner','manager1','manager2','staff1','staff2','staff3','staff4','worker'];
  u_emails text[] := array[
    'gakinz101+demo.owner@gmail.com','gakinz101+demo.manager1@gmail.com',
    'gakinz101+demo.manager2@gmail.com','gakinz101+demo.staff1@gmail.com',
    'gakinz101+demo.staff2@gmail.com','gakinz101+demo.staff3@gmail.com',
    'gakinz101+demo.staff4@gmail.com','gakinz101+demo.worker@gmail.com'];
  u_names  text[] := array[
    'Amelia Hart','Daniel Okafor','Priya Raman','James Whitfield',
    'Sofia Marchetti','Tomas Nowak','Grace Adeyemi','Maya Whitfield'];
  v_admin  uuid;
  v_uid    uuid;
  v_new    uuid;
  v_has_pid boolean;
  j        integer;
begin
  if c_password = 'CHANGE-ME-BEFORE-SEEDING' or length(c_password) < 12 then
    raise exception
      'Set c_password to your own strong value before seeding. This repository is public, so a committed password would be a public credential for real accounts.';
  end if;

  v_has_pid := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id');

  select id into v_admin from auth.users where lower(email) = c_admin_email;
  if v_admin is null then
    raise exception
      'No auth user for %. Sign up in the app first, then re-run this seed.', c_admin_email;
  end if;

  -- Super Admin. This is the only write the seed makes outside its own rows.
  update public.profiles
     set is_platform_admin = true,
         full_name = coalesce(full_name, 'Gideon Akinlotan')
   where id = v_admin;

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
    else
      -- v1 reused an existing account and left its password alone, which meant
      -- the value handed to whoever runs the demo was only *probably* the live
      -- one. Rotate it on every run so `c_password` is always the truth.
      update auth.users
         set encrypted_password = extensions.crypt(c_password, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
    end if;

    -- handle_new_user() fills profiles on insert; make the name right either way.
    update public.profiles p set full_name = u_names[j]
     from auth.users au
    where au.id = p.id and lower(au.email) = u_emails[j];
  end loop;
end;
$accounts$;

-- =====================================================================
-- 1. Catalogue temp tables. Everything below is built set-based off
--    these. Seventeen weeks across five orgs is far too much data for
--    row-at-a-time PL/pgSQL loops to finish inside an API request.
-- =====================================================================
drop table if exists d_user, d_admin, d_org, d_week, d_loc, d_dep, d_sty, d_pat, d_stf, d_worked;

-- ---- who is who -----------------------------------------------------
create temp table d_user as
select j,
       (array['owner','manager1','manager2','staff1','staff2','staff3','staff4','worker'])[j] as k,
       u.id
from generate_series(1, 8) j
join auth.users u
  on lower(u.email) = (array[
       'gakinz101+demo.owner@gmail.com','gakinz101+demo.manager1@gmail.com',
       'gakinz101+demo.manager2@gmail.com','gakinz101+demo.staff1@gmail.com',
       'gakinz101+demo.staff2@gmail.com','gakinz101+demo.staff3@gmail.com',
       'gakinz101+demo.staff4@gmail.com','gakinz101+demo.worker@gmail.com'])[j];

create temp table d_admin as
select id from auth.users where lower(email) = 'gakinz101@gmail.com';

-- ---- organisations --------------------------------------------------
-- n_staff / n_pat: the flagship carries a full 30-person roster on six
-- rotating patterns; the other four run 15 on three. Both fill every day
-- of the week at every site, which is what "enough staff to fill all
-- positions" has to mean in data.
create temp table d_org as
select i,
       pg_temp.demo_uuid('v2:org:' || i)                                              as id,
       (array['Northgate Care Group','Harbour View Hotels','Brightside Retail',
              'Clearway Logistics','Meridian Security'])[i]                           as name,
       (array['northgate-care','harbour-view-hotels','brightside-retail',
              'clearway-logistics','meridian-security'])[i]                           as slug,
       (array['business','professional','professional','starter','business'])[i]      as plan,
       (array['Healthcare','Hospitality','Retail','Logistics','Security'])[i]         as industry,
       (array['51-200','11-50','51-200','201-500','51-200'])[i]                       as org_size,
       (array[30,15,15,15,15])[i]                                                     as n_staff,
       (array[6,3,3,3,3])[i]                                                          as n_pat,
       (array['paypal','apple_pay','google_pay','paypal','apple_pay'])[i]             as sub_provider,
       (array['active','active','active','trialing','active'])[i]                     as sub_status
from generate_series(1, 5) i;

-- ---- the three-month window ----------------------------------------
-- w = 0..16 : three completed weeks of history, this week (w = 3), then
-- thirteen weeks ahead. Anchored on current_date, so a re-run always
-- yields "this month plus the two after it" with real history behind it.
create temp table d_week as
select w,
       (date_trunc('week', current_date)::date - 21 + (w * 7))     as ws,
       (date_trunc('week', current_date)::date - 21 + (w * 7) + 6) as we
from generate_series(0, 16) w;

-- ---- locations ------------------------------------------------------
create temp table d_loc as
select o.i as org_i, j,
       pg_temp.demo_uuid(format('v2:loc:%s:%s', o.i, j)) as id,
       o.id as org_id,
       (array[
         array['Northgate House','Willow Court','Ashfield Lodge','Rosewood Manor','Meadowbank Court'],
         array['Harbour View Brighton','Harbour View Whitby','Harbour View St Ives','Harbour View Tenby','Harbour View Oban'],
         array['Brightside Arndale','Brightside Trafford','Brightside Liverpool ONE','Brightside Meadowhall','Brightside Trinity Leeds'],
         array['Clearway Daventry DC','Clearway Warrington Hub','Clearway Thurrock Hub','Clearway Bristol Depot','Clearway Newcastle Depot'],
         array['Meridian Canary Wharf','Meridian Birmingham Central','Meridian Glasgow Riverside','Meridian Cardiff Bay','Meridian Nottingham Gateway']
       ])[o.i][j] as name,
       (array[
         array['14 Northgate Road, Leeds LS1 4AB','8 Willow Lane, Leeds LS2 9JT','51 Ashfield Way, Bradford BD1 1PR','3 Rosewood Drive, Wakefield WF1 2DE','22 Meadowbank Avenue, Harrogate HG1 5AY'],
         array['2 Kings Road, Brighton BN1 1NB','5 Pier Road, Whitby YO21 3PU','9 The Wharf, St Ives TR26 1LF','12 Esplanade, Tenby SA70 7DU','4 George Street, Oban PA34 5NT'],
         array['1 Market Street, Manchester M4 3AQ','7 The Dome, Trafford Centre, Manchester M17 8DA','21 South John Street, Liverpool L1 8BU','44 High Street, Meadowhall, Sheffield S9 1EP','15 Albion Street, Leeds LS1 5AT'],
         array['Royal Oak Way, Daventry NN11 8QL','Kingsland Grange, Warrington WA1 4RW','Oliver Road, West Thurrock RM20 3ED','Sherbourne Avenue, Bristol BS32 4AH','Balliol Business Park, Newcastle NE12 8EW'],
         array['30 Bank Street, London E14 5NR','120 Colmore Row, Birmingham B3 3BD','8 Pacific Quay, Glasgow G51 1EA','5 Bute Place, Cardiff CF10 5AL','2 Castle Wharf, Nottingham NG1 7EL']
       ])[o.i][j] as address,
       (array[
         array[53.8008,53.8067,53.7960,53.6833,53.9926],
         array[50.8214,54.4863,50.2110,51.6725,56.4152],
         array[53.4830,53.4652,53.4040,53.4136,53.7975],
         array[52.2610,53.4100,51.4830,51.5380,55.0350],
         array[51.5040,52.4810,55.8590,51.4640,52.9500]
       ])[o.i][j] as latitude,
       (array[
         array[-1.5491,-1.5550,-1.7594,-1.4977,-1.5418],
         array[-0.1500,-0.6133,-5.4800,-4.7050,-5.4714],
         array[-2.2380,-2.3480,-2.9860,-1.4130,-1.5450],
         array[-1.1500,-2.5470, 0.2810,-2.5570,-1.6100],
         array[-0.0190,-1.9030,-4.2900,-3.1620,-1.1520]
       ])[o.i][j] as longitude,
       (array[
         array[120,120,150,150,100], array[100,120,100,120,150],
         array[80,80,80,100,80],     array[300,300,250,200,200],
         array[150,120,200,150,120]
       ])[o.i][j] as radius
from d_org o cross join generate_series(1, 5) j;

-- ---- departments (org-wide: listDepartments() is org-scoped) ---------
create temp table d_dep as
select o.i as org_i, k,
       pg_temp.demo_uuid(format('v2:dep:%s:%s', o.i, k)) as id,
       o.id as org_id,
       (array[
         array['Nursing','Care','Kitchen','Housekeeping','Reception'],
         array['Front Desk','Housekeeping','Food & Beverage','Maintenance','Events'],
         array['Sales Floor','Stockroom','Checkout','Visual Merchandising','Click & Collect'],
         array['Inbound','Outbound','Transport','Fleet Maintenance','Goods-In QC'],
         array['Static Guarding','Mobile Patrol','Control Room','Event Security','Key Holding']
       ])[o.i][k] as name
from d_org o cross join generate_series(1, 5) k;

-- ---- shift types ----------------------------------------------------
-- Six per org. `colour` is restricted to the eight swatches in
-- src/lib/shiftPalette.ts. Anything else falls through
-- paletteTintForColour() to the grey default, which is exactly why the
-- v1 seed rendered every chip colourless.
create temp table d_sty as
select o.i as org_i, k,
       pg_temp.demo_uuid(format('v2:sty:%s:%s', o.i, k)) as id,
       o.id as org_id,
       (array[
         array['Early','Late','Night','Twilight','Long Day','On-Call'],
         array['Breakfast','Reception Day','Evening','Night Porter','Banquet','Housekeeping AM'],
         array['Opening','Mid','Closing','Stock Delivery','Weekend Peak','Click & Collect'],
         array['Day Shift','Back Shift','Night Shift','Weekend Cover','Driver Trunk','Goods-In'],
         array['Day Guard','Night Guard','Control Room AM','Control Room PM','Event Cover','Mobile Patrol']
       ])[o.i][k] as name,
       -- Sky, Violet, Indigo, Amber, Teal, Moss. All palette hexes.
       (array['#56AACD','#C48FD6','#6CA0EB','#C69A45','#4FB39A','#86AC6A'])[k] as colour,
       (array[
         array['07:00','14:00','21:45','17:00','08:00','09:00'],
         array['06:00','08:00','15:00','22:30','16:00','07:30'],
         array['08:30','11:00','13:30','05:00','10:00','12:00'],
         array['06:00','14:00','22:00','08:00','04:00','09:00'],
         array['07:00','19:00','06:00','14:00','16:00','10:00']
       ])[o.i][k]::time as t_start,
       (array[
         array['15:00','22:00','07:15','23:00','20:00','17:00'],
         array['14:00','16:00','23:00','06:30','00:00','15:30'],
         array['16:30','19:00','21:30','11:00','18:00','20:00'],
         array['14:00','22:00','06:00','20:00','12:00','17:00'],
         array['19:00','07:00','14:00','22:00','02:00','18:00']
       ])[o.i][k]::time as t_end,
       (array[
         array['day','day','night','evening','day','on_call'],
         array['day','day','evening','night','evening','day'],
         array['day','day','evening','early','day','day'],
         array['day','evening','night','day','early','day'],
         array['day','night','day','evening','evening','day']
       ])[o.i][k] as category,
       (array[30,30,45,30,60,0])[k] as break_minutes
from d_org o cross join generate_series(1, 6) k;

-- ---- rotating patterns ----------------------------------------------
-- One row per (roster size, pattern, weekday). dow: 0 = Monday.
-- Six-pattern roster (flagship): every site has four people on every day
-- of the week, with earlies, lates, nights and a long day all covered.
-- Three-pattern roster: two to three people on every day of the week.
create temp table d_pat(n_pat int, pattern int, sty_k int, dow int);
insert into d_pat (n_pat, pattern, sty_k, dow) values
  -- flagship, 6 patterns ------------------------------------------------
  (6,1,1,0),(6,1,1,1),(6,1,1,2),(6,1,1,3),(6,1,1,4),          -- Earlies, Mon-Fri
  (6,2,2,0),(6,2,2,1),(6,2,2,2),(6,2,2,3),(6,2,2,4),          -- Lates, Mon-Fri
  (6,3,3,2),(6,3,3,3),(6,3,3,4),(6,3,3,5),(6,3,3,6),          -- Nights, Wed-Sun
  (6,4,5,0),(6,4,5,1),(6,4,5,2),(6,4,5,5),(6,4,5,6),          -- Long days, Mon-Wed + weekend
  (6,5,4,3),(6,5,4,4),(6,5,4,5),(6,5,4,6),                    -- Twilights, Thu-Sun
  (6,6,1,5),(6,6,1,6),(6,6,1,0),(6,6,1,1),(6,6,1,2),          -- Weekend-in earlies, Sat-Wed
  -- everyone else, 3 patterns -------------------------------------------
  (3,1,1,0),(3,1,1,1),(3,1,1,2),(3,1,1,3),(3,1,1,4),
  (3,2,2,2),(3,2,2,3),(3,2,2,4),(3,2,2,5),(3,2,2,6),
  (3,3,3,5),(3,3,3,6),(3,3,3,0),(3,3,3,1),(3,3,3,2);

-- ---- staff ----------------------------------------------------------
-- loc_j and pattern fall out of the roster index, so each site gets one
-- person on each pattern and nobody is left without a home site.
create temp table d_stf as
with base as (
  select o.i as org_i, n, o.id as org_id, o.slug, o.n_pat,
         ((n - 1) / o.n_pat) + 1 as loc_j,
         ((n - 1) % o.n_pat) + 1 as pattern
  from d_org o cross join lateral generate_series(1, o.n_staff) n
)
select b.*,
       pg_temp.demo_uuid(format('v2:stf:%s:%s', b.org_i, b.n)) as id,
       -- Login-backed rows have to carry the account's real name; the rest
       -- come from two name pools, offset per org so no org repeats a name.
       coalesce(
         (array['Gideon','Daniel','Priya','James','Sofia','Maya'])[
           case when b.org_i = 1 and b.n <= 6 then b.n end],
         (array['Amelia','Tomas','Grace'])[
           case when b.org_i = 2 and b.n <= 3 then b.n end],
         (array['Hannah','Owen','Leila','Ryan','Nia','Victor','Karol','Denise','Femi','Ruth',
                'Nathan','Aisha','Gary','Elena','Josh','Bethany','Chris','Diana','Ethan','Farah',
                'Alex','Olivia','Michael','Emily','Sarah','Liam','Rosa','Chen','Ade','Marie',
                'Isla','Callum','Jonah','Keira','Bilal','Tara','Noah','Zara','Kofi','Lena'])[
           ((b.n * 7 + b.org_i * 11) % 40) + 1]
       ) as first_name,
       coalesce(
         (array['Akinlotan','Okafor','Raman','Whitfield','Marchetti','Whitfield'])[
           case when b.org_i = 1 and b.n <= 6 then b.n end],
         (array['Hart','Nowak','Adeyemi'])[
           case when b.org_i = 2 and b.n <= 3 then b.n end],
         (array['Clarke','Price','Ahmed','Docherty','Bevan','Mensah','Wisniewski','Hughes','Balogun','Kelly',
                'Boateng','Malik','Sutcliffe','Petrova','Lambert','Johnson','Brown','Davis','Wright','Hussain',
                'Morgan','Patel','Reid','Fraser','Doyle','Osei','Nowicki','Ferreira','Adeoye','Quinn',
                'Baxter','Mullen','Sharma','Ellis','Rahman','Griffiths','Sandhu','Novak','Byrne','Achebe'])[
           ((b.n * 13 + b.org_i * 5) % 40) + 1]
       ) as last_name,
       (array[
         array['Registered Manager','Deputy Manager','Senior Nurse','Care Assistant','Kitchen Assistant','Senior Care Assistant'],
         array['General Manager','Front Desk Supervisor','Housekeeping Lead','Night Porter','F&B Assistant','Events Coordinator'],
         array['Store Manager','Assistant Manager','Sales Advisor','Stock Assistant','Checkout Supervisor','Click & Collect Lead'],
         array['Shift Supervisor','LGV Driver','Warehouse Operative','Forklift Operator','Transport Planner','Goods-In Checker'],
         array['Security Supervisor','Control Room Operator','Static Guard','Mobile Patrol Officer','Event Steward','Key Holder']
       ])[b.org_i][b.pattern] as job_title,
       ((b.pattern - 1) % 5) + 1 as dept_k,
       (array[
         array['Safeguarding,Medication,First Aid','Safeguarding,Moving & Handling,First Aid','Medication,Wound Care,IV','Moving & Handling,Dementia Care','Food Hygiene L2,Allergen Awareness','Safeguarding,Medication,Dementia Care'],
         array['Front Office,Revenue Management','Opera PMS,Customer Service','COSHH,Team Leading','Fire Marshal,First Aid','Food Hygiene L2,Barista','Events,Licensing'],
         array['People Management,Loss Prevention','Merchandising,Cash Handling','Customer Service,Till','Manual Handling,Stock Control','Cash Handling,Age Verification','Click & Collect,Stock Control'],
         array['Team Leading,Manual Handling','LGV C+E,Digi Tacho,ADR','Manual Handling,Picking','Counterbalance FLT,Reach FLT','Route Planning,WMS','Goods-In QC,Manual Handling'],
         array['SIA Door Supervisor,First Aid','CCTV (PSS),Control Room','SIA Security Guard,Fire Marshal','SIA Security Guard,Driving','SIA Door Supervisor,Crowd Safety','SIA Security Guard,Key Holding']
       ])[b.org_i][b.pattern] as skills,
       -- A real roster is not all full-time; part-timers and zero-hours are
       -- what make the contracted-hours warnings mean anything.
       case when b.n % 7 = 0 then 'zero_hours'
            when b.n % 5 = 0 then 'part_time'
            when b.n % 11 = 0 then 'casual'
            else 'full_time' end as contract_type,
       case when b.n % 7 = 0 then 0.0
            when b.n % 5 = 0 then 22.5
            when b.n % 11 = 0 then 16.0
            else 37.5 end as weekly_hours,
       -- Which demo login owns this row. NULL = record only.
       case
         when b.org_i = 1 and b.n = 1 then 'admin'
         when b.org_i = 1 and b.n = 2 then 'manager1'
         when b.org_i = 1 and b.n = 3 then 'manager2'
         when b.org_i = 1 and b.n = 4 then 'staff1'
         when b.org_i = 1 and b.n = 5 then 'staff2'
         when b.org_i = 1 and b.n = 6 then 'worker'
         when b.org_i = 2 and b.n = 1 then 'owner'
         when b.org_i = 2 and b.n = 2 then 'staff3'
         when b.org_i = 2 and b.n = 3 then 'staff4'
       end as user_key
from base b;

-- =====================================================================
-- 2. Core rows
-- =====================================================================
insert into public.organisations (id, name, slug, plan, settings, created_by)
select o.id, o.name, o.slug, o.plan,
       jsonb_build_object('industry', o.industry, 'size', o.org_size,
                          'locale', 'en-GB', 'timezone', 'Europe/London',
                          'week_starts_on', 'monday', 'demo', true),
       a.id
from d_org o cross join d_admin a;

insert into public.subscriptions (id, org_id, plan, status, provider, provider_ref, current_period_end)
select pg_temp.demo_uuid(format('v2:sub:%s', o.i)), o.id, o.plan, o.sub_status,
       o.sub_provider, 'demo_' || o.slug, now() + interval '30 days'
from d_org o;

insert into public.locations (id, org_id, name, address, latitude, longitude, timezone, geofence_radius_m)
select l.id, l.org_id, l.name, l.address, l.latitude, l.longitude, 'Europe/London', l.radius
from d_loc l;

insert into public.departments (id, org_id, location_id, name)
select d.id, d.org_id, null, d.name from d_dep d;

insert into public.shift_types (id, org_id, name, colour, default_start, default_end, is_paid, category)
select s.id, s.org_id, s.name, s.colour, s.t_start, s.t_end, s.category <> 'on_call', s.category
from d_sty s;

-- Templates: every shift type at the first three sites, so the Templates
-- rail offers a real library rather than one site's worth.
insert into public.shift_templates (id, org_id, name, shift_type_id, location_id, department_id,
                                    start_time, end_time, break_minutes, required_skills)
select pg_temp.demo_uuid(format('v2:tpl:%s:%s:%s', s.org_i, s.k, l.j)),
       s.org_id,
       format('%s · %s', s.name, l.name),
       s.id, l.id,
       (select d.id from d_dep d where d.org_i = s.org_i and d.k = ((s.k - 1) % 5) + 1),
       s.t_start, s.t_end, s.break_minutes,
       string_to_array(
         (select st.skills from d_stf st
           where st.org_i = s.org_i and st.pattern = least(s.k, st.n_pat) limit 1), ',')
from d_sty s
join d_loc l on l.org_i = s.org_i
where l.j <= 3;

insert into public.staff_profiles (
  id, org_id, user_id, first_name, last_name, job_title, department_id,
  contract_type, weekly_hours, holiday_allowance, skills, payroll_id,
  start_date, phone, active)
select s.id, s.org_id,
       case when s.user_key = 'admin' then (select id from d_admin)
            else (select u.id from d_user u where u.k = s.user_key) end,
       s.first_name, s.last_name, s.job_title,
       (select d.id from d_dep d where d.org_i = s.org_i and d.k = s.dept_k),
       s.contract_type, s.weekly_hours, 28.0,
       string_to_array(s.skills, ','),
       format('%s-%s', upper(left(s.slug, 3)), lpad((100 + s.n)::text, 4, '0')),
       current_date - (120 + (s.n * 37) + (s.org_i * 23)),
       format('+4477%s%s', lpad(s.org_i::text, 2, '0'), lpad((100000 + s.n * 137)::text, 7, '0')),
       true
from d_stf s;

-- Memberships for every login-backed staff row.
insert into public.memberships (id, org_id, user_id, role, status)
select pg_temp.demo_uuid(format('v2:mem:%s:%s', s.org_i, s.n)), s.org_id,
       (select u.id from d_user u where u.k = s.user_key),
       case when s.user_key = 'owner' then 'owner'
            when s.user_key in ('manager1','manager2') then 'manager'
            else 'staff' end,
       'active'
from d_stf s
where s.user_key is not null and s.user_key <> 'admin'
on conflict (org_id, user_id) do nothing;

-- Daniel Okafor also covers Harbour View; orgs 3-5 get head-office logins so
-- the Team page is populated even though their staff records aren't invited yet.
insert into public.memberships (id, org_id, user_id, role, status)
select pg_temp.demo_uuid(format('v2:memho:%s:%s', o.i, u.j)), o.id, u.id,
       case when u.k in ('manager1','manager2') then 'manager' else 'staff' end,
       'active'
from d_org o
join d_user u on (o.i = 2 and u.k = 'manager1') or (o.i >= 3 and u.j <= 5)
on conflict (org_id, user_id) do nothing;

-- =====================================================================
-- 3. Rotas, one per site per week, for all seventeen weeks.
--
-- This is load-bearing, not tidiness: RotaBuilderPage calls
-- getOrCreateRotaForPeriod(org, location, Monday..Sunday) and then reads
-- shifts *by rota id*. A week with no rota row for a site gets a fresh
-- empty draft on open, and the seeded shifts. Attached to some other
-- rota, never appear. v1 seeded site 1 only, which is why four of the
-- five sites looked blank.
-- =====================================================================
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, published_at)
select pg_temp.demo_uuid(format('v2:rota:%s:%s:%s', l.org_i, l.j, wk.w)),
       l.org_id, l.id,
       format('%s. W/c %s', l.name, to_char(wk.ws, 'DD Mon YYYY')),
       wk.ws, wk.we,
       -- The last two weeks stay draft: an in-progress future is what the
       -- publish flow needs to demonstrate against.
       case when wk.w >= 15 then 'draft' else 'published' end,
       case when wk.w >= 15 then null
            else (least(wk.ws, current_date) - 9)::timestamptz end
from d_loc l cross join d_week wk;

-- =====================================================================
-- 4. Shifts. The rolling three-month rota.
-- =====================================================================
insert into public.shifts (
  id, org_id, rota_id, location_id, department_id, staff_profile_id,
  shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
select
  pg_temp.demo_uuid(format('v2:sft:%s:%s:%s:%s', s.org_i, s.n, wk.w, p.dow)),
  s.org_id,
  pg_temp.demo_uuid(format('v2:rota:%s:%s:%s', s.org_i, s.loc_j, wk.w)),
  (select l.id from d_loc l where l.org_i = s.org_i and l.j = s.loc_j),
  (select d.id from d_dep d where d.org_i = s.org_i and d.k = s.dept_k),
  s.id,
  ty.id,
  ((wk.ws + p.dow)::timestamp + ty.t_start) at time zone 'Europe/London',
  ((wk.ws + p.dow + case when ty.t_end <= ty.t_start then 1 else 0 end)::timestamp + ty.t_end)
    at time zone 'Europe/London',
  ty.break_minutes,
  case
    when ((wk.ws + p.dow)::timestamp + ty.t_start) at time zone 'Europe/London' < now()
      then 'confirmed'
    when wk.w <= 5 then 'confirmed'      -- the next couple of weeks are settled
    else 'assigned'
  end,
  ty.colour,
  case when (s.n + wk.w) % 23 = 0 then 'Covering annual leave.'
       when (s.n + wk.w) % 29 = 0 then 'Induction buddy for a new starter.'
  end
from d_stf s
join d_pat p on p.n_pat = s.n_pat and p.pattern = s.pattern
cross join d_week wk
join d_sty ty
  on ty.org_i = s.org_i
 -- Pattern 6 alternates earlies and lates week by week, a real rolling
 -- rota, and it gives the pattern filter something to actually find.
 and ty.k = case when s.pattern = 6 and wk.w % 2 = 1 then 2 else p.sty_k end;

-- =====================================================================
-- 5. Deliberate problems. Everything above is a healthy rota; a demo that
--    only shows a healthy rota never exercises the warnings.
-- =====================================================================

-- (a) SHORTAGE: unfill weekend night and twilight cover at two sites,
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
  and st.pattern in (3, 5)
  and st.loc_j in (2, 4)
  and extract(dow from s.starts_at at time zone 'Europe/London') in (0, 6);

-- (b) DOUBLE BOOKING: one person on two overlapping shifts next week.
insert into public.shifts (
  id, org_id, rota_id, location_id, department_id, staff_profile_id,
  shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
select
  pg_temp.demo_uuid(format('v2:clash:%s', s.org_i)),
  s.org_id,
  pg_temp.demo_uuid(format('v2:rota:%s:%s:%s', s.org_i, s.loc_j, 4)),
  (select l.id from d_loc l where l.org_i = s.org_i and l.j = s.loc_j),
  (select d.id from d_dep d where d.org_i = s.org_i and d.k = s.dept_k),
  s.id, ty.id,
  ((wk.ws + 1)::timestamp + time '12:00') at time zone 'Europe/London',
  ((wk.ws + 1)::timestamp + time '20:00') at time zone 'Europe/London',
  30, 'assigned', ty.colour,
  'Added by hand. Overlaps an existing shift.'
from d_stf s
join d_sty ty on ty.org_i = s.org_i and ty.k = 2
join d_week wk on wk.w = 4
where s.pattern = 1 and s.loc_j = 1;

-- (c) LEAVE CLASH: approved leave that still has shifts rostered inside it,
--     two weeks out, a future error rather than a historical one.
insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date, end_date,
                                   status, reason, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v2:lveclash:%s', s.org_i)), s.org_id, s.id,
       'holiday',
       (select ws from d_week where w = 5), (select ws + 4 from d_week where w = 5),
       'approved', 'Approved before the rota was built. Shifts still stand.',
       (select id from d_admin), now() - interval '6 days'
from d_stf s
where s.pattern = 2 and s.loc_j = 1;

-- (d) REST BREACH: a late finishing 22:00 followed by an early starting
--     07:00. Nine hours' rest, under the eleven the WTR expects.
insert into public.shifts (
  id, org_id, rota_id, location_id, department_id, staff_profile_id,
  shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
select
  pg_temp.demo_uuid(format('v2:rest:%s', s.org_i)),
  s.org_id,
  pg_temp.demo_uuid(format('v2:rota:%s:%s:%s', s.org_i, s.loc_j, 4)),
  (select l.id from d_loc l where l.org_i = s.org_i and l.j = s.loc_j),
  (select d.id from d_dep d where d.org_i = s.org_i and d.k = s.dept_k),
  s.id, ty.id,
  ((wk.ws + 5)::timestamp + ty.t_start) at time zone 'Europe/London',
  ((wk.ws + 5)::timestamp + ty.t_end) at time zone 'Europe/London',
  ty.break_minutes, 'assigned', ty.colour,
  'Back-to-back with the late the night before.'
from d_stf s
join d_sty ty on ty.org_i = s.org_i and ty.k = 1
join d_week wk on wk.w = 4
where s.pattern = 2 and s.loc_j = 2;

-- (e) UNAVAILABILITY, including one that conflicts with a rostered shift.
insert into public.availability (id, org_id, staff_profile_id, weekday, date,
                                 start_time, end_time, status, recurring)
select pg_temp.demo_uuid(format('v2:avl:%s:%s', s.org_i, s.n)), s.org_id, s.id,
       case when s.n % 4 = 3 then null else (s.n % 7) end,
       case when s.n % 4 = 3 then (select ws + (s.n % 5) from d_week where w = 6) end,
       case when s.n % 3 = 0 then time '09:00' end,
       case when s.n % 3 = 0 then time '17:00' end,
       case when s.n % 3 = 0 then 'preferred' else 'unavailable' end,
       s.n % 4 <> 3
from d_stf s
where s.n % 2 = 1;

-- The standing clash: pattern 1 works Mondays, so "unavailable every Monday"
-- is a conflict the rota warnings should surface every single week.
insert into public.availability (id, org_id, staff_profile_id, weekday, date,
                                 start_time, end_time, status, recurring)
select pg_temp.demo_uuid(format('v2:avlclash:%s', s.org_i)), s.org_id, s.id,
       0, null, null, null, 'unavailable', true
from d_stf s
where s.pattern = 1 and s.loc_j = 3;

-- (f) EXPIRED / EXPIRING DOCUMENTS, staggered on purpose.
insert into public.documents (id, org_id, staff_profile_id, type, name, file_url,
                              issued_at, expires_at)
select pg_temp.demo_uuid(format('v2:doc:%s:%s:%s', s.org_i, s.n, t.k)),
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
         -- one already expired, one expiring this week, one in three weeks,
         -- the rest comfortably valid
         when s.n % 9 = 0 and t.k = 2 then current_date - 12
         when s.n % 6 = 0 and t.k = 4 then current_date + 5
         when s.n % 6 = 3 and t.k = 3 then current_date + 21
         when t.k = 1 then null
         else current_date + 300 + (s.n * 7)
       end
from d_stf s cross join generate_series(1, 5) t(k)
-- everyone has a contract and a DBS; the rest is partial, like real life
where s.n % 2 = 0 or t.k <= 2;

-- =====================================================================
-- 6. Requests, timesheets and communications, spread across the window.
-- =====================================================================

-- ---- leave: a mix across all three months, all three states ----------
insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date, end_date,
                                   status, reason, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v2:lve:%s:%s', s.org_i, s.n)), s.org_id, s.id,
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
select pg_temp.demo_uuid(format('v2:ovt:%s:%s', s.org_i, s.n)), s.org_id, s.id,
       (select ws from d_week where w = ((s.n * 5) % 17)) + (s.n % 6),
       (1.5 + (s.n % 4))::numeric(5,2),
       (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1],
       format('Extra cover at %s',
              (select l.name from d_loc l where l.org_i = s.org_i and l.j = s.loc_j)),
       case when (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1] <> 'pending'
            then (select id from d_admin) end,
       case when (array['approved','pending','approved','pending','rejected'])[((s.n - 1) % 5) + 1] <> 'pending'
            then now() - ((s.n % 9) || ' days')::interval end
from d_stf s
where s.n % 2 = 0;

-- ---- timesheets: one per completed week, computed from real shifts ----
insert into public.timesheets (id, org_id, staff_profile_id, period_start, period_end,
                               total_minutes, status)
select pg_temp.demo_uuid(format('v2:tms:%s:%s:%s', s.org_i, s.n, wk.w)),
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
select pg_temp.demo_uuid(format('v2:emc:%s:%s', s.org_i, s.n)), s.org_id, s.id,
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
select pg_temp.demo_uuid(format('v2:ann:%s:%s', o.i, wk.w)), o.id, (select id from d_admin),
       (array['org','location','department','org','org','org'])[(wk.w % 6) + 1],
       case when (array['org','location','department','org','org','org'])[(wk.w % 6) + 1] = 'location'
            then (select l.id from d_loc l where l.org_i = o.i and l.j = (wk.w % 5) + 1) end,
       case when (array['org','location','department','org','org','org'])[(wk.w % 6) + 1] = 'department'
            then (select d.id from d_dep d where d.org_i = o.i and d.k = (wk.w % 5) + 1) end,
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
select pg_temp.demo_uuid(format('v2:ntf:%s:%s', s.org_i, s.n)), s.org_id,
       case when s.user_key = 'admin' then (select id from d_admin)
            else (select u.id from d_user u where u.k = s.user_key) end,
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

-- Extra unread notifications for the worker account, so the bell carries a
-- badge the moment you sign in as them.
insert into public.notifications (id, org_id, user_id, type, title, body, channel, read_at)
select pg_temp.demo_uuid(format('v2:ntfw:%s', g)), s.org_id,
       (select u.id from d_user u where u.k = 'worker'),
       (array['shift_reminder','swap_request','rota_published','announcement'])[g],
       (array['Your next shift starts soon','Swap request awaiting you',
              'Next month''s rota is published','Weather warning for your site'])[g],
       (array['Tap to see the details and clock in when you arrive.',
              'A colleague has asked to swap a shift with you.',
              'Your shifts for the next four weeks are now visible.',
              'Amber warning in force. Call in before travelling if unsafe.'])[g],
       'push', null
from d_stf s cross join generate_series(1, 4) g
where s.user_key = 'worker';

-- ---- pending invites --------------------------------------------------
insert into public.invites (id, org_id, email, role, token_hash, invited_by, expires_at)
select pg_temp.demo_uuid(format('v2:inv:%s:%s', o.i, j)), o.id,
       format('new.starter%s@%s.example', j, o.slug),
       (array['staff','staff','manager','staff','staff'])[j],
       -- Random preimage: the hash is real but no usable invite link exists.
       encode(sha256(extensions.gen_random_bytes(32)), 'hex'),
       (select id from d_admin), now() + ((j + 2) || ' days')::interval
from d_org o cross join generate_series(1, 5) j;

-- ---- audit log --------------------------------------------------------
insert into public.audit_logs (id, org_id, actor_user_id, action, entity_type,
                               entity_id, metadata, created_at)
select pg_temp.demo_uuid(format('v2:aud:%s:%s', o.i, j)), o.id, (select id from d_admin),
       (array['org.created','rota.published','staff.invited','leave.approved',
              'settings.updated','rota.published','document.expired','shift.reassigned'])[j],
       (array['organisation','rota','invite','leave_request',
              'organisation','rota','document','shift'])[j],
       null,
       jsonb_build_object('source', 'demo_seed', 'org', o.slug),
       now() - ((20 - (j * 2)) || ' days')::interval
from d_org o cross join generate_series(1, 8) j;

-- =====================================================================
-- 7. Shift swaps. Needs shifts, so it runs after them.
-- =====================================================================
insert into public.shift_swaps (id, org_id, shift_id, requested_by, target_staff_profile_id,
                                status, note, reviewed_by, reviewed_at)
select pg_temp.demo_uuid(format('v2:swp:%s:%s', c.org_i, c.rn)), c.org_id, c.id, c.staff_profile_id,
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
-- 8. Clock events.
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

-- (a) NO-SHOW: two recent shifts per org with no clock events at all.
--     (b) MISSING CLOCK-OUT: one clocked in and never out.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v2:clk:in:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'in',
       -- Mostly on time; a repeatable minority run late, which is what makes
       -- the attendance view worth looking at.
       w.starts_at + make_interval(mins => (case when w.seed_min % 11 = 0 then 18 + (w.seed_min % 13)
                                                 else (w.seed_min % 9) - 4 end)::integer),
       w.latitude, w.longitude, 6.0 + (w.seed_min % 12), 'gps', w.loc_name, true
from d_worked w
where w.recency not in (3, 9);

insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v2:clk:out:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'out',
       w.ends_at + make_interval(mins => ((w.seed_min % 7) - 2)::integer),
       w.latitude, w.longitude, 6.0 + (w.seed_min % 12), 'gps', w.loc_name, true
from d_worked w
where w.recency not in (2, 3, 9);

-- Break events on the long shifts, so a break-aware timesheet has data.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v2:clk:bs:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'break_start',
       w.starts_at + interval '4 hours' + make_interval(mins => (w.seed_min % 20)::integer),
       w.latitude, w.longitude, 9.0, 'gps', w.loc_name, true
from d_worked w
where w.break_minutes >= 45 and w.recency not in (3, 9);

insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v2:clk:be:' || w.id::text), w.org_id, w.staff_profile_id, w.id, 'break_end',
       w.starts_at + interval '4 hours' + make_interval(mins => ((w.seed_min % 20) + w.break_minutes)::integer),
       w.latitude, w.longitude, 9.0, 'gps', w.loc_name, true
from d_worked w
where w.break_minutes >= 45 and w.recency not in (3, 9);

-- (c) OFFLINE, NOT YET SYNCED: events created on a phone with no signal.
--     `synced = false` is the offline engine's own state, not a fiction.
update public.clock_events c
   set synced = false, method = 'manual'
  from d_worked w
 where c.shift_id = w.id and w.recency in (5, 6);

-- (d) CLOCKED IN RIGHT NOW. Whoever is genuinely mid-shift.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid('v2:clk:live:' || sh.id::text), sh.org_id, sh.staff_profile_id, sh.id, 'in',
       sh.starts_at + make_interval(mins => ((extract(epoch from sh.starts_at)::bigint / 60) % 7 - 3)::integer),
       l.latitude, l.longitude, 10.0, 'gps', l.name, true
from public.shifts sh
join public.locations l on l.id = sh.location_id
join d_stf st on st.id = sh.staff_profile_id
where sh.starts_at <= now() and sh.ends_at > now();

-- Fallback: if an org happens to have nobody mid-shift at the hour the seed
-- runs, the Clock In screen still needs a live state to show.
insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                 latitude, longitude, accuracy, method, location_name, synced)
select pg_temp.demo_uuid(format('v2:clk:livefb:%s', s.org_i)), s.org_id, s.id, null, 'in',
       now() - interval '2 hours',
       l.latitude, l.longitude, 12.0, 'gps', l.name, true
from d_stf s
join d_loc l on l.org_i = s.org_i and l.j = s.loc_j
where s.pattern = 4 and s.loc_j = 1
  and not exists (
    select 1
    from public.shifts sh2
    where sh2.org_id = s.org_id
      and sh2.staff_profile_id is not null
      and sh2.starts_at <= now() and sh2.ends_at > now());

-- =====================================================================
-- Verification. All five orgs should report a full three months.
-- =====================================================================
select o.name,
       (select count(*) from public.memberships       x where x.org_id = o.id) as members,
       (select count(*) from public.locations         x where x.org_id = o.id) as locations,
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
