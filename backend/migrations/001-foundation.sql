-- 001 foundation: abuse control. Tenant tables arrive from slice S2 onward, one numbered file per change.
-- Dates are UTC. Ids elsewhere are CHAR(36) UUIDs generated in PHP.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       CHAR(64)     NOT NULL,
  window_start INT UNSIGNED NOT NULL,
  hits         INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start),
  KEY rate_limits_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
