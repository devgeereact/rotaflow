-- =====================================================================
-- 0005_narrow_organisations_select_rls.sql — close the permanent creator
-- backdoor left by 0003
--
-- 0003 added `created_by = auth.uid()` to organisations_select to fix the
-- insert+RETURNING bootstrap race (the on_org_created trigger that grants
-- the creator's membership hasn't run yet when Postgres checks RETURNING
-- visibility). That clause is unconditional, though: it lets the creator
-- read the org forever, even after their membership is removed or
-- suspended — a permanent bypass of is_org_member() for one user.
--
-- Fix: only honour created_by while the org genuinely has no membership row
-- yet (the real bootstrap window, closed the instant on_org_created inserts
-- the owner row in the same transaction). Once membership exists, only
-- is_org_member() governs access, same as every other tenant table.
-- =====================================================================

drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations for select
  using (
    public.is_org_member(id)
    or (
      created_by = auth.uid()
      and not exists (select 1 from public.memberships m where m.org_id = id)
    )
  );
