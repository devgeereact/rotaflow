-- 013 data lifecycle: data-subject requests, the queues that finish an erasure (logins and stored files), and retention.
-- Deleting an organisation has no table: it is one transaction (Mod\Lifecycle::deleteOrg). Audit rows, cases and requests outlive it because
-- they carry no cascading link to it. Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

CREATE TABLE IF NOT EXISTS gdpr_requests (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NULL,
  subject_email    VARCHAR(255) NOT NULL,
  subject_name     VARCHAR(200) NULL,
  kind             ENUM('access','portability','rectification','erasure','restriction','objection') NOT NULL,
  status           ENUM('received','in_progress','awaiting_information','completed','refused') NOT NULL DEFAULT 'received',
  received_on      DATE         NOT NULL,
  due_on           DATE         NOT NULL,
  extended_to      DATE         NULL,
  extension_reason VARCHAR(1000) NULL,
  assigned_to      CHAR(36)     NULL,
  closed_at        DATETIME     NULL,
  outcome_note     VARCHAR(2000) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY gdpr_open (status, due_on),
  KEY gdpr_org (org_id, received_on),
  KEY gdpr_subject (subject_email, kind),
  CONSTRAINT gdpr_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE SET NULL,
  CONSTRAINT gdpr_assignee FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT gdpr_email CHECK (LOCATE('@', subject_email) > 1),
  CONSTRAINT gdpr_due_after_receipt CHECK (due_on >= received_on),
  CONSTRAINT gdpr_extension_is_later CHECK (extended_to IS NULL OR extended_to > due_on),
  CONSTRAINT gdpr_closed_has_outcome CHECK (status NOT IN ('completed','refused') OR (closed_at IS NOT NULL AND outcome_note IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A login owed to a completed erasure. No foreign key to users: the row must outlive the account it names, and holds the Clerk id because the local row goes first.
CREATE TABLE IF NOT EXISTS account_deletions (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  clerk_user_id   VARCHAR(64)  NULL,
  gdpr_request_id CHAR(36)     NULL,
  status          ENUM('pending','done','abandoned') NOT NULL DEFAULT 'pending',
  attempts        INT UNSIGNED NOT NULL DEFAULT 0,
  last_error      VARCHAR(500) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME     NULL,
  PRIMARY KEY (id),
  KEY account_deletions_queue (status, created_at),
  CONSTRAINT account_deletions_request FOREIGN KEY (gdpr_request_id) REFERENCES gdpr_requests (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A stored file or folder owed a delete. No foreign key to organisations, for the same reason. Queued by PHP in the transaction that removes the row.
CREATE TABLE IF NOT EXISTS storage_deletions (
  id           CHAR(36)     NOT NULL,
  org_id       CHAR(36)     NOT NULL,
  bucket       ENUM('staff-documents','staff-photos') NOT NULL,
  path         VARCHAR(200) NOT NULL,
  is_folder    TINYINT(1)   NOT NULL DEFAULT 0,
  reason       ENUM('document_removed','photo_removed','person_removed','person_erased','organisation_deleted') NOT NULL,
  status       ENUM('pending','done','abandoned') NOT NULL DEFAULT 'pending',
  attempts     INT UNSIGNED NOT NULL DEFAULT 0,
  last_error   VARCHAR(500) NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME     NULL,
  PRIMARY KEY (id),
  KEY storage_deletions_queue (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS retention_policies (
  data_type     VARCHAR(40)  NOT NULL,
  label         VARCHAR(120) NOT NULL,
  retain_months INT UNSIGNED NULL,
  enforced      TINYINT(1)   NOT NULL DEFAULT 0,
  note          VARCHAR(500) NOT NULL DEFAULT '',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (data_type),
  CONSTRAINT retention_months CHECK (retain_months IS NULL OR retain_months > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO retention_policies (data_type, label, retain_months, enforced, note) VALUES
  ('attendance',     'Clock events and timesheets',  36, 1, 'Kept three years after the event or period end.'),
  ('audit_log',      'Audit trail',                  NULL, 1, 'Kept indefinitely; the table is append-only.'),
  ('deleted_tenant', 'A deleted organisation',        1, 0, 'Not implemented: deleting an organisation takes effect at once. Listed so nobody assumes a grace period exists.'),
  ('enquiries',      'Website enquiries',            24, 1, 'Removed whatever their status.'),
  ('leave',          'Leave requests',               72, 1, 'Kept six years after the leave ended.'),
  ('notifications',  'Notification records',         12, 1, 'Delivery attempts and sent or abandoned outbox rows; pending rows are never removed.'),
  ('rota_history',   'Shifts and rotas',             84, 1, 'Kept seven years after the shift or rota period.'),
  ('support_cases',  'Resolved support cases',       36, 1, 'Only resolved cases; open ones are never removed.');

CREATE TABLE IF NOT EXISTS retention_runs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ran_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dry_run      TINYINT(1)   NOT NULL DEFAULT 0,
  data_type    VARCHAR(40)  NOT NULL,
  rows_removed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  cutoff       DATE         NULL,
  error        VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY retention_runs_when (ran_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A clock event's corrections go with it when retention (or an organisation's deletion) removes the event. Foreign-key cascades do not run
-- triggers, so this is the one sanctioned way past the append-only rule; a direct delete of a correction is still refused.
ALTER TABLE clock_event_corrections ADD CONSTRAINT clock_event_corrections_fk_event FOREIGN KEY (org_id, clock_event_id) REFERENCES clock_events (org_id, id) ON DELETE CASCADE;
