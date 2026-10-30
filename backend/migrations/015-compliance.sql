-- 015 compliance (R2 slice S10): document types, staff documents with review, and once-only expiry reminders.
-- Ported from SiteRelay's 060-compliance and re-made for RotaFlow's tables: a document belongs to a staff record (staff_profiles), not to a
-- login, because a person can be on the rota before they ever sign in. Not copied: document_type_sites, member_documents, member_profiles
-- (RotaFlow has staff_profiles, emergency_contacts and its own documents table, whose shape this keeps).
--
-- `documents` is RotaFlow's existing table (Postgres 0002 + 0159), here in MariaDB for the first time, with the review columns added. Its
-- legacy columns keep their names (type, name, file_url, storage_path, issued_at, expires_at) so moved rows need no mapping; `status`
-- defaults to 'approved', so nothing that was already on file becomes ineligible when the move happens. 'expired' is never stored: it is
-- computed from expires_at in the organisation's timezone. Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

CREATE TABLE IF NOT EXISTS document_types (
  id                      CHAR(36)      NOT NULL,
  org_id                  CHAR(36)      NOT NULL,
  name                    VARCHAR(100)  NOT NULL,
  description             VARCHAR(500)  NOT NULL DEFAULT '',
  requires_expiry         TINYINT(1)    NOT NULL DEFAULT 0,
  default_validity_months SMALLINT UNSIGNED NULL,
  required                TINYINT(1)    NOT NULL DEFAULT 0,
  preset_key              VARCHAR(40)   CHARACTER SET ascii NULL,
  status                  ENUM('active','archived') NOT NULL DEFAULT 'active',
  version                 INT UNSIGNED  NOT NULL DEFAULT 1,
  created_by              CHAR(36)      NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY document_types_org_id (org_id, id),
  KEY document_types_active (org_id, status),
  CONSTRAINT document_types_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT document_types_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT document_types_validity CHECK (default_validity_months IS NULL OR default_validity_months BETWEEN 1 AND 120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every upload is a new row. Replacing a document keeps the earlier rows: when the new one is approved, the earlier approved row becomes
-- 'superseded' and points at its successor. A row holds a stored file (storage_path, in the private store at <org>/<staff>/<file>) or, for a
-- row moved from before stored files, a pasted link (file_url): exactly one of the two. document_type_id is null only on such moved rows.
CREATE TABLE IF NOT EXISTS documents (
  id               CHAR(36)      NOT NULL,
  org_id           CHAR(36)      NOT NULL,
  staff_profile_id CHAR(36)      NOT NULL,
  document_type_id CHAR(36)      NULL,
  type             VARCHAR(100)  NOT NULL,
  name             VARCHAR(200)  NOT NULL,
  file_url         VARCHAR(500)  NULL,
  storage_path     VARCHAR(300)  NULL,
  mime             VARCHAR(60)   NULL,
  issued_at        DATE          NULL,
  expires_at       DATE          NULL,
  status           ENUM('uploaded','awaiting_review','approved','rejected','withdrawn','superseded') NOT NULL DEFAULT 'approved',
  rejection_reason VARCHAR(500)  NULL,
  uploaded_by      CHAR(36)      NULL,
  submitted_at     DATETIME(6)   NULL,
  reviewed_by      CHAR(36)      NULL,
  reviewed_at      DATETIME      NULL,
  superseded_by    CHAR(36)      NULL,
  version          INT UNSIGNED  NOT NULL DEFAULT 1,
  created_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY documents_org_id (org_id, id),
  UNIQUE KEY documents_storage_path (storage_path),
  KEY documents_staff_type (org_id, staff_profile_id, document_type_id, status),
  KEY documents_queue (org_id, status, submitted_at),
  KEY documents_expiry (status, expires_at),
  CONSTRAINT documents_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT documents_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT documents_type FOREIGN KEY (org_id, document_type_id) REFERENCES document_types (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT documents_uploader FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT documents_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT documents_successor FOREIGN KEY (superseded_by) REFERENCES documents (id) ON DELETE SET NULL,
  CONSTRAINT documents_has_one_file CHECK ((file_url IS NULL) <> (storage_path IS NULL)),
  CONSTRAINT documents_path_is_its_own CHECK (storage_path IS NULL OR storage_path LIKE CONCAT(org_id, '/', staff_profile_id, '/%')),
  CONSTRAINT documents_dates CHECK (issued_at IS NULL OR expires_at IS NULL OR expires_at >= issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per (document, reminder stage) ever sent: the primary key makes reminders once-only across cron runs.
CREATE TABLE IF NOT EXISTS document_reminders (
  org_id      CHAR(36)    NOT NULL,
  document_id CHAR(36)    NOT NULL,
  stage       VARCHAR(12) CHARACTER SET ascii NOT NULL,
  sent_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (document_id, stage),
  CONSTRAINT document_reminders_document FOREIGN KEY (org_id, document_id) REFERENCES documents (org_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The module ships dark: the screens show only where the platform turns this flag on.
INSERT IGNORE INTO feature_flags (flag_key, name, description, enabled, rollout, critical, target_plans) VALUES
  ('staff_documents', 'Staff documents and compliance', 'Document types, uploads with review, expiry reminders and the eligibility chip on the rota. Off until the platform turns it on.', 0, 0, 0, JSON_ARRAY());
