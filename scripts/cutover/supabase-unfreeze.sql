-- RotaFlow cutover ROLLBACK (docs/CUTOVER.md): undoes supabase-freeze.sql and supabase-freeze-final.sql on the OLD project.
-- Run by the OWNER in the Supabase SQL editor. Drops exactly the triggers and the schema those added, and puts each
-- rotaflow-* cron job back to the state it had before the freeze. Safe to run twice.
BEGIN;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tgrelid::regclass AS rel FROM pg_trigger WHERE tgname = 'zz_rotaflow_cutover_freeze' LOOP
    EXECUTE format('DROP TRIGGER zz_rotaflow_cutover_freeze ON %s', t.rel);
  END LOOP;
  IF to_regclass('rotaflow_cutover.cron_state') IS NOT NULL THEN
    UPDATE cron.job j SET active = s.active FROM rotaflow_cutover.cron_state s WHERE s.jobname = j.jobname;
  END IF;
END $$;
DROP SCHEMA IF EXISTS rotaflow_cutover CASCADE;
COMMIT;
-- Check: 0 frozen tables, and the cron jobs as they were.
SELECT count(*) AS frozen_tables FROM pg_trigger WHERE tgname = 'zz_rotaflow_cutover_freeze';
SELECT jobname, active FROM cron.job WHERE jobname LIKE 'rotaflow-%' ORDER BY jobname;
