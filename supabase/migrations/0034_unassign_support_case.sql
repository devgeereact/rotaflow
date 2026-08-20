-- =====================================================================
-- 0034. A support case can be handed back to the queue
--
-- 0024 declared `assign_support_case(p_case uuid, p_agent uuid)` with no
-- default on the agent. The body already handles null, and the column is
-- nullable, so unassigning was intended. The signature did not allow it: a
-- typed client sees a required argument and cannot express "nobody", which is
-- how a case ends up permanently owned by whoever touched it first.
--
-- Adding the default costs nothing at the call site that passes an agent and
-- makes the other case sayable.
-- =====================================================================

create or replace function public.assign_support_case(
  p_case  uuid,
  p_agent uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.support_cases;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform support staff can assign a case'
      using errcode = '42501';
  end if;

  -- Assigning a case to a customer would put a tenant name in the agent
  -- column and give them nothing: they cannot see the queue.
  if p_agent is not null and not exists (
       select 1 from public.platform_admins a
        where a.user_id = p_agent and a.revoked_at is null) then
    raise exception 'A case can only be assigned to platform staff'
      using errcode = '23514';
  end if;

  select * into c from public.support_cases where id = p_case;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;

  update public.support_cases set assigned_to = p_agent where id = p_case;

  perform public.audit_write(
    c.org_id, 'support_case.assigned', 'support_case', p_case,
    jsonb_build_object(
      'reference', c.reference,
      'before', coalesce(c.assigned_to::text, 'unassigned'),
      'after', coalesce(p_agent::text, 'unassigned')),
    'info', 'platform_only');
end;
$$;

revoke all on function public.assign_support_case(uuid, uuid) from public, anon;
grant execute on function public.assign_support_case(uuid, uuid) to authenticated;
