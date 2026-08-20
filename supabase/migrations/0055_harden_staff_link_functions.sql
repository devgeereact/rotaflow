-- =====================================================================
-- 0055_harden_staff_link_functions.sql — two advisor findings against 0053
--
-- 1. `staff_profiles_auto_link_account()` is a trigger function only, same
--    shape as `clock_events_guard_event_at()` (0037's comment explains the
--    class of bug exactly): left ungranted, PostgREST still exposes it at
--    /rest/v1/rpc/staff_profiles_auto_link_account by default, callable by
--    `anon`. It can't do anything through that path (no real trigger
--    context, so `new`/`old` don't exist outside a real row event) but the
--    advisor is right that an unrevoked definer function reads as "anyone
--    can call this" — revoked, matching every other trigger-only function
--    here.
-- 2. `staff_profiles_restrict_self_edit()` (0042, touched again by 0053)
--    never had `set search_path`, a pre-existing gap surfaced by 0053's
--    `create or replace` re-triggering the advisor. Fixed while already
--    touching this function rather than left for later.
-- =====================================================================

revoke all on function public.staff_profiles_auto_link_account() from public, anon, authenticated;

create or replace function public.staff_profiles_restrict_self_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.has_org_role(new.org_id, array['owner', 'manager']) then
    return new;
  end if;

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
     or new.email is distinct from old.email
  then
    raise exception 'You can only update your phone number and photo on your own profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
