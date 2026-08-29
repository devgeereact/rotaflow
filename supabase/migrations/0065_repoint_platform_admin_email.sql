-- 0065: move the platform Super Admin's login off the retired domain.
--
-- The account was created on a subdomain that was deleted on 2026-08-29 along
-- with its DNS, its mailbox and its docroot (see 0064). The address is now
-- unreachable in BOTH directions, so the only platform_admins account has no
-- email-based password recovery at all — a lost password would mean no route
-- back into the platform console.
--
-- Re-pointed rather than deleted, deliberately. This is the sole platform_admins
-- row: deleting it removes Super Admin access entirely, and the audit_logs
-- trigger blocks a user cascade anyway (it exempts org_id -> null, not
-- actor_user_id -> null).
--
-- Matched on the old address rather than a hardcoded uuid, so re-running is a
-- no-op and nothing depends on a generated identifier.
--
-- auth.identities keeps its OWN copy of the address inside identity_data. Move
-- only auth.users and the email provider still resolves the dead address, which
-- is the failure mode this migration exists to prevent — so both move together,
-- in one transaction.
--
-- NOTE: whoever applies this must also create the dev@rotaflow.space mailbox in
-- cPanel. Without it the address is valid but undeliverable, and recovery is
-- still dead — the exact problem being fixed here.

update auth.users
   set email = 'dev@rotaflow.space',
       updated_at = now()
 where email = 'dev@rota.gakinz.com';

update auth.identities
   set identity_data = jsonb_set(identity_data, '{email}', '"dev@rotaflow.space"'),
       updated_at = now()
 where provider = 'email'
   and identity_data->>'email' = 'dev@rota.gakinz.com';
