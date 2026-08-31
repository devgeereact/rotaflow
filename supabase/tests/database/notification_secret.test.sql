-- =====================================================================
-- notification_secret.test.sql — the outbox drain's shared secret lives
-- in one place, and asking about it is not a way to find it out
-- (docs/SAAS.md CAP-020, migration 0091)
--
-- The queue has existed since 0069 and has delivered nothing, because
-- the secret had to be set identically in two places that cannot be read
-- back, and for a month nobody set the second one. 0091 makes `vault`
-- the only place and generates the value in-database, so there is no
-- human step to skip.
--
-- What is asserted:
--
--   1. the secret exists after the migration — the whole point;
--   2. it is not a placeholder: 64 hex characters, from
--      `gen_random_bytes`, so a re-run of a half-finished setup cannot
--      leave something guessable behind;
--   3. `verify_notification_secret` says yes to the real value;
--   4. and no to anything else;
--   5. `authenticated` CANNOT call it. This is the assertion that
--      matters most: a function answering "is this the right secret?"
--      is a brute-force oracle, and one any signed-in user could call
--      would be worse than the broken state it replaces;
--   6. nor can `anon`;
--   7. `notification_delivery_configured()` tells the truth. A database
--      built from this repository alone has one of the three secrets —
--      the other two are project-specific and provisioned on the live
--      project — so here it must report NOT configured. A helper that
--      returned true would be reporting intent rather than state, which
--      is the failure this whole row is about.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

-- `supabase test db` runs against a database built from the migrations, so
-- 0091 has already created the secret. These read it rather than making one:
-- generating a fixture secret here would test the fixture, not the migration.

select ok(
  exists (select 1 from vault.secrets where name = 'notification_function_secret'),
  'the migration created the shared secret, so the drain has something to send'
);

select ok(
  (select decrypted_secret ~ '^[0-9a-f]{64}$'
     from vault.decrypted_secrets
    where name = 'notification_function_secret'),
  'and it is 32 random bytes rather than a placeholder somebody meant to replace'
);

select ok(
  public.verify_notification_secret(
    (select decrypted_secret from vault.decrypted_secrets
      where name = 'notification_function_secret')
  ),
  'the real value verifies'
);

select ok(
  not public.verify_notification_secret('not-the-secret'),
  'and anything else does not'
);

-- Who is allowed to ask.
select ok(
  not has_function_privilege(
    'authenticated', 'public.verify_notification_secret(text)', 'EXECUTE'),
  'a signed-in user cannot ask whether a guess is right — that would be a brute-force oracle'
);

select ok(
  not has_function_privilege(
    'anon', 'public.verify_notification_secret(text)', 'EXECUTE'),
  'and neither can an anonymous caller'
);

-- `send_notification_url` and `supabase_anon_key` are provisioned on the live
-- project, NOT by a migration — they are a URL and a key specific to one
-- project, and a migration that invented them would be wrong everywhere else.
-- So a database built purely from this repository has one of the three, and
-- the honest assertion is that the function says so. A helper that returned
-- true here would be reporting the migration's intent rather than the state.
select ok(
  not public.notification_delivery_configured(),
  'a database built from the migrations alone is NOT configured for delivery, and says so'
);

select * from finish();
rollback;
