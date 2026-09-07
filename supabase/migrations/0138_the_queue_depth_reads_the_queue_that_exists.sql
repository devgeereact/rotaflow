-- =====================================================================
-- 0138_the_queue_depth_reads_the_queue_that_exists.sql
--
-- ## The defect
--
-- `/admin/platform-health` shows a "Queue depth" tile and a "Background jobs"
-- panel, both read from `public.background_jobs` through
-- `platformFactsService.getQueueDepths()`. That table has no writer:
--
--   select count(*) from public.background_jobs;                     -- 0
--   select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'background_jobs' and not t.tgisinternal;     -- none
--   select proname from pg_proc where prosrc ilike '%background_jobs%'; -- none
--
-- Its only historical writer was Inngest, retired by `0087`. So on the one
-- screen whose job is to say whether work is stuck, the tile reads "0 queued"
-- and the panel reads "Nothing is queued or running" — permanently, and no
-- matter how badly the real queue is backed up. That is fabricated
-- reassurance, which is the BUG-059 class the page's own copy claims to have
-- ended ("Nothing on this page is invented any more").
--
-- ## The queue that does exist
--
-- `notification_outbox` is drained every minute by `send-notification`
-- (`0069`, and `0132` put platform announcements on it too). It is the only
-- background queue in the product.
--
-- ## Why an RPC and not a select
--
-- The service read `background_jobs` unpaginated and grouped in the browser.
-- Pointing that same code at `notification_outbox` would move the fabrication
-- and add a truncation bug on top: above PostgREST's `db.max_rows` the browser
-- would group a truncated page and report it as the estate's queue depth. This
-- counts in the database and returns one row per event, which is the pattern
-- `0130`, `0133` and `0134` established for exactly this reason.
--
-- ## One definition of "failed", not two
--
-- `abandoned` is a dispatch that will not be retried again; `pending` is in
-- flight and `failed` is still eligible for retry. That is `0133`'s wording
-- for `failed_notifications` on the overview, reused verbatim here so the two
-- screens cannot drift into disagreeing about the same number — the "a rule
-- written twice" argument from `0130`.
--
-- ## Rollback
--
-- `drop function public.platform_queue_depths()`. Nothing else changes;
-- `background_jobs` is left in place rather than dropped, because deciding
-- whether that table has a future is a separate question from stopping a
-- screen lying about it.
-- =====================================================================

create or replace function public.platform_queue_depths()
returns table (
  queue     text,
  queued    bigint,
  failed    bigint,
  oldest_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Operational, matching `platform_operations_summary`: a stuck notification
  -- queue is operational state, not billing state.
  if not public.is_platform_operational() then
    raise exception 'Only an operational platform role can read queue depth'
      using errcode = '42501';
  end if;

  return query
    select
      o.event_name,
      count(*) filter (where o.status in ('pending', 'failed')),
      -- Only `abandoned`. See the header: `failed` is still going to be
      -- retried, so counting it here would report a queue as broken while it
      -- is working normally.
      count(*) filter (where o.status = 'abandoned'),
      -- The age of the oldest thing still waiting is the number that tells an
      -- operator whether the drain has stopped. A depth of 40 that is seconds
      -- old is healthy; a depth of 3 that is six hours old is an outage.
      min(o.created_at) filter (where o.status in ('pending', 'failed'))
    from public.notification_outbox o
    where o.status in ('pending', 'failed', 'abandoned')
    group by o.event_name
    order by count(*) filter (where o.status in ('pending', 'failed')) desc,
             o.event_name;
end;
$$;

revoke all on function public.platform_queue_depths() from public, anon;
grant execute on function public.platform_queue_depths() to authenticated;

comment on function public.platform_queue_depths() is
  'Depth of the notification outbox by event, counted in the database. Replaces the console read of background_jobs, which has had no writer since Inngest was retired in 0087 and reported an empty queue forever. Operational platform roles only (0138).';
