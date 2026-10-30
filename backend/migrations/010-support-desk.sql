-- 010 support desk: cases, their messages, and the response/resolution promises (SLA) by priority.
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md. Reference numbers come from support_counter (CASE-4120 first), inside the opening transaction.

CREATE TABLE IF NOT EXISTS support_counter (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  n  INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT support_counter_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO support_counter (id, n) VALUES (1, 4119);

-- Wall-clock minutes: no working hours, and the clock does not pause for the customer.
CREATE TABLE IF NOT EXISTS support_sla_targets (
  priority               ENUM('urgent','high','normal','low') NOT NULL,
  first_response_minutes INT UNSIGNED NOT NULL,
  resolution_minutes     INT UNSIGNED NOT NULL,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (priority),
  CONSTRAINT support_sla_positive CHECK (first_response_minutes > 0 AND resolution_minutes >= first_response_minutes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO support_sla_targets (priority, first_response_minutes, resolution_minutes) VALUES
  ('urgent', 60, 240), ('high', 240, 1440), ('normal', 1440, 4320), ('low', 2880, 10080);

-- org_id is SET NULL when an organisation is deleted: the case outlives the tenant, as the old schema did.
CREATE TABLE IF NOT EXISTS support_cases (
  id                    CHAR(36)     NOT NULL,
  reference             VARCHAR(20)  NOT NULL,
  org_id                CHAR(36)     NULL,
  requester_id          CHAR(36)     NULL,
  requester_name        VARCHAR(200) NULL,
  requester_email       VARCHAR(255) NOT NULL,
  subject               VARCHAR(200) NOT NULL,
  category              ENUM('question','bug','billing','feature','incident','access') NOT NULL DEFAULT 'question',
  priority              ENUM('urgent','high','normal','low') NOT NULL DEFAULT 'normal',
  status                ENUM('open','pending','on_hold','resolved','closed') NOT NULL DEFAULT 'open',
  assigned_to           CHAR(36)     NULL,
  first_response_at     DATETIME     NULL,
  resolved_at           DATETIME     NULL,
  csat                  TINYINT UNSIGNED NULL,
  csat_comment          VARCHAR(2000) NULL,
  first_response_due_at DATETIME     NOT NULL,
  resolution_due_at     DATETIME     NOT NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY support_cases_reference (reference),
  KEY support_cases_queue (status, priority, created_at),
  KEY support_cases_org (org_id, created_at),
  KEY support_cases_requester (requester_id, created_at),
  CONSTRAINT support_cases_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE SET NULL,
  CONSTRAINT support_cases_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT support_cases_assignee FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT support_cases_resolved_time CHECK (status NOT IN ('resolved','closed') OR resolved_at IS NOT NULL),
  CONSTRAINT support_cases_csat_range CHECK (csat IS NULL OR csat BETWEEN 1 AND 5),
  CONSTRAINT support_cases_subject CHECK (CHAR_LENGTH(TRIM(subject)) > 0),
  CONSTRAINT support_cases_email CHECK (LOCATE('@', requester_email) > 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_case_messages (
  id          CHAR(36)     NOT NULL,
  case_id     CHAR(36)     NOT NULL,
  author_id   CHAR(36)     NULL,
  author_name VARCHAR(200) NULL,
  author_side ENUM('customer','platform') NOT NULL,
  body        TEXT         NOT NULL,
  is_internal TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY support_messages_case (case_id, created_at),
  CONSTRAINT support_messages_case FOREIGN KEY (case_id) REFERENCES support_cases (id) ON DELETE CASCADE,
  CONSTRAINT support_messages_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT support_messages_body CHECK (CHAR_LENGTH(TRIM(body)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
