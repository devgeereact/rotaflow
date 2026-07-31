-- =====================================================================
-- demo_seed.sql — RotaFlow showcase dataset
--
-- Builds five fully-populated demo organisations with 5 items in every
-- section, plus seven login-able demo accounts covering every role.
-- Intended for client demos and end-to-end manual testing.
--
-- RUN IT:  paste the whole file into the Supabase SQL editor and run once,
--          or POST it to /v1/projects/<ref>/database/query. Run the file as
--          a single unit — it uses a session-local helper function.
--
-- IDEMPOTENT BY RESET: every id is derived deterministically from a name, so
-- re-running DELETES the five demo organisations (cascading to all their
-- rows) and rebuilds them. All dates are relative to `current_date`, so a
-- re-run also re-centres the demo on the current week. Re-running is the
-- supported way to refresh the demo before a client call.
--
-- SAFETY: it only ever touches rows whose ids it derives itself, plus the
-- seven demo auth users. Organisations created through the app — including
-- "City Hospital Care Group" and "GAKINZ" — are never read or written.
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
-- Reset: drop the five demo orgs. Every domain table FKs org_id with
-- ON DELETE CASCADE, so this clears locations, staff, rotas, shifts,
-- leave, swaps, clock events, timesheets, documents, announcements,
-- notifications, invites, subscriptions and audit logs in one go.
-- ---------------------------------------------------------------------
delete from public.organisations
where id in (
  pg_temp.demo_uuid('org:1'), pg_temp.demo_uuid('org:2'),
  pg_temp.demo_uuid('org:3'), pg_temp.demo_uuid('org:4'),
  pg_temp.demo_uuid('org:5')
);

do $seed$
declare
  -- ---------- demo login accounts ----------------------------------
  c_password  constant text := 'RotaFlowDemo!2026';
  c_admin_email constant text := 'gakinz101@gmail.com';

  -- Plus-addressed on the owner's real mailbox: deliverable (so password
  -- resets and magic links actually arrive) and incapable of bouncing,
  -- which a fake domain would do — Supabase already flagged bounce rate.
  u_keys   text[] := array['owner','manager1','manager2','staff1','staff2','staff3','staff4'];
  u_emails text[] := array[
    'gakinz101+demo.owner@gmail.com','gakinz101+demo.manager1@gmail.com',
    'gakinz101+demo.manager2@gmail.com','gakinz101+demo.staff1@gmail.com',
    'gakinz101+demo.staff2@gmail.com','gakinz101+demo.staff3@gmail.com',
    'gakinz101+demo.staff4@gmail.com'];
  u_names  text[] := array[
    'Amelia Hart','Daniel Okafor','Priya Raman','James Whitfield',
    'Sofia Marchetti','Tomas Nowak','Grace Adeyemi'];
  u_ids    uuid[] := array[]::uuid[];
  v_admin  uuid;

  -- ---------- organisations ----------------------------------------
  org_names text[] := array[
    'Northgate Care Group','Harbour View Hotels','Brightside Retail',
    'Clearway Logistics','Meridian Security'];
  org_slugs text[] := array[
    'northgate-care','harbour-view-hotels','brightside-retail',
    'clearway-logistics','meridian-security'];
  org_plans text[] := array['business','professional','professional','starter','business'];
  org_inds  text[] := array['Healthcare','Hospitality','Retail','Logistics','Security'];
  org_sizes text[] := array['51-200','11-50','51-200','201-500','51-200'];

  -- ---------- locations (5 per org) --------------------------------
  loc_names text[][] := array[
    ['Northgate House','Willow Court','Ashfield Lodge','Rosewood Manor','Meadowbank Court'],
    ['Harbour View Brighton','Harbour View Whitby','Harbour View St Ives','Harbour View Tenby','Harbour View Oban'],
    ['Brightside Arndale','Brightside Trafford','Brightside Liverpool ONE','Brightside Meadowhall','Brightside Trinity Leeds'],
    ['Clearway Daventry DC','Clearway Warrington Hub','Clearway Thurrock Hub','Clearway Bristol Depot','Clearway Newcastle Depot'],
    ['Meridian Canary Wharf','Meridian Birmingham Central','Meridian Glasgow Riverside','Meridian Cardiff Bay','Meridian Nottingham Gateway']];
  loc_addrs text[][] := array[
    ['14 Northgate Road, Leeds LS1 4AB','8 Willow Lane, Leeds LS2 9JT','51 Ashfield Way, Bradford BD1 1PR','3 Rosewood Drive, Wakefield WF1 2DE','22 Meadowbank Avenue, Harrogate HG1 5AY'],
    ['2 Kings Road, Brighton BN1 1NB','5 Pier Road, Whitby YO21 3PU','9 The Wharf, St Ives TR26 1LF','12 Esplanade, Tenby SA70 7DU','4 George Street, Oban PA34 5NT'],
    ['1 Market Street, Manchester M4 3AQ','7 The Dome, Trafford Centre, Manchester M17 8DA','21 South John Street, Liverpool L1 8BU','44 High Street, Meadowhall, Sheffield S9 1EP','15 Albion Street, Leeds LS1 5AT'],
    ['Royal Oak Way, Daventry NN11 8QL','Kingsland Grange, Warrington WA1 4RW','Oliver Road, West Thurrock RM20 3ED','Sherbourne Avenue, Bristol BS32 4AH','Balliol Business Park, Newcastle NE12 8EW'],
    ['30 Bank Street, London E14 5NR','120 Colmore Row, Birmingham B3 3BD','8 Pacific Quay, Glasgow G51 1EA','5 Bute Place, Cardiff CF10 5AL','2 Castle Wharf, Nottingham NG1 7EL']];
  loc_lat double precision[][] := array[
    [53.8008,53.8067,53.7960,53.6833,53.9926],
    [50.8214,54.4863,50.2110,51.6725,56.4152],
    [53.4830,53.4652,53.4040,53.4136,53.7975],
    [52.2610,53.4100,51.4830,51.5380,55.0350],
    [51.5040,52.4810,55.8590,51.4640,52.9500]];
  loc_lon double precision[][] := array[
    [-1.5491,-1.5550,-1.7594,-1.4977,-1.5418],
    [-0.1500,-0.6133,-5.4800,-4.7050,-5.4714],
    [-2.2380,-2.3480,-2.9860,-1.4130,-1.5450],
    [-1.1500,-2.5470, 0.2810,-2.5570,-1.6100],
    [-0.0190,-1.9030,-4.2900,-3.1620,-1.1520]];
  loc_radius integer[][] := array[
    [120,120,150,150,100],[100,120,100,120,150],
    [80,80,80,100,80],[300,300,250,200,200],[150,120,200,150,120]];

  -- ---------- departments (5 per org, org-wide) ---------------------
  dep_names text[][] := array[
    ['Nursing','Care','Kitchen','Housekeeping','Reception'],
    ['Front Desk','Housekeeping','Food & Beverage','Maintenance','Events'],
    ['Sales Floor','Stockroom','Checkout','Visual Merchandising','Click & Collect'],
    ['Inbound','Outbound','Transport','Fleet Maintenance','Goods-In QC'],
    ['Static Guarding','Mobile Patrol','Control Room','Event Security','Key Holding']];

  -- ---------- shift types (5 per org) ------------------------------
  sty_names text[][] := array[
    ['Early','Late','Night','Twilight','On-Call'],
    ['Breakfast','Reception Day','Evening','Night Porter','Banquet'],
    ['Opening','Mid','Closing','Stock Delivery','Weekend Peak'],
    ['Day Shift','Back Shift','Night Shift','Weekend Cover','Driver Trunk'],
    ['Day Guard','Night Guard','Control Room AM','Control Room PM','Event Cover']];
  sty_colours text[][] := array[
    ['#2563EB','#7C3AED','#0F172A','#F97316','#059669'],
    ['#F59E0B','#2563EB','#7C3AED','#0F172A','#DB2777'],
    ['#2563EB','#10B981','#7C3AED','#F59E0B','#DB2777'],
    ['#2563EB','#7C3AED','#0F172A','#10B981','#F59E0B'],
    ['#2563EB','#0F172A','#10B981','#7C3AED','#DB2777']];
  sty_starts text[][] := array[
    ['07:00','14:00','21:45','17:00','09:00'],
    ['06:00','08:00','15:00','22:30','16:00'],
    ['08:30','11:00','13:30','05:00','10:00'],
    ['06:00','14:00','22:00','08:00','04:00'],
    ['07:00','19:00','06:00','14:00','16:00']];
  sty_ends text[][] := array[
    ['15:00','22:00','07:15','23:00','17:00'],
    ['14:00','16:00','23:00','06:30','00:00'],
    ['16:30','19:00','21:30','11:00','18:00'],
    ['14:00','22:00','06:00','20:00','12:00'],
    ['19:00','07:00','14:00','22:00','02:00']];
  sty_cats text[][] := array[
    ['day','day','night','evening','on_call'],
    ['day','day','evening','night','evening'],
    ['day','day','evening','early','day'],
    ['day','evening','night','day','early'],
    ['day','night','day','evening','evening']];
  sty_breaks integer[][] := array[
    [30,30,45,30,0],[30,30,30,45,45],[30,30,30,20,30],[30,30,45,60,30],[45,45,30,30,45]];

  -- ---------- staff (5 per org) ------------------------------------
  stf_first text[][] := array[
    ['Gideon','Daniel','Priya','James','Sofia'],
    ['Amelia','Tomas','Grace','Callum','Isla'],
    ['Hannah','Owen','Leila','Ryan','Nia'],
    ['Victor','Karol','Denise','Femi','Ruth'],
    ['Nathan','Aisha','Gary','Elena','Josh']];
  stf_last text[][] := array[
    ['Akinlotan','Okafor','Raman','Whitfield','Marchetti'],
    ['Hart','Nowak','Adeyemi','Reid','Fraser'],
    ['Clarke','Price','Ahmed','Docherty','Bevan'],
    ['Mensah','Wisniewski','Hughes','Balogun','Kelly'],
    ['Boateng','Malik','Sutcliffe','Petrova','Lambert']];
  stf_titles text[][] := array[
    ['Registered Manager','Deputy Manager','Senior Nurse','Care Assistant','Kitchen Assistant'],
    ['General Manager','Front Desk Supervisor','Housekeeping Lead','Night Porter','F&B Assistant'],
    ['Store Manager','Assistant Manager','Sales Advisor','Stock Assistant','Checkout Supervisor'],
    ['Shift Supervisor','LGV Driver','Warehouse Operative','Forklift Operator','Transport Planner'],
    ['Security Supervisor','Control Room Operator','Static Guard','Mobile Patrol Officer','Event Steward']];
  stf_dept integer[][] := array[
    [1,2,1,2,3],[1,1,2,4,3],[1,1,1,2,3],[1,3,2,1,3],[1,3,1,2,4]];
  stf_skills text[][] := array[
    ['Safeguarding,Medication,First Aid','Safeguarding,Moving & Handling,First Aid','Medication,Wound Care,IV','Moving & Handling,Dementia Care','Food Hygiene L2,Allergen Awareness'],
    ['Front Office,Revenue Management','Opera PMS,Customer Service','COSHH,Team Leading','Fire Marshal,First Aid','Food Hygiene L2,Barista'],
    ['People Management,Loss Prevention','Merchandising,Cash Handling','Customer Service,Till','Manual Handling,Stock Control','Cash Handling,Age Verification'],
    ['Team Leading,Manual Handling','LGV C+E,Digi Tacho,ADR','Manual Handling,Picking','Counterbalance FLT,Reach FLT','Route Planning,WMS'],
    ['SIA Door Supervisor,First Aid','CCTV (PSS),Control Room','SIA Security Guard,Fire Marshal','SIA Security Guard,Driving','SIA Door Supervisor,Crowd Safety']];
  stf_contract text[][] := array[
    ['full_time','full_time','part_time','full_time','part_time'],
    ['full_time','full_time','full_time','part_time','zero_hours'],
    ['full_time','full_time','part_time','zero_hours','part_time'],
    ['full_time','full_time','full_time','part_time','full_time'],
    ['full_time','full_time','full_time','part_time','casual']];
  stf_hours numeric[][] := array[
    [37.5,37.5,22.5,37.5,20.0],[40.0,37.5,37.5,24.0,0.0],
    [39.0,39.0,20.0,0.0,25.0],[42.5,45.0,40.0,20.0,37.5],
    [42.0,42.0,42.0,24.0,0.0]];
  -- Which demo login owns which staff row. 0 = record only (no auth user),
  -- 8 = the platform admin. 1..7 index u_keys.
  stf_user integer[][] := array[
    [8,2,3,4,5],[1,6,7,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];

  -- ---------- misc content -----------------------------------------
  leave_types  text[] := array['holiday','sick','holiday','unpaid','holiday'];
  leave_status text[] := array['approved','approved','pending','pending','rejected'];
  leave_reason text[] := array['Family holiday booked in January','Flu — GP note supplied',
    'Half-term break with the kids','Moving house','Long weekend away'];
  ot_status    text[] := array['approved','approved','pending','pending','rejected'];
  ts_status    text[] := array['approved','approved','submitted','submitted','open'];
  doc_types    text[] := array['contract','dbs','right_to_work','training','visa'];
  doc_names    text[] := array['Employment contract','DBS certificate','Right to work check',
    'Mandatory training record','Visa / share code'];
  doc_expiry   integer[] := array[540, -20, 300, 21, 120];  -- days from today
  swap_status  text[] := array['pending','pending','accepted','approved','rejected'];
  sub_provider text[] := array['paypal','apple_pay','google_pay','paypal','apple_pay'];
  sub_status   text[] := array['active','active','active','trialing','active'];

  ann_titles text[] := array[
    'Winter rota published — please check your shifts',
    'Fire drill this Thursday at 14:00',
    'New starter joining the team',
    'Reminder: submit your timesheets by Sunday',
    'URGENT: severe weather — site cover plan'];
  ann_bodies text[] := array[
    'The rota for the next four weeks is now live in RotaFlow. Please review your shifts and raise any swap requests before Friday.',
    'A full evacuation drill takes place on Thursday at 14:00. Assembly point is the main car park. Please make sure visitors are escorted out.',
    'Please join us in welcoming our newest team member. Their induction runs across their first two shifts — do say hello.',
    'Timesheets close at 23:59 on Sunday. Anything submitted after that lands in the following pay run.',
    'Amber weather warning in force. If you cannot travel safely, call the on-call number before your shift starts — do not travel and do not no-show.'];
  ann_scopes text[] := array['org','location','department','org','org'];
  ann_urgent boolean[] := array[false,false,false,false,true];

  ntf_types  text[] := array['rota_published','leave_approved','swap_request','announcement','shift_reminder'];
  ntf_titles text[] := array['Rota published','Leave approved','Swap request awaiting you',
    'New announcement','Shift starts in 2 hours'];
  ntf_bodies text[] := array[
    'The rota for this week has been published. Tap to view your shifts.',
    'Your holiday request has been approved by your manager.',
    'A colleague has asked to swap a shift with you. Tap to accept or decline.',
    'A new announcement has been posted for your organisation.',
    'Your next shift starts in 2 hours. Remember to clock in on arrival.'];
  ntf_chan   text[] := array['push','email','push','push','push'];

  audit_actions text[] := array['org.created','rota.published','staff.invited','leave.approved','settings.updated'];
  audit_entities text[] := array['organisation','rota','invite','leave_request','organisation'];

  inv_roles text[] := array['staff','staff','manager','staff','staff'];

  -- ---------- loop state -------------------------------------------
  v_week0     date := (date_trunc('week', current_date))::date;   -- Monday of this week
  i           integer;   -- org index
  j           integer;   -- per-org item index
  d           integer;   -- weekday offset
  w           integer;   -- week offset
  k           integer;   -- shift-type index
  v_org       uuid;
  v_loc       uuid;
  v_rota      uuid;
  v_ws        date;
  v_start     timestamptz;
  v_end       timestamptz;
  t_start     time;
  t_end       time;
  v_status    text;
  v_uid       uuid;
  v_new       uuid;
  v_has_pid   boolean;
begin
  -- =================================================================
  -- 1. Accounts. The platform admin plus seven role accounts.
  -- =================================================================
  v_has_pid := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id');

  select id into v_admin from auth.users where lower(email) = c_admin_email;
  if v_admin is null then
    raise exception
      'No auth user for % — sign up in the app first, then re-run this seed.', c_admin_email;
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

      v_uid := v_new;
    end if;

    -- handle_new_user() fills profiles on insert; make the name right either way.
    update public.profiles set full_name = u_names[j] where id = v_uid;
    u_ids := u_ids || v_uid;
  end loop;

  -- =================================================================
  -- 2. Per-organisation build
  -- =================================================================
  for i in 1..5 loop
    v_org := pg_temp.demo_uuid('org:' || i);

    -- ---- organisation (trigger on_org_created makes the admin owner) ----
    insert into public.organisations (id, name, slug, plan, settings, created_by)
    values (v_org, org_names[i], org_slugs[i], org_plans[i],
            jsonb_build_object(
              'industry', org_inds[i], 'size', org_sizes[i],
              'locale', 'en-GB', 'timezone', 'Europe/London',
              'week_starts_on', 'monday', 'demo', true),
            v_admin);

    insert into public.subscriptions (id, org_id, plan, status, provider, provider_ref, current_period_end)
    values (pg_temp.demo_uuid('sub:' || i), v_org, org_plans[i], sub_status[i],
            sub_provider[i], 'demo_' || org_slugs[i], now() + interval '30 days');

    -- ---- locations -------------------------------------------------
    for j in 1..5 loop
      insert into public.locations (id, org_id, name, address, latitude, longitude,
                                    timezone, geofence_radius_m)
      values (pg_temp.demo_uuid(format('loc:%s:%s', i, j)), v_org,
              loc_names[i][j], loc_addrs[i][j], loc_lat[i][j], loc_lon[i][j],
              'Europe/London', loc_radius[i][j]);
    end loop;

    -- ---- departments (org-wide: listDepartments() is org-scoped) ----
    for j in 1..5 loop
      insert into public.departments (id, org_id, location_id, name)
      values (pg_temp.demo_uuid(format('dep:%s:%s', i, j)), v_org, null, dep_names[i][j]);
    end loop;

    -- ---- shift types + templates ------------------------------------
    for j in 1..5 loop
      insert into public.shift_types (id, org_id, name, colour, default_start, default_end,
                                      is_paid, category)
      values (pg_temp.demo_uuid(format('sty:%s:%s', i, j)), v_org,
              sty_names[i][j], sty_colours[i][j], sty_starts[i][j]::time, sty_ends[i][j]::time,
              true, sty_cats[i][j]);

      insert into public.shift_templates (id, org_id, name, shift_type_id, location_id,
                                          department_id, start_time, end_time,
                                          break_minutes, required_skills)
      values (pg_temp.demo_uuid(format('tpl:%s:%s', i, j)), v_org,
              sty_names[i][j] || ' — ' || loc_names[i][1],
              pg_temp.demo_uuid(format('sty:%s:%s', i, j)),
              pg_temp.demo_uuid(format('loc:%s:%s', i, 1)),
              pg_temp.demo_uuid(format('dep:%s:%s', i, j)),
              sty_starts[i][j]::time, sty_ends[i][j]::time, sty_breaks[i][j],
              string_to_array(stf_skills[i][j], ','));
    end loop;

    -- ---- staff -------------------------------------------------------
    for j in 1..5 loop
      v_uid := case
                 when stf_user[i][j] = 0 then null
                 when stf_user[i][j] = 8 then v_admin
                 else u_ids[stf_user[i][j]]
               end;

      insert into public.staff_profiles (
        id, org_id, user_id, first_name, last_name, job_title, department_id,
        contract_type, weekly_hours, holiday_allowance, skills, payroll_id,
        start_date, phone, active)
      values (
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)), v_org, v_uid,
        stf_first[i][j], stf_last[i][j], stf_titles[i][j],
        pg_temp.demo_uuid(format('dep:%s:%s', i, stf_dept[i][j])),
        stf_contract[i][j], stf_hours[i][j], 28.0,
        string_to_array(stf_skills[i][j], ','),
        format('%s-%s', upper(left(org_slugs[i], 3)), lpad((100 + j)::text, 4, '0')),
        current_date - ((180 * j) + (30 * i)), format('+4477009%s%s', i, lpad((j * 11)::text, 5, '0')),
        true);

      -- memberships for the staff rows that have a login
      if v_uid is not null and v_uid <> v_admin then
        insert into public.memberships (id, org_id, user_id, role, status)
        values (pg_temp.demo_uuid(format('mem:%s:%s', i, j)), v_org, v_uid,
                case when stf_user[i][j] in (1) then 'owner'
                     when stf_user[i][j] in (2, 3) then 'manager'
                     else 'staff' end,
                'active')
        on conflict (org_id, user_id) do nothing;
      end if;
    end loop;

    -- Daniel Okafor manages at Northgate and covers Harbour View too — the
    -- multi-org case, and it takes org 2 to a full five members.
    if i = 2 then
      insert into public.memberships (id, org_id, user_id, role, status)
      values (pg_temp.demo_uuid('mem:2:multi'), v_org, u_ids[2], 'manager', 'active')
      on conflict (org_id, user_id) do nothing;
    end if;

    -- Orgs 3-5 have record-only staff, so give them head-office logins too,
    -- otherwise the Team section would show one member. These users have app
    -- access to the org without being on its rota.
    if i >= 3 then
      for j in 1..4 loop
        insert into public.memberships (id, org_id, user_id, role, status)
        values (pg_temp.demo_uuid(format('memho:%s:%s', i, j)), v_org, u_ids[j + 1],
                case when j = 1 then 'manager' else 'staff' end, 'active')
        on conflict (org_id, user_id) do nothing;
      end loop;
    end if;

    -- ---- rotas: two past, current, next, and a draft ------------------
    for w in -2..2 loop
      v_ws   := v_week0 + (w * 7);
      v_rota := pg_temp.demo_uuid(format('rota:%s:%s', i, w));
      v_loc  := pg_temp.demo_uuid(format('loc:%s:%s', i, 1));

      insert into public.rotas (id, org_id, location_id, name, period_start, period_end,
                                status, published_at)
      values (v_rota, v_org, v_loc,
              format('%s — w/c %s', loc_names[i][1], to_char(v_ws, 'DD Mon YYYY')),
              v_ws, v_ws + 6,
              case when w = 2 then 'draft' else 'published' end,
              case when w = 2 then null else (v_ws - 10)::timestamptz end);

      -- Mon-Fri; the draft week is deliberately half-built.
      for d in 0..(case when w = 2 then 1 else 4 end) loop
        for j in 1..5 loop
          continue when ((j - 1) % 5) = d;          -- each person gets one day off

          k := ((d + j) % 5) + 1;
          t_start := sty_starts[i][k]::time;
          t_end   := sty_ends[i][k]::time;

          v_start := ((v_ws + d)::timestamp + t_start) at time zone 'Europe/London';
          v_end   := ((v_ws + d + case when t_end <= t_start then 1 else 0 end)::timestamp + t_end)
                     at time zone 'Europe/London';

          v_status := case when v_end < now() then 'confirmed'
                           when (d + j) % 3 = 0 then 'confirmed'
                           else 'assigned' end;

          insert into public.shifts (
            id, org_id, rota_id, location_id, department_id, staff_profile_id,
            shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
          values (
            pg_temp.demo_uuid(format('sft:%s:%s:%s:%s', i, w, d, j)), v_org, v_rota, v_loc,
            pg_temp.demo_uuid(format('dep:%s:%s', i, stf_dept[i][j])),
            pg_temp.demo_uuid(format('stf:%s:%s', i, j)),
            pg_temp.demo_uuid(format('sty:%s:%s', i, k)),
            v_start, v_end, sty_breaks[i][k], v_status, sty_colours[i][k],
            case when (d + j) % 7 = 0 then 'Covering for annual leave.' else null end);
        end loop;
      end loop;
    end loop;

    -- ---- open shifts this week, one at each of the other sites --------
    for j in 1..5 loop
      k := j;
      t_start := sty_starts[i][k]::time;
      t_end   := sty_ends[i][k]::time;
      v_start := ((v_week0 + (j - 1))::timestamp + t_start) at time zone 'Europe/London';
      v_end   := ((v_week0 + (j - 1) + case when t_end <= t_start then 1 else 0 end)::timestamp + t_end)
                 at time zone 'Europe/London';

      insert into public.shifts (
        id, org_id, rota_id, location_id, department_id, staff_profile_id,
        shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
      values (
        pg_temp.demo_uuid(format('open:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('rota:%s:%s', i, 0)),
        pg_temp.demo_uuid(format('loc:%s:%s', i, j)),
        pg_temp.demo_uuid(format('dep:%s:%s', i, j)),
        null,
        pg_temp.demo_uuid(format('sty:%s:%s', i, k)),
        v_start, v_end, sty_breaks[i][k], 'open', sty_colours[i][k],
        'Open shift — needs cover.');
    end loop;

    -- ---- availability -------------------------------------------------
    for j in 1..5 loop
      insert into public.availability (id, org_id, staff_profile_id, weekday, date,
                                       start_time, end_time, status, recurring)
      values (
        pg_temp.demo_uuid(format('avl:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)),
        case when j = 4 then null else (j + 1) % 7 end,
        case when j = 4 then v_week0 + 9 else null end,
        case when j in (2, 5) then '09:00'::time else null end,
        case when j in (2, 5) then '17:00'::time else null end,
        case when j in (2, 5) then 'preferred' else 'unavailable' end,
        j <> 4);
    end loop;

    -- ---- leave requests -----------------------------------------------
    for j in 1..5 loop
      insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date,
                                         end_date, status, reason, reviewed_by, reviewed_at)
      values (
        pg_temp.demo_uuid(format('lve:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)),
        leave_types[j],
        v_week0 + (case j when 1 then 21 when 2 then -10 when 3 then 14 when 4 then 30 else 3 end),
        v_week0 + (case j when 1 then 25 when 2 then  -9 when 3 then 18 when 4 then 31 else 4 end),
        leave_status[j], leave_reason[j],
        case when leave_status[j] = 'pending' then null else v_admin end,
        case when leave_status[j] = 'pending' then null else now() - (j || ' days')::interval end);
    end loop;

    -- ---- overtime requests --------------------------------------------
    for j in 1..5 loop
      insert into public.overtime_requests (id, org_id, staff_profile_id, date, hours,
                                            status, note, reviewed_by, reviewed_at)
      values (
        pg_temp.demo_uuid(format('ovt:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)),
        v_week0 + (j * 2) - 6, (1.5 * j)::numeric(5,2), ot_status[j],
        format('Extra cover on %s', loc_names[i][j]),
        case when ot_status[j] = 'pending' then null else v_admin end,
        case when ot_status[j] = 'pending' then null else now() - (j || ' days')::interval end);
    end loop;

    -- ---- timesheets for last completed week ----------------------------
    for j in 1..5 loop
      insert into public.timesheets (id, org_id, staff_profile_id, period_start, period_end,
                                     total_minutes, status)
      select
        pg_temp.demo_uuid(format('tms:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)), v_week0 - 7, v_week0 - 1,
        coalesce(sum(
          (extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer - s.break_minutes
        ), 0)::integer,
        ts_status[j]
      from public.shifts s
      where s.staff_profile_id = pg_temp.demo_uuid(format('stf:%s:%s', i, j))
        and s.starts_at >= ((v_week0 - 7)::timestamp at time zone 'Europe/London')
        and s.starts_at <  (( v_week0     )::timestamp at time zone 'Europe/London');
    end loop;

    -- ---- emergency contacts + documents --------------------------------
    for j in 1..5 loop
      insert into public.emergency_contacts (id, org_id, staff_profile_id, name, relationship,
                                             phone, secondary_phone, medical_notes)
      values (
        pg_temp.demo_uuid(format('emc:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)),
        format('%s %s', (array['Marie','Ade','Rosa','Chen','Nadia'])[j], stf_last[i][j]),
        (array['Partner','Parent','Sibling','Spouse','Friend'])[j],
        format('+4477115%s%s', i, lpad((j * 13)::text, 5, '0')),
        case when j % 2 = 0 then format('+4477226%s%s', i, lpad((j * 17)::text, 5, '0')) else null end,
        case when j = 3 then 'Carries an inhaler (asthma).'
             when j = 5 then 'Nut allergy — EpiPen in locker.' else null end);

      insert into public.documents (id, org_id, staff_profile_id, type, name, file_url,
                                    issued_at, expires_at)
      values (
        pg_temp.demo_uuid(format('doc:%s:%s', i, j)), v_org,
        pg_temp.demo_uuid(format('stf:%s:%s', i, j)),
        doc_types[j],
        format('%s — %s %s', doc_names[j], stf_first[i][j], stf_last[i][j]),
        format('https://ik.imagekit.io/demo/rotaflow/%s/%s-%s.pdf', org_slugs[i], doc_types[j], j),
        current_date - 400 + (j * 30), current_date + doc_expiry[j]);
    end loop;

    -- ---- announcements ---------------------------------------------------
    for j in 1..5 loop
      insert into public.announcements (id, org_id, author_user_id, scope, location_id,
                                        department_id, title, body, urgent, published_at)
      values (
        pg_temp.demo_uuid(format('ann:%s:%s', i, j)), v_org, v_admin, ann_scopes[j],
        case when ann_scopes[j] = 'location'   then pg_temp.demo_uuid(format('loc:%s:%s', i, 2)) end,
        case when ann_scopes[j] = 'department' then pg_temp.demo_uuid(format('dep:%s:%s', i, 1)) end,
        ann_titles[j], ann_bodies[j], ann_urgent[j],
        now() - ((6 - j) || ' days')::interval);
    end loop;

    -- ---- notifications ---------------------------------------------------
    for j in 1..5 loop
      -- Orgs 1-2 spread across their real members; orgs 3-5 land on the admin.
      v_uid := case
                 when i = 1 then (array[v_admin, u_ids[2], u_ids[3], u_ids[4], u_ids[5]])[j]
                 when i = 2 then (array[v_admin, u_ids[1], u_ids[6], u_ids[7], u_ids[2]])[j]
                 else v_admin
               end;

      insert into public.notifications (id, org_id, user_id, type, title, body, channel, read_at)
      values (
        pg_temp.demo_uuid(format('ntf:%s:%s', i, j)), v_org, v_uid,
        ntf_types[j], ntf_titles[j], ntf_bodies[j], ntf_chan[j],
        case when j <= 3 then now() - ((j * 4) || ' hours')::interval end);
    end loop;

    -- ---- pending invites --------------------------------------------------
    for j in 1..5 loop
      insert into public.invites (id, org_id, email, role, token_hash, invited_by, expires_at)
      values (
        pg_temp.demo_uuid(format('inv:%s:%s', i, j)), v_org,
        format('new.starter%s@%s.example', j, org_slugs[i]),
        inv_roles[j],
        -- Random preimage: the hash is real but no usable invite link exists.
        encode(sha256(extensions.gen_random_bytes(32)), 'hex'),
        v_admin, now() + ((j + 2) || ' days')::interval);
    end loop;

    -- ---- audit log --------------------------------------------------------
    for j in 1..5 loop
      insert into public.audit_logs (id, org_id, actor_user_id, action, entity_type,
                                     entity_id, metadata, created_at)
      values (
        pg_temp.demo_uuid(format('aud:%s:%s', i, j)), v_org, v_admin,
        audit_actions[j], audit_entities[j],
        case audit_entities[j]
          when 'organisation'  then v_org
          when 'rota'          then pg_temp.demo_uuid(format('rota:%s:%s', i, 0))
          when 'invite'        then pg_temp.demo_uuid(format('inv:%s:%s', i, 1))
          when 'leave_request' then pg_temp.demo_uuid(format('lve:%s:%s', i, 1))
        end,
        jsonb_build_object('source', 'demo_seed', 'org', org_slugs[i]),
        now() - ((10 - j) || ' days')::interval);
    end loop;
  end loop;

  -- =================================================================
  -- 3. Shift swaps — needs shifts to exist, so it runs set-based after.
  -- =================================================================
  for i in 1..5 loop
    v_org := pg_temp.demo_uuid('org:' || i);

    insert into public.shift_swaps (id, org_id, shift_id, requested_by,
                                    target_staff_profile_id, status, note,
                                    reviewed_by, reviewed_at)
    select
      pg_temp.demo_uuid(format('swp:%s:%s', i, c.rn)), v_org, c.id, c.staff_profile_id,
      pg_temp.demo_uuid(format('stf:%s:%s', i, (c.rn % 5) + 1)),
      swap_status[c.rn],
      format('Can anyone cover %s? Happy to swap for a later shift.',
             to_char(c.starts_at at time zone 'Europe/London', 'Dy DD Mon')),
      case when swap_status[c.rn] in ('approved','rejected') then v_admin end,
      case when swap_status[c.rn] in ('approved','rejected') then now() - interval '1 day' end
    from (
      select s.id, s.staff_profile_id, s.starts_at,
             row_number() over (order by s.starts_at, s.id) as rn
      from public.shifts s
      where s.org_id = v_org
        and s.staff_profile_id is not null
        and s.starts_at > now()
      limit 5
    ) c;
  end loop;

  -- =================================================================
  -- 4. Clock events derived from shifts that have already finished.
  --    Deterministic minute jitter so re-runs stay stable.
  -- =================================================================
  insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                   latitude, longitude, accuracy, method, location_name, synced)
  select
    pg_temp.demo_uuid('clk:in:' || s.id::text), s.org_id, s.staff_profile_id, s.id, 'in',
    s.starts_at + make_interval(mins => ((extract(epoch from s.starts_at)::bigint / 60) % 9 - 4)::integer),
    l.latitude, l.longitude, 8.0 + ((extract(epoch from s.starts_at)::bigint) % 12),
    'gps', l.name, true
  from public.shifts s
  join public.locations l on l.id = s.location_id
  where s.org_id in (pg_temp.demo_uuid('org:1'), pg_temp.demo_uuid('org:2'),
                     pg_temp.demo_uuid('org:3'), pg_temp.demo_uuid('org:4'),
                     pg_temp.demo_uuid('org:5'))
    and s.staff_profile_id is not null
    and s.ends_at < now()
    and s.starts_at > now() - interval '10 days';

  insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                   latitude, longitude, accuracy, method, location_name, synced)
  select
    pg_temp.demo_uuid('clk:out:' || s.id::text), s.org_id, s.staff_profile_id, s.id, 'out',
    s.ends_at + make_interval(mins => ((extract(epoch from s.ends_at)::bigint / 60) % 7 - 2)::integer),
    l.latitude, l.longitude, 8.0 + ((extract(epoch from s.ends_at)::bigint) % 12),
    'gps', l.name, true
  from public.shifts s
  join public.locations l on l.id = s.location_id
  where s.org_id in (pg_temp.demo_uuid('org:1'), pg_temp.demo_uuid('org:2'),
                     pg_temp.demo_uuid('org:3'), pg_temp.demo_uuid('org:4'),
                     pg_temp.demo_uuid('org:5'))
    and s.staff_profile_id is not null
    and s.ends_at < now()
    and s.starts_at > now() - interval '10 days';

  -- One person per org left mid-shift, so Clock In always has a live state
  -- to show no matter what time of day the demo runs.
  for i in 1..5 loop
    insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                     latitude, longitude, accuracy, method, location_name, synced)
    values (
      pg_temp.demo_uuid(format('clk:live:%s', i)), pg_temp.demo_uuid('org:' || i),
      pg_temp.demo_uuid(format('stf:%s:%s', i, 4)),
      (select s.id from public.shifts s
        where s.org_id = pg_temp.demo_uuid('org:' || i)
          and s.staff_profile_id = pg_temp.demo_uuid(format('stf:%s:%s', i, 4))
          and s.starts_at <= now() and s.ends_at > now()
        order by s.starts_at limit 1),
      'in', now() - interval '2 hours',
      loc_lat[i][1], loc_lon[i][1], 11.0, 'gps', loc_names[i][1], true);
  end loop;

  raise notice 'RotaFlow demo seed complete — 5 organisations rebuilt around w/c %', v_week0;
end;
$seed$;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
select o.name,
       (select count(*) from public.memberships       x where x.org_id = o.id) as members,
       (select count(*) from public.locations         x where x.org_id = o.id) as locations,
       (select count(*) from public.departments       x where x.org_id = o.id) as departments,
       (select count(*) from public.staff_profiles    x where x.org_id = o.id) as staff,
       (select count(*) from public.shift_types       x where x.org_id = o.id) as shift_types,
       (select count(*) from public.shift_templates   x where x.org_id = o.id) as templates,
       (select count(*) from public.rotas             x where x.org_id = o.id) as rotas,
       (select count(*) from public.shifts            x where x.org_id = o.id) as shifts,
       (select count(*) from public.availability      x where x.org_id = o.id) as availability,
       (select count(*) from public.leave_requests    x where x.org_id = o.id) as leave,
       (select count(*) from public.overtime_requests x where x.org_id = o.id) as overtime,
       (select count(*) from public.shift_swaps       x where x.org_id = o.id) as swaps,
       (select count(*) from public.clock_events      x where x.org_id = o.id) as clock_events,
       (select count(*) from public.timesheets        x where x.org_id = o.id) as timesheets,
       (select count(*) from public.emergency_contacts x where x.org_id = o.id) as emergency,
       (select count(*) from public.documents         x where x.org_id = o.id) as documents,
       (select count(*) from public.announcements     x where x.org_id = o.id) as announcements,
       (select count(*) from public.notifications     x where x.org_id = o.id) as notifications,
       (select count(*) from public.invites           x where x.org_id = o.id) as invites,
       (select count(*) from public.audit_logs        x where x.org_id = o.id) as audit_logs,
       (select count(*) from public.subscriptions     x where x.org_id = o.id) as subscriptions
from public.organisations o
where o.slug in ('northgate-care','harbour-view-hotels','brightside-retail',
                 'clearway-logistics','meridian-security')
order by o.name;
