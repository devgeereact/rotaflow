-- =====================================================================
-- 0072_hot_path_indexes.sql — composite indexes for the predicates the
-- app actually issues (docs/SAAS.md HARDEN-006)
--
-- Nearly every list query in `src/services` has the same shape:
--
--     .eq(<scope column>, …).order(<time column>, desc)
--
-- and nearly every index in 0002 is a single column. So Postgres can use
-- the index for the filter, but then has to sort what it finds. That is
-- free today and stops being free at the row counts the product is sold
-- against: a 250-person organisation running weekly rotas across six
-- sites writes tens of thousands of shifts and clock events a year, and
-- the screens that read them are the ones opened most.
--
-- Each index below is added because a specific function issues exactly
-- that predicate, and the function is named. Nothing is added
-- speculatively — an unused index is not free either, since every write
-- maintains it.
--
-- WHY NOT `CONCURRENTLY`. It cannot run inside a transaction block, and
-- the Supabase CLI wraps each migration file in one. On a populated
-- database that would matter, because a plain CREATE INDEX takes a
-- SHARE lock and blocks writes to the table for its duration. It does
-- not matter here: production currently holds one organisation and
-- effectively no rows (see the DATA_LIFECYCLE row-count note), so every
-- index below builds in milliseconds. **If this is ever replayed against
-- a large database, build these by hand with CONCURRENTLY instead.**
--
-- MIGRATION RISK. Additive only: no table altered, no row rewritten, no
-- policy or grant touched, and no existing index dropped — the
-- single-column ones stay, because they still serve lookups that do not
-- sort. Every statement is `if not exists`, so the file is re-runnable.
-- Reversible by dropping the named indexes.
-- =====================================================================

-- ── rotas ────────────────────────────────────────────────────────────
-- `listRotasForPeriod` (src/services/rotaService.ts) filters on all four
-- of these columns at once, and the rota builder calls it once per
-- location on every week load. The only existing indexes that cover the
-- combination are 0059's two PARTIAL unique ones, `where status =
-- 'draft'` — and this lookup deliberately does not filter on status,
-- because it has to see the published and archived rows too (that was
-- the pre-1.5 bug the function's own comment records). So today it falls
-- back to `rotas_org_idx` and filters every rota the org has ever had.
-- That set grows by one row per location per week, forever.
create index if not exists rotas_period_idx
  on public.rotas (org_id, location_id, period_start, period_end);

-- ── shifts ───────────────────────────────────────────────────────────
-- `listShiftsForPeriod` — every schedule view, the dashboard, and the
-- staff "my week". Filters org_id then a range on starts_at; the range
-- is the selective half and a two-column index makes it an index range
-- scan rather than a filter over the org's whole history.
create index if not exists shifts_org_starts_idx
  on public.shifts (org_id, starts_at);

-- `listShiftsForRota` — the builder grid. `shifts_rota_idx` already
-- serves the equality, but the query also orders by starts_at, so this
-- returns the rows already sorted.
create index if not exists shifts_rota_starts_idx
  on public.shifts (rota_id, starts_at);

-- ── clock_events ─────────────────────────────────────────────────────
-- The highest-growth table in the product: two rows per person per day,
-- every day, and it is never pruned below the retention window.
--
-- `listClockEventsForStaff` — one person, one window, ascending.
create index if not exists clock_events_staff_at_idx
  on public.clock_events (staff_profile_id, event_at);

-- `listClockEventsForOrg` — manager review, newest first. Descending is
-- deliberate: it matches the query's own ordering, so the planner reads
-- the index forwards rather than backwards.
create index if not exists clock_events_org_at_idx
  on public.clock_events (org_id, event_at desc);

-- ── staff_profiles ───────────────────────────────────────────────────
-- `listStaff` runs on nearly every screen in the app, and it filters
-- `active = true` far more often than not. A partial index is the right
-- shape here rather than a three-column one: it indexes only the rows
-- the common query wants, so it stays small, and it still returns them
-- in name order.
create index if not exists staff_profiles_org_active_name_idx
  on public.staff_profiles (org_id, first_name)
  where active is true;

-- ── the four approval queues ─────────────────────────────────────────
-- All four have the same two readers — one scoped to the org (a
-- manager's queue) and one to a staff profile (a person's own history) —
-- and both sort newest first.
create index if not exists leave_org_created_idx
  on public.leave_requests (org_id, created_at desc);
create index if not exists leave_staff_created_idx
  on public.leave_requests (staff_profile_id, created_at desc);

create index if not exists overtime_org_created_idx
  on public.overtime_requests (org_id, created_at desc);
-- `listOvertimeForStaff` orders by `date`, not `created_at` — the claim
-- is about a day worked, and that is the column the screen shows.
create index if not exists overtime_staff_date_idx
  on public.overtime_requests (staff_profile_id, date desc);

create index if not exists swaps_org_created_idx
  on public.shift_swaps (org_id, created_at desc);

-- `listSwapsForStaff` matches `requested_by OR target_staff_profile_id`,
-- and neither column has ever been indexed — the OR was resolved by
-- scanning. Two single-column indexes rather than a composite: a
-- composite cannot serve an OR across its own columns, whereas two
-- separate ones let the planner take a BitmapOr of both.
create index if not exists swaps_requested_by_idx
  on public.shift_swaps (requested_by);
create index if not exists swaps_target_idx
  on public.shift_swaps (target_staff_profile_id);

-- ── notifications ────────────────────────────────────────────────────
-- The bell polls this on every page, for every signed-in user.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- ── audit_logs ───────────────────────────────────────────────────────
-- 0016 indexed `(actor_user_id, created_at desc)` for Profile → Activity
-- and `created_at desc` on its own, but the org-scoped compliance view —
-- the one an owner actually opens — had only `audit_org_idx (org_id)`
-- and sorted afterwards. Append-only and never deleted, so this is the
-- table whose sort cost grows without limit.
create index if not exists audit_logs_org_created_idx
  on public.audit_logs (org_id, created_at desc);

-- ── documents ────────────────────────────────────────────────────────
-- `listExpiringDocuments` — the expiry reminders. Filters the org then
-- takes a range on expires_at.
create index if not exists documents_org_expiry_idx
  on public.documents (org_id, expires_at);
