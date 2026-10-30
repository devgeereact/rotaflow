-- 007 communication: the in-app inbox, the notification outbox and its delivery log, templates, announcements, web push
-- subscriptions, an organisation's own SMTP account (password encrypted), calendar feed tokens, and a per-person mute.
-- The outbox row is written in the same transaction as the event that caused it, so a crash cannot lose a notification.
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notifications_enabled TINYINT(1) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL,
  org_id     CHAR(36)     NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  type       VARCHAR(40)  NOT NULL,
  title      VARCHAR(300) NOT NULL,
  body       TEXT         NULL,
  channel    ENUM('in_app','push','email','sms') NOT NULL DEFAULT 'in_app',
  read_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY notifications_inbox (user_id, org_id, created_at),
  CONSTRAINT notifications_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A pending row is claimed ('sending') before delivery so two cron runs cannot send it twice; a claim older than ten minutes is reclaimed.
-- dedupe_key makes a scheduled alert once-only: a second insert with the same key is ignored.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id              CHAR(36)     NOT NULL,
  org_id          CHAR(36)     NOT NULL,
  event_name      VARCHAR(80)  NOT NULL,
  payload         JSON         NOT NULL,
  status          ENUM('pending','sending','sent','failed','abandoned') NOT NULL DEFAULT 'pending',
  attempts        INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at      DATETIME     NULL,
  last_error      VARCHAR(500) NULL,
  dedupe_key      VARCHAR(190) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at   DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY notification_outbox_dedupe (dedupe_key),
  KEY notification_outbox_due (status, next_attempt_at),
  CONSTRAINT notification_outbox_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT notification_outbox_payload CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id     CHAR(36)     NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  channel    ENUM('in_app','email','push') NOT NULL,
  status     ENUM('sent','failed','skipped','expired') NOT NULL,
  event_type VARCHAR(40)  NOT NULL,
  detail     VARCHAR(500) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY notification_deliveries_org (org_id, created_at),
  CONSTRAINT notification_deliveries_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT notification_deliveries_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wording overrides: a row for an organisation wins over a platform row (org_id NULL, org_key '-'), which wins over the built-in default.
CREATE TABLE IF NOT EXISTS notification_templates (
  id         CHAR(36)     NOT NULL,
  org_id     CHAR(36)     NULL,
  org_key    CHAR(36)     NOT NULL DEFAULT '-',
  `key`      VARCHAR(60)  NOT NULL,
  channel    ENUM('email','push') NOT NULL DEFAULT 'email',
  subject    VARCHAR(300) NOT NULL,
  body       TEXT         NOT NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY notification_templates_slot (org_key, `key`, channel),
  CONSTRAINT notification_templates_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT notification_templates_org_key CHECK (org_key = IFNULL(org_id, '-'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id             CHAR(36)     NOT NULL,
  org_id         CHAR(36)     NOT NULL,
  author_user_id CHAR(36)     NULL,
  scope          ENUM('org','location','department') NOT NULL DEFAULT 'org',
  location_id    CHAR(36)     NULL,
  department_id  CHAR(36)     NULL,
  title          VARCHAR(200) NOT NULL,
  body           TEXT         NOT NULL,
  urgent         TINYINT(1)   NOT NULL DEFAULT 0,
  published_at   DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY announcements_org_id (org_id, id),
  KEY announcements_feed (org_id, published_at),
  CONSTRAINT announcements_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT announcements_author FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT announcements_location FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
  CONSTRAINT announcements_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id  CHAR(36) NOT NULL,
  staff_profile_id CHAR(36) NOT NULL,
  org_id           CHAR(36) NOT NULL,
  read_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (announcement_id, staff_profile_id),
  CONSTRAINT announcement_reads_announcement FOREIGN KEY (org_id, announcement_id) REFERENCES announcements (org_id, id) ON DELETE CASCADE,
  CONSTRAINT announcement_reads_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per device. The endpoint can be long, so uniqueness is on its hash.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  endpoint      TEXT         NOT NULL,
  endpoint_hash CHAR(64)     NOT NULL,
  p256dh        VARCHAR(200) NOT NULL,
  auth_key      VARCHAR(100) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY push_subscriptions_endpoint (endpoint_hash),
  KEY push_subscriptions_user (user_id),
  CONSTRAINT push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An organisation's own mail account. The password is stored encrypted (AES-256-GCM, key in private config) and never returned.
CREATE TABLE IF NOT EXISTS org_smtp_settings (
  org_id       CHAR(36)     NOT NULL,
  smtp_host    VARCHAR(255) NOT NULL,
  smtp_port    INT UNSIGNED NOT NULL DEFAULT 587,
  smtp_user    VARCHAR(255) NOT NULL,
  smtp_pass_enc TEXT        NOT NULL,
  from_email   VARCHAR(255) NOT NULL,
  from_name    VARCHAR(200) NULL,
  verified_at  DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id),
  CONSTRAINT org_smtp_settings_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only the SHA-256 of a feed token is stored. A person has one live token (issuing a new one revokes the old).
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  id               CHAR(36) NOT NULL,
  org_id           CHAR(36) NOT NULL,
  staff_profile_id CHAR(36) NOT NULL,
  token_hash       CHAR(64) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at     DATETIME NULL,
  revoked_at       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY calendar_feed_tokens_hash (token_hash),
  KEY calendar_feed_tokens_staff (org_id, staff_profile_id),
  CONSTRAINT calendar_feed_tokens_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
