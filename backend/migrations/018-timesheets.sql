-- 018 timesheets (R2 slice S13): flag chips beside each line and the payroll CSV export.
-- No new tables. The tolerance is an organisation setting (organisations.settings, key timesheet_tolerance_minutes, a whole number 0-120,
-- written by Settings -> Policies; 10 applies when unset). The module ships dark: while this flag is off GET timesheets/export answers 403
-- feature_off, the list response is exactly what it was (no lines), and the screens show nothing new.
INSERT IGNORE INTO feature_flags (flag_key, name, description, enabled, rollout, critical, target_plans) VALUES
  ('timesheet_tools', 'Timesheet tools', 'Late, early finish and overtime flags beside each timesheet line (beyond the organisation''s tolerance, default 10 minutes) and the payroll CSV export of approved periods. Off until the platform turns it on.', 0, 0, 0, JSON_ARRAY());
