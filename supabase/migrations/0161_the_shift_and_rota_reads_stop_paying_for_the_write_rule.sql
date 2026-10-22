-- =====================================================================
-- 0161 — the shift and rota reads stop paying for the write rule
-- (GAP-071, HARDEN-007)
--
-- ## What the large-tenant load test found
--
-- The 21 October 2026 run of `scripts/load-test-workforce.mjs` (20 sites,
-- 250 staff, 10,000 shifts, 50,000 clock events, local stack) read 50,000
-- clock events in 0.9 s and 10,000 shifts in 2.0 s: five times the rows
-- in half the time. `EXPLAIN ANALYZE` as the owner showed why. The tenth
-- page of the shifts read cost 225 ms; the fiftieth page of the clock
-- events read cost 23 ms.
--
-- `0137` hoisted `shifts_select` into hashed SubPlans, and said of the
-- write policy:
--
--   `shifts_write` is `FOR ALL` and is evaluated per statement on the
--   rows it touches, so the per-row cost is not the same problem there.
--
-- That is true of INSERT, UPDATE and DELETE and false of SELECT. A
-- `FOR ALL` policy's USING clause is a SELECT policy as well, and
-- permissive policies are OR-ed, so every row a read scanned paid for
-- `has_org_role(org_id, ...)`, one SECURITY DEFINER call per row,
-- including every row an OFFSET skipped. The plan says so:
--
--   Filter: (has_org_role(org_id, '{owner,manager}') OR (hashed SubPlan ...))
--
-- `rotas` has the same shape (`rotas_write` is `FOR ALL`), and its
-- `rotas_select` still calls `is_org_member` and `has_org_role` per row.
-- Every shift read embeds `rota:rotas(status, supersedes_rota_id)`, so a
-- page of 1,000 shifts made 1,000 more lookups through both.
--
-- ## The change
--
-- 1. `shifts_write` and `rotas_write` become one policy per command:
--    INSERT, UPDATE, DELETE. Same predicate, same roles, same WITH
--    CHECK. A read no longer sees them.
-- 2. `rotas_select` becomes `id in (select my_readable_rota_ids())`.
--    `0137` wrote that function as the rota-readability rule (member of
--    the organisation, and published or archived unless the caller is an
--    owner or manager there) for `shifts_select`; the rota table now asks
--    the same question the same way.
--
-- ## Why nothing anyone can see changes
--
-- A row was readable under (select OR write). For a caller holding
-- owner or manager, every row the write rule admits is already admitted
-- by the select rule: `my_member_org_ids()` contains every organisation
-- `has_org_role(..., manager)` does (membership, live delegation, and a
-- read-write support session, which is also a member-scope session),
-- and `my_readable_rota_ids()` returns every rota of an organisation in
-- `my_managed_org_ids()`. So dropping the write rule from SELECT removes
-- nothing. `supabase/tests/database/shift_rota_write_split.test.sql`
-- compares visible rows against the old predicates evaluated directly,
-- and checks every write path for a manager and a staff member.
--
-- ## Measured, same dataset, same page
--
--   shifts, page 10 of five months: 225 ms before, 120 ms with (1) only,
--   75 ms with (1) and (2).
--
-- ## Migration risk
--
-- Policies only. No table altered, no row rewritten, no grant changed.
-- Reversible by recreating the two `FOR ALL` policies and the old
-- `rotas_select` (quoted in the test).
-- =====================================================================

drop policy if exists shifts_write on public.shifts;

create policy shifts_insert on public.shifts
  for insert
  with check (public.has_org_role(org_id, array['owner', 'manager']));

create policy shifts_update on public.shifts
  for update
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

create policy shifts_delete on public.shifts
  for delete
  using (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists rotas_write on public.rotas;

create policy rotas_insert on public.rotas
  for insert
  with check (public.has_org_role(org_id, array['owner', 'manager']));

create policy rotas_update on public.rotas
  for update
  using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

create policy rotas_delete on public.rotas
  for delete
  using (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists rotas_select on public.rotas;

create policy rotas_select on public.rotas
  for select
  using (id in (select public.my_readable_rota_ids()));
