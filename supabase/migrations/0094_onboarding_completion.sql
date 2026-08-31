-- =====================================================================
-- 0094_onboarding_completion.sql — an organisation remembers whether
-- its setup was ever finished (docs/SAAS.md GAP-015)
--
-- The wizard creates the organisation at the end of step 1, which is
-- the right call and is well argued in `OnboardingPage`: steps 2-4 need
-- an org id to write against, and somebody who abandons midway has a
-- usable workspace rather than nothing.
--
-- The trap is what happens next. `/onboarding` bounces anybody who
-- already belongs to an organisation straight to the dashboard, so the
-- moment step 1 succeeds the remaining steps — locations, invitations,
-- plan — become unreachable. Forever. A new customer who closes the tab
-- to find their site addresses comes back to a workspace with no
-- locations and no way to return to the screen that would have added
-- them.
--
-- Nothing recorded whether setup was finished, so the bounce could not
-- tell "this person is done" from "this person got one step in". That
-- is the whole of this migration.
--
-- ## Existing organisations are backfilled as complete
--
-- Every org that exists today predates the column, and marking them
-- incomplete would drop their owners into a wizard they finished weeks
-- ago. `created_at` is used rather than `now()` so the timestamp does
-- not claim they all completed setup at the moment of this deploy.
-- =====================================================================

alter table public.organisations
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.organisations.onboarding_completed_at is
  'When the setup wizard was finished, or null if it never was. Null is what lets /onboarding resume instead of bouncing to the dashboard — the org exists from step 1 onward, so its existence cannot answer the question (GAP-015).';

update public.organisations
   set onboarding_completed_at = created_at
 where onboarding_completed_at is null;

-- ── marking it finished ───────────────────────────────────────────────
--
-- A function rather than a client UPDATE. `organisations` is writable by
-- owners, so the client could set this itself — but then "setup is finished"
-- would be a claim any owner's browser could make about any field on the
-- row, and a stamp that can be set by accident is one that cannot be
-- trusted to gate a redirect. This does exactly one thing, and only for
-- somebody who could finish the wizard anyway.
create or replace function public.complete_onboarding(p_org uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not public.has_org_role(p_org, array['owner']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  -- Idempotent: finishing twice keeps the first timestamp. The wizard's last
  -- step can be reached more than once (a back button, a double submit), and
  -- the useful fact is when setup was first completed.
  update public.organisations
     set onboarding_completed_at = coalesce(onboarding_completed_at, timezone('utc', now()))
   where id = p_org
  returning onboarding_completed_at into v_at;

  return v_at;
end;
$$;

comment on function public.complete_onboarding(uuid) is
  'Stamps an organisation as having finished setup. Owner only, idempotent, and the only writer of onboarding_completed_at.';

revoke all on function public.complete_onboarding(uuid) from public, anon;
grant execute on function public.complete_onboarding(uuid) to authenticated;
