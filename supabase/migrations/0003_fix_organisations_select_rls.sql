-- =====================================================================
-- 0003_fix_organisations_select_rls.sql — fix org-creation bootstrap bug
--
-- Bug: creating an organisation via `insert(...).select().single()` failed
-- with "new row violates row-level security policy for table organisations"
-- (42501), even though the INSERT's own WITH CHECK (auth.uid() = created_by)
-- passed. Root cause: PostgREST's insert+RETURNING requires the new row to
-- also satisfy the table's SELECT policy, which was `is_org_member(id)` —
-- but the `on_org_created` AFTER INSERT trigger that grants the creator
-- membership hasn't run yet at the point Postgres evaluates RETURNING
-- visibility. A chicken-and-egg bootstrap failure, not a client bug.
--
-- Fix: the creator can always see the org they just created, independent of
-- whether their membership row exists yet.
-- =====================================================================

drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations for select
  using (public.is_org_member(id) or created_by = auth.uid());
