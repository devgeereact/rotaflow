-- =====================================================================
-- 0092_url_schemes_and_notification_retention.sql — two things the
-- database was trusting the browser about (docs/SAAS.md HARDEN-003,
-- GAP-027)
--
-- ## 1. URL schemes
--
-- `DocumentsModal` checks that a document link starts with `http://` or
-- `https://`, and its comment explains exactly why: the value is
-- rendered as a real `<a href>`, so an unvalidated scheme is a
-- stored-XSS vector rather than untidy data. `javascript:` is the case
-- it names.
--
-- That check is in a React component. The row it protects is written
-- through PostgREST, which no component sits in front of — this
-- project's own rule is that a control enforced only in the browser is
-- not a control. And `staff_profiles.photo_url` had no check at all, in
-- either place.
--
-- Both columns are constrained here. NOT VALID is deliberate: it
-- enforces on every INSERT and UPDATE from now on, which is the
-- security property, while leaving any existing row alone. The
-- alternative was a migration that either deletes people's data or
-- fails the whole deploy on one bad row, and neither is a good trade
-- for a table this constraint now protects going forward. Run
-- `alter table ... validate constraint ...` once the existing rows are
-- known clean; on this project both tables are empty, so that is
-- already true and the statement is included.
--
-- ## 2. Notification retention
--
-- `notification_deliveries` (0067) and `notification_outbox` (0069)
-- grow forever. Every notification the product sends writes a row to
-- each, and neither had a policy. A policy row alone would not have
-- helped: `enforce_retention` is an if/elsif chain over data types it
-- knows, and an unknown type takes the `else` branch, which records
-- "no rule implemented for this data type" in the run log and deletes
-- nothing. That is good behaviour — it fails visibly — but it means the
-- policy and the branch have to arrive together, which is what GAP-027
-- was about.
--
-- TWELVE months, and deliberately shorter than everything else in the
-- table: `attendance` is 36, `support_cases` 36, `leave` 72,
-- `rota_history` 84. Those are records of work — hours a person was
-- paid for, absence they are entitled to, a rota they were rostered on.
-- A delivery log is operational telemetry about whether a message got
-- through. It answers "were they told?", which is worth keeping long
-- enough to settle a dispute about a shift somebody says they never
-- heard about, and not worth keeping for seven years.
--
-- Only SETTLED rows are removed. A `pending` outbox row is work still
-- owed, and deleting it because it is old would silently drop a
-- notification instead of sending it — precisely the class of silence
-- the outbox exists to end.
-- =====================================================================

-- ── 1. URL schemes ────────────────────────────────────────────────────
alter table public.staff_profiles
  drop constraint if exists staff_profiles_photo_url_scheme;
alter table public.staff_profiles
  add constraint staff_profiles_photo_url_scheme
  check (photo_url is null or photo_url ~* '^https?://') not valid;

alter table public.documents
  drop constraint if exists documents_file_url_scheme;
alter table public.documents
  add constraint documents_file_url_scheme
  check (file_url ~* '^https?://') not valid;

-- Both tables are empty on this project, so validating costs nothing and
-- turns the constraint from "everything new" into "everything". A
-- deployment with existing rows that fails here has bad data to look at,
-- which is the right outcome: the failure names the table.
alter table public.staff_profiles validate constraint staff_profiles_photo_url_scheme;
alter table public.documents validate constraint documents_file_url_scheme;

comment on constraint staff_profiles_photo_url_scheme on public.staff_profiles is
  'http(s) only. These values are rendered into the DOM, so a javascript: scheme here is stored XSS. The browser check is not the control (HARDEN-003).';
comment on constraint documents_file_url_scheme on public.documents is
  'http(s) only. DocumentsModal checks the same thing and is not what enforces it (HARDEN-003).';

-- ── 2. Notification retention ─────────────────────────────────────────
insert into public.retention_policies (data_type, retain_months, note)
values (
  'notifications',
  12,
  'Delivery attempts and the settled outbox queue. Twelve months, deliberately shorter than attendance (36) or rota history (84): those are records of work, this is telemetry about whether a message arrived. Long enough to settle "I was never told about that shift", not long enough to be an archive. Only settled rows are removed — a pending outbox row is work still owed.'
)
on conflict (data_type) do nothing;

create or replace function public.enforce_retention(p_dry_run boolean default false)
returns table (data_type text, rows_removed bigint, cutoff date)
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_row public.retention_policies;
  v_cutoff   date;
  v_count    bigint;
  v_outbox   bigint;
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

    -- New in 0092 (GAP-027).
    elsif policy_row.data_type = 'notifications' then
      if p_dry_run then
        select (select count(*) from public.notification_deliveries d
                 where d.created_at::date < v_cutoff)
             + (select count(*) from public.notification_outbox o
                 where o.created_at::date < v_cutoff
                   and o.status <> 'pending')
          into v_count;
      else
        delete from public.notification_deliveries d
         where d.created_at::date < v_cutoff;
        get diagnostics v_count = row_count;
        -- `status <> 'pending'` is the whole point: an old pending row is a
        -- notification still owed, and deleting it would drop it silently
        -- rather than send it.
        delete from public.notification_outbox o
         where o.created_at::date < v_cutoff
           and o.status <> 'pending';
        -- Both deletes are reported as one figure, which is what the policy
        -- covers. `get diagnostics` only ever describes the statement just
        -- run, so the second count has to be added explicitly — dropping it
        -- would under-report the run and make the log quietly wrong.
        get diagnostics v_outbox = row_count;
        v_count := v_count + v_outbox;
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
