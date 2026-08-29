-- =====================================================================
-- 0062_backfill_org_profile_columns.sql — move the organisation profile
-- out of `settings` and into the columns 0023 created for it.
--
-- 0023 added `industry`, `country`, `timezone`, `contact_email` and
-- `contact_phone` to `organisations` with this reasoning, quoted from the
-- migration itself:
--
--   "Industry, country and timezone were shown on every organisation and
--    stored for none. They are attributes of the customer, not of a rota,
--    so they belong on the organisation rather than in `settings`, where
--    nothing can index them and every reader has to guess the key."
--
-- Nothing then wrote them. The onboarding wizard and the settings page both
-- kept putting these values in the `settings` jsonb, so the columns stayed
-- null (or at their defaults) for every tenant that has ever existed.
--
-- That is what BUG-026 was downstream of: the admin console reads the
-- columns, found nothing, and invented an industry and a "last activity"
-- per row instead — plausible values, keyed to row position, that an
-- administrator would go on to act on.
--
-- The application writes the columns from this release. This backfills the
-- rows written before it, so a tenant that supplied an industry during
-- onboarding shows it rather than "Not available".
--
-- `settings` is deliberately left as it is. Its copies are now legacy
-- fallbacks that `orgProfileFields` still reads when a column is empty, and
-- deleting keys from a live jsonb to save a few bytes is a needless risk.
-- =====================================================================

update public.organisations
   set industry = nullif(btrim(settings->>'industry'), '')
 where industry is null
   and nullif(btrim(settings->>'industry'), '') is not null;

update public.organisations
   set contact_email = nullif(btrim(settings->>'contact_email'), '')
 where contact_email is null
   and nullif(btrim(settings->>'contact_email'), '') is not null;

update public.organisations
   set contact_phone = nullif(btrim(settings->>'phone'), '')
 where contact_phone is null
   and nullif(btrim(settings->>'phone'), '') is not null;

-- country and timezone are `not null default`, so "never written" looks
-- exactly like "written, and happens to equal the default". Only overwrite
-- a row still sitting on the default with a settings value that disagrees
-- with it: anything else would clobber a deliberate choice with a stale
-- jsonb copy.
update public.organisations
   set country = nullif(btrim(settings->>'country'), '')
 where country = 'United Kingdom'
   and nullif(btrim(settings->>'country'), '') is not null
   and btrim(settings->>'country') <> 'United Kingdom';

update public.organisations
   set timezone = nullif(btrim(settings->>'timezone'), '')
 where timezone = 'Europe/London'
   and nullif(btrim(settings->>'timezone'), '') is not null
   and btrim(settings->>'timezone') <> 'Europe/London';
