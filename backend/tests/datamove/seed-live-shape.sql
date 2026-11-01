-- LOCAL TEST ONLY. Synthetic data in the SHAPE of the live Supabase project (row counts from its table listing, 1 Nov 2026;
-- no live data was read): 1 organisation, 2 logins, 21 staff (one of them the owner, the rest without a login), 2 sites,
-- 6 rotas, 311 shifts, 8 clock events and timesheets, 1006 notifications, 381 audit rows, and the large tables the move
-- does NOT carry: 54 696 health samples, 3 018 delivery-log rows, 370 retention runs, 215 drained outbox rows.
-- Uses only columns that exist at migration 0156 (where production stops), so the same file seeds a 0156 and a 0164
-- source (scripts/datamove-test.sh live-source). Reference rows (plans, flags, settings, SLA targets, templates) are the
-- ones the migrations seed. The live listing showed 0 plans, flags and settings next to 1 flag change and 1 announcement
-- delivery, which their foreign keys make impossible, so those listed counts are estimates; the seed keeps the
-- migration-seeded rows and gives the change and the delivery their parents. Triggers are off while seeding.
\set ON_ERROR_STOP on
SET session_replication_role = replica;
SET TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.u(kind int, n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT (lpad(to_hex(kind), 8, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- two logins: the owner, and one person with a profile and no membership --------------------------------------------------
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at) VALUES
  (pg_temp.u(1, 1), 'authenticated', 'authenticated', 'owner@live-shape.test', '2026-08-01 09:00+00', '2026-10-31 18:02:11.250001+00', '{"full_name":"Olivia Owner"}', '2026-08-01 09:00+00', '2026-10-31 18:02+00'),
  (pg_temp.u(1, 2), 'authenticated', 'authenticated', 'second@live-shape.test', '2026-08-03 09:00+00', NULL, '{"full_name":"Sam Second"}', '2026-08-03 09:00+00', '2026-08-03 09:00+00');
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at)
SELECT pg_temp.u(1, n)::text, pg_temp.u(1, n), jsonb_build_object('sub', pg_temp.u(1, n)::text), 'email', now() FROM generate_series(1, 2) n;
INSERT INTO public.profiles (id, email, full_name, avatar_url, created_at, updated_at, is_platform_admin) VALUES
  (pg_temp.u(1, 1), 'owner@live-shape.test', 'Olivia Owner', NULL, '2026-08-01 09:00+00', '2026-08-01 09:00+00', false),
  (pg_temp.u(1, 2), 'second@live-shape.test', 'Sam Second', NULL, '2026-08-03 09:00+00', '2026-08-03 09:00+00', false);
INSERT INTO public.app_settings (id, user_id, theme, notifications_enabled, created_at, updated_at)
SELECT gen_random_uuid(), pg_temp.u(1, n), CASE n WHEN 1 THEN 'dark' ELSE 'light' END, true, now(), '2026-09-09 09:09:09.090909+00' FROM generate_series(1, 2) n;

-- one organisation, one membership -------------------------------------------------------------------------------------
INSERT INTO public.organisations (id, name, slug, plan, settings, created_by, created_at, updated_at, status, support_access_allowed, industry, country,
  timezone, contact_email, is_demo, onboarding_completed_at, trial_ends_at, last_activity_at) VALUES
  (pg_temp.u(2, 1), 'Riverside Care Ltd', 'riverside-care', 'starter', '{"min_rest_hours": 11}', pg_temp.u(1, 1), '2026-08-01 09:05+00', '2026-10-01 10:00+00',
   'active', false, 'Care', 'United Kingdom', 'Europe/London', 'owner@live-shape.test', false, '2026-08-01 09:30+00', '2026-08-31 09:05+00', now());
INSERT INTO public.memberships (id, org_id, user_id, role, status, created_at, updated_at) VALUES
  (pg_temp.u(3, 1), pg_temp.u(2, 1), pg_temp.u(1, 1), 'owner', 'active', '2026-08-01 09:05+00', '2026-08-01 09:05+00');

-- 2 sites, 4 departments, 5 job titles, 21 staff, 20 site assignments ---------------------------------------------------
INSERT INTO public.locations (id, org_id, name, address, latitude, longitude, timezone, geofence_radius_m, created_at, updated_at, location_type, status) VALUES
  (pg_temp.u(6, 1), pg_temp.u(2, 1), 'Riverside House', '1 River Rd, London SE1 7PB', 51.5033635, -0.1195244, 'Europe/London', 150, '2026-08-01+00', '2026-08-01+00', 'Residential', 'active'),
  (pg_temp.u(6, 2), pg_temp.u(2, 1), 'Oak Court', NULL, NULL, NULL, 'Europe/London', 200, '2026-08-01+00', '2026-08-01+00', NULL, 'active');
INSERT INTO public.departments (id, org_id, location_id, name, created_at, updated_at)
SELECT pg_temp.u(5, n), pg_temp.u(2, 1), pg_temp.u(6, 1 + (n - 1) / 2), CASE n % 2 WHEN 1 THEN 'Care' ELSE 'Kitchen' END, now(), now() FROM generate_series(1, 4) n;
INSERT INTO public.job_titles (id, org_id, name, colour, active, created_at, updated_at)
SELECT pg_temp.u(9, n), pg_temp.u(2, 1), (ARRAY['Care Assistant', 'Senior Carer', 'Nurse', 'Cook', 'Manager'])[n],
       (ARRAY['teal', 'amber', 'rose', 'sky', 'slate'])[n], true, now(), now() FROM generate_series(1, 5) n;
INSERT INTO public.staff_profiles (id, org_id, user_id, first_name, last_name, job_title, department_id, contract_type, weekly_hours, holiday_allowance, skills,
  payroll_id, start_date, phone, photo_url, active, created_at, updated_at, email, job_title_id)
SELECT pg_temp.u(10, n), pg_temp.u(2, 1), CASE WHEN n = 1 THEN pg_temp.u(1, 1) END,
       CASE WHEN n = 1 THEN 'Olivia' ELSE 'Staff' END, CASE WHEN n = 1 THEN 'Owner' ELSE 'Member ' || n END,
       (ARRAY['Care Assistant', 'Senior Carer', 'Nurse', 'Cook', 'Manager'])[1 + n % 5], pg_temp.u(5, 1 + n % 4),
       CASE WHEN n % 4 = 0 THEN 'zero-hours' ELSE 'permanent' END, CASE WHEN n % 4 = 0 THEN NULL ELSE 37.5 END, 28,
       CASE WHEN n % 3 = 0 THEN ARRAY['First aid'] ELSE '{}'::text[] END, 'PAY-' || lpad(n::text, 4, '0'), '2026-08-01'::date + n,
       CASE WHEN n % 2 = 0 THEN '+44 7700 900' || lpad(n::text, 3, '0') END, NULL, n <> 21, '2026-08-02+00', '2026-08-02+00',
       CASE WHEN n = 1 THEN 'owner@live-shape.test' ELSE 'staff' || n || '@live-shape.test' END, pg_temp.u(9, 1 + n % 5)
FROM generate_series(1, 21) n;
INSERT INTO public.staff_locations (staff_profile_id, location_id, org_id, created_at)
SELECT pg_temp.u(10, n), pg_temp.u(6, 1 + n % 2), pg_temp.u(2, 1), now() FROM generate_series(2, 21) n;

-- the rota: 3 shift types, 6 rotas (3 weeks x 2 sites, the last week in draft), 311 shifts across the October clock change
INSERT INTO public.shift_types (id, org_id, name, colour, default_start, default_end, is_paid, category, created_at, updated_at) VALUES
  (pg_temp.u(13, 1), pg_temp.u(2, 1), 'Early', '#2563eb', '07:00', '15:00', true, 'day', now(), now()),
  (pg_temp.u(13, 2), pg_temp.u(2, 1), 'Late', '#f59e0b', '14:00', '22:00', true, 'day', now(), now()),
  (pg_temp.u(13, 3), pg_temp.u(2, 1), 'Training', '#16a34a', NULL, NULL, false, NULL, now(), now());
INSERT INTO public.rotas (id, org_id, location_id, name, period_start, period_end, status, published_at, created_at, updated_at, created_by, published_by)
SELECT pg_temp.u(14, s * 10 + w), pg_temp.u(2, 1), pg_temp.u(6, s), 'Week of ' || to_char('2026-10-12'::date + w * 7, 'DD Mon'), '2026-10-12'::date + w * 7,
       '2026-10-12'::date + w * 7 + 6, CASE WHEN w < 2 THEN 'published' ELSE 'draft' END, CASE WHEN w < 2 THEN ('2026-10-09'::date + w * 7)::timestamptz END,
       now(), now(), pg_temp.u(1, 1), CASE WHEN w < 2 THEN pg_temp.u(1, 1) END
FROM generate_series(1, 2) s CROSS JOIN generate_series(0, 2) w;
INSERT INTO public.shifts (id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes, created_at, updated_at)
SELECT pg_temp.u(15, n), pg_temp.u(2, 1), pg_temp.u(14, site * 10 + day / 7), pg_temp.u(6, site), pg_temp.u(5, 2 * site - 1),
       CASE WHEN n % 50 = 0 THEN NULL ELSE pg_temp.u(10, staff) END, pg_temp.u(13, CASE WHEN late THEN 2 ELSE 1 END),
       (('2026-10-12'::date + day) + CASE WHEN late THEN time '14:00' ELSE time '07:00' END) AT TIME ZONE 'Europe/London',
       (('2026-10-12'::date + day) + CASE WHEN late THEN time '22:00' ELSE time '15:00' END) AT TIME ZONE 'Europe/London',
       30, CASE WHEN n % 50 = 0 THEN 'open' WHEN n % 41 = 0 THEN 'cancelled' ELSE 'assigned' END, NULL,
       CASE WHEN n % 60 = 0 THEN 'Handover at 14:45' END, now(), now()
FROM (SELECT n, (n - 1) % 21 AS day, 1 + ((n - 1) / 21) % 2 AS site, 2 + (n - 1) % 20 AS staff, n % 2 = 0 AS late FROM generate_series(1, 311) n) g;
INSERT INTO public.minimum_cover_rules (id, org_id, location_id, weekday, min_staff, created_at, updated_at)
SELECT pg_temp.u(17, s * 10 + d), pg_temp.u(2, 1), pg_temp.u(6, s), d, 2 + s, now(), now() FROM generate_series(1, 2) s CROSS JOIN generate_series(0, 6) d;

-- time: 8 clock events (4 shifts in and out), 1 correction, 8 timesheets ------------------------------------------------
INSERT INTO public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at, latitude, longitude, accuracy, method, location_name, synced, created_at, updated_at)
SELECT pg_temp.u(18, s.n * 2 + k), s.org_id, s.staff_profile_id, s.id, CASE k WHEN 0 THEN 'in' ELSE 'out' END,
       CASE k WHEN 0 THEN s.starts_at - interval '4 minutes 0.123456 seconds' ELSE s.ends_at + interval '2 minutes 0.5 seconds' END,
       51.5033635, -0.1195244, 12.5, 'gps', 'Riverside House', true, now(), now()
FROM (SELECT row_number() OVER (ORDER BY starts_at, id)::int AS n, sh.* FROM public.shifts sh WHERE staff_profile_id IS NOT NULL ORDER BY starts_at, id LIMIT 4) s
CROSS JOIN generate_series(0, 1) k;
INSERT INTO public.clock_event_corrections (id, org_id, clock_event_id, staff_profile_id, actor_user_id, actor_name, reason, before_value, after_value, created_at)
SELECT pg_temp.u(20, 1), c.org_id, c.id, c.staff_profile_id, pg_temp.u(1, 1), 'Olivia Owner', 'Forgot to clock in at the door',
       jsonb_build_object('event_at', c.event_at), jsonb_build_object('event_at', c.event_at - interval '5 minutes'), '2026-10-12 08:00+00'
FROM (SELECT * FROM public.clock_events ORDER BY id LIMIT 1) c;
INSERT INTO public.timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status, created_at, updated_at, approved_by, approved_at, version)
SELECT pg_temp.u(25, n), pg_temp.u(2, 1), pg_temp.u(10, n), '2026-10-12', '2026-10-18', 450 * (1 + n % 3), CASE WHEN n <= 4 THEN 'approved' ELSE 'open' END,
       now(), now(), CASE WHEN n <= 4 THEN pg_temp.u(1, 1) END, CASE WHEN n <= 4 THEN now() END, 0
FROM generate_series(2, 9) n;

-- communication: 1006 notifications to the two logins ------------------------------------------------------------------
INSERT INTO public.notifications (id, org_id, user_id, type, title, body, channel, read_at, created_at, updated_at)
SELECT pg_temp.u(27, n), pg_temp.u(2, 1), pg_temp.u(1, 1 + n % 2), CASE n % 3 WHEN 0 THEN 'rota' WHEN 1 THEN 'attendance' ELSE 'billing' END,
       'Notice ' || n, CASE WHEN n % 7 = 0 THEN NULL ELSE 'Body ' || n || ' — Zoë' END, 'in_app',
       CASE WHEN n % 3 = 0 THEN '2026-10-20 10:10:10.5+00'::timestamptz END, '2026-08-01+00'::timestamptz + n * interval '2 hours', now()
FROM generate_series(1, 1006) n;

-- billing and platform: 2 billing events, 1 flag change, 1 announcement and its delivery -------------------------------
INSERT INTO public.billing_events (id, provider, mode, event_id, event_type, org_id, event_created_at, received_at, processed_at, deliveries, last_error) VALUES
  (pg_temp.u(33, 1), 'stripe', 'test', 'evt_live_shape_1', 'customer.created', pg_temp.u(2, 1), '2026-08-01 09:10+00', '2026-08-01 09:10:01+00', '2026-08-01 09:10:02+00', 1, NULL),
  (pg_temp.u(33, 2), 'stripe', 'test', 'evt_live_shape_2', 'checkout.session.expired', pg_temp.u(2, 1), '2026-08-02 09:10+00', '2026-08-02 09:10:01+00', '2026-08-02 09:10:02+00', 1, NULL);
INSERT INTO public.feature_flag_changes (id, flag_key, actor_id, actor_name, field, before_value, after_value, created_at) VALUES
  (pg_temp.u(46, 1), 'ai_rota_assistant', pg_temp.u(1, 1), 'Olivia Owner', 'enabled', 'false', 'false', '2026-08-05+00');
INSERT INTO public.platform_announcements (id, title, body, kind, audience, audience_plans, channel, status, sent_at, created_by, created_at, updated_at) VALUES
  (pg_temp.u(40, 1), 'Welcome', 'Thanks for trying RotaFlow', 'product', 'all', '{}', 'in_app', 'sent', '2026-08-10+00', NULL, now(), now());
INSERT INTO public.platform_announcement_deliveries (id, announcement_id, org_id, sent_at, created_at) VALUES
  (pg_temp.u(41, 1), pg_temp.u(40, 1), pg_temp.u(2, 1), '2026-08-10+00', now());
DELETE FROM public.retention_policies WHERE data_type NOT IN (SELECT data_type FROM public.retention_policies ORDER BY data_type LIMIT 2);

-- audit: 381 rows ------------------------------------------------------------------------------------------------------
INSERT INTO public.audit_logs (id, org_id, actor_user_id, action, entity_type, entity_id, metadata, created_at, org_name, actor_email, actor_name, severity, scope, visibility, ip_address, user_agent)
SELECT pg_temp.u(45, n), CASE WHEN n % 20 = 0 THEN NULL ELSE pg_temp.u(2, 1) END, CASE WHEN n % 9 = 0 THEN NULL ELSE pg_temp.u(1, 1) END,
       CASE n % 4 WHEN 0 THEN 'shift.created' WHEN 1 THEN 'rota.published' WHEN 2 THEN 'staff.updated' ELSE 'member.invited' END,
       'shifts', pg_temp.u(15, 1 + n % 311), jsonb_build_object('n', n), '2026-08-01 00:00+00'::timestamptz + n * interval '4 hours 0.000123 seconds',
       CASE WHEN n % 20 = 0 THEN NULL ELSE 'Riverside Care Ltd' END, CASE WHEN n % 9 = 0 THEN NULL ELSE 'owner@live-shape.test' END, NULL,
       CASE n % 5 WHEN 0 THEN 'notice' WHEN 1 THEN 'warning' ELSE 'info' END, CASE WHEN n % 20 = 0 THEN 'platform' ELSE 'org' END,
       CASE n % 6 WHEN 0 THEN 'both' ELSE 'org' END, '203.0.113.7'::inet, 'Mozilla/5.0'
FROM generate_series(1, 381) n;

-- the tables the move does not carry, at their live sizes --------------------------------------------------------------
INSERT INTO public.platform_health_samples (id, service, status, latency_ms, source, checked_at) OVERRIDING SYSTEM VALUE
SELECT n, (ARRAY['database', 'auth', 'storage', 'functions'])[1 + n % 4], CASE WHEN n % 997 = 0 THEN 'degraded' ELSE 'operational' END, 20 + n % 180, 'scheduled',
       '2026-08-01+00'::timestamptz + n * interval '2 minutes'
FROM generate_series(1, 54696) n;
INSERT INTO public.platform_health_probes (request_id, service, sent_at) VALUES (1, 'database', now()), (2, 'auth', now());
INSERT INTO public.retention_runs (id, ran_at, dry_run, data_type, rows_removed) OVERRIDING SYSTEM VALUE
SELECT n, '2026-08-01 03:00+00'::timestamptz + n * interval '6 hours', false, 'notifications', n % 7 FROM generate_series(1, 370) n;
INSERT INTO public.notification_deliveries (id, org_id, user_id, channel, status, event_type, created_at)
SELECT gen_random_uuid(), pg_temp.u(2, 1), pg_temp.u(1, 1 + n % 2), (ARRAY['in_app', 'email', 'push'])[1 + n % 3], 'sent', 'rota', now() FROM generate_series(1, 3018) n;
INSERT INTO public.notification_outbox (id, org_id, event_name, payload, status, attempts, created_at, dispatched_at)
SELECT gen_random_uuid(), pg_temp.u(2, 1), 'rota/published', '{}', 'sent', 1, now(), now() FROM generate_series(1, 215) n;
INSERT INTO public.rate_limit_events (id, bucket, subject, created_at) OVERRIDING SYSTEM VALUE VALUES (1, 'enquiry', 'x', now());

SET session_replication_role = DEFAULT;
ANALYZE;
