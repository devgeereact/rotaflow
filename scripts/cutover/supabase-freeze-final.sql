-- RotaFlow cutover, step "freeze writes", phase 2 (docs/CUTOVER.md). Run by the OWNER in the Supabase SQL editor on the OLD
-- project, after supabase-freeze.sql and once outbox_pending is 0 (or after 5 minutes: the rest are then not delivered,
-- and their count goes in the cutover log). Freezes the two outbox tables too and pauses the rotaflow-* cron jobs,
-- remembering which were active so supabase-unfreeze.sql restores exactly that.
BEGIN;
CREATE TABLE IF NOT EXISTS rotaflow_cutover.cron_state AS SELECT jobname, active FROM cron.job WHERE jobname LIKE 'rotaflow-%';
UPDATE cron.job SET active = false WHERE jobname LIKE 'rotaflow-%';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_outbox', 'notification_deliveries'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_rotaflow_cutover_freeze ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_rotaflow_cutover_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION rotaflow_cutover.refuse()', t);
  END LOOP;
END $$;
COMMIT;
-- Check: every public table frozen; every rotaflow-* job inactive; what was still waiting (not delivered).
SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_rotaflow_cutover_freeze') AS frozen_tables,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) AS public_tables;
SELECT jobname, active FROM cron.job WHERE jobname LIKE 'rotaflow-%' ORDER BY jobname;
SELECT count(*) AS outbox_pending_not_delivered FROM public.notification_outbox WHERE status = 'pending';
