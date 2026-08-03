-- =====================================================================
-- 0013_realtime_overtime.sql — publish overtime_requests to Realtime
--
-- `overtime_requests` was left out of 0012 on that migration's own first
-- rule: "only tables a screen actually watches". Nothing watched it,
-- because the table had no reader and no writer anywhere in the app
-- (audit01 P2-7) — NEW_STRUCTURE §34's `/app/overtime` did not exist.
--
-- It does now, and it carries the same approve/decline queue as
-- `leave_requests` and `shift_swaps`, both of which are published. A
-- manager approving overtime on one device and a staff member watching
-- for the decision on another is exactly the case Realtime is here for,
-- so the table earns its place by the same test the others passed.
--
-- Everything 0012 says about safety still holds: RLS is evaluated on
-- `postgres_changes`, so a manager at one org cannot receive another
-- org's rows, and the client treats an event purely as a "something
-- changed" signal and re-queries through the normal RLS-protected path
-- rather than rendering the payload. REPLICA IDENTITY stays at the
-- default (primary key) — the payload is never read, so FULL would be
-- pure WAL cost.
--
-- Idempotent, like 0012: adding a table already in the publication
-- raises 42710, and migrations here must be safe to re-run.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'overtime_requests'
  ) then
    alter publication supabase_realtime add table public.overtime_requests;
  end if;
end $$;
