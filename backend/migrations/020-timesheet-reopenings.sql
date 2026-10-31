-- 020 timesheet reopenings (S13 follow-up, owner decision 31 Oct 2026): once a period has been exported to payroll it is not changed by
-- approving it again; an owner reopens it deliberately (exported -> approved, version + 1) and must say why. The reason is kept here, on its
-- own row, not in the audit log (the audit row carries only ids, dates and the version, never free text that might name a person).
-- Additive: one new table; nothing existing changes. Used only while the timesheet_tools flag is on (the only way a period becomes exported).
CREATE TABLE IF NOT EXISTS timesheet_reopenings (
  id             CHAR(36)     NOT NULL,
  org_id         CHAR(36)     NOT NULL,
  timesheet_id   CHAR(36)     NOT NULL,
  actor_user_id  CHAR(36)     NULL,
  reason         VARCHAR(500) NOT NULL,
  from_status    VARCHAR(20)  NOT NULL,
  to_status      VARCHAR(20)  NOT NULL,
  version_after  INT UNSIGNED NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY timesheet_reopenings_sheet (org_id, timesheet_id, created_at),
  CONSTRAINT timesheet_reopenings_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT timesheet_reopenings_timesheet FOREIGN KEY (timesheet_id) REFERENCES timesheets (id) ON DELETE CASCADE,
  CONSTRAINT timesheet_reopenings_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 3 AND 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
