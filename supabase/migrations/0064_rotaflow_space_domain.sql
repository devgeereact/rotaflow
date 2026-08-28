-- 0064: move the platform's canonical identity to rotaflow.space.
--
-- RotaFlow ran on rota.gakinz.com — a subdomain of the operator's personal
-- domain — until 2026-08-29. rotaflow.space is the product's own registered
-- domain, and unlike the old subdomain it carries a full mail record set
-- (MX x3, one SPF, one DKIM, one DMARC). The old host had SPF and DKIM but no
-- MX, so it could sign outbound mail while silently dropping every reply.
--
-- Two changes per column, and BOTH are needed. Altering a default does not
-- touch rows that already exist, and platform_settings is a singleton row
-- created long before this migration — so the update is what actually moves
-- production. The default is what stops a fresh environment being seeded with
-- a domain that no longer exists.

alter table public.platform_settings
  alter column platform_url set default 'https://rotaflow.space',
  alter column email_sender_address set default 'support@rotaflow.space';

-- Only rewrite rows still holding the retired values. An operator who has
-- deliberately set something else keeps it.
update public.platform_settings
   set platform_url = 'https://rotaflow.space'
 where platform_url in ('https://rota.gakinz.com', 'https://rotaflow.app');

update public.platform_settings
   set email_sender_address = 'support@rotaflow.space'
 where email_sender_address in ('info@gakinz.com', 'info@rota.gakinz.com');

comment on column public.platform_settings.platform_url is
  'Canonical public origin of this deployment. rotaflow.space since 2026-08-29; '
  'previously rota.gakinz.com, whose DNS was deleted in the same change.';
