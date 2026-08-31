-- =====================================================================
-- 0091_notification_secret_lives_in_vault.sql — one place for the
-- notification shared secret, generated where nobody has to see it
-- (docs/SAAS.md CAP-020)
--
-- ## The queue has never drained, and this is why
--
-- `0069` built the outbox and the pg_cron drain correctly. It has been
-- running every minute since, and it has delivered nothing, because
-- `notification_function_secret` is not in `vault` — verified on
-- production 2026-08-31, where `vault.secrets` holds
-- `send_notification_url` and `supabase_anon_key` and nothing else. The
-- drain does exactly what it was built to do in that case: warns, and
-- returns 0.
--
-- The secret itself is not lost. `NOTIFICATION_FUNCTION_SECRET` has
-- existed as an Edge Function secret since 30 July. The problem is that
-- it has to exist TWICE — once for the drain to send, once for
-- `send-notification` to check — with the two values equal, and a
-- Supabase secret cannot be read back once set. So making them equal
-- means someone knowing the value and typing it into two places, and
-- for a month nobody has.
--
-- ## One source of truth instead of two kept equal by hand
--
-- The secret now lives in `vault` alone. The drain already reads it
-- there; `send-notification` is changed in the same commit to verify
-- against `vault` too, using the service-role client it already builds.
-- The Edge Function secret stays valid as a fallback, so a deployment
-- where this migration has applied but the function has not — the
-- ordinary case, since functions never deploy on merge — keeps working
-- either way round.
--
-- ## Generated in the database, on purpose
--
-- `gen_random_bytes` runs inside Postgres, so the value is never in a
-- migration, a transcript, a terminal history or a clipboard. Nobody
-- has to know it, which is the property that stops this drifting again:
-- there is no second place to keep in step, and no human step to skip.
--
-- Idempotent. If a secret of this name already exists it is left alone,
-- so re-running never invalidates a working configuration.
-- =====================================================================

do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'notification_function_secret';

  if v_id is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notification_function_secret',
      'Shared secret proving a call to send-notification came from this project''s own outbox drain. Generated in-database by 0091 so no human ever handles it. Rotate by deleting this row and re-running that block.'
    );
  end if;
end;
$$;

-- ── verifying without handing the secret over ─────────────────────────
--
-- `send-notification` needs to know whether the caller presented the right
-- value. It does NOT need the value, and the difference matters: `vault` is
-- not a PostgREST-exposed schema, so a function cannot read it over the API
-- anyway, and a helper that returned the secret would put a credential on the
-- wire for no reason.
--
-- So the comparison happens here. The function takes what was presented and
-- answers yes or no.
--
-- `service_role` only. Every other role — including `authenticated` — is
-- refused, because an oracle that says "is this the right secret?" is a
-- brute-force target if anyone can ask it. Only the Edge Function, which
-- already holds the service-role key, can.
create or replace function public.verify_notification_secret(p_presented text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select exists (
    select 1 from vault.decrypted_secrets
     where name = 'notification_function_secret'
       and decrypted_secret = p_presented
  );
$$;

comment on function public.verify_notification_secret(text) is
  'Does this match the outbox drain''s shared secret? Answers a boolean and never returns the value. service_role only: an oracle anyone could ask is a brute-force target.';

revoke all on function public.verify_notification_secret(text) from public, anon, authenticated;
grant execute on function public.verify_notification_secret(text) to service_role;

-- A visible, non-secret answer to "is delivery configured?", so the
-- platform console and a future health check can say so without anybody
-- reading a credential to find out.
create or replace function public.notification_delivery_configured()
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select count(*) = 3
    from vault.secrets
   where name in (
     'send_notification_url',
     'supabase_anon_key',
     'notification_function_secret'
   );
$$;

comment on function public.notification_delivery_configured() is
  'True when all three secrets the outbox drain needs are present. Returns a boolean and never the values, so "is it set up?" is answerable without handling a credential.';

revoke all on function public.notification_delivery_configured() from public, anon;
grant execute on function public.notification_delivery_configured() to authenticated;
