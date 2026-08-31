-- =====================================================================
-- erasure_coverage.test.sql — CAP-057 / GAP-013, and the bug 0111 fixed
--
-- `anonymize_staff_member` replaced a person's name with "Deleted
-- Member" and left their EMAIL ADDRESS on the record. Not a wrong
-- decision — `0011` was written before the column existed, `0053` added
-- it two months later for account linking, and nothing went back. The
-- register recorded the capability as verified clean, and it was: the
-- verification ran before the column existed.
--
-- So the assertions here are in two halves. The first is the bug:
--
--   1. the email address is gone;
--   2. the name is replaced and the login link severed;
--   3. a live calendar feed token is revoked — a URL in somebody's phone
--      would otherwise keep serving the shifts of a person the
--      organisation was just asked to erase, which is the one
--      consequence here that keeps producing NEW disclosures rather
--      than retaining an old one;
--   4. emergency contacts and documents are deleted outright;
--   5. shifts survive, attached to the anonymous record;
--   6. so do pay rates — the business still has to say what a week cost,
--      and a rate attached to nobody identifies nobody.
--
-- The second half is the gate, and is the reason this file exists rather
-- than three more assertions in the old one:
--
--   7. EVERY column on `staff_profiles` is either cleared by the
--      function or named in `erasure_retained_columns()` with a reason.
--
-- That is what stops the next added column from quietly surviving an
-- erasure the way `email` did for two months.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('b8111111-1111-1111-1111-111111111111'::uuid, 'owner-erase@example.test'),
  ('b8222222-2222-2222-2222-222222222222'::uuid, 'leaver@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('b8000000-0000-0000-0000-000000000001', 'Org Erase', 'org-erase',
   'b8111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('b8000000-0000-0000-0000-000000000001', 'b8222222-2222-2222-2222-222222222222', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('b8100000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001',
   'Ward E', 'Europe/London');

insert into public.staff_profiles
  (id, org_id, user_id, first_name, last_name, email, phone, payroll_id)
values
  ('b8200000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001',
   'b8222222-2222-2222-2222-222222222222', 'Ada', 'Lovelace',
   'leaver@example.test', '07700 900000', 'PAY-1');

insert into public.emergency_contacts (org_id, staff_profile_id, name, phone)
values ('b8000000-0000-0000-0000-000000000001', 'b8200000-0000-0000-0000-000000000001',
        'Next of kin', '07700 900001');

insert into public.calendar_feed_tokens (org_id, staff_profile_id)
values ('b8000000-0000-0000-0000-000000000001', 'b8200000-0000-0000-0000-000000000001');

insert into public.staff_pay_rates
  (org_id, staff_profile_id, hourly_rate_pence, effective_from)
values ('b8000000-0000-0000-0000-000000000001', 'b8200000-0000-0000-0000-000000000001',
        1200, '2026-01-01');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by)
values ('b8300000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001',
        'b8100000-0000-0000-0000-000000000001', 'A week',
        current_date, current_date + 6, 'draft', 'b8111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values ('b8400000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001',
        'b8300000-0000-0000-0000-000000000001', 'b8100000-0000-0000-0000-000000000001',
        'b8200000-0000-0000-0000-000000000001',
        timezone('utc', now()) + interval '1 day',
        timezone('utc', now()) + interval '1 day 8 hours', 'assigned');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b8111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select public.anonymize_staff_member(
  'b8000000-0000-0000-0000-000000000001', 'b8200000-0000-0000-0000-000000000001');

-- ── the bug ───────────────────────────────────────────────────────────

select is(
  (select email from public.staff_profiles where id = 'b8200000-0000-0000-0000-000000000001'),
  null,
  'the email address is gone — an erasure that leaves one has erased nobody'
);

select is(
  (select first_name || ' ' || last_name || ':' || coalesce(user_id::text, 'none')
     from public.staff_profiles where id = 'b8200000-0000-0000-0000-000000000001'),
  'Deleted Member:none',
  'the name is replaced and the login link severed'
);

select is(
  (select count(*)::int from public.calendar_feed_tokens
    where staff_profile_id = 'b8200000-0000-0000-0000-000000000001'
      and revoked_at is null),
  0,
  'a live calendar feed is revoked — otherwise a URL keeps serving an erased person''s shifts'
);

select is(
  (select count(*)::int from public.emergency_contacts
    where staff_profile_id = 'b8200000-0000-0000-0000-000000000001'),
  0,
  'pure PII containers are deleted outright'
);

select is(
  (select count(*)::int from public.shifts
    where staff_profile_id = 'b8200000-0000-0000-0000-000000000001'),
  1,
  'the shift survives, attached to the anonymous record'
);

select is(
  (select count(*)::int from public.staff_pay_rates
    where staff_profile_id = 'b8200000-0000-0000-0000-000000000001'),
  1,
  'and so does the pay rate — the business still has to say what a week cost'
);

reset role;

-- ── the gate ──────────────────────────────────────────────────────────
--
-- Every column, not a fixed list. `email` survived for two months because
-- the erasure was written against the columns that existed at the time, and
-- an assertion written the same way would have had the same blind spot.
select is(
  (
    select coalesce(string_agg(c.column_name, ', ' order by c.column_name), '')
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = 'staff_profiles'
       -- Not cleared by the function …
       and pg_get_functiondef(
             (select p.oid from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'anonymize_staff_member')
           ) not like '%' || c.column_name || ' =%'
       -- … and not declared as deliberately kept.
       and c.column_name not in (select column_name from public.erasure_retained_columns())
  ),
  '',
  'every column on staff_profiles is either cleared by the erasure or kept with a written reason'
);

select * from finish();
rollback;
