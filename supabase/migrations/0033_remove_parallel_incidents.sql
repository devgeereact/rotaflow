-- =====================================================================
-- 0033. Remove the parallel incident feature nobody declared
--
-- Regenerating the types from the live database turned up a second incident
-- implementation that exists in production and in no migration file:
--
--   table      platform_incidents
--   functions  open_incident, set_incident_status, add_incident_event
--
-- plus `incident_events`, which 0028 already dropped for the same reason. It
-- was found because PostgREST suggested `incident_events` as a near match while
-- `public.incidents` was missing, and the rest surfaced when the generated
-- types were diffed against the migrations.
--
-- Every one of them is empty and referenced by no application code. 0021 built
-- the incident register this product actually uses, with a reference sequence,
-- a mandatory resolution note, a timeline table and audit writes. Two schemas
-- for one feature is how a support engineer ends up recording an outage in the
-- table nobody reads.
--
-- ## The finding worth keeping
--
-- Something wrote DDL to this database outside the migration set. The tables
-- are harmless; the unknown writer is not, because it means the repository
-- stopped being a complete description of production. After this migration the
-- two match again, verified by diffing `supabase gen types` output against the
-- declarations in `supabase/migrations`. That diff is worth repeating before
-- any future release.
-- =====================================================================

drop function if exists public.add_incident_event(uuid, text, text);
drop function if exists public.add_incident_event(uuid, text);
drop function if exists public.set_incident_status(uuid, text);
drop function if exists public.set_incident_status(uuid, text, text);
drop function if exists public.open_incident(text, text, text, text);
drop function if exists public.open_incident(text, text, text);

drop table if exists public.platform_incidents;
