-- 011 platform operations: incidents (the status record), feature flags, and website enquiries.
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md. Retired flags and the platform MFA switch are not carried over (docs/RLS-TO-PHP.md says why).

CREATE TABLE IF NOT EXISTS incident_counter (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  n  INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT incident_counter_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO incident_counter (id, n) VALUES (1, 137);

CREATE TABLE IF NOT EXISTS incidents (
  id          CHAR(36)     NOT NULL,
  reference   VARCHAR(20)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  impact      VARCHAR(2000) NOT NULL,
  severity    ENUM('critical','high','medium','low') NOT NULL,
  status      ENUM('investigating','identified','monitoring','resolved') NOT NULL DEFAULT 'investigating',
  service     VARCHAR(100) NOT NULL,
  started_at  DATETIME     NOT NULL,
  detected_at DATETIME     NULL,
  resolved_at DATETIME     NULL,
  owner_id    CHAR(36)     NULL,
  resolution  VARCHAR(2000) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY incidents_reference (reference),
  KEY incidents_open (status, started_at),
  CONSTRAINT incidents_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT incidents_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT incidents_impact CHECK (CHAR_LENGTH(TRIM(impact)) > 0),
  CONSTRAINT incidents_service CHECK (CHAR_LENGTH(TRIM(service)) > 0),
  CONSTRAINT incidents_resolved_after_start CHECK (resolved_at IS NULL OR resolved_at >= started_at),
  CONSTRAINT incidents_detected_after_start CHECK (detected_at IS NULL OR detected_at >= started_at),
  CONSTRAINT incidents_resolved_has_note CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND resolution IS NOT NULL AND CHAR_LENGTH(TRIM(resolution)) > 0)),
  CONSTRAINT incidents_open_has_no_resolution CHECK (status = 'resolved' OR (resolved_at IS NULL AND resolution IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incident_updates (
  id          CHAR(36)     NOT NULL,
  incident_id CHAR(36)     NOT NULL,
  author_id   CHAR(36)     NULL,
  status      ENUM('investigating','identified','monitoring','resolved') NOT NULL,
  body        VARCHAR(2000) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY incident_updates_incident (incident_id, created_at),
  CONSTRAINT incident_updates_incident FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE,
  CONSTRAINT incident_updates_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT incident_updates_body CHECK (CHAR_LENGTH(TRIM(body)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flags exist by migration only: there is no "create flag" endpoint, as before. A disabled flag is off for everyone, whatever its rollout.
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key       VARCHAR(64)  NOT NULL,
  name           VARCHAR(120) NOT NULL,
  description    VARCHAR(500) NOT NULL DEFAULT '',
  enabled        TINYINT(1)   NOT NULL DEFAULT 0,
  rollout        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  environment    ENUM('production','staging','development') NOT NULL DEFAULT 'production',
  critical       TINYINT(1)   NOT NULL DEFAULT 0,
  target_plans   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  updated_by     CHAR(36)     NULL,
  retired_at     DATETIME     NULL,
  retired_reason VARCHAR(500) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (flag_key),
  CONSTRAINT feature_flags_updater FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT feature_flags_key CHECK (flag_key REGEXP '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT feature_flags_rollout CHECK (rollout BETWEEN 0 AND 100),
  CONSTRAINT feature_flags_plans CHECK (JSON_VALID(target_plans))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO feature_flags (flag_key, name, description, enabled, rollout, critical, target_plans) VALUES
  ('ai_rota_assistant', 'AI rota assistant', 'Lets owners and managers ask for a draft rota. The plan entitlement decides who may use it; this switch can turn it off for everyone.', 1, 100, 1, JSON_ARRAY('business', 'enterprise'));

CREATE TABLE IF NOT EXISTS feature_flag_targets (
  flag_key   VARCHAR(64) NOT NULL,
  org_id     CHAR(36)    NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (flag_key, org_id),
  CONSTRAINT flag_targets_flag FOREIGN KEY (flag_key) REFERENCES feature_flags (flag_key) ON DELETE CASCADE,
  CONSTRAINT flag_targets_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_flag_changes (
  id           CHAR(36)     NOT NULL,
  flag_key     VARCHAR(64)  NOT NULL,
  actor_id     CHAR(36)     NULL,
  actor_name   VARCHAR(200) NULL,
  field_name   ENUM('enabled','rollout','target_plans','targets','created') NOT NULL,
  before_value VARCHAR(500) NULL,
  after_value  VARCHAR(500) NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY flag_changes_flag (flag_key, created_at),
  CONSTRAINT flag_changes_flag FOREIGN KEY (flag_key) REFERENCES feature_flags (flag_key) ON DELETE CASCADE,
  CONSTRAINT flag_changes_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO feature_flag_changes (id, flag_key, field_name, before_value, after_value) VALUES (UUID(), 'ai_rota_assistant', 'created', NULL, 'Migration 011');

-- Website enquiries: platform-wide on purpose (a prospect belongs to no organisation). The raw address is never kept, only a keyed hash.
CREATE TABLE IF NOT EXISTS enquiries (
  id                CHAR(36)     NOT NULL,
  name              VARCHAR(120) NOT NULL,
  work_email        VARCHAR(254) NOT NULL,
  organisation      VARCHAR(160) NOT NULL,
  team_size         ENUM('1-25','26-100','101-500','500+') NULL,
  sector            VARCHAR(80)  NULL,
  message           TEXT         NOT NULL,
  wants_demo        TINYINT(1)   NOT NULL DEFAULT 0,
  marketing_consent TINYINT(1)   NOT NULL DEFAULT 0,
  status            ENUM('new','replied','demo_booked','closed') NOT NULL DEFAULT 'new',
  ip_hash           CHAR(64)     NULL,
  user_agent        VARCHAR(400) NULL,
  notified_at       DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY enquiries_inbox (status, created_at),
  KEY enquiries_age (created_at),
  CONSTRAINT enquiries_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 120),
  CONSTRAINT enquiries_email CHECK (CHAR_LENGTH(work_email) BETWEEN 3 AND 254 AND LOCATE('@', work_email) > 1),
  CONSTRAINT enquiries_org CHECK (CHAR_LENGTH(TRIM(organisation)) BETWEEN 1 AND 160),
  CONSTRAINT enquiries_message CHECK (CHAR_LENGTH(TRIM(message)) BETWEEN 10 AND 5000),
  CONSTRAINT enquiries_hash CHECK (ip_hash IS NULL OR ip_hash REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
