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
  SELECT
    r.id AS keeper_id,
    r.org_id,
    r.location_id,
    r.period_start,
    r.period_end
  FROM duplicate_rotas r
  WHERE r.row_num = 1
),
duplicates AS (
  SELECT r.id AS duplicate_id, k.keeper_id
  FROM duplicate_rotas r
  JOIN keepers k
    ON r.org_id = k.org_id
    AND r.period_start = k.period_start
    AND r.period_end = k.period_end
    AND (r.location_id IS NOT DISTINCT FROM k.location_id)
  WHERE r.row_num > 1
),
reassigned_shifts AS (
  UPDATE public.shifts s
  SET rota_id = d.keeper_id
  FROM duplicates d
  WHERE s.rota_id = d.duplicate_id
  RETURNING s.id
)
DELETE FROM public.rotas r
USING duplicates d
WHERE r.id = d.duplicate_id;

create unique index if not exists rotas_draft_unique_location
  on public.rotas (org_id, location_id, period_start, period_end)
  where status = 'draft' and location_id is not null;

create unique index if not exists rotas_draft_unique_no_location
  on public.rotas (org_id, period_start, period_end)
  where status = 'draft' and location_id is null;
