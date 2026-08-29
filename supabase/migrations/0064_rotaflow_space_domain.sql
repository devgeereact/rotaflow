-- 0064: move the platform's canonical identity to rotaflow.space.
--
-- RotaFlow ran on a subdomain of the operator's personal domain until
-- 2026-08-29. rotaflow.space is the product's own registered domain, and
-- unlike that subdomain it carries a full mail record set (MX x3, one SPF,
-- one DKIM, one DMARC). The old host had SPF and DKIM but no MX, so it could
-- sign outbound mail while silently dropping every reply.
--
-- Two changes per column, and BOTH are needed. Altering a default does not
-- touch rows that already exist, and platform_settings is a singleton row
-- created long before this migration — so the update is what actually moves
-- production. The default is what stops a fresh environment being seeded with
-- a domain that no longer exists.

alter table public.platform_settings
  alter column platform_url set default 'https://rotaflow.space',
  alter column email_sender_address set default 'support@rotaflow.space';

-- platform_settings is a singleton (its primary key is a `true` boolean), and
-- this deployment's row was read before writing this migration: it held the
-- retired host and the operator's personal contact address. So both columns are
-- moved unconditionally rather than matched against the old literals — naming a
-- domain that no longer exists just to skip a row that does not exist either
-- would be dead weight. Re-point them by hand if a deployment wants something
-- other than the canonical values.
update public.platform_settings
   set platform_url = 'https://rotaflow.space'
 where platform_url is distinct from 'https://rotaflow.space';

update public.platform_settings
   set email_sender_address = 'support@rotaflow.space'
 where email_sender_address is distinct from 'support@rotaflow.space';

comment on column public.platform_settings.platform_url is
  'Canonical public origin of this deployment. rotaflow.space since 2026-08-29; '
  'the previous host was retired and its DNS deleted in the same change.';
