-- =====================================================================
-- 0153_support_access_is_asked_for.sql — a new organisation starts with
-- support access off (plan decision D8, docs/SAAS.md CAP-044)
--
-- ## What was wrong
--
-- `organisations.support_access_allowed` is the customer's consent to
-- platform support opening their data. Since `0143` it is re-checked on
-- every read by `has_support_access`, and only an organisation owner can
-- change it (`set_org_support_access`). That part is sound.
--
-- The default is not. `0017` added the column `default true`, so every
-- organisation has consented from the moment it was created, before its
-- owner had seen the switch or been told what it does. Support staff then
-- grant themselves a time-boxed session against that standing consent.
-- The console calls the access "customer-approved", and for an owner who
-- never opened Settings it was approved by a column default.
--
-- ## The change
--
-- New organisations start with the switch off. When a support case needs
-- access, support asks in the case thread and the owner turns it on.
--
-- ## What this deliberately does not do
--
--   * **Existing rows are not touched.** Only the default changes, so an
--     organisation keeps whatever value it holds today. There are no paying
--     customers yet, so flipping existing rows would change nobody's
--     workflow, but it would also remove consent nobody has withdrawn, and
--     that is the owner's call, not a migration's.
--   * **No path sets the column explicitly on insert.** Organisation
--     creation (onboarding, the console's create-with-invite, import)
--     leaves it to the default, and the browser cannot write it at all
--     (`0017` withheld it, `0117` kept it withheld). So the new default
--     reaches every creation path without editing any of them.
--   * **Nothing about sessions changes.** Durations, scopes, expiry,
--     revocation and the `0148` rule that a session cannot create an owner
--     all stand as they are.
--
-- Non-destructive: a column default, no data rewritten.
-- =====================================================================

alter table public.organisations
  alter column support_access_allowed set default false;

comment on column public.organisations.support_access_allowed is
  'The customer''s consent to platform support opening their data. Re-checked on every read by has_support_access (0143); only an organisation owner can change it. Defaults to false for new organisations since 0153; existing rows kept their value.';
