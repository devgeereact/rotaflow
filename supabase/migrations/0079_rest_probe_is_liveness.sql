-- =====================================================================
-- 0079_rest_probe_is_liveness.sql — the REST probe stops reporting a
-- healthy service as degraded (docs/SAAS.md BUG-065)
--
-- 0076 shipped alongside 0075, and the two interact in a way neither
-- migration noticed. 0075 removed every table grant from `anon`; the
-- REST probe calls `GET /rest/v1/` with the anon key; PostgREST now
-- answers that with 401. 0076's classifier maps any 4xx to `degraded`.
--
-- So from the first tick after deploy, "REST API" has read **degraded**
-- on a platform that is entirely healthy — verified on production, seven
-- consecutive samples, every one of them wrong.
--
-- A monitor that cries wolf on its first day is worse than no monitor.
-- It teaches the person reading it to discount the one screen whose
-- whole job is to be believed.
--
-- ## What the REST probe can actually claim
--
-- It has no credentials and no tenant to look at. What it can establish
-- is that PostgREST is up and answering — liveness. A 401 answers that
-- as well as a 200 does: something served a considered HTTP response.
-- What it cannot establish is that any particular query works, and it
-- should not pretend otherwise by treating an authorisation refusal as
-- a symptom.
--
-- So REST is classified as liveness: no response or a 5xx is `down`,
-- anything else is `operational`. Auth keeps the stricter reading,
-- because `/auth/v1/health` is a real health endpoint that returns 200
-- when healthy — a 4xx there genuinely is a symptom.
--
-- The distinction is carried in the probe row rather than inferred from
-- the service name, so a future probe has to say which kind it is
-- instead of inheriting whichever branch happens to match.
--
-- MIGRATION RISK. One column added with a default, one function
-- replaced. The existing rows are back-filled to `strict`, which is what
-- they were classified as. Historical samples are not rewritten: they
-- record what the probe concluded at the time, and rewriting monitoring
-- history to make a past reading look better is not a thing to start
-- doing. The seven wrong "degraded" rows age out of the 24-hour window
-- on their own.
-- =====================================================================

alter table public.platform_health_probes
  add column if not exists classify text not null default 'strict'
    check (classify in ('strict', 'liveness'));

comment on column public.platform_health_probes.classify is
  'How to read the response. strict: a 4xx is degraded, for endpoints that return 200 when healthy. liveness: only a 5xx or no answer is a fault, for endpoints where an authorisation refusal still proves the service is serving.';

create or replace function public.probe_platform_health()
returns integer
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_origin text;
  v_anon   text;
  v_row    record;
  v_resp   record;
  v_status text;
  v_wrote  integer := 0;
begin
  -- 1. Reconcile last tick's requests. Anything older than a minute has
  --    either landed or timed out, so a missing response row is itself the
  --    answer: the service did not reply.
  for v_row in
    select * from public.platform_health_probes
     where sent_at < timezone('utc', now()) - interval '1 minute'
  loop
    select status_code, timed_out into v_resp
      from net._http_response where id = v_row.request_id;

    v_status := case
      -- Silence is a fault under either reading.
      when v_resp.status_code is null or v_resp.timed_out then 'down'
      when v_resp.status_code >= 500 then 'down'
      -- A 4xx is a symptom only where the endpoint returns 200 when well.
      when v_row.classify = 'strict' and v_resp.status_code >= 400 then 'degraded'
      else 'operational'
    end;

    insert into public.platform_health_samples (service, status, latency_ms, source)
    values (v_row.service, v_status, null, 'scheduled');

    delete from public.platform_health_probes where request_id = v_row.request_id;
    v_wrote := v_wrote + 1;
  end loop;

  -- 2. The database. This function running IS the measurement; a tick that
  --    does not happen leaves no row, and the window notices the gap.
  insert into public.platform_health_samples (service, status, latency_ms, source)
  values ('PostgreSQL database', 'operational', null, 'scheduled');
  v_wrote := v_wrote + 1;

  -- 3. Prune, BEFORE anything that can return early — a missing credential
  --    must not silently stop retention.
  delete from public.platform_health_samples
   where checked_at < timezone('utc', now()) - interval '90 days';

  -- 4. Fire this tick's HTTP probes.
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'supabase_anon_key';

  select decrypted_secret into v_origin
    from vault.decrypted_secrets where name = 'supabase_url';

  if v_origin is null then
    select substring(decrypted_secret from '^https?://[^/]+') into v_origin
      from vault.decrypted_secrets where name = 'send_notification_url';
  end if;

  if v_origin is null or v_anon is null then
    raise warning 'probe_platform_health: cannot probe HTTP endpoints (origin=%, anon key=%)',
      v_origin is not null, v_anon is not null;
    return v_wrote;
  end if;

  -- A real health endpoint: 200 when well, so a 4xx means something.
  insert into public.platform_health_probes (request_id, service, classify)
  values (
    net.http_get(
      url     := v_origin || '/auth/v1/health',
      headers := jsonb_build_object('apikey', v_anon)
    ),
    'Authentication', 'strict'
  );

  -- Liveness only. With no grants and no session there is nothing this
  -- caller is entitled to read, so PostgREST answers 401 — which proves it
  -- is serving just as well as a 200 would.
  insert into public.platform_health_probes (request_id, service, classify)
  values (
    net.http_get(
      url     := v_origin || '/rest/v1/',
      headers := jsonb_build_object('apikey', v_anon)
    ),
    'REST API', 'liveness'
  );

  return v_wrote;
end;
$$;

comment on function public.probe_platform_health() is
  'Writes platform_health_samples with source = scheduled, every five minutes, whether or not anyone is looking. Records status only: see 0076 for why no latency is recorded from a pg_net probe, and 0079 for why REST is classified as liveness rather than strictly.';

revoke all on function public.probe_platform_health() from public, anon, authenticated;
