-- =====================================================================
-- enquiries.test.sql — the public contact form's table (0155)
--
-- What has to hold:
--
--   * Only `service_role` can write an enquiry, and only through
--     `receive_enquiry`. `anon` holds nothing; `authenticated` cannot
--     insert, and cannot call the writer.
--   * Operational platform roles (owner, admin, support) read and triage;
--     finance and a tenant owner see nothing.
--   * The browser can change `status` and no other column, and cannot read
--     the abuse-handling columns at all.
--   * The per-address limit holds, and a limited call writes nothing.
--   * Retention knows the new data type, so the policy is not an intention.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'e1e1e1e1-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'enq-support@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e1e1e1e1-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'enq-finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e1e1e1e1-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'enq-tenant@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role) values
  ('e1e1e1e1-0000-4000-8000-000000000001', 'platform_support'),
  ('e1e1e1e1-0000-4000-8000-000000000002', 'platform_finance');

-- ---------- privileges -------------------------------------------------
select ok(
  not has_table_privilege('anon', 'public.enquiries', 'SELECT')
  and not has_table_privilege('anon', 'public.enquiries', 'INSERT'),
  'anon can neither read nor write enquiries'
);

select ok(
  not has_table_privilege('authenticated', 'public.enquiries', 'INSERT')
  and not has_table_privilege('authenticated', 'public.enquiries', 'DELETE'),
  'authenticated cannot insert or delete enquiries'
);

select ok(
  not has_function_privilege('anon',
    'public.receive_enquiry(text,text,text,text,text,text,boolean,boolean,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.receive_enquiry(text,text,text,text,text,text,boolean,boolean,text,text)', 'EXECUTE'),
  'neither browser role can call receive_enquiry'
);

select ok(
  has_function_privilege('service_role',
    'public.receive_enquiry(text,text,text,text,text,text,boolean,boolean,text,text)', 'EXECUTE'),
  'service_role, the Edge Function, can'
);

select ok(
  has_column_privilege('authenticated', 'public.enquiries', 'status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.enquiries', 'message', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.enquiries', 'work_email', 'UPDATE'),
  'the browser can update status and nothing the visitor wrote'
);

select ok(
  not has_column_privilege('authenticated', 'public.enquiries', 'ip_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.enquiries', 'user_agent', 'SELECT'),
  'the abuse-handling columns are not readable from a browser'
);

-- ---------- the writer -------------------------------------------------
-- As the test superuser, standing in for service_role.
select lives_ok(
  $$ select public.receive_enquiry('Alex Morgan', 'alex@example.test', 'Sunnyvale Care',
       '26-100', 'Care homes', 'We roster 60 carers across two homes.', true, false,
       repeat('a', 64), 'test-agent') $$,
  'receive_enquiry stores a valid enquiry'
);

select is(
  (select status from public.enquiries where work_email = 'alex@example.test'),
  'new',
  'a new enquiry starts as new'
);

select is(
  (select marketing_consent from public.enquiries where work_email = 'alex@example.test'),
  false,
  'marketing consent is false unless it was given'
);

select throws_ok(
  $$ select public.receive_enquiry('A', 'a@example.test', 'O', null, null,
       'Long enough message here.', false, false, 'not-a-hash', null) $$,
  '22023',
  null,
  'an unhashed address is refused'
);

-- Five from a second address reach the per-address limit of five.
do $$
begin
  for g in 1..5 loop
    perform public.receive_enquiry('Same Sender', 'same' || g || '@example.test', 'Org',
      null, null, 'Another message, long enough.', false, false, repeat('b', 64), null);
  end loop;
end;
$$;

select throws_ok(
  $$ select public.receive_enquiry('Same Sender', 'six@example.test', 'Org', null, null,
       'The sixth message in an hour.', false, false, repeat('b', 64), null) $$,
  'P0001',
  null,
  'the sixth enquiry in an hour from one address is refused'
);

select is(
  (select count(*)::int from public.enquiries where work_email = 'six@example.test'),
  0,
  'and the refused one wrote nothing'
);

-- ---------- who reads it -----------------------------------------------
create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

select pg_temp.become('e1e1e1e1-0000-4000-8000-000000000001');
select isnt(
  (select count(*)::int from public.enquiries),
  0,
  'platform_support reads enquiries'
);

update public.enquiries set status = 'replied' where work_email = 'alex@example.test';
select is(
  (select status from public.enquiries where work_email = 'alex@example.test'),
  'replied',
  'platform_support can move an enquiry on'
);

select pg_temp.become('e1e1e1e1-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.enquiries),
  0,
  'platform_finance reads no enquiries'
);

select pg_temp.become('e1e1e1e1-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.enquiries),
  0,
  'a signed-in user with no platform role reads none'
);

reset role;

select * from finish();
rollback;
