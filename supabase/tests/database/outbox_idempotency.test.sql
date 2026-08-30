-- =====================================================================
-- outbox_idempotency.test.sql — BUG-046: a replayed offline write lands
-- once.
--
-- The client half of this is covered in `syncQueue.test.ts`: the key is
-- minted before the first attempt, a caller's own key is not overwritten,
-- and a collision is treated as synced rather than dead-lettered. What
-- that suite cannot check is that the database actually refuses the
-- second insert — it mocks the write.
--
-- So this pins the constraint, and specifically the parts of it a
-- reasonable person might "tidy" later:
--
--   1. the same key twice is refused;
--   2. a different key is not;
--   3. NULL is not a key — every row written by any other path has one,
--      and a plain unique index would have collapsed them all into one;
--   4. the index is named what the client matches on, because
--      `isAlreadyApplied` tells a collision from an unrelated unique
--      violation by NAME, and renaming it would silently turn every
--      recognised replay back into a dead letter.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'e9111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-idem@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

insert into public.organisations (id, name, slug, created_by, plan) values
  ('e9999999-0000-0000-0000-000000000001', 'Org Idem', 'org-idem',
   'e9111111-1111-1111-1111-111111111111', 'business');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('e9999999-2000-0000-0000-000000000001',
   'e9999999-0000-0000-0000-000000000001', 'Idem', 'Tester');

-- 1: the replay collides.
insert into public.clock_events (org_id, staff_profile_id, type, event_at, client_event_id)
values ('e9999999-0000-0000-0000-000000000001','e9999999-2000-0000-0000-000000000001',
        'in', timezone('utc', now()), 'aaaaaaaa-1111-1111-1111-111111111111');

select throws_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, event_at, client_event_id)
    values ('e9999999-0000-0000-0000-000000000001','e9999999-2000-0000-0000-000000000001',
            'in', timezone('utc', now()), 'aaaaaaaa-1111-1111-1111-111111111111')$$,
  '23505',
  null,
  'the same client_event_id twice is refused — one action, one row'
);

-- 2: a genuinely different action still goes in.
select lives_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, event_at, client_event_id)
    values ('e9999999-0000-0000-0000-000000000001','e9999999-2000-0000-0000-000000000001',
            'out', timezone('utc', now()), 'aaaaaaaa-2222-2222-2222-222222222222')$$,
  'a different key is a different action and is accepted'
);

-- 3: NULL is not a key. Every row written online, by an import, or before
-- 0081 has none, and a non-partial unique index would have let exactly one
-- of them exist per table.
select lives_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, event_at)
    values ('e9999999-0000-0000-0000-000000000001','e9999999-2000-0000-0000-000000000001',
            'break_start', timezone('utc', now())),
           ('e9999999-0000-0000-0000-000000000001','e9999999-2000-0000-0000-000000000001',
            'break_end', timezone('utc', now()))$$,
  'two rows with no key coexist — the index is partial, so unkeyed writes are untouched'
);

-- 4: the names the client matches on.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public'
      and indexname in ('clock_events_client_event_id_key',
                        'leave_requests_client_event_id_key',
                        'shift_swaps_client_event_id_key')),
  3,
  'all three indexes exist under the exact names isAlreadyApplied matches on'
);

select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public'
      and indexname = 'clock_events_client_event_id_key'
      and indexdef like '%WHERE %client_event_id IS NOT NULL%'),
  1,
  'and it really is partial, not merely nullable'
);

select * from finish();
rollback;
