-- =====================================================================
-- 0041_payroll_id_unique_immutable.sql
--
-- staff_profiles.payroll_id ("Employee ID" in the UI) must stay unique per
-- organisation and can never be reassigned once issued — it is the number
-- payroll systems and physical ID cards key off, and a changed or duplicated
-- one silently corrupts payroll matching outside RotaFlow.
--
-- Two guarantees, at the DB level rather than only in the client form, since
-- a form-only rule holds until the next screen forgets to check it:
--   1. UNIQUE (org_id, payroll_id) — nulls don't collide (Postgres treats
--      each NULL as distinct in a unique constraint), so staff with no
--      payroll ID recorded yet are unaffected.
--   2. A BEFORE UPDATE trigger blocks changing an already-set payroll_id to
--      any different value. `anonymize_staff_member` (0011) still needs to
--      null it out on erasure, so that one write path sets a transaction-
--      local flag to step around the lock rather than the lock having a
--      blanket exception — the exception is one named, audited call site,
--      not "any write that happens to want through".
-- =====================================================================

alter table public.staff_profiles
  add constraint staff_profiles_payroll_id_org_unique unique (org_id, payroll_id);

create or replace function public.staff_profiles_lock_payroll_id()
returns trigger language plpgsql as $$
begin
  if old.payroll_id is not null
     and new.payroll_id is distinct from old.payroll_id
     and coalesce(current_setting('rotaflow.allow_payroll_id_change', true), '') <> 'true'
  then
    raise exception 'payroll_id cannot be changed once set' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_profiles_lock_payroll_id_trigger on public.staff_profiles;
create trigger staff_profiles_lock_payroll_id_trigger
  before update on public.staff_profiles
  for each row execute function public.staff_profiles_lock_payroll_id();

create or replace function public.anonymize_staff_member(
  p_org uuid,
  p_staff_profile_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only the organisation owner can erase a staff member''s data'
      using errcode = '42501';
  end if;

  select exists(
    select 1 from public.staff_profiles
    where id = p_staff_profile_id and org_id = p_org
  ) into v_exists;
  if not v_exists then
    raise exception 'Staff member not found in this organisation' using errcode = 'P0002';
  end if;

  delete from public.emergency_contacts where staff_profile_id = p_staff_profile_id;
  delete from public.documents where staff_profile_id = p_staff_profile_id;

  -- Transaction-local: automatically reverts at commit/rollback, and never
  -- leaks into any other statement on this connection.
  perform set_config('rotaflow.allow_payroll_id_change', 'true', true);

  update public.staff_profiles
     set first_name = 'Deleted',
         last_name = 'Member',
         phone = null,
         photo_url = null,
         payroll_id = null,
         user_id = null,
         active = false
   where id = p_staff_profile_id;

  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'gdpr_anonymize', 'staff_profile', p_staff_profile_id, '{}'::jsonb);
end;
$$;

revoke all on function public.anonymize_staff_member(uuid, uuid) from public, anon;
grant execute on function public.anonymize_staff_member(uuid, uuid) to authenticated;
