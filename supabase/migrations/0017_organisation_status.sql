-- =====================================================================
-- 0017_organisation_status.sql — tenant lifecycle state
-- Additive & idempotent. Builds on 0002, 0015 and 0016.
--
-- ## The gap this fills
--
-- `organisations` had no `status`, no `suspended_at`, no soft-delete of any
-- kind. Suspending a tenant — the single most-used action in any platform
-- console — was not expressible, so `/admin/organisations` could list every
-- customer and do nothing about any of them.
--
-- ## What "suspended" means here, stated plainly
--
-- **It is a billing and account state, not a lockout.** No RLS policy consults
-- this column. A suspended organisation's staff keep signing in, keep clocking
-- in and keep seeing their rota.
--
-- Making it a real lockout means putting a check inside `is_org_member()`,
-- which every policy in 0002 depends on — the blast radius this entire plan is
-- built to avoid, across tables with no RLS test coverage (audit01 §7). Doing
-- that badly locks every tenant out of the product at once.
--
-- So the column is honest about being a flag, and the console labels it
-- "Suspended (billing state)". A badge claiming a customer is locked out while
-- their carers are still clocking in is exactly what audit01 §4 calls worse
-- than a stated absence. When enforcement is genuinely wanted it is its own
-- migration, gated on the RLS test suite.
-- =====================================================================

alter table public.organisations
  add column if not exists status text not null default 'active'
        check (status in ('active','suspended','archived')),
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  -- A real column, deliberately NOT a key in the `settings` jsonb. That blob
  -- is untyped and six screens write it (audit01 P1-4); a control governing
  -- who may read a customer's data has no business living somewhere a
  -- `mergeOrgSettings` call could overwrite by accident.
  add column if not exists support_access_allowed boolean not null default true;

create index if not exists organisations_status_idx
  on public.organisations (status) where status <> 'active';

-- ---------- Close the write path ---------------------------------------
-- `organisations_update` is `has_org_role(id, array['owner'])`, which folds in
-- `is_platform_admin()`. Without a column grant a suspended tenant's own owner
-- could simply set `status` back to 'active' from the settings screen. Same
-- mechanism as 0010's `smtp_pass` and 0015's `is_platform_admin`: remove the
-- privilege rather than rely on a policy.
--
-- The four columns below are the complete set the client writes today —
-- `createOrganisation` inserts name/slug/settings/created_by, `updateOrganisation`
-- is called with `{ name }` and `{ plan }`, and `mergeOrgSettings` writes
-- `settings`. Anything omitted here fails with 42501 at the screen that writes
-- it, so this list is checked against `orgService.ts`, not guessed.
revoke update on public.organisations from authenticated;
grant update (name, slug, plan, settings) on public.organisations to authenticated;

-- ---------- The one write path for status ------------------------------
create or replace function public.set_org_status(
  p_org    uuid,
  p_status text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can change an organisation''s status'
      using errcode = '42501';
  end if;

  if p_status not in ('active','suspended','archived') then
    raise exception 'Unknown organisation status: %', p_status using errcode = '22023';
  end if;

  select status into v_current from public.organisations where id = p_org;
  if v_current is null then
    raise exception 'No such organisation' using errcode = 'P0002';
  end if;
  if v_current = p_status then
    return;                       -- idempotent; no audit noise for a no-op
  end if;

  -- Suspending is a decision someone must be able to explain later, so the
  -- reason is required going in and cleared coming out.
  if p_status <> 'active' and coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'A reason is required to suspend or archive an organisation'
      using errcode = '22023';
  end if;

  update public.organisations
     set status           = p_status,
         suspended_at     = case when p_status = 'active' then null
                                 else timezone('utc', now()) end,
         suspended_reason = case when p_status = 'active' then null
                                 else btrim(p_reason) end
   where id = p_org;

  -- Written here rather than left to the UPDATE trigger below so the status
  -- change and its record cannot come apart: same transaction, same reason
  -- string, no second code path that could forget.
  perform public.audit_write(
    p_org,
    case p_status when 'suspended' then 'org.suspended'
                  when 'archived'  then 'org.archived'
                  else 'org.reactivated' end,
    'organisation', p_org,
    jsonb_strip_nulls(jsonb_build_object(
      'from_status', v_current, 'to_status', p_status, 'reason', btrim(p_reason))),
    'critical',
    -- Visible to the customer's own owner in Settings → Audit. Being
    -- suspended is something they are entitled to see recorded.
    'org');
end;
$$;

revoke all on function public.set_org_status(uuid, text, text) from public, anon;
grant execute on function public.set_org_status(uuid, text, text) to authenticated;

-- ---------- Support-access opt-out -------------------------------------
-- Read by the console today and enforced by nothing, which is the same honest
-- position as `status`: it records the customer's preference so a support
-- administrator can respect it, and 0019's session table is where it becomes
-- a precondition. The org's own owner may set it — it is their data.
create or replace function public.set_org_support_access(
  p_org uuid,
  p_allowed boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_org_role(p_org, array['owner'])
          or public.has_platform_role(array['platform_owner','platform_admin'])) then
    raise exception 'Only an organisation owner or a platform administrator can change this'
      using errcode = '42501';
  end if;

  update public.organisations
     set support_access_allowed = p_allowed
   where id = p_org;

  perform public.audit_write(
    p_org,
    case when p_allowed then 'org.support_access_allowed'
         else 'org.support_access_denied' end,
    'organisation', p_org, '{}'::jsonb, 'warning', 'org');
end;
$$;

revoke all on function public.set_org_support_access(uuid, boolean) from public, anon;
grant execute on function public.set_org_support_access(uuid, boolean) to authenticated;

-- ---------- Keep the 0016 trigger honest about the new columns ---------
-- Replaced rather than edited in place: 0016 is shipped, and a migration that
-- rewrites an earlier migration's file is a migration that has already run
-- differently somewhere.
--
-- Status changes are audited inside `set_org_status` above, so this
-- deliberately does not audit them again — it would double every suspension.
create or replace function public.audit_organisation_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plan is distinct from old.plan then
    perform public.audit_write(
      new.id, 'org.plan_changed', 'organisation', new.id,
      jsonb_build_object('from_plan', old.plan, 'to_plan', new.plan),
      'warning');
  end if;

  -- The settings blob is untyped and six screens write it (audit01 P1-4).
  -- Recording that it changed is useful; dumping its contents into an
  -- append-only table nobody can later redact is not.
  if new.settings is distinct from old.settings then
    perform public.audit_write(
      new.id, 'org.settings_changed', 'organisation', new.id,
      '{}'::jsonb, 'notice');
  end if;

  if new.name is distinct from old.name or new.slug is distinct from old.slug then
    perform public.audit_write(
      new.id, 'org.renamed', 'organisation', new.id,
      jsonb_build_object('from_name', old.name, 'to_name', new.name,
                         'from_slug', old.slug, 'to_slug', new.slug),
      'notice');
  end if;
  return null;
end;
$$;
