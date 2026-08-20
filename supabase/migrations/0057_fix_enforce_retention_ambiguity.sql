-- =====================================================================
-- 0057_fix_enforce_retention_ambiguity.sql
--
-- Retention has never run. Not once.
--
-- `enforce_retention()` (0029) has failed on every scheduled execution
-- since it was created — 14 consecutive nights, 2026-08-07 through
-- 2026-08-20, verified in `cron.job_run_details`:
--
--   ERROR:  column reference "data_type" is ambiguous
--   LINE 5:        and data_type <> 'deleted_tenant'
--   DETAIL:  It could refer to either a PL/pgSQL variable or a table column.
--
-- The function is declared `returns table (data_type text, rows_removed
-- bigint, cutoff date)`. Those output columns are PL/pgSQL variables inside
-- the body, so the unqualified `data_type` in the driving loop's WHERE and
-- ORDER BY is ambiguous against `retention_policies.data_type`. Postgres
-- accepts the definition and fails at execution, which is why this got
-- through review and through `create or replace` without complaint.
--
-- Consequences, both worse than a broken job on its own:
--
--   * `public.retention_runs` is empty. Zero rows, ever. 0029's own comment
--     calls that table "the evidence that the schedule is enforced rather
--     than published" — the evidence trail was working correctly and
--     recording nothing, because nothing ever ran.
--   * `retention_policies.enforced` is `true` for five of six policies,
--     which `/app/settings` shows to every signed-in user and the platform
--     console shows to admins. The application has been asserting a
--     data-retention guarantee it has never once performed. That is a
--     compliance-facing claim, not just an internal flag.
--
-- Nothing was wrongly deleted — the failure mode is that nothing was
-- deleted at all. No data loss; a promise silently unkept.
--
-- The fix is to qualify the two references. Everything else in the body
-- already used `policy_row.*`, `v_cutoff` or `v_count` and was never
-- ambiguous; the final assignments to `data_type` / `rows_removed` /
-- `cutoff` are the intended writes to the OUT columns and are left alone.
-- The alias makes the qualification impossible to lose again in a future
-- edit.
--
-- Guarded by supabase/tests/database/enforce_retention.test.sql, which
-- actually calls the function. That is the check that was missing: the
-- definition was reviewed, the schedule was verified as active, and neither
-- of those can catch a runtime-only ambiguity error. Only invoking it can.
-- =====================================================================

create or replace function public.enforce_retention(p_dry_run boolean default false)
returns table (data_type text, rows_removed bigint, cutoff date)
language plpgsql security definer set search_path = public as $$
declare
  policy_row public.retention_policies;
  v_cutoff   date;
  v_count    bigint;
begin
  -- `rp` alias, and every column qualified. The output columns declared by
  -- `returns table (...)` are variables in this scope, so an unqualified
  -- `data_type` here resolves to the OUT column, not to the table, and the
  -- statement fails at run time with "column reference is ambiguous".
  for policy_row in
    select * from public.retention_policies rp
     -- Null months means indefinite. The audit log lives here, and skipping
     -- null is what keeps it out of reach of this function entirely.
     where rp.retain_months is not null
       and rp.data_type <> 'deleted_tenant'
     order by rp.data_type
  loop
    v_cutoff := (timezone('utc', now()) - (policy_row.retain_months || ' months')::interval)::date;
    v_count := 0;

    if policy_row.data_type = 'rota_history' then
      if p_dry_run then
        select count(*) into v_count from public.shifts where starts_at::date < v_cutoff;
      else
        -- Shifts first: they reference the rota, and a rota deleted out from
        -- under them would fail the foreign key rather than cascade quietly.
        delete from public.shifts where starts_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        delete from public.rotas
         where period_end < v_cutoff
           and not exists (select 1 from public.shifts s where s.rota_id = rotas.id);
      end if;

    elsif policy_row.data_type = 'attendance' then
      if p_dry_run then
        select count(*) into v_count from public.clock_events where event_at::date < v_cutoff;
      else
        delete from public.clock_events where event_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        delete from public.timesheets where period_end < v_cutoff;
      end if;

    elsif policy_row.data_type = 'leave' then
      if p_dry_run then
        select count(*) into v_count from public.leave_requests where end_date < v_cutoff;
      else
        delete from public.leave_requests where end_date < v_cutoff;
        get diagnostics v_count = row_count;
      end if;

    elsif policy_row.data_type = 'support_cases' then
      if p_dry_run then
        select count(*) into v_count from public.support_cases
         where resolved_at is not null and resolved_at::date < v_cutoff;
      else
        delete from public.support_cases
         where resolved_at is not null and resolved_at::date < v_cutoff;
        get diagnostics v_count = row_count;
      end if;

    else
      -- A policy row nobody has taught this function about. Recorded rather
      -- than skipped silently, so adding a data type without adding a branch
      -- shows up in the run log instead of looking enforced.
      insert into public.retention_runs (dry_run, data_type, rows_removed, cutoff, error)
      values (p_dry_run, policy_row.data_type, 0, v_cutoff,
              'no rule implemented for this data type');
      continue;
    end if;

    insert into public.retention_runs (dry_run, data_type, rows_removed, cutoff)
    values (p_dry_run, policy_row.data_type, v_count, v_cutoff);

    data_type := policy_row.data_type;
    rows_removed := v_count;
    cutoff := v_cutoff;
    return next;
  end loop;
end;
$$;

comment on function public.enforce_retention(boolean) is
  'Deletes what has aged past its published window. Dry run reports counts without deleting. The audit log is unreachable from here because its retention is null. Column references in the driving loop are table-qualified: the OUT columns declared by `returns table (...)` shadow same-named table columns and produce a run-time ambiguity error otherwise (see 0057).';

-- 0029 revoked these; `create or replace` preserves existing grants, but
-- restating them keeps this file correct if it is ever applied to a database
-- where 0029's revokes did not land.
revoke all on function public.enforce_retention(boolean) from public, anon, authenticated;
