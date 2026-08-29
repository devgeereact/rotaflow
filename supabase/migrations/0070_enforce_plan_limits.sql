-- =====================================================================
-- 0070_enforce_plan_limits.sql — plan limits become a control, not a label
-- (docs/SAAS.md GAP-008)
--
-- `plans.seat_limit` and `plans.location_limit` have existed since 0023 and
-- were enforced nowhere. Not in the database, and not in the UI either —
-- the only consumer in the whole codebase was a percentage bar on the
-- platform console. A Starter organisation paying for 15 staff could add
-- 500, and nothing anywhere would notice.
--
-- The register's own rule is that a control whose only enforcement is a
-- hidden button is not a control. So this goes in the database, where a
-- direct PostgREST call meets it too.
--
-- WHAT COUNTS
--
--   seats     — ACTIVE `staff_profiles` rows for the org
--   locations — `locations` rows for the org
--
-- Those are exactly the two numbers the customer's own Settings → Billing
-- screen already shows them (`listStaff` filters `active = true` by
-- default; `listLocations` is unfiltered), so the limit bites on the
-- figure they were already watching. Deactivating someone frees a seat,
-- which is the behaviour an owner will expect from a screen that stops
-- counting them.
--
-- Note the platform console counts MEMBERSHIPS instead for its usage bar,
-- so it can disagree with both. That mismatch is recorded as BUG-062
-- rather than quietly resolved here — changing what the console means is a
-- product decision, not a migration.
--
-- NULL MEANS UNCAPPED, and is the Enterprise tier's whole point. A plan
-- code that does not resolve to a row is also uncapped: refusing writes
-- because a plan was renamed would take a tenant's product away over a
-- data-entry mistake. That branch is defensive rather than routine —
-- `organisations.plan` carries a CHECK constraint, so the column cannot
-- hold an unknown code, and the only way to reach it is deleting a `plans`
-- row out from under an organisation still on it.
--
-- EXISTING TENANTS ARE NOT BROKEN. These are BEFORE INSERT triggers only.
-- An organisation already over its limit keeps every row it has; it simply
-- cannot add more until it upgrades or removes some. There is no UPDATE
-- trigger, so reactivating a staff member is deliberately not blocked —
-- catching that needs a different rule and would make "undo a mistake"
-- fail confusingly.
--
-- MIGRATION RISK. Two functions and two triggers. No table altered, no row
-- rewritten, nothing dropped. Reversible by dropping both triggers. The
-- database still has no backups (GAP-001).
-- =====================================================================

create or replace function public.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- Only active profiles consume a seat, matching what the org's own
  -- billing screen counts.
  if new.active is not true then
    return new;
  end if;

  select p.seat_limit into v_limit
    from public.organisations o
    join public.plans p on p.code = o.plan
   where o.id = new.org_id;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
    from public.staff_profiles
   where org_id = new.org_id and active is true;

  if v_count >= v_limit then
    -- 'P0001' with a message the UI can show verbatim: the services layer
    -- surfaces database messages for exactly this class of refusal, the way
    -- create_invite's already are.
    raise exception
      'Your plan includes % staff and you already have %. Upgrade in Settings → Billing, or deactivate someone first.',
      v_limit, v_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_location_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit integer;
  v_count integer;
begin
  select p.location_limit into v_limit
    from public.organisations o
    join public.plans p on p.code = o.plan
   where o.id = new.org_id;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
    from public.locations
   where org_id = new.org_id;

  if v_count >= v_limit then
    raise exception
      'Your plan includes % site%, and you already have %. Upgrade in Settings → Billing to add another.',
      v_limit, case when v_limit = 1 then '' else 's' end, v_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_profiles_enforce_seat_limit on public.staff_profiles;
create trigger staff_profiles_enforce_seat_limit
  before insert on public.staff_profiles
  for each row execute function public.enforce_seat_limit();

drop trigger if exists locations_enforce_location_limit on public.locations;
create trigger locations_enforce_location_limit
  before insert on public.locations
  for each row execute function public.enforce_location_limit();

revoke all on function public.enforce_seat_limit()     from public, anon, authenticated;
revoke all on function public.enforce_location_limit() from public, anon, authenticated;
