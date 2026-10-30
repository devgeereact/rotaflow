-- 016 scheduling (R2 slice S11): rota warnings, the publish preview and recurring patterns.
-- No new tables. The two limits the warnings read are organisation settings that already exist (organisations.settings, keys min_rest_hours
-- and max_weekly_hours, written by Settings -> Policies; 11 and 48 apply when unset). The module ships dark: while this flag is off the new
-- routes answer 403 feature_off, publishing and leave decisions behave exactly as before, and the screens do not show.
INSERT IGNORE INTO feature_flags (flag_key, name, description, enabled, rollout, critical, target_plans) VALUES
  ('scheduling_tools', 'Scheduling tools', 'Rota warnings (rest, weekly hours, leave, unavailable) at assign and in a publish preview, double-booking blocks publishing, recurring patterns, and clashing shifts on leave approval. Off until the platform turns it on.', 0, 0, 0, JSON_ARRAY());
