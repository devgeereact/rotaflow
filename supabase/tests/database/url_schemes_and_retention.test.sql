-- =====================================================================
-- url_schemes_and_retention.test.sql — 0092 (HARDEN-003, GAP-027)
--
-- Two things the database used to trust the browser about.
--
-- URL SCHEMES. `DocumentsModal` refuses a link that is not http(s) and
-- explains why: the value is rendered as an `<a href>`, so a
-- `javascript:` scheme is stored XSS. That check is in a component; the
-- row is written through PostgREST, which no component sits in front of.
--
--   1. a `javascript:` document link is refused by the DATABASE;
--   2. so is a `data:` one — the other scheme that executes;
--   3. an ordinary https link is accepted, so the constraint is not
--      simply refusing everything;
--   4. the same holds for `staff_profiles.photo_url`, which had no
--      check anywhere at all;
--   5. and null is still allowed there, because a staff member without
--      a photo is the normal case.
--
-- RETENTION. `enforce_retention` deletes nothing for a data type it has
-- no branch for — it records "no rule implemented" instead, which is
-- honest and is why a policy row alone was never enough.
--
--   6. the policy exists and is 12 months;
--   7. a dry run records NO error against the notifications type. This
--      has to be read out of `retention_runs`: calling the function and
--      seeing it succeed proves nothing, because the `else` path
--      succeeds too — it just logs "no rule implemented" and deletes
--      nothing.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'f1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-urls@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

insert into public.organisations (id, name, slug, created_by, plan) values
  ('ffffffff-0000-0000-0000-000000000001', 'Org URLs', 'org-urls',
   'f1111111-1111-1111-1111-111111111111', 'starter');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('ffffffff-2000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
   'Ada', 'Urls');

-- ── URL schemes ───────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name, file_url)
    values ('ffffffff-0000-0000-0000-000000000001',
            'ffffffff-2000-0000-0000-000000000001',
            'dbs', 'DBS check', 'javascript:alert(1)')$$,
  '23514',
  null,
  'a javascript: document link is refused by the database, not just by the form'
);

select throws_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name, file_url)
    values ('ffffffff-0000-0000-0000-000000000001',
            'ffffffff-2000-0000-0000-000000000001',
            'dbs', 'DBS check', 'data:text/html;base64,PHNjcmlwdD4=')$$,
  '23514',
  null,
  'and so is a data: one, the other scheme that executes'
);

select lives_ok(
  $$insert into public.documents (org_id, staff_profile_id, type, name, file_url)
    values ('ffffffff-0000-0000-0000-000000000001',
            'ffffffff-2000-0000-0000-000000000001',
            'dbs', 'DBS check', 'https://example.test/dbs.pdf')$$,
  'an ordinary https link is accepted, so the constraint is not refusing everything'
);

select throws_ok(
  $$update public.staff_profiles set photo_url = 'javascript:alert(1)'
     where id = 'ffffffff-2000-0000-0000-000000000001'$$,
  '23514',
  null,
  'photo_url is constrained too — it had no check in the database or the client'
);

select lives_ok(
  $$update public.staff_profiles set photo_url = null
     where id = 'ffffffff-2000-0000-0000-000000000001'$$,
  'and null is still allowed: a staff member with no photo is the normal case'
);

-- ── Retention ─────────────────────────────────────────────────────────
select is(
  (select retain_months from public.retention_policies where data_type = 'notifications'),
  12,
  'the notifications policy exists, at 12 months'
);

-- The assertion that proves the BRANCH landed and not just the policy.
-- `lives_ok` on the function would prove nothing: the `else` path succeeds
-- too, it just writes 'no rule implemented for this data type' into the run
-- log and deletes nothing. So the test has to read the log.
select public.enforce_retention(true);

select is(
  (select error from public.retention_runs
    where data_type = 'notifications'
    order by ran_at desc limit 1),
  null,
  'the dry run recorded no error for notifications, so a rule really exists for it'
);

select * from finish();
rollback;
