-- RotaFlow cutover, step "freeze writes" (docs/CUTOVER.md). Run by the OWNER in the Supabase dashboard, SQL editor, on the
-- OLD project. It changes no data: it adds one statement trigger to every table in the public schema that refuses
-- INSERT, UPDATE, DELETE and TRUNCATE, from every caller (the app, RPC functions, edge functions with the service key).
-- Reads keep working, so the old site still shows rotas, and sign-in still works; every change is refused with
-- "RotaFlow is moving: changes are paused". Undo with supabase-unfreeze.sql (exact: it drops what this adds).
-- Phase 1 leaves the notification drain running (notification_outbox, notification_deliveries) so the last messages
-- go out; supabase-freeze-final.sql closes those and pauses the rotaflow-* cron jobs.
BEGIN;
CREATE SCHEMA IF NOT EXISTS rotaflow_cutover;
CREATE OR REPLACE FUNCTION rotaflow_cutover.refuse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RotaFlow is moving: changes are paused for the cutover' USING ERRCODE = '25006';
END $$;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
             AND c.relname NOT IN ('notification_outbox', 'notification_deliveries') LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_rotaflow_cutover_freeze ON public.%I', t.relname);
    EXECUTE format('CREATE TRIGGER zz_rotaflow_cutover_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION rotaflow_cutover.refuse()', t.relname);
  END LOOP;
END $$;
COMMIT;
-- Check: one row per public table except the two outbox tables, and the number of messages still waiting to go out.
SELECT count(*) AS frozen_tables FROM pg_trigger WHERE tgname = 'zz_rotaflow_cutover_freeze';
SELECT count(*) AS outbox_pending FROM public.notification_outbox WHERE status = 'pending';
