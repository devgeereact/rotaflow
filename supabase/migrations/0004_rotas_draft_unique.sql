-- =====================================================================
-- 0004_rotas_draft_unique.sql — one draft rota per org/location/period
--
-- getOrCreateDraftRota (src/services/rotaService.ts) checked-then-inserted
-- with no DB constraint backing it, so two concurrent callers (e.g. two
-- managers opening the same week) could each pass the find-check and both
-- insert a draft rota for the same org/location/period. Partial unique
-- indexes make that impossible at the database level; the service catches
-- the resulting 23505 conflict and reloads the existing draft.
-- =====================================================================

create unique index if not exists rotas_draft_unique_location
  on public.rotas (org_id, location_id, period_start, period_end)
  where status = 'draft' and location_id is not null;

create unique index if not exists rotas_draft_unique_no_location
  on public.rotas (org_id, period_start, period_end)
  where status = 'draft' and location_id is null;
