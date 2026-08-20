-- =====================================================================
-- 0049_fix_org_bootstrap_correlation.sql — fix the unqualified correlation
-- in 0048's bootstrap clause
--
-- 0048's subquery read `where m.org_id = id`. `memberships` has its own
-- `id` column, so the bare `id` bound to the innermost scope (`m.id`), not
-- the intended correlation to the outer `organisations.id`. Postgres's own
-- parse confirms it: `pg_policies.qual` for organisations_select showed
-- `WHERE (m.org_id = m.id)` live — always false, so `not exists(...)` was
-- always true, collapsing the clause to an unconditional `created_by =
-- auth.uid()`. Functionally this did not block org creation (that OR-branch
-- alone was enough), but it silently reopened the permanent creator
-- backdoor 0005 was written to close — the creator keeps read access to
-- the org forever, even after their membership is removed.
--
-- 0005's original version of this subquery had the identical shape, so
-- this bootstrap clause has likely never actually narrowed as intended,
-- through 0005 and now 0048. This migration is the first version that
-- qualifies the outer reference explicitly.
-- =====================================================================

drop policy if exists organisations_select on public.organisations;
create policy organisations_select
  on public.organisations for select
  using (
    public.is_org_member(id)
    or public.is_platform_admin()
    or (
      created_by = auth.uid()
      and not exists (
        select 1 from public.memberships m
        where m.org_id = organisations.id
      )
    )
  );
