-- =====================================================================
-- health_probe.test.sql — GAP-011: uptime stops meaning "somebody
-- opened a page".
--
-- Until 0076 the only writer to `platform_health_samples` was the
-- console, so "uptime, 24 hours" was arithmetic over the moments an
-- administrator happened to look, and a 3am outage left no trace.
--
-- The subtle part is not the probe, it is the view. 0027 warned that
-- averaging a browser round trip with an in-region one would produce
-- "the kind of number that survives until someone depends on it", and
-- `platform_health_summary` had no source filter because only one
-- source existed. Adding a second makes that warning bite.
--
-- Assertions 4-7 are the ones worth having. The first draft of 0076
-- preferred scheduled samples for EVERYTHING, which silently deleted
-- the console's real browser-measured percentiles — scheduled probes
-- record no duration, so p95 became null and the screen read "Not
-- sampled" where it had shown a true figure. Uptime and latency are
-- different questions and the view has to answer them separately.
--
-- What has to hold:
--
--   1. the probe writes a database sample, unattended;
--   2. and marks it `scheduled`, not `console`;
--   3. a probe with no response reconciles to `down` — silence is an
--      answer, not a missing row;
--   4. uptime prefers scheduled samples and ignores console ones;
--   5. and falls back to console for a service with no scheduled probe;
--   6. latency still comes from console samples even when scheduled
--      ones exist — the regression above;
--   7. `measured_from` and `latency_from` say which source was used;
--   8. samples older than 90 days are pruned, because nothing else
--      prunes this table.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

-- The local stack has no Vault secrets, so the probe records the database
-- sample, raises its "cannot probe HTTP endpoints" warning, and returns
-- before firing anything. That is the documented fail-loud path, it is what
-- runs here, and it means no outbound request is made from a test. The
-- warning goes to stderr and does not disturb the TAP stream, so it is left
-- visible rather than silenced.

-- A sample old enough to be pruned, and one recent console sample so the
-- fallback branch has something to fall back to.
insert into public.platform_health_samples (service, status, latency_ms, source, checked_at)
values
  ('Ancient service', 'operational', 10, 'console',
   timezone('utc', now()) - interval '120 days');

-- An in-flight probe whose response never arrived.
insert into public.platform_health_probes (request_id, service, sent_at)
values (999999999, 'Authentication', timezone('utc', now()) - interval '10 minutes');

select ok(
  public.probe_platform_health() >= 1,
  'the probe runs unattended and writes at least one sample'
);

select is(
  (select source from public.platform_health_samples
    where service = 'PostgreSQL database'
    order by checked_at desc limit 1),
  'scheduled',
  'and marks the database sample scheduled — a cron tick is not a browser'
);

select is(
  (select status from public.platform_health_samples
    where service = 'Authentication' and source = 'scheduled'
    order by checked_at desc limit 1),
  'down',
  'a probe with no response reconciles to down — silence is an answer'
);

select is(
  (select count(*)::int from public.platform_health_samples
    where service = 'Ancient service'),
  0,
  'samples past 90 days are pruned, because nothing else prunes this table'
);

-- ---------- the view's two questions ---------------------------------
-- 'Realtime' gets both sources: three scheduled (one down) and one console
-- that is both healthy and the only row carrying a latency.
insert into public.platform_health_samples (service, status, latency_ms, source) values
  ('Realtime', 'operational', null, 'scheduled'),
  ('Realtime', 'down',        null, 'scheduled'),
  ('Realtime', 'operational', null, 'scheduled'),
  ('Realtime', 'operational', 120,  'console'),
  -- 'File storage' gets console only, so it must fall back.
  ('File storage', 'operational', 80, 'console');

select is(
  (select uptime_pct_24h from public.platform_health_summary where service = 'Realtime'),
  66.67::numeric,
  'uptime counts the three scheduled samples and ignores the healthy console one'
);

select is(
  (select measured_from from public.platform_health_summary where service = 'File storage'),
  'console',
  'a service with no scheduled probe falls back to console, and says so'
);

-- The regression the first draft introduced: preferring scheduled samples for
-- percentiles too would make this null, because scheduled probes record no
-- duration — deleting a true figure in the name of a better one.
select is(
  -- Cast on both sides: percentile_cont over an integer column returns double
  -- precision, and pgTAP's is() will not compare that with a numeric literal.
  (select p50_ms::numeric from public.platform_health_summary where service = 'Realtime'),
  120::numeric,
  'latency still comes from the console sample, which is the only thing that timed anything'
);

select is(
  (select latency_from from public.platform_health_summary where service = 'Realtime'),
  'console',
  'and latency_from says so, rather than letting measured_from imply it'
);

select * from finish();
rollback;
