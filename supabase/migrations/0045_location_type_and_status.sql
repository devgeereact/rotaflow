-- =====================================================================
-- 0045_location_type_and_status.sql — site type and operating status
--
-- SCREENS.locations shows each site's type (Residential / Dementia care /
-- Domiciliary / Head office), a status pill, and an "In setup" tile counting
-- sites "not yet rosterable" — none of which `locations` could back
-- (locationsDirectoryMapping.ts's own docstring recorded the gap: type,
-- region and status all mapped to null because there was no column). This
-- adds the two the reference actually uses; region stays out; nothing reads
-- it anywhere yet and a column nothing reads is exactly the failure mode
-- SettingsPoliciesPage.tsx's own docstring warns against.
--
-- `status` defaults to 'setup': a freshly created site should not silently
-- count as rosterable before anyone has set its departments or staffing
-- minimum, matching the reference's own "not yet rosterable" framing.
-- =====================================================================

alter table public.locations
  add column if not exists location_type text,
  add column if not exists status text not null default 'setup';

alter table public.locations
  add constraint locations_status_check
    check (status in ('setup', 'active', 'maintenance', 'inactive'));

alter table public.locations
  add constraint locations_type_check
    check (
      location_type is null
      or location_type in ('Residential', 'Dementia care', 'Domiciliary', 'Head office')
    );

-- Every location that already exists has real departments and shifts
-- against it, so treating it as still "in setup" would be a regression on
-- day one of this migration, not a safe default.
update public.locations set status = 'active' where status = 'setup';
