-- LOCAL TEST ONLY. Synthetic data for the Supabase-shaped source database (scripts/datamove-test.sh source).
-- Covers every table the data move maps, with the edge cases it must survive: NULLs, unicode and emoji names, a name that
-- starts with "=", mixed-case and unconfirmed emails, a Google-only login, deleted, banned and erased users, a legacy
-- platform-admin flag, demo and suspended organisations, shifts across both 2026 clock changes, sub-millisecond clock
-- times, money in pence, half-day leave, file names Storage allows but the private store does not, pending deletions,
-- rows of skipped tables, and :shifts shifts (default 10000). Triggers are off while seeding (session_replication_role),
-- so every reference is made consistent here by hand.
\set ON_ERROR_STOP on
SET session_replication_role = replica;
SET TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.u(kind int, n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT (lpad(to_hex(kind), 8, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- people (kind 1) --------------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at)
SELECT pg_temp.u(1, n), 'authenticated', 'authenticated', 'user' || n || '@example.test', '2026-01-01 09:00+00',
       CASE WHEN n % 3 = 0 THEN NULL ELSE '2026-10-30 08:15:30.123456+00'::timestamptz END,
       jsonb_build_object('full_name', 'Person ' || n), '2026-01-01 09:00+00'::timestamptz + n * interval '1 hour', '2026-02-01 09:00+00'
FROM generate_series(1, 50) n;
UPDATE auth.users SET email = 'Mixed.Case@Example.TEST' WHERE id = pg_temp.u(1, 2);              -- lower-cased on the way
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = pg_temp.u(1, 3);                       -- never confirmed
UPDATE auth.users SET deleted_at = '2026-09-01 10:00+00' WHERE id = pg_temp.u(1, 4);              -- soft-deleted
UPDATE auth.users SET banned_until = '2099-01-01 00:00+00' WHERE id = pg_temp.u(1, 5);            -- banned
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at) VALUES
  (pg_temp.u(1, 90), 'authenticated', 'authenticated', 'erased@example.test', '2026-01-01+00', '2026-01-01+00'),   -- erasure pending, no profile
  (pg_temp.u(1, 91), 'authenticated', 'authenticated', 'stray@example.test', '2026-01-01+00', '2026-01-01+00');    -- no profile, unreferenced: not moved
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at)
SELECT pg_temp.u(1, n)::text, pg_temp.u(1, n), jsonb_build_object('sub', pg_temp.u(1, n)::text, 'email', 'user' || n || '@example.test'), 'email', now()
FROM generate_series(1, 50) n WHERE n <> 6;
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at) VALUES
  ('google-sub-6', pg_temp.u(1, 6), '{"email":"user6@example.test","name":"Google Only"}', 'google', now());       -- Google-only login

INSERT INTO public.profiles (id, email, full_name, avatar_url, created_at, updated_at, is_platform_admin)
SELECT pg_temp.u(1, n), lower(u.email),
       CASE n WHEN 7 THEN 'Zoë Ólafsdóttir' WHEN 8 THEN '李小龍' WHEN 9 THEN 'Nguyễn Thị Minh Khai' WHEN 10 THEN 'Ana 🌟 Silva'
              WHEN 11 THEN '=Ivan Formula' WHEN 12 THEN NULL WHEN 13 THEN 'O''Brien-Smythe' ELSE 'Person ' || n END,
       CASE n WHEN 14 THEN 'http://insecure.example/a.png' WHEN 15 THEN 'https://lh3.googleusercontent.com/a/abc=s96-c' ELSE NULL END,
       u.created_at, u.updated_at, n = 16
FROM auth.users u CROSS JOIN generate_series(1, 50) n WHERE u.id = pg_temp.u(1, n);
UPDATE public.profiles SET email = 'old-address@example.test' WHERE id = pg_temp.u(1, 17);         -- profile email drifted from the login

-- organisations (kind 2): A (business, active), B (suspended, unicode), Demo -------------------------------------------
INSERT INTO public.organisations (id, name, slug, plan, settings, created_by, created_at, updated_at, status, suspended_at, suspended_reason,
  support_access_allowed, industry, country, timezone, contact_email, contact_phone, is_demo, onboarding_completed_at, trial_ends_at, last_activity_at) VALUES
  (pg_temp.u(2, 1), 'Acme Care Homes', 'acme-care', 'business', '{"min_rest_hours": 11, "max_weekly_hours": 48, "nested": {"a": [1, 2]}}', pg_temp.u(1, 1),
   '2026-01-02 10:00+00', '2026-10-01 10:00+00', 'active', NULL, NULL, true, 'Care', 'United Kingdom', 'Europe/London', 'ops@acme.example', '+44 20 7946 0000', false, '2026-01-03+00', NULL, now()),
  (pg_temp.u(2, 2), 'Café Ünïcode Ltd ☕', 'cafe-unicode', 'starter', '{}', pg_temp.u(1, 41), '2026-02-02 10:00+00', '2026-09-01 10:00+00', 'suspended',
   '2026-09-01 10:00+00', 'Payment failed', false, NULL, 'United Kingdom', 'Europe/London', NULL, NULL, false, NULL, '2026-03-02 10:00+00', NULL),
  (pg_temp.u(2, 3), 'Demo Org', 'demo-org', 'professional', '{}', NULL, '2026-01-05 10:00+00', '2026-01-05 10:00+00', 'active', NULL, NULL, false, NULL,
   'United Kingdom', 'Europe/London', NULL, NULL, true, NULL, NULL, NULL);

INSERT INTO public.memberships (id, org_id, user_id, role, status, created_at, updated_at)
SELECT pg_temp.u(3, n), CASE WHEN n <= 40 THEN pg_temp.u(2, 1) WHEN n <= 45 THEN pg_temp.u(2, 2) ELSE pg_temp.u(2, 3) END, pg_temp.u(1, n),
       CASE WHEN n IN (1, 41, 46) THEN 'owner' WHEN n IN (2, 3) THEN 'manager' ELSE 'staff' END,
       CASE WHEN n = 39 THEN 'suspended' WHEN n = 40 THEN 'invited' ELSE 'active' END, '2026-01-03+00', '2026-01-03+00'
FROM generate_series(1, 48) n;

INSERT INTO public.invites (id, org_id, email, role, token_hash, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at, updated_at, department_id, location_id, last_sent_at, send_error) VALUES
  (pg_temp.u(4, 1), pg_temp.u(2, 1), 'newstarter@example.test', 'staff', encode(sha256('0123456789abcdef0123456789abcdef'::bytea), 'hex'), pg_temp.u(1, 1), '2099-01-01+00', NULL, NULL, NULL, '2026-10-20+00', '2026-10-20+00', pg_temp.u(5, 1), pg_temp.u(6, 1), '2026-10-20+00', NULL),
  (pg_temp.u(4, 2), pg_temp.u(2, 1), 'user20@example.test', 'staff', encode(sha256('accepted-token'::bytea), 'hex'), pg_temp.u(1, 1), '2026-02-01+00', '2026-01-10+00', pg_temp.u(1, 20), NULL, '2026-01-05+00', '2026-01-10+00', NULL, NULL, NULL, NULL),
  (pg_temp.u(4, 3), pg_temp.u(2, 1), 'revoked@example.test', 'manager', encode(sha256('revoked-token'::bytea), 'hex'), pg_temp.u(1, 1), '2026-05-01+00', NULL, NULL, '2026-04-01+00', '2026-03-01+00', '2026-04-01+00', NULL, NULL, NULL, 'SMTP 550 mailbox unavailable'),
  (pg_temp.u(4, 4), pg_temp.u(2, 2), 'expired@example.test', 'staff', encode(sha256('expired-token'::bytea), 'hex'), pg_temp.u(1, 41), '2026-03-01+00', NULL, NULL, NULL, '2026-02-01+00', '2026-02-01+00', NULL, NULL, NULL, NULL);

INSERT INTO public.platform_admins (user_id, role, granted_by, granted_at, revoked_at, revoked_by, note, created_at, updated_at) VALUES
  (pg_temp.u(1, 50), 'platform_owner', NULL, '2026-01-01+00', NULL, NULL, 'founder', '2026-01-01+00', '2026-01-01+00'),
  (pg_temp.u(1, 49), 'platform_support', pg_temp.u(1, 50), '2026-02-01+00', '2026-06-01+00', pg_temp.u(1, 50), 'left', '2026-02-01+00', '2026-06-01+00');
INSERT INTO public.role_delegations (id, org_id, from_user_id, to_user_id, starts_at, ends_at, note, revoked_at, created_at) VALUES
  (pg_temp.u(7, 1), pg_temp.u(2, 1), pg_temp.u(1, 1), pg_temp.u(1, 21), '2026-07-01+00', '2026-07-14+00', 'Holiday cover', NULL, '2026-06-30+00');
INSERT INTO public.app_settings (id, user_id, theme, notifications_enabled, created_at, updated_at, time_format, week_start, digest_frequency)
SELECT gen_random_uuid(), pg_temp.u(1, n), CASE WHEN n % 2 = 0 THEN 'light' ELSE 'dark' END, n % 5 <> 0, now(), '2026-05-05 05:05:05.555555+00',
       CASE WHEN n % 3 = 0 THEN '12h' ELSE '24h' END, CASE WHEN n % 4 = 0 THEN 'sunday' ELSE 'monday' END, 'immediate'
FROM generate_series(1, 20) n;
INSERT INTO public.push_subscriptions (id, user_id, endpoint, p256dh, auth_key, created_at) VALUES
  (pg_temp.u(8, 1), pg_temp.u(1, 1), 'https://fcm.googleapis.com/fcm/send/abc:def', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg', now()),
  (pg_temp.u(8, 2), pg_temp.u(1, 22), 'https://web.push.apple.com/QGuQyavXutnMH3DT0' || repeat('x', 300), 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg', now());

-- places (kinds 6 locations, 5 departments, 9 job titles, 10 staff) -----------------------------------------------------
INSERT INTO public.locations (id, org_id, name, address, latitude, longitude, timezone, geofence_radius_m, created_at, updated_at, location_type, status) VALUES
  (pg_temp.u(6, 1), pg_temp.u(2, 1), 'Riverside House', '1 River Rd, London SE1 7PB', 51.5033635, -0.1195244, 'Europe/London', 150, '2026-01-02+00', '2026-01-02+00', 'Residential', 'active'),
  (pg_temp.u(6, 2), pg_temp.u(2, 1), 'Maple Lodge — Dementia Unit', NULL, NULL, NULL, 'Europe/London', 300, '2026-01-02+00', '2026-01-02+00', 'Dementia care', 'active'),
  (pg_temp.u(6, 3), pg_temp.u(2, 1), 'Head Office', 'Ünit 5, Café Street', 53.4807593, -2.2426305, 'Europe/London', 100, '2026-01-02+00', '2026-01-02+00', NULL, 'setup'),
  (pg_temp.u(6, 4), pg_temp.u(2, 2), 'Café One', NULL, NULL, NULL, 'Europe/London', 150, '2026-02-02+00', '2026-02-02+00', NULL, 'active'),
  (pg_temp.u(6, 5), pg_temp.u(2, 3), 'Demo Site', NULL, NULL, NULL, 'Europe/London', 150, '2026-01-05+00', '2026-01-05+00', NULL, 'active');
INSERT INTO public.departments (id, org_id, location_id, name, created_at, updated_at) VALUES
  (pg_temp.u(5, 1), pg_temp.u(2, 1), pg_temp.u(6, 1), 'Care', now(), now()),
  (pg_temp.u(5, 2), pg_temp.u(2, 1), pg_temp.u(6, 2), 'Nursing', now(), now()),
  (pg_temp.u(5, 3), pg_temp.u(2, 1), NULL, 'Bank staff', now(), now()),
  (pg_temp.u(5, 4), pg_temp.u(2, 2), pg_temp.u(6, 4), 'Floor', now(), now()),
  (pg_temp.u(5, 5), pg_temp.u(2, 3), pg_temp.u(6, 5), 'Demo dept', now(), now());
INSERT INTO public.job_titles (id, org_id, name, colour, active, created_at, updated_at) VALUES
  (pg_temp.u(9, 1), pg_temp.u(2, 1), 'Care Assistant', 'teal', true, now(), now()),
  (pg_temp.u(9, 2), pg_temp.u(2, 1), 'Senior Carer', 'amber', true, now(), now()),
  (pg_temp.u(9, 3), pg_temp.u(2, 1), 'Registered Nurse', 'rose', true, now(), now()),
  (pg_temp.u(9, 4), pg_temp.u(2, 1), 'Old Title', 'teal', false, now(), now()),
  (pg_temp.u(9, 5), pg_temp.u(2, 2), 'Barista', NULL, true, now(), now());
INSERT INTO public.staff_profiles (id, org_id, user_id, first_name, last_name, job_title, department_id, contract_type, weekly_hours, holiday_allowance, skills,
  payroll_id, start_date, phone, photo_url, active, created_at, updated_at, email, job_title_id, photo_path)
SELECT pg_temp.u(10, n), CASE WHEN n <= 40 THEN pg_temp.u(2, 1) WHEN n <= 45 THEN pg_temp.u(2, 2) ELSE pg_temp.u(2, 3) END,
       CASE WHEN n = 38 THEN NULL ELSE pg_temp.u(1, n) END,
       split_part(coalesce(p.full_name, 'No Name'), ' ', 1),
       coalesce(nullif(substr(coalesce(p.full_name, ''), length(split_part(coalesce(p.full_name, ''), ' ', 1)) + 2), ''), ''),
       CASE WHEN n % 3 = 0 THEN 'Senior Carer' ELSE 'Care Assistant' END,
       CASE WHEN n <= 40 THEN pg_temp.u(5, 1 + n % 3) WHEN n <= 45 THEN pg_temp.u(5, 4) ELSE pg_temp.u(5, 5) END,
       CASE WHEN n % 4 = 0 THEN 'zero-hours' ELSE 'permanent' END, CASE WHEN n % 4 = 0 THEN NULL ELSE 37.5 END, CASE WHEN n % 5 = 0 THEN 28 ELSE 33.75 END,
       CASE WHEN n % 2 = 0 THEN ARRAY['First aid', 'Manual handling', 'Médication'] ELSE '{}'::text[] END,
       CASE WHEN n % 7 = 0 THEN NULL ELSE 'PAY-' || lpad(n::text, 4, '0') END, ('2025-01-01'::date + n), CASE WHEN n % 2 = 0 THEN '+44 7700 900' || lpad(n::text, 3, '0') END,
       CASE WHEN n = 19 THEN 'https://images.example/photo19.jpg' END, n <> 37, '2026-01-04+00', '2026-01-04+00',
       CASE WHEN n = 38 THEN NULL ELSE lower(u.email) END,
       CASE WHEN n <= 40 THEN pg_temp.u(9, 1 + n % 3) WHEN n <= 45 THEN pg_temp.u(9, 5) ELSE NULL END,
       CASE WHEN n = 18 THEN pg_temp.u(2, 1) || '/' || pg_temp.u(10, 18) || '/photo.jpg'
            WHEN n = 21 THEN pg_temp.u(2, 1) || '/' || pg_temp.u(10, 21) || '/Zoë portrait (1).JPG' END
FROM generate_series(1, 48) n LEFT JOIN public.profiles p ON p.id = pg_temp.u(1, n) LEFT JOIN auth.users u ON u.id = pg_temp.u(1, n);
UPDATE public.staff_profiles SET first_name = 'Erased', last_name = 'Person', email = NULL, phone = NULL, payroll_id = 'PAY-ERASED' WHERE id = pg_temp.u(10, 38);
INSERT INTO public.staff_locations (staff_profile_id, location_id, org_id, created_at)
SELECT pg_temp.u(10, n), pg_temp.u(6, 1 + n % 2), pg_temp.u(2, 1), now() FROM generate_series(1, 40) n
UNION ALL SELECT pg_temp.u(10, n), pg_temp.u(6, 3), pg_temp.u(2, 1), now() FROM generate_series(1, 5) n;
INSERT INTO public.staff_pay_rates (id, org_id, staff_profile_id, hourly_rate_pence, effective_from, note, created_by, created_at)
SELECT pg_temp.u(11, n * 10 + k), CASE WHEN n <= 40 THEN pg_temp.u(2, 1) WHEN n <= 45 THEN pg_temp.u(2, 2) ELSE pg_temp.u(2, 3) END, pg_temp.u(10, n),
       CASE k WHEN 1 THEN 1144 + n ELSE 1221 + n END, CASE k WHEN 1 THEN '2025-04-01'::date ELSE '2026-04-01'::date END,
       CASE WHEN n = 1 AND k = 2 THEN 'National Living Wage rise' END, pg_temp.u(1, 1), now()
FROM generate_series(1, 48) n CROSS JOIN generate_series(1, 2) k;
INSERT INTO public.emergency_contacts (id, org_id, staff_profile_id, name, relationship, phone, secondary_phone, created_at, updated_at)
SELECT pg_temp.u(12, n), pg_temp.u(2, 1), pg_temp.u(10, n), 'Contact of ' || n, CASE WHEN n % 2 = 0 THEN 'Partner' END, '+44 7700 900999', NULL, now(), now()
FROM generate_series(1, 10) n;

-- the rota (kinds 13 shift types, 14 rotas, 15 shifts) -------------------------------------------------------------------
INSERT INTO public.shift_types (id, org_id, name, colour, default_start, default_end, is_paid, category, created_at, updated_at) VALUES
  (pg_temp.u(13, 1), pg_temp.u(2, 1), 'Early', '#2563eb', '07:00', '15:00', true, 'day', now(), now()),
  (pg_temp.u(13, 2), pg_temp.u(2, 1), 'Night', '#7c3aed', '21:00', '07:00', true, 'night', now(), now()),
  (pg_temp.u(13, 3), pg_temp.u(2, 1), 'Training', '#16a34a', NULL, NULL, false, NULL, now(), now());
-- Weekly rotas from Sunday 1 March 2026 per care site, enough weeks for :shifts; the last two are drafts. The clock changes fall on 29 March and 25 October.
INSERT INTO public.rotas (id, org_id, location_id, name, period_start, period_end, status, published_at, created_at, updated_at, supersedes_rota_id, archived_at, created_by, published_by)
SELECT pg_temp.u(14, s * 1000 + w), pg_temp.u(2, 1), pg_temp.u(6, s), 'Week ' || (w + 1) || ' — site ' || s, '2026-03-01'::date + w * 7, '2026-03-01'::date + w * 7 + 6,
       CASE WHEN w < weeks - 2 THEN 'published' ELSE 'draft' END, CASE WHEN w < weeks - 2 THEN ('2026-03-01'::date + w * 7 - 3)::timestamptz END, now(), now(), NULL, NULL,
       CASE WHEN w = 0 THEN pg_temp.u(1, 90) ELSE pg_temp.u(1, 1) END, CASE WHEN w < weeks - 2 THEN pg_temp.u(1, 1) END
FROM generate_series(1, 2) s CROSS JOIN (SELECT (:shifts / 40) / 7 + 1 AS weeks) k CROSS JOIN LATERAL generate_series(0, k.weeks - 1) w;
INSERT INTO public.rotas (id, org_id, location_id, name, period_start, period_end, status, published_at, created_at, updated_at) VALUES
  (pg_temp.u(14, 9001), pg_temp.u(2, 1), NULL, 'Org-wide training', '2026-06-01', '2026-06-07', 'published', '2026-05-25+00', now(), now()),
  (pg_temp.u(14, 9002), pg_temp.u(2, 3), pg_temp.u(6, 5), 'Demo week', '2026-10-26', '2026-11-01', 'published', '2026-10-20+00', now(), now());
-- :shifts shifts in Acme: day d, staff (n-1)%40+1, site by staff parity, alternate early and night. A night ends at 07:00 local
-- the next morning, so the nights of 28 March and 24 October 2026 are 9 and 11 hours long in UTC.
INSERT INTO public.shifts (id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes, created_at, updated_at)
SELECT pg_temp.u(15, n), pg_temp.u(2, 1), pg_temp.u(14, site * 1000 + wk), pg_temp.u(6, site), pg_temp.u(5, 1 + (staff % 3)),
       CASE WHEN n % 97 = 0 THEN NULL ELSE pg_temp.u(10, staff) END, pg_temp.u(13, CASE WHEN night THEN 2 ELSE 1 END),
       ((day + CASE WHEN night THEN time '21:00' ELSE time '07:00' END) AT TIME ZONE 'Europe/London'),
       (((day + CASE WHEN night THEN 1 ELSE 0 END) + CASE WHEN night THEN time '07:00' ELSE time '15:00' END) AT TIME ZONE 'Europe/London'),
       CASE WHEN night THEN 60 ELSE 30 END,
       CASE WHEN n % 97 = 0 THEN 'open' WHEN n % 89 = 0 THEN 'cancelled' WHEN n % 5 = 0 THEN 'confirmed' ELSE 'assigned' END,
       CASE WHEN n % 50 = 0 THEN '#ff00aa' END, CASE WHEN n % 333 = 0 THEN 'Handover at 06:45 — bring keys 🔑; Zoë covers' END, now(), now()
FROM (SELECT n, ((n - 1) % 40) + 1 AS staff, 1 + (((n - 1) % 40) + 1) % 2 AS site, '2026-03-01'::date + ((n - 1) / 40) AS day,
             ((n - 1) / 40) / 7 AS wk, (n % 2 = 0) AS night FROM generate_series(1, :shifts) n) g;
INSERT INTO public.shifts (id, org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id, starts_at, ends_at, break_minutes, status, created_at, updated_at) VALUES
  (pg_temp.u(15, 900001), pg_temp.u(2, 1), NULL, NULL, NULL, NULL, NULL, '2026-06-02 09:00+00', '2026-06-02 12:00+00', 0, 'open', now(), now()),
  (pg_temp.u(15, 900002), pg_temp.u(2, 3), pg_temp.u(14, 9002), pg_temp.u(6, 5), pg_temp.u(5, 5), pg_temp.u(10, 46), NULL, '2026-10-27 08:00+00', '2026-10-27 16:00+00', 30, 'assigned', now(), now());
INSERT INTO public.availability (id, org_id, staff_profile_id, weekday, date, start_time, end_time, status, recurring, created_at, updated_at)
SELECT pg_temp.u(16, n), pg_temp.u(2, 1), pg_temp.u(10, n), CASE WHEN n % 2 = 0 THEN n % 7 END, CASE WHEN n % 2 = 1 THEN '2026-11-01'::date + n END,
       CASE WHEN n % 3 = 0 THEN '09:00'::time END, CASE WHEN n % 3 = 0 THEN '17:30'::time END,
       CASE n % 3 WHEN 0 THEN 'available' WHEN 1 THEN 'unavailable' ELSE 'preferred' END, n % 2 = 0, now(), now()
FROM generate_series(1, 30) n;
INSERT INTO public.minimum_cover_rules (id, org_id, location_id, weekday, min_staff, created_at, updated_at)
SELECT pg_temp.u(17, s * 10 + d), pg_temp.u(2, 1), pg_temp.u(6, s), d, 3 + s, now(), now() FROM generate_series(1, 2) s CROSS JOIN generate_series(0, 6) d;

-- time and requests ------------------------------------------------------------------------------------------------------
INSERT INTO public.clock_events (id, org_id, staff_profile_id, shift_id, type, event_at, latitude, longitude, accuracy, method, location_name, synced, created_at, updated_at, event_at_reported, client_event_id)
SELECT pg_temp.u(18, s.n * 2 + k), s.org_id, s.staff_profile_id, s.id, CASE k WHEN 0 THEN 'in' ELSE 'out' END,
       CASE k WHEN 0 THEN s.starts_at ELSE s.ends_at END + make_interval(secs => (s.n % 600) - 300 + 0.123456),
       CASE WHEN s.n % 3 = 0 THEN NULL ELSE 51.5033635 + s.n * 0.0000001 END, CASE WHEN s.n % 3 = 0 THEN NULL ELSE -0.1195244 END, CASE WHEN s.n % 3 = 0 THEN NULL ELSE 12.5 END,
       CASE s.n % 3 WHEN 0 THEN 'manual' WHEN 1 THEN 'gps' ELSE 'qr' END, 'Riverside House', s.n % 11 <> 0, now(), now(),
       CASE WHEN s.n % 11 = 0 THEN s.starts_at + interval '2 minutes 0.987654 seconds' END, CASE WHEN s.n % 4 = 0 THEN pg_temp.u(19, s.n * 2 + k) END
FROM (SELECT row_number() OVER (ORDER BY id)::int AS n, sh.* FROM public.shifts sh WHERE staff_profile_id IS NOT NULL AND starts_at < '2026-10-30' AND org_id = pg_temp.u(2, 1)) s
CROSS JOIN generate_series(0, 1) k WHERE s.n % 10 = 0;
INSERT INTO public.clock_event_corrections (id, org_id, clock_event_id, staff_profile_id, actor_user_id, actor_name, reason, before_value, after_value, created_at)
SELECT pg_temp.u(20, (row_number() OVER (ORDER BY c.id))::int), c.org_id, c.id, c.staff_profile_id, pg_temp.u(1, 90), 'Person 1 (manager)', 'Forgot to clock in — badge reader down',
       jsonb_build_object('event_at', c.event_at), jsonb_build_object('event_at', c.event_at - interval '5 minutes', 'note', 'café'), '2026-09-09 09:09:09.999999+00'
FROM (SELECT * FROM public.clock_events ORDER BY id LIMIT 20) c;
INSERT INTO public.leave_requests (id, org_id, staff_profile_id, type, start_date, end_date, status, reason, reviewed_by, reviewed_at, created_at, updated_at, client_event_id, starts_half, ends_half)
SELECT pg_temp.u(21, n * 10 + k), pg_temp.u(2, 1), pg_temp.u(10, n), CASE k WHEN 1 THEN 'holiday' WHEN 2 THEN 'sick' ELSE 'unpaid' END,
       '2026-11-02'::date + n * 3 + k * 200, '2026-11-02'::date + n * 3 + k * 200 + (n % 3),
       CASE k WHEN 1 THEN 'approved' WHEN 2 THEN 'pending' ELSE 'rejected' END, CASE WHEN n % 4 = 0 THEN 'Family wedding — Zoë' END,
       CASE WHEN k <> 2 THEN pg_temp.u(1, 1) END, CASE WHEN k <> 2 THEN '2026-10-01+00'::timestamptz END, now(), now(), CASE WHEN n % 6 = 0 THEN pg_temp.u(22, n * 10 + k) END,
       n % 5 = 0, n % 7 = 0
FROM generate_series(1, 40) n CROSS JOIN generate_series(1, 3) k;
INSERT INTO public.overtime_requests (id, org_id, staff_profile_id, date, hours, status, note, reviewed_by, reviewed_at, created_at, updated_at)
SELECT pg_temp.u(23, n), pg_temp.u(2, 1), pg_temp.u(10, n), '2026-10-01'::date + n, CASE WHEN n % 2 = 0 THEN 1.25 ELSE 2.5 END,
       CASE n % 4 WHEN 0 THEN 'approved' WHEN 1 THEN 'pending' WHEN 2 THEN 'rejected' ELSE 'cancelled' END, NULL, NULL, NULL, now(), now()
FROM generate_series(1, 12) n;
INSERT INTO public.shift_swaps (id, org_id, shift_id, requested_by, target_staff_profile_id, status, note, reviewed_by, reviewed_at, created_at, updated_at, client_event_id, applied_at, applied_shift_id, applied_from_staff_profile_id)
SELECT pg_temp.u(24, s.n), pg_temp.u(2, 1), s.id, s.staff_profile_id, pg_temp.u(10, 1 + (s.n % 40)), CASE WHEN s.n % 2 = 0 THEN 'pending' ELSE 'approved' END, 'Can you take this?',
       CASE WHEN s.n % 2 = 1 THEN pg_temp.u(1, 1) END, CASE WHEN s.n % 2 = 1 THEN now() END, now(), now(), NULL,
       CASE WHEN s.n % 2 = 1 THEN now() END, CASE WHEN s.n % 2 = 1 THEN s.id END, CASE WHEN s.n % 2 = 1 THEN s.staff_profile_id END
FROM (SELECT row_number() OVER (ORDER BY id)::int AS n, sh.* FROM public.shifts sh WHERE staff_profile_id IS NOT NULL AND org_id = pg_temp.u(2, 1) ORDER BY id DESC LIMIT 6) s;
INSERT INTO public.timesheets (id, org_id, staff_profile_id, period_start, period_end, total_minutes, status, created_at, updated_at, approved_by, approved_at, version, recalculation_required_at)
SELECT pg_temp.u(25, n * 100 + w), pg_temp.u(2, 1), pg_temp.u(10, n), '2026-03-01'::date + w * 7, '2026-03-01'::date + w * 7 + 6, 2250 + n * 7 + w,
       CASE w % 4 WHEN 0 THEN 'open' WHEN 1 THEN 'submitted' WHEN 2 THEN 'approved' ELSE 'exported' END, now(), now(),
       CASE WHEN w % 4 >= 2 THEN pg_temp.u(1, 1) END, CASE WHEN w % 4 >= 2 THEN now() END, w % 3, CASE WHEN n = 1 AND w = 2 THEN now() END
FROM generate_series(1, 40) n CROSS JOIN generate_series(0, 10) w;

-- communication ----------------------------------------------------------------------------------------------------------
INSERT INTO public.notification_templates (id, org_id, key, channel, subject, body, updated_at) VALUES
  (pg_temp.u(26, 1), pg_temp.u(2, 1), 'leave', 'email', 'Leave update — {{name}}', 'Hello {{name}}, your leave was {{status}}. Café rules apply.', now());
INSERT INTO public.notifications (id, org_id, user_id, type, title, body, channel, read_at, created_at, updated_at)
SELECT pg_temp.u(27, n), pg_temp.u(2, 1), pg_temp.u(1, 1 + n % 40), CASE n % 3 WHEN 0 THEN 'leave' WHEN 1 THEN 'swap' ELSE 'rota' END,
       'Rota published for week ' || n || ' ✅', CASE WHEN n % 5 = 0 THEN NULL ELSE 'Body ' || n || ' — ünïcödé' END, 'in_app',
       CASE WHEN n % 2 = 0 THEN '2026-10-10 10:10:10.5+00'::timestamptz END, now(), now()
FROM generate_series(1, 60) n;
INSERT INTO public.announcements (id, org_id, author_user_id, scope, location_id, department_id, title, body, urgent, published_at, created_at, updated_at) VALUES
  (pg_temp.u(28, 1), pg_temp.u(2, 1), pg_temp.u(1, 1), 'org', NULL, NULL, 'Welcome to RotaFlow', 'Hello everyone 👋', false, '2026-01-10+00', now(), now()),
  (pg_temp.u(28, 2), pg_temp.u(2, 1), pg_temp.u(1, 2), 'location', pg_temp.u(6, 1), NULL, 'Fire drill', 'Tuesday 10:00 at Riverside', true, '2026-05-10+00', now(), now()),
  (pg_temp.u(28, 3), pg_temp.u(2, 1), NULL, 'department', NULL, pg_temp.u(5, 2), 'Draft notice', 'Not yet published', false, NULL, now(), now());
INSERT INTO public.announcement_reads (id, org_id, announcement_id, staff_profile_id, read_at)
SELECT gen_random_uuid(), pg_temp.u(2, 1), pg_temp.u(28, 1 + n % 2), pg_temp.u(10, n), now() FROM generate_series(1, 25) n;
INSERT INTO public.org_smtp_settings (org_id, smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name, verified_at, created_at, updated_at) VALUES
  (pg_temp.u(2, 1), 'smtp.acme.example', 587, 'rota@acme.example', 'p@ss wörd 🔐', 'rota@acme.example', 'Acme Rota', now(), now(), now());

-- compliance (documents; the Storage files are written by run.php, which also records their size and eTag) ---------------
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars-legacy', 'avatars-legacy', true) ON CONFLICT DO NOTHING;
INSERT INTO public.documents (id, org_id, staff_profile_id, type, name, file_url, issued_at, expires_at, created_at, updated_at, storage_path) VALUES
  (pg_temp.u(29, 1), pg_temp.u(2, 1), pg_temp.u(10, 7), 'DBS', 'DBS certificate', NULL, '2025-01-01', '2028-01-01', '2026-02-02 02:02:02.123456+00', now(), pg_temp.u(2, 1) || '/' || pg_temp.u(10, 7) || '/dbs.pdf'),
  (pg_temp.u(29, 2), pg_temp.u(2, 1), pg_temp.u(10, 7), 'Right to work', 'Right to Work – Zoë', NULL, NULL, NULL, now(), now(), pg_temp.u(2, 1) || '/' || pg_temp.u(10, 7) || '/Right to Work – Zoë.pdf'),
  (pg_temp.u(29, 3), pg_temp.u(2, 1), pg_temp.u(10, 8), 'Training', 'Manual handling', 'https://docs.example.com/mh.pdf', '2026-01-01', NULL, now(), now(), NULL),
  (pg_temp.u(29, 4), pg_temp.u(2, 1), pg_temp.u(10, 9), 'Visa', 'Visa (old link)', 'https://abcdefgh.supabase.co/storage/v1/object/public/documents/visa.pdf', NULL, '2027-06-30', now(), now(), NULL),
  (pg_temp.u(29, 5), pg_temp.u(2, 2), pg_temp.u(10, 42), 'Food hygiene', 'Level 2', NULL, '2026-03-03', '2029-03-03', now(), now(), pg_temp.u(2, 2) || '/' || pg_temp.u(10, 42) || '/food.png');
INSERT INTO storage.objects (bucket_id, name, metadata, created_at) VALUES
  ('staff-documents', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 7) || '/dbs.pdf', '{"mimetype":"application/pdf"}', now()),
  ('staff-documents', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 7) || '/Right to Work – Zoë.pdf', '{"mimetype":"application/pdf"}', now()),
  ('staff-documents', pg_temp.u(2, 2) || '/' || pg_temp.u(10, 42) || '/food.png', '{"mimetype":"image/png"}', now()),
  ('staff-documents', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 9) || '/removed.pdf', '{"mimetype":"application/pdf"}', now()),
  ('staff-documents', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 10) || '/orphan.pdf', '{"mimetype":"application/pdf"}', now()),
  ('staff-photos', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 18) || '/photo.jpg', '{"mimetype":"image/jpeg"}', now()),
  ('staff-photos', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 21) || '/Zoë portrait (1).JPG', '{"mimetype":"image/jpeg"}', now()),
  ('avatars-legacy', 'someone.png', '{"mimetype":"image/png"}', now());

-- billing ----------------------------------------------------------------------------------------------------------------
UPDATE public.plans SET stripe_price_id = 'price_live_' || code, stripe_test_price_id = 'price_test_' || code;
INSERT INTO public.subscriptions (id, org_id, plan, status, provider, provider_ref, current_period_end, created_at, updated_at, price_pence, currency, trial_ends_at, canceled_at, started_at, stripe_customer_id, stripe_mode, past_due_since, grace_until) VALUES
  (pg_temp.u(30, 1), pg_temp.u(2, 1), 'business', 'active', 'stripe', 'sub_1PxAcmeLive', '2026-11-15 00:00+00', now(), now(), 29900, 'GBP', NULL, NULL, '2026-01-15+00', 'cus_AcmeLive123', 'live', NULL, NULL),
  (pg_temp.u(30, 2), pg_temp.u(2, 2), 'starter', 'past_due', 'stripe', 'sub_1PxCafeTest', '2026-09-01 00:00+00', now(), now(), 2900, 'GBP', '2026-03-02+00', NULL, '2026-02-02+00', 'cus_CafeTest', 'test', '2026-09-01+00', '2026-09-15+00');
INSERT INTO public.invoices (id, org_id, number, period_start, period_end, amount_pence, tax_pence, currency, status, issued_on, due_on, paid_at, refunded_at, failure_reason, attempts, provider, provider_ref, created_at, updated_at, hosted_invoice_url, invoice_pdf) VALUES
  (pg_temp.u(31, 1), pg_temp.u(2, 1), 'RF-2026-0001', '2026-01-15', '2026-02-14', 29900, 5980, 'GBP', 'paid', '2026-01-15', '2026-01-29', '2026-01-15 12:00:01.5+00', NULL, NULL, 1, 'stripe', 'in_1Acme1', now(), now(), 'https://invoice.stripe.com/i/acct_1/test_abc', 'https://pay.stripe.com/invoice/acct_1/test_abc/pdf'),
  (pg_temp.u(31, 2), pg_temp.u(2, 1), 'RF-2026-0002', '2026-02-15', '2026-03-14', 29900, 5980, 'GBP', 'refunded', '2026-02-15', '2026-03-01', '2026-02-15+00', '2026-02-20+00', NULL, 1, 'stripe', 'in_1Acme2', now(), now(), NULL, NULL),
  (pg_temp.u(31, 3), pg_temp.u(2, 2), 'RF-2026-0003', '2026-08-02', '2026-09-01', 2900, 0, 'GBP', 'past_due', '2026-08-02', '2026-08-16', NULL, NULL, 'card_declined: insufficient funds', 3, 'stripe', 'in_1Cafe1', now(), now(), NULL, NULL),
  (pg_temp.u(31, 4), pg_temp.u(2, 1), 'RF-2026-0004', '2026-10-15', '2026-11-14', 0, 0, 'GBP', 'void', '2026-10-15', '2026-10-15', NULL, NULL, NULL, 0, NULL, NULL, now(), now(), NULL, NULL);
INSERT INTO public.invoice_credits (id, invoice_id, org_id, amount_pence, currency, reason, idempotency_key, created_by, created_at) VALUES
  (pg_temp.u(32, 1), pg_temp.u(31, 1), pg_temp.u(2, 1), 1250, 'GBP', 'Goodwill credit for the outage on 3 Feb', 'credit-1', pg_temp.u(1, 50), now());
INSERT INTO public.billing_events (id, provider, mode, event_id, event_type, org_id, event_created_at, received_at, processed_at, deliveries, last_error) VALUES
  (pg_temp.u(33, 1), 'stripe', 'live', 'evt_1Live1', 'invoice.paid', pg_temp.u(2, 1), '2026-01-15 12:00+00', '2026-01-15 12:00:02+00', '2026-01-15 12:00:03+00', 1, NULL),
  (pg_temp.u(33, 2), 'stripe', 'test', 'evt_1Test1', 'invoice.payment_failed', pg_temp.u(2, 2), now(), now(), NULL, 3, 'org not found (retried)'),
  (pg_temp.u(33, 3), 'stripe', 'live', 'evt_1NoOrg', 'customer.created', NULL, now(), now(), now(), 1, NULL);

-- platform ---------------------------------------------------------------------------------------------------------------
UPDATE public.platform_settings SET platform_name = 'RotaFlow', registration_enabled = false, updated_by = pg_temp.u(1, 50);
UPDATE public.support_sla_targets SET first_response_minutes = 30 WHERE priority = 'urgent';
INSERT INTO public.feature_flag_targets (flag_key, org_id, created_at) VALUES ('ai_rota_assistant', pg_temp.u(2, 1), now()), ('advanced_reporting', pg_temp.u(2, 1), now());
UPDATE public.feature_flags SET enabled = true, rollout = 50, updated_by = pg_temp.u(1, 50) WHERE key = 'ai_rota_assistant';
INSERT INTO public.support_access_sessions (id, org_id, admin_user_id, reason, case_ref, scope, granted_at, expires_at, revoked_at, revoked_by, revoke_reason) VALUES
  (pg_temp.u(34, 1), pg_temp.u(2, 1), pg_temp.u(1, 50), 'Customer reported rota publishing error', 'CASE-4120', 'read', '2026-06-01 10:00+00', '2026-06-01 12:00+00', '2026-06-01 11:00+00', pg_temp.u(1, 50), 'Done');
INSERT INTO public.support_cases (id, reference, org_id, requester_id, requester_name, requester_email, subject, category, priority, status, assigned_to, first_response_at, resolved_at, csat, csat_comment, created_at, updated_at, first_response_due_at, resolution_due_at) VALUES
  (pg_temp.u(35, 1), 'CASE-4120', pg_temp.u(2, 1), pg_temp.u(1, 1), 'Person 1', 'user1@example.test', 'Cannot publish rota', 'bug', 'high', 'resolved', pg_temp.u(1, 50), '2026-06-01 10:30+00', '2026-06-01 12:00+00', 5, 'Great — thanks!', '2026-06-01 09:00+00', now(), '2026-06-01 13:00+00', '2026-06-02 09:00+00'),
  (pg_temp.u(35, 2), 'CASE-4121', NULL, NULL, NULL, 'visitor@example.test', 'Pricing question', 'question', 'normal', 'open', NULL, NULL, NULL, NULL, NULL, '2026-10-01 09:00+00', now(), NULL, NULL),
  (pg_temp.u(35, 3), 'CASE-4122', pg_temp.u(2, 2), pg_temp.u(1, 41), 'Café owner', 'user41@example.test', 'Billing failed', 'billing', 'urgent', 'pending', NULL, NULL, NULL, NULL, NULL, '2026-09-02 09:00+00', now(), NULL, NULL);
INSERT INTO public.support_case_messages (id, case_id, author_id, author_name, author_side, body, is_internal, created_at) VALUES
  (pg_temp.u(36, 1), pg_temp.u(35, 1), pg_temp.u(1, 1), 'Person 1', 'customer', 'Publish button errors out', false, '2026-06-01 09:00+00'),
  (pg_temp.u(36, 2), pg_temp.u(35, 1), pg_temp.u(1, 50), 'Support', 'platform', 'Looking now', false, '2026-06-01 10:30+00'),
  (pg_temp.u(36, 3), pg_temp.u(35, 1), pg_temp.u(1, 50), 'Support', 'platform', 'Internal: minimum cover bug', true, '2026-06-01 10:31+00'),
  (pg_temp.u(36, 4), pg_temp.u(35, 3), pg_temp.u(1, 41), 'Café owner', 'customer', 'Card declined?', false, '2026-09-02 09:00+00');
INSERT INTO public.incidents (id, reference, title, impact, severity, status, service, started_at, detected_at, resolved_at, owner_id, resolution, is_public, created_at, updated_at) VALUES
  (pg_temp.u(37, 1), 'INC-0138', 'Push delays', 'Notifications late by 10 minutes', 'medium', 'resolved', 'notifications', '2026-07-01 08:00+00', '2026-07-01 08:05+00', '2026-07-01 09:00+00', pg_temp.u(1, 50), 'Restarted the drain', true, now(), now());
INSERT INTO public.incident_updates (id, incident_id, author_id, status, body, created_at) VALUES
  (pg_temp.u(38, 1), pg_temp.u(37, 1), pg_temp.u(1, 50), 'investigating', 'Looking into it', '2026-07-01 08:06+00'),
  (pg_temp.u(38, 2), pg_temp.u(37, 1), pg_temp.u(1, 50), 'resolved', 'Fixed', '2026-07-01 09:00+00');
INSERT INTO public.enquiries (id, name, work_email, organisation, team_size, sector, message, wants_demo, marketing_consent, status, ip_hash, user_agent, created_at, updated_at) VALUES
  (pg_temp.u(39, 1), 'Jane Doe', 'jane@carehome.example', 'Care Home Ltd', '26-100', 'Care', 'We would like a demo please.', true, false, 'new', repeat('a', 64), 'Mozilla/5.0', '2026-10-01+00', now()),
  (pg_temp.u(39, 2), 'Jürgen Müller', 'j@klinik.example', 'Klinik GmbH', NULL, NULL, 'Do you support German law?', false, true, 'replied', NULL, NULL, '2026-09-01+00', now());
INSERT INTO public.platform_announcements (id, title, body, kind, audience, audience_plans, channel, status, scheduled_for, sent_at, created_by, created_at, updated_at) VALUES
  (pg_temp.u(40, 1), 'Planned maintenance', 'Sunday 02:00–02:30', 'maintenance', 'all', '{}', 'both', 'sent', NULL, '2026-08-01+00', pg_temp.u(1, 50), now(), now()),
  (pg_temp.u(40, 2), 'New AI assistant', 'For Business plans', 'product', 'plans', '{business,enterprise}', 'in_app', 'scheduled', '2099-01-01+00', NULL, pg_temp.u(1, 50), now(), now());
INSERT INTO public.platform_announcement_deliveries (id, announcement_id, org_id, sent_at, read_at, read_by, failed_at, failure_reason, created_at, outbox_id) VALUES
  (pg_temp.u(41, 1), pg_temp.u(40, 1), pg_temp.u(2, 1), '2026-08-01+00', '2026-08-02+00', pg_temp.u(1, 1), NULL, NULL, now(), NULL),
  (pg_temp.u(41, 2), pg_temp.u(40, 1), pg_temp.u(2, 2), NULL, NULL, NULL, '2026-08-01+00', 'no recipients', now(), NULL);
INSERT INTO public.platform_announcement_optouts (org_id, opted_out_by, created_at) VALUES (pg_temp.u(2, 2), pg_temp.u(1, 41), now());

-- data protection --------------------------------------------------------------------------------------------------------
INSERT INTO public.gdpr_requests (id, org_id, subject_email, subject_name, kind, status, received_on, due_on, extended_to, extension_reason, assigned_to, closed_at, outcome_note, created_at, updated_at) VALUES
  (pg_temp.u(42, 1), pg_temp.u(2, 1), 'erased@example.test', 'Erased Person', 'erasure', 'completed', '2026-09-01', '2026-10-01', NULL, NULL, pg_temp.u(1, 50), '2026-09-10+00', 'Erased; payroll kept 6 years', now(), now()),
  (pg_temp.u(42, 2), NULL, 'someone@example.test', NULL, 'access', 'received', '2026-10-20', '2026-11-20', NULL, NULL, NULL, NULL, NULL, now(), now());
INSERT INTO public.account_deletions (id, user_id, gdpr_request_id, status, attempts, request_id, last_error, created_at, dispatched_at, completed_at) VALUES
  (pg_temp.u(43, 1), pg_temp.u(1, 90), pg_temp.u(42, 1), 'sent', 1, 77, NULL, '2026-09-10+00', '2026-09-10+00', NULL),
  (pg_temp.u(43, 2), pg_temp.u(1, 99), NULL, 'done', 1, NULL, NULL, '2026-05-01+00', '2026-05-01+00', '2026-05-01+00');
INSERT INTO public.storage_deletions (id, org_id, bucket, path, is_folder, reason, status, attempts, request_id, last_error, created_at, dispatched_at, completed_at) VALUES
  (pg_temp.u(44, 1), pg_temp.u(2, 1), 'staff-documents', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 9) || '/removed.pdf', false, 'document_removed', 'pending', 0, NULL, NULL, now(), NULL, NULL),
  (pg_temp.u(44, 2), pg_temp.u(2, 1), 'staff-photos', pg_temp.u(2, 1) || '/' || pg_temp.u(10, 38), true, 'person_erased', 'done', 1, NULL, NULL, now(), now(), now());

-- audit (3000 rows; severity "notice" and visibility "both" have no target value and are mapped) -------------------------
INSERT INTO public.audit_logs (id, org_id, actor_user_id, action, entity_type, entity_id, metadata, created_at, org_name, actor_email, actor_name, severity, scope, visibility, ip_address, user_agent, before_value, after_value)
SELECT pg_temp.u(45, n), CASE WHEN n % 10 = 0 THEN NULL ELSE pg_temp.u(2, 1 + n % 3) END, CASE WHEN n % 7 = 0 THEN NULL ELSE pg_temp.u(1, 1 + n % 40) END,
       CASE n % 4 WHEN 0 THEN 'shift.created' WHEN 1 THEN 'rota.published' WHEN 2 THEN 'leave.approved' ELSE 'member.role_changed' END,
       CASE WHEN n % 13 = 0 THEN NULL ELSE 'shifts' END, CASE WHEN n % 13 = 0 THEN NULL ELSE pg_temp.u(15, n) END,
       CASE WHEN n = 5 THEN '[1, 2, 3]'::jsonb ELSE jsonb_build_object('n', n, 'note', 'Zoë') END,
       '2026-01-01 00:00+00'::timestamptz + n * interval '97 minutes 0.000123 seconds', CASE WHEN n % 10 = 0 THEN NULL ELSE 'Org ' || (1 + n % 3) END,
       CASE WHEN n % 7 = 0 THEN NULL ELSE 'user' || (1 + n % 40) || '@example.test' END, NULL,
       CASE n % 5 WHEN 0 THEN 'notice' WHEN 1 THEN 'warning' WHEN 2 THEN 'critical' ELSE 'info' END, CASE WHEN n % 10 = 0 THEN 'platform' ELSE 'org' END,
       CASE n % 6 WHEN 0 THEN 'both' WHEN 1 THEN 'platform_only' ELSE 'org' END, CASE WHEN n % 2 = 0 THEN '203.0.113.7'::inet ELSE '2001:db8::1'::inet END,
       CASE WHEN n % 3 = 0 THEN 'Mozilla/5.0 (iPhone)' END, CASE WHEN n % 8 = 0 THEN 'staff' END, CASE WHEN n % 8 = 0 THEN 'manager' END
FROM generate_series(1, 3000) n;

-- rows in tables the move deliberately skips -----------------------------------------------------------------------------
INSERT INTO public.calendar_feed_tokens (token, org_id, staff_profile_id, created_at) VALUES (gen_random_uuid(), pg_temp.u(2, 1), pg_temp.u(10, 1), now());
INSERT INTO public.notification_outbox (id, org_id, event_name, payload, status, attempts, created_at, dispatched_at) VALUES (gen_random_uuid(), pg_temp.u(2, 1), 'rota/published', '{}', 'sent', 1, now(), now());
INSERT INTO public.rate_limit_events (bucket, subject, created_at) VALUES ('enquiry', 'x', now());

SET session_replication_role = DEFAULT;
ANALYZE;
