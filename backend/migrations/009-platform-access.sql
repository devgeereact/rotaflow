-- 009 platform access: platform settings, and support access sessions (platform staff entering a customer's data, with the customer's consent).
-- A session is only worth anything while ALL of these hold, re-read on every request (Scope::supportAccess): it is not revoked, not expired,
-- the organisation still allows support access (organisations.support_access_allowed), and the person is still platform staff.
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

CREATE TABLE IF NOT EXISTS platform_settings (
  id                   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  platform_name        VARCHAR(100) NOT NULL DEFAULT 'RotaFlow',
  support_email        VARCHAR(255) NOT NULL DEFAULT 'support@rotaflow.space',
  platform_url         VARCHAR(255) NOT NULL DEFAULT 'https://rotaflow.space',
  default_timezone     VARCHAR(64)  NOT NULL DEFAULT 'Europe/London',
  registration_enabled TINYINT(1)   NOT NULL DEFAULT 1,
  maintenance_mode     TINYINT(1)   NOT NULL DEFAULT 0,
  maintenance_message  VARCHAR(1000) NULL,
  updated_by           CHAR(36)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT platform_settings_singleton CHECK (id = 1),
  CONSTRAINT platform_settings_updater FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO platform_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS support_access_sessions (
  id            CHAR(36)     NOT NULL,
  org_id        CHAR(36)     NOT NULL,
  admin_user_id CHAR(36)     NOT NULL,
  reason        VARCHAR(1000) NOT NULL,
  case_ref      VARCHAR(100) NOT NULL,
  scope         ENUM('read','read_write') NOT NULL DEFAULT 'read',
  granted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME     NOT NULL,
  revoked_at    DATETIME     NULL,
  revoked_by    CHAR(36)     NULL,
  revoke_reason VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  KEY support_sessions_lookup (admin_user_id, org_id, revoked_at, expires_at),
  KEY support_sessions_org (org_id, granted_at),
  CONSTRAINT support_sessions_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT support_sessions_admin FOREIGN KEY (admin_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT support_sessions_revoker FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT support_sessions_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 15),
  CONSTRAINT support_sessions_case CHECK (CHAR_LENGTH(TRIM(case_ref)) >= 3),
  CONSTRAINT support_sessions_expiry CHECK (expires_at > granted_at),
  CONSTRAINT support_sessions_revoked CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
