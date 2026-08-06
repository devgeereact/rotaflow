-- =====================================================================
-- sunnyvale_seed.sql. The "Sunnyvale Care Group" showcase organisation
--
-- A single large, multi-site care organisation: 248 staff across 3 sites
-- and 8 departments, sized so the dashboard shows the figures the product
-- brief specifies (248 total, 41 on shift today, 23 open shifts,
-- 7 pending leave, ~92% coverage).
--
-- WHY IT IS A SEPARATE FILE, not part of demo_seed.sql
--   demo_seed.sql builds five *small* orgs-5 of everything, so every
--   screen can be read at a glance in a demo. Sunnyvale exists for the
--   opposite reason: to prove the product holds up at a realistic size,
--   where pagination, filters, coverage maths and the staff directory are
--   under actual load. Merging the two would mean re-running a 248-staff
--   build every time someone wanted to refresh the small demo, and would
--   put one file's bugs in the way of the other's dataset.
--
--   The two use DIFFERENT id namespaces ('rotaflow-sunnyvale-v1:' vs
--   'rotaflow-demo-v1:'), so neither can ever touch the other's rows.
--
-- RUN IT:  paste the whole file into the Supabase SQL editor and run once,
--          or POST it to /v1/projects/<ref>/database/query. Run it as a
--          single unit. It uses a session-local helper function.
--
-- IDEMPOTENT BY RESET: re-running DELETES the Sunnyvale org (cascading to
-- every child row) and rebuilds it, re-centred on the current week.
--
-- SAFETY: it only ever touches rows whose ids it derives itself, plus its
-- own two auth users. It never reads or writes the five demo orgs, and
-- never touches organisations created through the app.
--
-- ⚠️ THIS IS NOT A MIGRATION and must never be moved into
--    supabase/migrations/. Those auto-apply on merge to main, and demo
--    data must never ship that way.
--
-- Teardown: supabase/seed/sunnyvale_teardown.sql
-- Docs:     supabase/seed/README.md
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Distinct namespace from demo_seed.sql. Same key -> same uuid, forever.
create or replace function pg_temp.sv_uuid(p_key text)
returns uuid language sql immutable as $$
  select md5('rotaflow-sunnyvale-v1:' || p_key)::uuid;
$$;

delete from public.organisations where id = pg_temp.sv_uuid('org');

do $seed$
declare
  -- SET THIS BEFORE RUNNING. This repository is public, so a password
  -- committed here would be a working public credential for real,
  -- email-confirmed accounts on the live project. Same rule, and same
  -- reasoning, as demo_seed.sql.
  c_password constant text := 'CHANGE-ME-BEFORE-SEEDING';
  c_admin_email constant text := 'gakinz101@gmail.com';

  -- Plus-addressed on the owner's real mailbox so password resets and
  -- magic links genuinely arrive and nothing can hard-bounce.
  u_emails text[] := array[
    'gakinz101+sunnyvale.owner@gmail.com',
    'gakinz101+sunnyvale.manager@gmail.com'];
  u_names  text[] := array['Helen Braithwaite','Sarah Manager'];
  u_roles  text[] := array['owner','manager'];
  u_keys   text[] := array['owner','manager'];
  u_ids    uuid[] := array[]::uuid[];

  v_org    uuid := pg_temp.sv_uuid('org');
  v_admin  uuid;
  v_uid    uuid;
  v_new    uuid;
  v_has_pid boolean;
  j        int;

  -- ---------- sites ------------------------------------------------
  -- Sunnyvale Care Home is the primary site and carries most of the
  -- workforce; the brief's other two sites are deliberately different
  -- sizes so multi-site filters have something real to separate.
  loc_names text[] := array[
    'Sunnyvale Care Home','Westview Care Home','Riverside Support Centre'];
  loc_addr  text[] := array[
    '14 Sunnyvale Road, Leeds, LS8 2QP',
    '3 Westview Rise, Bradford, BD9 4TR',
    'Riverside House, Wetherby Road, York, YO26 6RB'];
  loc_lat   numeric[] := array[53.8267, 53.8120, 53.9583];
  loc_lng   numeric[] := array[-1.5100, -1.7830, -1.1140];

  -- ---------- departments (brief §"Example departments") ------------
  -- location index each department belongs to.
  dep_names text[] := array[
    'Care Home. Floor 1','Care Home, Floor 2','Care Home, Floor 3',
    'Nursing','Kitchen','Maintenance','Administration','Head Office'];
  dep_loc   int[]   := array[1,1,1,1,2,2,3,3];

  -- ---------- shift types ------------------------------------------
  st_names  text[] := array['Early','Day','Late','Night'];
  st_colour text[] := array['#86AC6A','#56AACD','#C48FD6','#6CA0EB'];
  st_start  time[] := array['07:00','09:00','14:00','22:00'];
  st_end    time[] := array['15:00','17:00','22:00','06:00'];

  -- ---------- name pools -------------------------------------------
  -- 40 x 40 = 1600 combinations for 248 staff, walked with a stride that
  -- is coprime to both lengths so the pairing does not repeat.
  fn text[] := array[
    'Amelia','Oliver','Priya','James','Sofia','Tomas','Grace','Daniel','Chloe','Mohammed',
    'Ruth','Ade','Niamh','Callum','Fatima','George','Isla','Hassan','Leah','Ryan',
    'Blessing','Katie','Samuel','Aisha','Connor','Megan','Idris','Freya','Joseph','Nadia',
    'Ewan','Rosie','Kwame','Hannah','Lucas','Bethan','Zainab','Alfie','Martha','Dylan'];
  ln text[] := array[
    'Okafor','Whitfield','Nowak','Bello','Hart','Raman','Adeyemi','Marchetti','Doherty','Khan',
    'Brennan','Osei','Kaur','Sutcliffe','Nkemdirim','Fairbanks','Alvarez','Mensah','Holloway','Petrov',
    'Ashworth','Iqbal','Duffy','Oyelaran','Kirkbride','Santos','Rahman','Lindqvist','Boateng','Trent',
    'Wallace','Ferreira','Adeyinka','Colquhoun','Mabika','Sinclair','Yildirim','Rowntree','Chukwu','Baptiste'];

  -- Job titles per department, as a flat lookup keyed by
  -- (department_index, variant). A nested `int[][]` was the obvious shape
  -- and does not work: Postgres multidimensional arrays must be
  -- rectangular, and these rows have 1-3 entries each, so the literal
  -- fails to parse at declaration time. Two variants per department,
  -- picked by parity, keeps it rectangular and readable.
  dep_job_a text[] := array[
    'Care Assistant','Care Assistant','Care Assistant','Registered Nurse',
    'Kitchen Assistant','Maintenance Operative','Administrator','Administrator'];
  dep_job_b text[] := array[
    'Senior Care Assistant','Activities Coordinator','Senior Care Assistant','Team Leader',
    'Chef','Maintenance Operative','Payroll Administrator','HR Advisor'];
  -- Qualifications that match the department, so a Kitchen Assistant is
  -- never NMC-registered.
  dep_skills text[] := array[
    'Manual handling','Manual handling','Manual handling','NMC registered',
    'Food hygiene','Legionella awareness','Data protection','Data protection'];

  v_staff_total constant int := 248;
  v_monday date := (current_date - ((extract(isodow from current_date)::int - 1)))::date;
begin
  if c_password = 'CHANGE-ME-BEFORE-SEEDING' then
    raise exception
      'Set c_password before running this seed. See supabase/seed/README.md.';
  end if;

  v_has_pid := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id');

  select id into v_admin from auth.users where lower(email) = c_admin_email;
  if v_admin is null then
    raise exception
      'No auth user for %. Sign up in the app first, then re-run this seed.', c_admin_email;
  end if;

  -- ---------------------------------------------------------------
  -- 1. Two sign-in-able accounts: an owner, and Sarah Manager, who is
  --    the persona every reference screen in design/ is signed in as.
  -- ---------------------------------------------------------------
  for j in 1..array_length(u_keys, 1) loop
    select id into v_uid from auth.users where lower(email) = u_emails[j];

    if v_uid is null then
      v_new := pg_temp.sv_uuid('user:' || u_keys[j]);

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

    update public.profiles set full_name = u_names[j] where id = v_uid;
    u_ids := u_ids || v_uid;
  end loop;

  -- ---------------------------------------------------------------
  -- 2. Organisation. `on_org_created` makes `created_by` the owner.
  -- ---------------------------------------------------------------
  insert into public.organisations (id, name, slug, plan, settings, created_by)
  values (v_org, 'Sunnyvale Care Group', 'sunnyvale-care-group', 'business',
          jsonb_build_object(
            'industry', 'Healthcare', 'size', '201-500',
            'locale', 'en-GB', 'timezone', 'Europe/London',
            'week_start', 'monday', 'date_format', 'dd/MM/yyyy', 'time_format', '24h'),
          v_admin);

  insert into public.subscriptions (id, org_id, plan, status, provider, provider_ref,
                                    current_period_end)
  values (pg_temp.sv_uuid('sub'), v_org, 'business', 'active', 'none',
          'sunnyvale-demo', (current_date + 30)::timestamptz);

  -- Owner + Sarah Manager. The admin's owner membership already exists
  -- from the trigger, so only these two are inserted.
  for j in 1..array_length(u_ids, 1) loop
    insert into public.memberships (id, org_id, user_id, role, status)
    values (pg_temp.sv_uuid('mem:' || u_keys[j]), v_org, u_ids[j], u_roles[j], 'active')
    on conflict do nothing;
  end loop;

  -- ---------------------------------------------------------------
  -- 3. Sites, departments, shift types
  -- ---------------------------------------------------------------
  insert into public.locations (id, org_id, name, address, latitude, longitude,
                                timezone, geofence_radius_m)
  select pg_temp.sv_uuid('loc:' || i), v_org, loc_names[i], loc_addr[i],
         loc_lat[i], loc_lng[i], 'Europe/London', 150
  from generate_series(1, 3) as i;

  insert into public.departments (id, org_id, location_id, name)
  select pg_temp.sv_uuid('dep:' || i), v_org, pg_temp.sv_uuid('loc:' || dep_loc[i]),
         dep_names[i]
  from generate_series(1, 8) as i;

  insert into public.shift_types (id, org_id, name, colour, default_start, default_end,
                                  is_paid, category)
  select pg_temp.sv_uuid('st:' || i), v_org, st_names[i], st_colour[i],
         st_start[i], st_end[i], true, 'shift'
  from generate_series(1, 4) as i;

  -- ---------------------------------------------------------------
  -- 4. 248 staff.
  --
  -- Distribution is deliberately uneven-60/25/15 across the three
  -- sites, because an evenly split workforce makes every per-site
  -- filter and coverage figure look identical, which hides exactly the
  -- bugs a multi-site dataset exists to expose.
  --
  -- 12 are inactive (leavers), so the directory's Active filter and the
  -- "236 active" figure have something real behind them.
  -- ---------------------------------------------------------------
  insert into public.staff_profiles (
    id, org_id, user_id, first_name, last_name, job_title, department_id,
    contract_type, weekly_hours, holiday_allowance, skills, payroll_id,
    start_date, phone, active)
  select
    pg_temp.sv_uuid('staff:' || i),
    v_org,
    -- Sarah Manager is staff #1 so she appears on the rota she manages;
    -- the owner is #2. Everyone else is record-only, which is the real
    -- state of a 248-person organisation that has not invited everyone.
    case i when 1 then u_ids[2] when 2 then u_ids[1] else null end,
    case i when 1 then 'Sarah' when 2 then 'Helen'
           else fn[1 + (i * 7) % 40] end,
    case i when 1 then 'Manager' when 2 then 'Braithwaite'
           else ln[1 + (i * 13) % 40] end,
    case i when 1 then 'Operations Manager' when 2 then 'Managing Director'
           -- Department index is `1 + (i % 8)`; parity picks one of the two
           -- titles that department actually has.
           else case when i % 2 = 0 then dep_job_a[1 + (i % 8)]
                     else dep_job_b[1 + (i % 8)] end end,
    pg_temp.sv_uuid('dep:' || (1 + (i % 8))),
    case when i % 9 = 0 then 'part_time' when i % 17 = 0 then 'bank' else 'full_time' end,
    case when i % 9 = 0 then 20 when i % 17 = 0 then 12 else 37.5 end,
    28,
    -- Keyed off the same department index as the job title. An earlier
    -- draft matched on `i % 8` directly, which is the index *minus one*,
    -- so Kitchen staff came out NMC-registered and Nursing did not.
    array[dep_skills[1 + (i % 8)], 'Safeguarding'],
    'SV' || lpad(i::text, 4, '0'),
    (current_date - ((i * 11) % 2400))::date,
    '+44 7' || lpad(((i * 37) % 1000000)::text, 9, '0'),
    -- 12 leavers, spread rather than clustered at the end.
    (i % 21 <> 0 or i <= 40)
  from generate_series(1, v_staff_total) as i;

  -- ---------------------------------------------------------------
  -- 5. One published rota per site for this week.
  -- ---------------------------------------------------------------
  insert into public.rotas (id, org_id, location_id, name, period_start, period_end,
                            status, published_at)
  select pg_temp.sv_uuid('rota:' || i), v_org, pg_temp.sv_uuid('loc:' || i),
         'Week of ' || to_char(v_monday, 'DD Mon YYYY'),
         v_monday, (v_monday + 6)::date, 'published', now() - interval '3 days'
  from generate_series(1, 3) as i;

  -- ---- assigned shifts -------------------------------------------
  -- Every active staff member works 4 of the 7 days. The day offsets
  -- are derived from the staff index so the pattern is stable across
  -- re-runs but different per person, a rota where everyone works the
  -- same four days has no coverage variation to look at.
  insert into public.shifts (
    id, org_id, rota_id, location_id, department_id, staff_profile_id,
    shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
  select
    pg_temp.sv_uuid('shift:' || s.i || ':' || d.day_offset),
    v_org,
    pg_temp.sv_uuid('rota:' || (1 + (s.i % 3))),
    pg_temp.sv_uuid('loc:' || (1 + (s.i % 3))),
    pg_temp.sv_uuid('dep:' || (1 + (s.i % 8))),
    pg_temp.sv_uuid('staff:' || s.i),
    pg_temp.sv_uuid('st:' || (1 + (s.i % 4))),
    ((v_monday + d.day_offset)::timestamp
      + st_start[1 + (s.i % 4)]) at time zone 'Europe/London',
    -- Night finishes the following morning; every other type finishes
    -- the same day. Getting this wrong is the classic midnight-crossing
    -- bug the test suite exists to catch, so the data exercises it.
    (((v_monday + d.day_offset)::timestamp
      + st_end[1 + (s.i % 4)])
      + case when (1 + (s.i % 4)) = 4 then interval '1 day' else interval '0' end)
      at time zone 'Europe/London',
    30, 'assigned', st_colour[1 + (s.i % 4)], null
  from generate_series(1, v_staff_total) as s(i)
  cross join lateral (
    select unnest(array[(s.i * 3) % 7, (s.i * 3 + 1) % 7,
                        (s.i * 3 + 3) % 7, (s.i * 3 + 5) % 7]) as day_offset
  ) as d
  where (s.i % 21 <> 0 or s.i <= 40)
  on conflict (id) do nothing;

  -- ---- 23 open shifts --------------------------------------------
  -- Unassigned and needing cover, spread across sites and days so the
  -- dashboard's "Open shifts" tile and the rota's gap indicators both
  -- have something to show.
  insert into public.shifts (
    id, org_id, rota_id, location_id, department_id, staff_profile_id,
    shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
  select
    pg_temp.sv_uuid('open:' || k),
    v_org,
    pg_temp.sv_uuid('rota:' || (1 + (k % 3))),
    pg_temp.sv_uuid('loc:' || (1 + (k % 3))),
    pg_temp.sv_uuid('dep:' || (1 + (k % 8))),
    null,
    pg_temp.sv_uuid('st:' || (1 + (k % 4))),
    ((v_monday + (k % 7))::timestamp + st_start[1 + (k % 4)]) at time zone 'Europe/London',
    (((v_monday + (k % 7))::timestamp + st_end[1 + (k % 4)])
      + case when (1 + (k % 4)) = 4 then interval '1 day' else interval '0' end)
      at time zone 'Europe/London',
    30, 'open', st_colour[1 + (k % 4)], 'Cover required'
  from generate_series(1, 23) as k;

  -- ---------------------------------------------------------------
  -- 6. 7 pending leave requests, plus settled history either side so
  --    the approval queue is not the only thing on the screen.
  -- ---------------------------------------------------------------
  insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date,
                                     end_date, status, reason, reviewed_by, reviewed_at)
  select
    pg_temp.sv_uuid('leave:pending:' || k), v_org, pg_temp.sv_uuid('staff:' || (k * 9)),
    (array['annual','sick','unpaid','parental','compassionate','annual','annual'])[k],
    (current_date + (k * 4))::date, (current_date + (k * 4) + 2)::date,
    'pending',
    (array['Family holiday','Hospital appointment','Moving house',
           'Childcare','Family bereavement','Annual leave','Wedding'])[k],
    null, null
  from generate_series(1, 7) as k;

  insert into public.leave_requests (id, org_id, staff_profile_id, type, start_date,
                                     end_date, status, reason, reviewed_by, reviewed_at)
  select
    pg_temp.sv_uuid('leave:settled:' || k), v_org, pg_temp.sv_uuid('staff:' || (k * 17)),
    'annual',
    (current_date - (k * 12))::date, (current_date - (k * 12) + 3)::date,
    case when k % 3 = 0 then 'rejected' else 'approved' end,
    'Annual leave', u_ids[2], now() - (k * interval '10 days')
  from generate_series(1, 9) as k;

  -- ---------------------------------------------------------------
  -- 7. Clock events for shifts that have already finished this week,
  --    so timesheets are computed from real attendance rather than
  --    from the rota. Minute-level jitter keeps variance realistic:
  --    a dataset where everyone clocks in exactly on time makes the
  --    variance column look broken.
  -- ---------------------------------------------------------------
  insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                   latitude, longitude, accuracy, method, location_name, synced)
  select
    pg_temp.sv_uuid('clock:in:' || sh.id::text), v_org, sh.staff_profile_id, sh.id, 'in',
    sh.starts_at + ((extract(epoch from sh.starts_at)::bigint % 9) - 4) * interval '1 minute',
    loc_lat[1], loc_lng[1], 12, 'gps', 'Sunnyvale Care Home', true
  from public.shifts sh
  where sh.org_id = v_org and sh.staff_profile_id is not null and sh.ends_at < now();

  insert into public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at,
                                   latitude, longitude, accuracy, method, location_name, synced)
  select
    pg_temp.sv_uuid('clock:out:' || sh.id::text), v_org, sh.staff_profile_id, sh.id, 'out',
    sh.ends_at + ((extract(epoch from sh.ends_at)::bigint % 11) - 3) * interval '1 minute',
    loc_lat[1], loc_lng[1], 12, 'gps', 'Sunnyvale Care Home', true
  from public.shifts sh
  where sh.org_id = v_org and sh.staff_profile_id is not null and sh.ends_at < now()
    -- One in every 40 finished shifts has no clock-out on purpose. That
    -- is the "forgot to clock out" case, and `pairClockEvents` must flag
    -- it for review rather than silently dropping the day, a real bug
    -- this repository has already shipped once.
    and (extract(epoch from sh.starts_at)::bigint % 40) <> 0;

  -- ---------------------------------------------------------------
  -- 8. Announcements
  -- ---------------------------------------------------------------
  insert into public.announcements (id, org_id, author_user_id, scope, location_id,
                                    department_id, title, body, urgent, published_at)
  values
    (pg_temp.sv_uuid('ann:1'), v_org, u_ids[2], 'org', null, null,
     'Winter rota published',
     'The rota for the next four weeks is now live. Please check your shifts and raise any swaps by Friday.',
     false, now() - interval '2 days'),
    (pg_temp.sv_uuid('ann:2'), v_org, u_ids[2], 'location', pg_temp.sv_uuid('loc:1'), null,
     'Fire drill. Thursday 10:00',
     'A full evacuation drill will run on Floor 1 and Floor 2. Please brief residents on Wednesday evening.',
     true, now() - interval '18 hours'),
    (pg_temp.sv_uuid('ann:3'), v_org, u_ids[1], 'org', null, null,
     'Mandatory manual handling refresher',
     'All care staff must complete the refresher before the end of the month. Sessions are bookable at reception.',
     false, now() - interval '9 days');

  -- ---------------------------------------------------------------
  -- 9. Timesheets for the two completed weeks
  -- ---------------------------------------------------------------
  insert into public.timesheets (id, org_id, staff_profile_id, period_start, period_end,
                                 total_minutes, status)
  select
    pg_temp.sv_uuid('ts:' || w || ':' || i), v_org, pg_temp.sv_uuid('staff:' || i),
    (v_monday - (w * 7))::date, (v_monday - (w * 7) + 6)::date,
    (1800 + ((i * 37) % 600)),
    case when w = 2 then 'approved' else 'submitted' end
  from generate_series(1, 2) as w
  cross join generate_series(1, 60) as i;
end
$seed$;

drop function if exists pg_temp.sv_uuid(text);

-- ---------------------------------------------------------------------
-- Verification. Re-derive the org id independently of the helper so this
-- checks the data rather than the function that wrote it.
-- ---------------------------------------------------------------------
select o.name,
       (select count(*) from public.locations       x where x.org_id = o.id) as locations,
       (select count(*) from public.departments     x where x.org_id = o.id) as departments,
       (select count(*) from public.staff_profiles  x where x.org_id = o.id) as staff,
       (select count(*) from public.staff_profiles  x where x.org_id = o.id and x.active) as active_staff,
       (select count(*) from public.shifts          x where x.org_id = o.id) as shifts,
       (select count(*) from public.shifts          x where x.org_id = o.id and x.status = 'open') as open_shifts,
       (select count(*) from public.shifts          x where x.org_id = o.id
          and x.starts_at::date = current_date and x.staff_profile_id is not null) as on_shift_today,
       (select count(*) from public.leave_requests  x where x.org_id = o.id and x.status = 'pending') as pending_leave,
       (select count(*) from public.clock_events    x where x.org_id = o.id) as clock_events
from public.organisations o
where o.id = md5('rotaflow-sunnyvale-v1:org')::uuid;
