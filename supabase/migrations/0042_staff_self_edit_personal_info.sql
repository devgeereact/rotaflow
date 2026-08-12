-- =====================================================================
-- 0042_staff_self_edit_personal_info.sql
--
-- Staff have never been able to view or edit their own `staff_profiles` row
-- at all — `staff_profiles_write` (0002) grants owner/manager only. This
-- adds a narrow, additive self-service path: a staff member may update
-- their OWN row, but a trigger restricts what actually changes to `phone`
-- and `photo_url` ("Personal Info" and the profile picture). Everything
-- else — name, job title, department, contract, hours, holiday allowance,
-- skills, payroll ID, start date, active flag, user_id — stays
-- manager/owner-only, matching "staff cannot edit their work information".
--
-- Multiple permissive RLS policies on the same command are OR'd together,
-- so this is purely additive: `staff_profiles_write` still gives a
-- manager/owner unrestricted access, this just opens a second, much
-- narrower door for everyone else, closed down further by the trigger
-- (RLS is row-level; a trigger is what actually enforces which columns).
-- =====================================================================

drop policy if exists staff_profiles_self_write on public.staff_profiles;
create policy staff_profiles_self_write on public.staff_profiles for update
  using (id = public.my_staff_profile_id(org_id))
  with check (id = public.my_staff_profile_id(org_id));

create or replace function public.staff_profiles_restrict_self_edit()
returns trigger language plpgsql as $$
begin
  -- Manager/owner: unrestricted, same as always.
  if public.has_org_role(new.org_id, array['owner', 'manager']) then
    return new;
  end if;

  -- Anyone else touching this row (RLS already confines that to the row's
  -- own person) may only change phone and photo_url.
  if new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.job_title is distinct from old.job_title
     or new.department_id is distinct from old.department_id
     or new.contract_type is distinct from old.contract_type
     or new.weekly_hours is distinct from old.weekly_hours
     or new.holiday_allowance is distinct from old.holiday_allowance
     or new.skills is distinct from old.skills
     or new.payroll_id is distinct from old.payroll_id
     or new.start_date is distinct from old.start_date
     or new.active is distinct from old.active
     or new.user_id is distinct from old.user_id
     or new.org_id is distinct from old.org_id
  then
    raise exception 'You can only update your phone number and photo on your own profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_profiles_restrict_self_edit_trigger on public.staff_profiles;
create trigger staff_profiles_restrict_self_edit_trigger
  before update on public.staff_profiles
  for each row execute function public.staff_profiles_restrict_self_edit();
