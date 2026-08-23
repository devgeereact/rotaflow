-- =====================================================================
-- 0059_restore_rotas_draft_unique.sql — actually create 0004's indexes,
-- and clear the orphan drafts their absence allowed.
--
-- 0004_rotas_draft_unique.sql is recorded as applied in
-- supabase_migrations.schema_migrations, but neither index it declares
-- exists in the database: pg_indexes for `rotas` returns only rotas_pkey
-- and rotas_org_idx, and no later migration drops them. Recorded is not
-- applied. A full audit of all 76 indexes declared across the migration
-- set found these two to be the only such drift, so this migration is a
-- targeted repair rather than the first of a series.
--
-- What the absence cost, observed in production: two concurrent
-- get-or-create calls for the same org/location/week both inserted a
-- draft, 73ms apart. One later received every shift and was published;
-- the other stayed empty. The pair then made
-- `overlapping.every(r => r.status === 'published')` false, so the
-- manager dashboard and the staff schedule both announced
-- "Draft — not visible to staff" for a week that WAS published, printed
-- directly above the staff member's real published shifts.
--
-- Note what these indexes do and do not do. They are PARTIAL —
-- `where status = 'draft'` — so they prevent a second *draft* for a
-- scope, which is exactly the race above. They deliberately do not stop
-- a draft coexisting with a published rota for the same scope: that is a
-- legitimate state while next week's revision is being prepared. Which
-- means recreating the indexes cannot by itself remove the orphans
-- already created, hence step 2 below. The display half of the fix lives
-- in src/lib/rotaRollup.ts, which no longer lets a duplicate outvote the
-- published rota it duplicates.
-- =====================================================================

-- ── 1. Reconcile duplicate DRAFT rotas ───────────────────────────────
-- 0004's own reconciliation, which never ran. Shifts are reassigned to
-- the canonical rota rather than deleted, so no scheduled work is lost.
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
  SELECT r.id AS keeper_id, r.org_id, r.location_id, r.period_start, r.period_end
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

-- ── 2. Clear EMPTY orphan drafts shadowing a published rota ──────────
-- The residue of the race: a draft holding no shifts whatsoever, for a
-- scope that already has a published rota. It can only mislead — the
-- published rota is what findRotaForPeriod returns and what staff see.
--
-- Strictly guarded on purpose. `not exists (… shifts …)` means a draft
-- containing even one shift is never touched, because that is a real
-- work-in-progress revision of a published week and deleting it would
-- destroy a manager's unpublished edits. This removes only rows that
-- carry no information.
DELETE FROM public.rotas d
WHERE d.status = 'draft'
  AND NOT EXISTS (
    SELECT 1 FROM public.shifts s WHERE s.rota_id = d.id
  )
  AND EXISTS (
    SELECT 1
    FROM public.rotas p
    WHERE p.status = 'published'
      AND p.org_id = d.org_id
      AND p.period_start = d.period_start
      AND p.period_end = d.period_end
      AND p.location_id IS NOT DISTINCT FROM d.location_id
  );

-- ── 3. Create the indexes 0004 promised ──────────────────────────────
-- Identical definitions to 0004, so re-running either is a no-op.
create unique index if not exists rotas_draft_unique_location
  on public.rotas (org_id, location_id, period_start, period_end)
  where status = 'draft' and location_id is not null;

create unique index if not exists rotas_draft_unique_no_location
  on public.rotas (org_id, period_start, period_end)
  where status = 'draft' and location_id is null;
