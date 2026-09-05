-- =====================================================================
-- 0121_the_founder_gets_a_staff_record.sql — create the owner's staff
-- profile when the organisation is created (docs/SAAS.md GAP-068)
--
-- ## The dead end
--
-- `handle_new_org` inserted a `memberships` row and stopped. No function
-- in `public` ever inserted into `staff_profiles`, and no onboarding step
-- created one. A `staff_profiles` row is what shifts, leave, availability
-- and clock events attach to, and every "what does the signed-in person
-- see" query goes through `my_staff_profile_id()`, which is
-- `where user_id = auth.uid()`.
--
-- So the first thing a brand-new owner saw on `/app/clock`,
-- `/app/leave` and `/app/availability` was
--
--   "You don't have a staff profile in this organisation.
--    Ask your manager to add you to the staff directory."
--
-- addressed to the person who IS the manager. Three capabilities the
-- register marks 🟢 were unreachable on day one for every customer.
--
-- The message and its missing route were fixed in the same pass
-- (`NoStaffProfileNotice`). This is the other half: the founder should not
-- have to discover a screen to be able to clock in to their own
-- organisation.
--
-- ## Why the trigger and not the wizard
--
-- Onboarding is one of several ways an organisation comes into existence —
-- `admin_create_organisation_with_invite` is another — and a rule written
-- into one screen is a rule the other paths do not have. `on_org_created`
-- already fires for all of them.
--
-- ## The name, and why it is allowed to be poor
--
-- `profiles.full_name` is set by `handle_new_user` from the sign-up form,
-- so it is normally "Ada Lovelace" and splits cleanly. When it is absent
-- or single-word the record is still created, with the email local part as
-- a fallback, because a staff record with an awkward name is recoverable
-- from the Staff screen in ten seconds and a missing one is a dead end the
-- owner cannot diagnose. `email` is set so `0053`'s linking trigger treats
-- the row as already claimed rather than trying to match it later.
--
-- ## What this deliberately does not do
--
-- It does not bypass `enforce_seat_limit` (`0070`). The founder counts as
-- one of the plan's seats, which is correct: they are a person who can be
-- rostered. On `starter` that is 1 of 15. The trigger fires BEFORE INSERT
-- on `staff_profiles` and will raise if a limit is somehow already reached,
-- which cannot happen for an organisation being created in this statement
-- but is left in force rather than worked around.
--
-- It does not touch existing organisations. The three that exist are
-- `is_demo`-flagged leftovers with no owner expecting a staff record, and
-- a backfill would silently consume a seat in each. `NoStaffProfileNotice`
-- covers them.
-- =====================================================================

create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_email     text;
  v_first     text;
  v_last      text;
begin
  insert into public.memberships (org_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active')
  on conflict (org_id, user_id) do nothing;

  -- The founder's own staff record, so the organisation is usable on day
  -- one rather than after a detour through the Staff screen (GAP-068).
  select p.full_name, lower(u.email)
    into v_full_name, v_email
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = new.created_by;

  v_full_name := nullif(btrim(coalesce(v_full_name, '')), '');

  if v_full_name is not null then
    v_first := split_part(v_full_name, ' ', 1);
    -- Everything after the first space, so "Ada King Lovelace" keeps
    -- "King Lovelace" rather than losing a name.
    v_last := nullif(btrim(substr(v_full_name, length(split_part(v_full_name, ' ', 1)) + 1)), '');
  end if;

  -- `first_name` and `last_name` are NOT NULL. A record with a thin name
  -- is fixable from the Staff screen; a missing record is the dead end
  -- this migration exists to remove, so never let the name prevent it.
  v_first := coalesce(v_first, split_part(coalesce(v_email, 'owner'), '@', 1));
  v_last := coalesce(v_last, '');

  insert into public.staff_profiles (org_id, user_id, first_name, last_name, email, active)
  values (new.id, new.created_by, v_first, v_last, v_email, true)
  on conflict do nothing;

  return new;
end;
$$;
