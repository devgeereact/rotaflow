-- =====================================================================
-- 0073_connectors_are_planned.sql — the connector catalogue stops
-- claiming eight working integrations (docs/SAAS.md BUG-057)
--
-- 0026 seeded eight connectors and gave each one a status:
--
--     sage_payroll     operational   available
--     xero             operational   available
--     brighthr         degraded      available
--     google_calendar  operational   available
--     microsoft_365    operational   available
--     slack            operational   available
--     quickbooks       beta          available
--     bamboohr         beta          available
--
-- None of them exists. No Edge Function talks to Sage, Xero or BrightHR;
-- `integration_sync_runs` has never had a writer. So "operational" is
-- describing a thing that does not run, "degraded" implies BrightHR
-- partly works, and "beta" implies QuickBooks is in testing. All three
-- are inventions, and `available = true` goes further than a label: it
-- is the flag `connect_integration` checks, so the database was
-- genuinely prepared to let an owner connect Sage Payroll and then
-- silently sync nothing, forever.
--
-- The customer-facing screen was never affected — `/app/settings/
-- integrations` is SMTP only, and that is real. This is the platform
-- console, where an administrator acts on what it tells them.
--
-- WHY NOT DELETE THE ROWS. The catalogue is a useful roadmap, and
-- deleting it would take that with it while leaving 0026's `on conflict
-- (key) do nothing` unable to restore anything. The problem is the
-- claim, not the row. So a new status value says exactly what is true.
--
--     status    = 'planned'  — the connector does not exist yet
--     available = false      — and cannot be connected
--
-- Those are different facts and both are needed: `available` alone would
-- read as "temporarily closed", and a status alone would leave the
-- database willing to connect it.
--
-- `connect_integration` already raises 22023 on an unavailable
-- connector, so this needs no new guard — it makes an existing one bite.
--
-- WHAT STAYS TRUE. `integration_connector_stats` keeps working: it
-- selects `c.status` and `c.available` straight through, and its
-- deliberate null-not-100% behaviour for a connector nobody used already
-- reads correctly for one that cannot be used.
--
-- MIGRATION RISK. One CHECK constraint widened (strictly: it accepts one
-- more value, so nothing that was valid becomes invalid), and eight
-- catalogue rows updated. No tenant data is touched. `org_integrations`
-- is empty in production, so no existing connection is affected — and
-- had there been one, it would keep working, because this only blocks
-- NEW connections.
--
-- Reversible by setting the eight rows back and narrowing the CHECK,
-- though restoring a claim that was never true is not an improvement.
-- =====================================================================

alter table public.integration_connectors
  drop constraint if exists integration_connectors_status_check;

alter table public.integration_connectors
  add constraint integration_connectors_status_check
  check (status in ('planned','operational','degraded','down','beta','retired'));

comment on column public.integration_connectors.status is
  'planned: the connector does not exist yet, only an intention to build it. operational/degraded/down: it exists and this is its health. beta: it exists and is in testing. retired: it existed and no longer accepts connections. Anything other than planned asserts running code — do not set one until there is an Edge Function behind it.';

-- Every connector in the catalogue is planned, because not one of them is
-- built. This is deliberately unconditional rather than keyed to the eight
-- rows 0026 seeded: if any other row exists, it is in the same position.
update public.integration_connectors
   set status = 'planned',
       available = false
 where status <> 'planned'
    or available is true;
