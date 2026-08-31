-- =====================================================================
-- 0101_enterprise_stops_selling_sso.sql — stop selling two features
-- that do not exist (docs/SAAS.md CAP-067, CAP-068)
--
-- `plans.description` for Enterprise has read "Unlimited sites and
-- staff, with SSO." since `0023`, and the pricing page listed "SSO with
-- Microsoft 365 or Google" and "Payroll and HR integrations" beside it.
-- Neither is built. There is no SAML or OIDC call anywhere in the
-- product, and the whole of the payroll story is a `payroll_id` column
-- and a timesheet CSV.
--
-- This is a £790/month plan on a public page. That it is Contact-us
-- rather than self-serve makes the claim worse rather than better: it
-- is the bullet a sales conversation opens on, and the first thing the
-- buyer asks to see. `docs/SAAS.md` has recorded CAP-068 as "marketing
-- copy only" for two days without anybody changing the copy.
--
-- Both remain on the roadmap. Neither is sold until it is built.
--
-- The description lives in the database because the marketing page and
-- the billing screens must agree; `src/lib/marketing.test.ts` reads the
-- seeded rows out of the migrations and compares them, which is what
-- caught this the moment the page changed.
-- =====================================================================

-- SAFETY(update): one row, one column, marketing copy. No data is lost —
-- the previous text is quoted in this file's header.
update public.plans
   set description = 'Unlimited sites and staff, with hands-on onboarding.'
 where code = 'enterprise'
   and description = 'Unlimited sites and staff, with SSO.';
