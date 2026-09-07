-- =====================================================================
-- support_case_reopen.test.sql — a resolved, rated case can be reopened
-- (0024's CHECK, replaced by 0140)
--
-- ## The defect
--
-- `set_support_case_status` clears `resolved_at` for any status that is not
-- resolved or closed, while `support_cases_csat_after_resolution` required
-- `resolved_at` whenever `csat` was set. So the one case nobody could reopen
-- was the one the customer had been happy enough to rate, and the operator saw
-- a bare `23514` constraint violation rather than any explanation.
--
-- ## Shown to fail on the real defect
--
-- With `0140` reverted, assertion 1 fails with
-- `new row for relation "support_cases" violates check constraint
-- "support_cases_csat_after_resolution"`.
--
-- ## The other half of the assertion
--
-- Removing the constraint outright would let a rating be attached to a case
-- that was never resolved, which is what it existed to prevent. 3 and 4 hold
-- that line on both the update and the insert path — the insert case is why
-- this is a trigger and not a CHECK, since `NOT VALID` exempts only rows that
-- already exist and a CHECK therefore fires on the reopen too.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(5);

insert into public.organisations (id, name, slug) values
  ('c9000000-0000-0000-0000-000000000001', 'Reopen Care Ltd', 'reopen-care');

-- Resolved, and rated by the customer.
insert into public.support_cases
  (id, reference, org_id, requester_email, subject, priority, status, resolved_at, csat)
values
  ('c9000000-1000-0000-0000-000000000001', 'REOPEN-1',
   'c9000000-0000-0000-0000-000000000001', 'rated@example.test',
   'Resolved and rated', 'normal', 'resolved', timezone('utc', now()), 5);

-- ---------- the case reopens, and keeps what the customer said --------
select lives_ok(
  $$ update public.support_cases
        set status = 'open', resolved_at = null
      where id = 'c9000000-1000-0000-0000-000000000001' $$,
  'a resolved case that the customer rated can be reopened');

select is(
  (select csat::int from public.support_cases
    where id = 'c9000000-1000-0000-0000-000000000001'),
  5,
  'and the rating survives: reopening a case must not edit a satisfaction metric');

-- ---------- but a rating still implies a resolution -------------------
insert into public.support_cases
  (id, reference, org_id, requester_email, subject, priority, status)
values
  ('c9000000-1000-0000-0000-000000000002', 'REOPEN-2',
   'c9000000-0000-0000-0000-000000000001', 'unrated@example.test',
   'Never resolved', 'normal', 'open');

select throws_ok(
  $$ update public.support_cases set csat = 4
      where id = 'c9000000-1000-0000-0000-000000000002' $$,
  '22023',
  'A case can only be rated once it has been resolved',
  'a case that was never resolved cannot be rated');

select throws_ok(
  $$ insert into public.support_cases
       (reference, org_id, requester_email, subject, priority, status, csat)
     values ('REOPEN-3', 'c9000000-0000-0000-0000-000000000001',
             'arrives@example.test', 'Arrives rated', 'normal', 'open', 5) $$,
  '22023',
  'A case can only be rated once it has been resolved',
  'and a case cannot arrive already rated — the insert path a CHECK could not express');

-- The rating that IS legitimate still lands.
select lives_ok(
  $$ update public.support_cases
        set status = 'resolved', resolved_at = timezone('utc', now()), csat = 3
      where id = 'c9000000-1000-0000-0000-000000000002' $$,
  'resolving and rating in one statement is still allowed');

select * from finish();
rollback;
