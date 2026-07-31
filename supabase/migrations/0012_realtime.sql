-- =====================================================================
-- 0012_realtime.sql — publish the operational tables to Realtime
--
-- Adds tables to the `supabase_realtime` publication so the app can
-- subscribe to `postgres_changes` and refresh a screen the moment
-- somebody else changes something — a published rota reaching staff
-- without a manual reload, an approval landing in a manager's queue.
--
-- Two deliberate limits on what goes in here:
--
-- 1. Only tables a screen actually watches. Every published table streams
--    WAL to Realtime for every subscribed client, and the free tier has a
--    finite monthly message budget — publishing a table nothing listens to
--    spends that budget for nothing.
--
-- 2. Nothing holding a secret. `org_smtp_settings` is deliberately absent:
--    its whole design (0010) is that `smtp_pass` is unreadable by any
--    client, and a change payload is another way out of the database.
--    `audit_logs` is absent for the same reason — it is append-only,
--    owner-read, and nothing renders it live.
--
-- RLS still applies: Realtime evaluates the subscriber's policies on
-- `postgres_changes`, so a manager at one org cannot receive another
-- org's rows. The client hardens this further by treating an event purely
-- as a "something changed" signal and re-querying through the normal
-- RLS-protected path rather than rendering the payload — see
-- `src/hooks/useRealtimeRefresh.ts`. That also sidesteps the known gap
-- that DELETE payloads carry only the primary key and cannot be
-- RLS-filtered the way INSERT/UPDATE can.
--
-- REPLICA IDENTITY is left at the default (primary key). FULL would put
-- every column of every row into the WAL for the payload's benefit, and
-- since the client never reads the payload, that is pure cost.
-- =====================================================================

do $$
declare
  t text;
  realtime_tables constant text[] := array[
    'shifts',          -- rota builder, schedule, dashboard
    'rotas',           -- publish/unpublish state
    'leave_requests',  -- staff tracking + manager approvals
    'shift_swaps',     -- swap requests, responses, approvals
    'notifications',   -- inbox badge and list
    'announcements',   -- org feed
    'clock_events',    -- live clock status, timesheets
    'availability',    -- staff patterns + team view
    'staff_profiles',  -- directory
    'invites',         -- pending invite list
    'locations',       -- locations/departments admin
    'departments',
    'shift_types'      -- rota builder palette
  ];
begin
  foreach t in array realtime_tables loop
    -- Idempotent: adding a table already in the publication raises
    -- 42710, and this migration must be safe to re-run.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
