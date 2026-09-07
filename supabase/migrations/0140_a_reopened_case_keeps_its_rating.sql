-- =====================================================================
-- 0140_a_reopened_case_keeps_its_rating.sql
--
-- Two defects on the support and organisation-detail screens, both of which
-- make a screen state something it did not observe.
--
-- ## 1. A rated case cannot be reopened
--
-- `set_support_case_status` (`0024`) clears `resolved_at` for any status other
-- than resolved or closed:
--
--   resolved_at = case when p_status in ('resolved','closed')
--                      then coalesce(resolved_at, now()) else null end
--
-- while the table carries
--
--   constraint support_cases_csat_after_resolution
--     check (csat is null or resolved_at is not null)
--
-- So a case the customer resolved AND rated cannot be reopened at all.
-- Reproduced on a rebuilt local database:
--
--   ERROR:  new row for relation "support_cases" violates check constraint
--           "support_cases_csat_after_resolution"   -- SQLSTATE 23514
--
-- The operator gets a raw constraint violation with no explanation, on a case
-- whose only distinguishing feature is that the customer was happy enough to
-- rate it.
--
-- ### Why the CHECK goes and a trigger replaces it
--
-- The CHECK is a point-in-time invariant applied to a lifecycle that moves
-- backwards legitimately. It is also redundant as a write guard: `authenticated`
-- holds SELECT and nothing else on `support_cases` (verified in
-- `information_schema.role_table_grants`), so `csat` is reachable only through
-- `rate_support_case`, which already refuses a case with no `resolved_at`.
--
-- The real invariant is narrower than the CHECK expressed: *a rating may not be
-- SET on a case that was never resolved*. That is about the transition, not
-- about every future state of the row, so it belongs in a trigger. Clearing
-- `resolved_at` afterwards is then allowed, and the rating survives.
--
-- Deleting the rating instead was the obvious alternative and is wrong:
-- `averageCsat` and `csatResponses` (`src/lib/supportMetrics.ts`) would silently
-- move, so reopening a case would edit a satisfaction metric. A reopened case
-- keeps what the customer said about the resolution they were given.
--
-- ## 2. The Integrations tab reports every tenant as having no SMTP
--
-- `org_smtp_settings_safe` is `security_invoker = true`, so the base table's
-- policy applies to the reader. That policy is
-- `has_org_role(org_id, array['owner'])` for ALL commands, which for a platform
-- administrator means `has_support_access(org, write)` — a `read_write` support
-- session. Verified live: a `platform_owner` with no session read 0 rows for a
-- tenant with a populated row, and the tab rendered
--
--   "This organisation has not configured its own SMTP. Its mail goes out on
--    the platform sender."
--
-- which is a statement about the customer's configuration that nobody checked.
--
-- The fix widens the READ only. `using` gains `is_platform_operational()`;
-- `with check` is untouched, so no platform role gains the ability to write a
-- tenant's mail settings. The password is withheld at the column level by the
-- view regardless, so what this exposes is a hostname, a port and a from
-- address — not workforce data, and exactly what an operator needs to answer
-- "why is this tenant's mail not arriving".
--
-- ## Rollback
--
-- Re-add the CHECK (only safe once no reopened-and-rated row exists), drop the
-- trigger and its function, and restore the single `org_smtp_settings_write`
-- policy from its original migration.
-- =====================================================================

-- ---------- 1. the rating outlives the resolution ---------------------

alter table public.support_cases
  drop constraint if exists support_cases_csat_after_resolution;

create or replace function public.support_case_rating_needs_resolution()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Both the insert and the update cases live here rather than half in a CHECK.
  -- A CHECK cannot tell a transition from a state: `NOT VALID` exempts only
  -- rows that already exist, so a CHECK written for the insert case fires on
  -- the reopen as well and reintroduces the bug it was meant to leave behind.
  -- (Written, applied, and caught by the repro below before it went further.)
  --
  -- On INSERT: a case cannot arrive already rated.
  -- On UPDATE: only the transition that SETS or CHANGES a rating is guarded, so
  -- a row whose csat is unchanged may have its resolved_at cleared, which is
  -- exactly what reopening a case does.
  if new.csat is not null
     and new.resolved_at is null
     and (tg_op = 'INSERT' or new.csat is distinct from old.csat) then
    raise exception 'A case can only be rated once it has been resolved'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists support_cases_rating_needs_resolution on public.support_cases;

create trigger support_cases_rating_needs_resolution
  before insert or update on public.support_cases
  for each row
  execute function public.support_case_rating_needs_resolution();

comment on function public.support_case_rating_needs_resolution() is
  'Refuses a rating on a case with no resolution, at the moment the rating is set. Replaces support_cases_csat_after_resolution, which expressed the same intent as a whole-row invariant and so blocked reopening a rated case with a bare 23514 (0140).';

-- ---------- 2. an operator can see whether SMTP is configured ----------

drop policy if exists org_smtp_settings_write on public.org_smtp_settings;

create policy org_smtp_settings_write on public.org_smtp_settings
  for all
  using (
    public.has_org_role(org_id, array['owner'])
    -- READ only. Writing still requires the owner branch above, which for a
    -- platform administrator means a read_write support session.
    or public.is_platform_operational()
  )
  with check (public.has_org_role(org_id, array['owner']));

comment on policy org_smtp_settings_write on public.org_smtp_settings is
  'An organisation owner manages its own mail settings. Operational platform staff may READ them (0140) so the console can say whether a tenant has its own sender rather than asserting it has none; the with-check is unchanged, so no platform role can write them. The password is withheld by org_smtp_settings_safe at the column level either way.';
