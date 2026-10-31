-- 017 cover (R2 slice S12): absence reports, cover requests and cover applications, and swaps that void themselves when their shift changes.
-- Ported from SiteRelay's 030-cover and re-made for RotaFlow's tables: a person is a staff record (staff_profiles), a shift belongs to a rota,
-- and "publishing one shift" is a write to a shift on a PUBLISHED rota (RotaFlow has no separate published projection). RotaFlow's own
-- shift_swaps and open-shift claim stay; SiteRelay's swap table is not copied. Every table carries org_id with same-organisation composite
-- foreign keys. Times are UTC DATETIME. open_shift_id equals shift_id while the record is open and NULL once closed, so a unique key allows
-- at most ONE open absence report and ONE open cover request per shift. Policy -> PHP check -> test: docs/RLS-TO-PHP.md.
--
-- The module ships dark: while the cover_tools flag is off every /cover route answers 403 feature_off, and open-shift claims, swaps and leave
-- behave exactly as before.

CREATE TABLE IF NOT EXISTS cover_absences (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NOT NULL,
  shift_id         CHAR(36)     NOT NULL,
  staff_profile_id CHAR(36)     NOT NULL,
  reason           VARCHAR(500) NOT NULL,
  status           ENUM('open','covered','dismissed','withdrawn') NOT NULL DEFAULT 'open',
  open_shift_id    CHAR(36)     NULL,
  resolved_by      CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at      DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cover_absences_org_id (org_id, id),
  UNIQUE KEY cover_absences_one_open (org_id, open_shift_id),
  KEY cover_absences_person (org_id, staff_profile_id, created_at),
  KEY cover_absences_shift (org_id, shift_id),
  CONSTRAINT cover_absences_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT cover_absences_shift FOREIGN KEY (org_id, shift_id) REFERENCES shifts (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_absences_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_absences_resolver FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT cover_absences_open CHECK (open_shift_id IS NULL OR (status = 'open' AND open_shift_id = shift_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cover_requests (
  id                      CHAR(36)     NOT NULL,
  org_id                  CHAR(36)     NOT NULL,
  shift_id                CHAR(36)     NOT NULL,
  absence_id              CHAR(36)     NULL,
  absent_staff_profile_id CHAR(36)     NULL,
  status                  ENUM('open','filled','cancelled') NOT NULL DEFAULT 'open',
  open_shift_id           CHAR(36)     NULL,
  note                    VARCHAR(500) NULL,
  respond_by              DATETIME     NULL,
  offered_count           INT UNSIGNED NOT NULL DEFAULT 0,
  filled_staff_profile_id CHAR(36)     NULL,
  created_by              CHAR(36)     NULL,
  closed_by               CHAR(36)     NULL,
  close_reason            VARCHAR(40)  NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at               DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cover_requests_org_id (org_id, id),
  UNIQUE KEY cover_requests_one_open (org_id, open_shift_id),
  KEY cover_requests_status (org_id, status, created_at),
  KEY cover_requests_shift (org_id, shift_id),
  CONSTRAINT cover_requests_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT cover_requests_shift FOREIGN KEY (org_id, shift_id) REFERENCES shifts (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_requests_absence FOREIGN KEY (org_id, absence_id) REFERENCES cover_absences (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_requests_absent FOREIGN KEY (org_id, absent_staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_requests_filled FOREIGN KEY (org_id, filled_staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_requests_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT cover_requests_closer FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT cover_requests_open CHECK (open_shift_id IS NULL OR (status = 'open' AND open_shift_id = shift_id))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One application row per person per shift (applying again after withdrawing reuses the row).
CREATE TABLE IF NOT EXISTS cover_applications (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NOT NULL,
  shift_id         CHAR(36)     NOT NULL,
  staff_profile_id CHAR(36)     NOT NULL,
  cover_request_id CHAR(36)     NULL,
  status           ENUM('pending','withdrawn','approved','rejected') NOT NULL DEFAULT 'pending',
  note             VARCHAR(300) NULL,
  decided_by       CHAR(36)     NULL,
  decided_at       DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY cover_applications_org_id (org_id, id),
  UNIQUE KEY cover_applications_one_each (org_id, shift_id, staff_profile_id),
  KEY cover_applications_person (org_id, staff_profile_id, status),
  KEY cover_applications_status (org_id, status),
  CONSTRAINT cover_applications_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT cover_applications_shift FOREIGN KEY (org_id, shift_id) REFERENCES shifts (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_applications_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_applications_request FOREIGN KEY (org_id, cover_request_id) REFERENCES cover_requests (org_id, id) ON DELETE CASCADE,
  CONSTRAINT cover_applications_decider FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A swap remembers what its shift looked like when it was raised (a hash of times, site, holder, status and rota). With the module on, a
-- later change to any of them, a cancelled shift, an archived rota or a started shift cancels the swap (status 'cancelled', void_reason set).
-- The fingerprint is recorded on every new swap (it never leaves the server) but only read while the module is on, so turning the flag on
-- later still protects swaps raised before; a swap raised before this migration has none and is judged on the rest.
ALTER TABLE shift_swaps ADD COLUMN IF NOT EXISTS shift_fingerprint CHAR(64) CHARACTER SET ascii NULL AFTER applied_from_staff_profile_id;
ALTER TABLE shift_swaps ADD COLUMN IF NOT EXISTS void_reason VARCHAR(40) NULL AFTER shift_fingerprint;

INSERT IGNORE INTO feature_flags (flag_key, name, description, enabled, rollout, critical, target_plans) VALUES
  ('cover_tools', 'Cover', 'Absence reports, cover requests and applications with eligibility, the cover board, eligibility on the instant open-shift claim, and swaps that cancel themselves when their shift changes. Off until the platform turns it on.', 0, 0, 0, JSON_ARRAY());
