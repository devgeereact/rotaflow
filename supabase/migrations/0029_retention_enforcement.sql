-- =====================================================================
-- 0029. Retention stops being a promise
--
-- 0027 created `retention_policies` and set `enforced = false` on five of its
-- six rows, because nothing deleted anything. The console said so on screen,
-- which is honest internally and worthless in a contract: a customer reading a
-- privacy notice does not see the caveat.
--
-- This adds the job. `enforce_retention()` walks the policy table and deletes
-- what has aged past its window, `pg_cron` runs it nightly, and the five rows
-- flip to `enforced = true` because they now are.
--
-- ## What it deletes, and what it deliberately does not
--
-- Rota and shift history, attendance, leave and support cases age out on the
-- schedule the table already published. The audit log does not: it has no
-- delete policy and its row says `retain_months = null`, which this function
-- reads as indefinite. That exemption is the point of an audit log and is
-- enforced by the loop skipping null rather than by anyone remembering.
--
-- Deleted tenant data is also skipped here. Its thirty-day grace is about an
-- organisation row and everything cascading from it, which is a different and
-- more dangerous operation than ageing out old shifts. It stays manual until
-- someone decides who may trigger it.
--
-- ## Why a dry run exists
--
-- `enforce_retention(p_dry_run => true)` reports what it would remove without
-- removing it, and the nightly job logs the counts it acted on. A deletion job
-- nobody can rehearse is one nobody will enable.
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

-- ---------- What ran, and what it removed -------------------------------
create table if not exists public.retention_runs (
  id           bigint generated always as identity primary key,
  ran_at       timestamptz not null default timezone('utc', now()),
  dry_run      boolean not null default false,
  data_type    text not null,
  rows_removed bigint not null default 0,
  cutoff       date,
  error        text
);

comment on table public.retention_runs is
  'One row per policy per run. The evidence that the schedule is enforced rather than published.';

create index if not exists retention_runs_recent_idx
  on public.retention_runs (ran_at desc);

alter table public.retention_runs enable row level security;

drop policy if exists retention_runs_select on public.retention_runs;
create policy retention_runs_select
  on public.retention_runs for select
  using (public.is_platform_admin());

revoke insert, update, delete on public.retention_runs from anon, authenticated;

-- ---------- The job -----------------------------------------------------
create or replace function public.enforce_retention(p_dry_run boolean default false)
returns table (data_type text, rows_removed bigint, cutoff date)
language plpgsql security definer set search_path = public as $$
declare
  policy_row public.retention_policies;
  v_cutoff   date;
  v_count    bigint;
begin
  for policy_row in
    select * from public.retention_policies
     -- Null months means indefinite. The audit log lives here, and skipping
     -- null is what keeps it out of reach of this function entirely.
     where retain_months is not null
       and data_type <> 'deleted_tenant'
     order by data_type
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
  'Deletes what has aged past its published window. Dry run reports counts without deleting. The audit log is unreachable from here because its retention is null.';

revoke all on function public.enforce_retention(boolean) from public, anon, authenticated;

-- ---------- Nightly, at 02:15 UTC ---------------------------------------
-- Quiet hours in Europe/London either side of the clock change, and clear of
-- the backup window.
select cron.unschedule('rotaflow-retention')
 where exists (select 1 from cron.job where jobname = 'rotaflow-retention');

select cron.schedule(
  'rotaflow-retention',
  '15 2 * * *',
  $job$ select public.enforce_retention(false); $job$
);

-- ---------- The table now describes something true ----------------------
update public.retention_policies
   set enforced = true,
       note = case data_type
         when 'rota_history'  then 'Shifts and their rotas are removed nightly once the period ends more than seven years ago.'
         when 'attendance'    then 'Clock events and timesheets are removed nightly past three years.'
         when 'leave'         then 'Leave requests are removed nightly once they ended more than six years ago.'
         when 'support_cases' then 'Resolved cases and their messages are removed nightly past three years.'
         else note end
 where data_type in ('rota_history', 'attendance', 'leave', 'support_cases');

-- Deleted tenant data stays manual, and now says why rather than reading as an
-- oversight.
update public.retention_policies
   set note = 'Thirty-day grace, then erasure. Deliberately manual: this deletes an organisation and everything cascading from it, and nobody has decided who may trigger it.'
 where data_type = 'deleted_tenant';

-- Remove the scratch row the pg_cron probe left behind.
delete from public.retention_policies where data_type = '_probe';
