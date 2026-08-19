-- =====================================================================
-- 0051_org_status_service_role.sql — let a service_role caller suspend
-- an org, for dunning-exhausted payment failures
--
-- set_org_status() (0017) only accepted a platform owner/admin's own JWT.
-- stripe-webhook runs as service_role with no user session — Stripe calls
-- it directly, there is no auth.uid() to check. Extends the permission
-- gate in this function with a service_role alternative
-- (auth.uid() is null), matching audit_write()'s own existing convention
-- for exactly this situation (0037: "coalesce(p_metadata, '{}'::jsonb) ||
-- case when auth.uid() is null then jsonb_build_object('via',
-- 'service_role') else '{}'::jsonb end").
--
-- Every existing caller (a real platform admin, with a real JWT) is
-- unaffected — auth.uid() is never null for them, so the new branch
-- never applies.
-- =====================================================================

create or replace function public.set_org_status(
  p_org    uuid,
  p_status text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  if not (
    public.has_platform_role(array['platform_owner','platform_admin'])
    or auth.uid() is null
  ) then
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

grant execute on function public.set_org_status(uuid, text, text) to service_role;
