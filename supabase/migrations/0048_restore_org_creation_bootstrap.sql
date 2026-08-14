-- =====================================================================
-- 0048_restore_org_creation_bootstrap.sql — restore the creator bootstrap
-- window that 0031 dropped
--
-- Bug: every new-organisation creation fails with 42501 (RLS violation on
-- RETURNING). 0003 added a `created_by = auth.uid()` clause to
-- organisations_select so the creator could see the row they just inserted,
-- before the on_org_created AFTER INSERT trigger grants their membership —
-- PostgREST's insert+RETURNING checks the SELECT policy before the
-- trigger's effects are visible. 0005 narrowed that clause to only apply
-- while no membership row exists yet, closing it the instant on_org_created
-- runs. 0031 dropped the clause entirely while adding platform-admin
-- visibility, and its own comment misreads 0005 as having already "closed"
-- the bootstrap window rather than narrowed it. With no bootstrap clause,
-- organisations_select is `is_org_member(id) or is_platform_admin()` —
-- neither is true at insert time for an ordinary signup, so RETURNING
-- fails and no one can create an organisation.
--
-- Fix: restore 0005's narrowed bootstrap clause alongside 0031's
-- platform-admin clause.
-- =====================================================================

drop policy if exists organisations_select on public.organisations;
create policy organisations_select
  on public.organisations for select
  using (
    public.is_org_member(id)
    or public.is_platform_admin()
    or (
      created_by = auth.uid()
      and not exists (select 1 from public.memberships m where m.org_id = id)
    )
  );
