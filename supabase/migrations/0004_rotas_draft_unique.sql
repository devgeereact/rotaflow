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

-- Reconcile existing duplicate draft rotas before creating the uniqueness
-- constraints. Preserve all shifts by reassigning them to the canonical rota.
WITH duplicate_rotas AS (
  SELECT
    id,
    org_id,
    location_id,
    period_start,
    period_end,
    row_number() OVER (
      PARTITION BY org_id, location_id, period_start, period_end
      ORDER BY created_at, id
    ) AS row_num
  FROM public.rotas
  WHERE status = 'draft'
),
keepers AS (
  SELECT org_id, location_id, period_start, period_end, min(id) AS keeper_id
  FROM duplicate_rotas
  WHERE row_num = 1
  GROUP BY org_id, location_id, period_start, period_end
),
duplicates AS (
  SELECT r.id AS duplicate_id, k.keeper_id
  FROM duplicate_rotas r
  JOIN keepers k USING (org_id, location_id, period_start, period_end)
  WHERE r.row_num > 1
)
UPDATE public.shifts s
SET rota_id = d.keeper_id
FROM duplicates d
WHERE s.rota_id = d.duplicate_id;

delete from public.rotas r
using duplicates d
where r.id = d.duplicate_id;

create unique index if not exists rotas_draft_unique_location
  on public.rotas (org_id, location_id, period_start, period_end)
  where status = 'draft' and location_id is not null;

create unique index if not exists rotas_draft_unique_no_location
  on public.rotas (org_id, period_start, period_end)
  where status = 'draft' and location_id is null;
