-- =====================================================================
-- 0081_outbox_idempotency.sql — an offline write lands once, however
-- many times it is replayed (docs/SAAS.md BUG-046)
--
-- The offline outbox replays a queued write and then removes it:
--
--     await REPLAYERS[item.kind](item.payload);
--     await outboxRemove(item.id);
--
-- Nothing makes those two steps atomic, and nothing on the server can
-- tell a replay from a new write. So there are two ways one action
-- becomes two rows, and both are ordinary rather than exotic:
--
--   1. The insert succeeds and `outboxRemove` does not — the tab is
--      closed, the browser is killed, IndexedDB throws. The next flush
--      replays an item that already landed.
--
--   2. Worse, and already documented in `ClockInPage`: the request
--      reaches Postgres, the row is written, and the RESPONSE is lost.
--      `classifyFailure` sees a dropped connection, calls it transient,
--      and the catch block queues the write — which then replays a row
--      that is already there. The code comment beside it describes this
--      exact network ("captive portal, associated-but-dead wifi —
--      routine on a ward").
--
-- For a clock event that means a duplicated shift on a timesheet, which
-- is a payroll error. For leave and swaps it means a manager reviewing
-- the same request twice.
--
-- ## The key is minted before the first attempt, not at enqueue
--
-- Stamping an id when the item is queued would close (1) and not (2) —
-- by then the row is already in Postgres without one. So the client
-- generates `client_event_id` at the moment the person presses the
-- button, uses it for the online attempt, and reuses it for any replay.
-- The second insert then collides with the index below.
--
-- Nullable and a PARTIAL unique index, deliberately: rows written before
-- this migration have no key, and a plain unique index over a nullable
-- column would still work but the partial one says what is meant — only
-- keyed rows are deduplicated. Nothing is backfilled, because a
-- retrospective key would be invented rather than observed.
--
-- ## What the client does with the collision
--
-- A 23505 on one of these indexes means "this already landed", which is
-- success, not failure. `syncQueue` treats it as synced and drops the
-- item. It matches on the index NAME rather than on 23505 alone — a
-- unique violation from some other constraint is a real failure and must
-- keep dead-lettering, which is why the names below are stable and
-- referenced from the client.
--
-- MIGRATION RISK. Three nullable columns and three partial indexes. No
-- row is rewritten and no existing write path changes: a caller that
-- sends no key behaves exactly as before. Reversible by dropping them.
-- =====================================================================

alter table public.clock_events
  add column if not exists client_event_id uuid;
alter table public.leave_requests
  add column if not exists client_event_id uuid;
alter table public.shift_swaps
  add column if not exists client_event_id uuid;

comment on column public.clock_events.client_event_id is
  'Idempotency key minted by the device before the first attempt, so a replayed offline write collides instead of duplicating. Null for anything written by another path.';
comment on column public.leave_requests.client_event_id is
  'Idempotency key from the offline outbox. See 0081.';
comment on column public.shift_swaps.client_event_id is
  'Idempotency key from the offline outbox. See 0081.';

-- The names matter: src/services/syncQueue.ts matches on them to tell
-- "already landed" from a genuine constraint violation.
create unique index if not exists clock_events_client_event_id_key
  on public.clock_events (client_event_id) where client_event_id is not null;
create unique index if not exists leave_requests_client_event_id_key
  on public.leave_requests (client_event_id) where client_event_id is not null;
create unique index if not exists shift_swaps_client_event_id_key
  on public.shift_swaps (client_event_id) where client_event_id is not null;
