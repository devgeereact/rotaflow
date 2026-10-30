-- 002 identity and tenancy. MariaDB, utf8mb4, ids CHAR(36) UUIDs generated in PHP, times UTC.
-- Replaces Supabase auth.users + profiles, organisations, memberships, invites, platform_admins,
-- role_delegations and audit_logs. Row-level security is gone: every read and write is a PHP check
-- (Scope.php), and composite (org_id, id) keys make a cross-tenant reference impossible here.
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

-- A person. clerk_user_id is NULL until first sign-in, when a verified email that matches links it.
CREATE TABLE IF NOT EXISTS users (
  id             CHAR(36)     NOT NULL,
  clerk_user_id  VARCHAR(64)  NULL,
  email          VARCHAR(255) NOT NULL,
  full_name      VARCHAR(200) NULL,
  avatar_url     VARCHAR(500) NULL,
  last_seen_at   DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_clerk (clerk_user_id),
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organisations (
  id                     CHAR(36)     NOT NULL,
  name                   VARCHAR(200) NOT NULL,
  slug                   VARCHAR(80)  NOT NULL,
  plan                   ENUM('starter','professional','business','enterprise') NOT NULL DEFAULT 'professional',
  status                 ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  suspended_at           DATETIME     NULL,
  support_access_allowed TINYINT(1)   NOT NULL DEFAULT 0,
  trial_ends_at          DATETIME     NULL,
  settings               JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  created_by             CHAR(36)     NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY organisations_slug (slug),
  CONSTRAINT organisations_settings_json CHECK (JSON_VALID(settings)),
  CONSTRAINT organisations_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS memberships (
  id         CHAR(36)  NOT NULL,
  org_id     CHAR(36)  NOT NULL,
  user_id    CHAR(36)  NOT NULL,
  role       ENUM('owner','manager','staff') NOT NULL,
  status     ENUM('invited','active','suspended') NOT NULL DEFAULT 'active',
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY memberships_org_id (org_id, id),
  UNIQUE KEY memberships_org_user (org_id, user_id),
  KEY memberships_user (user_id),
  CONSTRAINT memberships_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT memberships_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time join links. Only the SHA-256 of the token is stored; the token itself is shown once.
-- 'owner' invites exist for the platform's first-owner bootstrap (S8).
-- pending_email is NULL once accepted or revoked, so "one pending invite per email per org" is a unique key.
CREATE TABLE IF NOT EXISTS invites (
  id            CHAR(36)     NOT NULL,
  org_id        CHAR(36)     NOT NULL,
  email         VARCHAR(255) NOT NULL,
  role          ENUM('owner','manager','staff') NOT NULL,
  token_hash    CHAR(64)     NOT NULL,
  expires_at    DATETIME     NOT NULL,
  accepted_at   DATETIME     NULL,
  revoked_at    DATETIME     NULL,
  invited_by    CHAR(36)     NULL,
  last_sent_at  DATETIME     NULL,
  send_error    VARCHAR(200) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pending_email VARCHAR(255) AS (IF(accepted_at IS NULL AND revoked_at IS NULL, LOWER(email), NULL)) PERSISTENT,
  PRIMARY KEY (id),
  UNIQUE KEY invites_org_id (org_id, id),
  UNIQUE KEY invites_token (token_hash),
  UNIQUE KEY invites_pending (org_id, pending_email),
  CONSTRAINT invites_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT invites_by FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    CHAR(36)    NOT NULL,
  role       ENUM('platform_owner','platform_admin','platform_support','platform_finance') NOT NULL,
  granted_by CHAR(36)    NULL,
  granted_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by CHAR(36)    NULL,
  revoked_at DATETIME    NULL,
  note       VARCHAR(500) NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT platform_admins_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Temporary manager cover. Confers 'manager', never 'owner', and cannot be passed on.
CREATE TABLE IF NOT EXISTS role_delegations (
  id           CHAR(36)     NOT NULL,
  org_id       CHAR(36)     NOT NULL,
  from_user_id CHAR(36)     NOT NULL,
  to_user_id   CHAR(36)     NOT NULL,
  starts_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at      DATETIME     NOT NULL,
  revoked_at   DATETIME     NULL,
  note         VARCHAR(500) NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY role_delegations_lookup (org_id, to_user_id, revoked_at, ends_at),
  CONSTRAINT role_delegations_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT role_delegations_from FOREIGN KEY (from_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT role_delegations_to FOREIGN KEY (to_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only trail. Deliberately NO foreign key to organisations: an audit trail that a tenant deletion
-- erases is not an audit trail, so org_name is copied onto each row. Immutability is enforced in 003.
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id        CHAR(36)     NULL,
  org_name      VARCHAR(200) NULL,
  actor_user_id CHAR(36)     NULL,
  action        VARCHAR(80)  NOT NULL,
  entity_type   VARCHAR(80)  NOT NULL,
  entity_id     CHAR(36)     NULL,
  metadata      JSON         NULL,
  severity      ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  visibility    ENUM('org','platform_only') NOT NULL DEFAULT 'org',
  ip_address    VARCHAR(45)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY audit_logs_org_created (org_id, created_at),
  KEY audit_logs_actor (actor_user_id, created_at),
  CONSTRAINT audit_logs_metadata_json CHECK (metadata IS NULL OR JSON_VALID(metadata))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
