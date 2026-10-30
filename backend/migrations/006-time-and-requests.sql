-- 006 time and requests: clock events and their corrections, leave, overtime, shift swaps, timesheets.
-- Idempotency: client_event_id is minted by the device before the first attempt, so a replayed offline write finds its
-- own earlier row instead of duplicating. A replay answers 200 with already_applied (no database error is parsed).
-- Leave never overlaps for one person: the old exclusion constraint has no MariaDB twin, so Leave.php checks under a lock on the
-- person's staff record. Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

CREATE TABLE IF NOT EXISTS clock_events (
  id                 CHAR(36)      NOT NULL,
  org_id             CHAR(36)      NOT NULL,
  staff_profile_id   CHAR(36)      NOT NULL,
  shift_id           CHAR(36)      NULL,
  type               ENUM('in','out','break_start','break_end') NOT NULL,
  event_at           DATETIME(3)   NOT NULL,
  event_at_reported  DATETIME(3)   NULL,
  latitude           DOUBLE        NULL,
  longitude          DOUBLE        NULL,
  accuracy           DOUBLE        NULL,
  method             ENUM('gps','qr','manual') NOT NULL DEFAULT 'manual',
  location_name      VARCHAR(200)  NULL,
  synced             TINYINT(1)    NOT NULL DEFAULT 1,
  client_event_id    CHAR(36)      NULL,
  created_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY clock_events_org_id (org_id, id),
  UNIQUE KEY clock_events_client_event (client_event_id),
  KEY clock_events_staff_time (org_id, staff_profile_id, event_at),
  KEY clock_events_org_time (org_id, event_at),
  CONSTRAINT clock_events_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT clock_events_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT clock_events_shift FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A correction keeps what the record said before and after, who changed it and why. Append-only (triggers below).
CREATE TABLE IF NOT EXISTS clock_event_corrections (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NOT NULL,
  clock_event_id   CHAR(36)     NOT NULL,
  staff_profile_id CHAR(36)     NOT NULL,
  actor_user_id    CHAR(36)     NULL,
  actor_name       VARCHAR(200) NULL,
  reason           VARCHAR(500) NOT NULL,
  before_value     JSON         NOT NULL,
  after_value      JSON         NOT NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY clock_event_corrections_event (org_id, clock_event_id, created_at),
  KEY clock_event_corrections_staff (org_id, staff_profile_id, created_at),
  CONSTRAINT clock_event_corrections_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT clock_event_corrections_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 3 AND 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER clock_event_corrections_no_update BEFORE UPDATE ON clock_event_corrections FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'clock_event_corrections is append-only';
CREATE TRIGGER clock_event_corrections_no_delete BEFORE DELETE ON clock_event_corrections FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'clock_event_corrections is append-only';

CREATE TABLE IF NOT EXISTS leave_requests (
  id               CHAR(36)      NOT NULL,
  org_id           CHAR(36)      NOT NULL,
  staff_profile_id CHAR(36)      NOT NULL,
  type             VARCHAR(40)   NOT NULL DEFAULT 'holiday',
  start_date       DATE          NOT NULL,
  end_date         DATE          NOT NULL,
  starts_half      TINYINT(1)    NOT NULL DEFAULT 0,
  ends_half        TINYINT(1)    NOT NULL DEFAULT 0,
  status           ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  reason           VARCHAR(1000) NULL,
  reviewed_by      CHAR(36)      NULL,
  reviewed_at      DATETIME      NULL,
  client_event_id  CHAR(36)      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY leave_requests_client_event (client_event_id),
  KEY leave_requests_staff (org_id, staff_profile_id, start_date),
  KEY leave_requests_status (org_id, status, start_date),
  CONSTRAINT leave_requests_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT leave_requests_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT leave_requests_range_valid CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overtime_requests (
  id               CHAR(36)      NOT NULL,
  org_id           CHAR(36)      NOT NULL,
  staff_profile_id CHAR(36)      NOT NULL,
  date             DATE          NOT NULL,
  hours            DECIMAL(5,2)  NOT NULL,
  status           ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  note             VARCHAR(1000) NULL,
  reviewed_by      CHAR(36)      NULL,
  reviewed_at      DATETIME      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY overtime_requests_staff (org_id, staff_profile_id, date),
  KEY overtime_requests_status (org_id, status, date),
  CONSTRAINT overtime_requests_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT overtime_requests_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT overtime_requests_hours CHECK (hours > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A swap offers one of the requester's shifts to a named colleague, or (no target) to the open board. Approving it moves the shift.
CREATE TABLE IF NOT EXISTS shift_swaps (
  id                            CHAR(36)    NOT NULL,
  org_id                        CHAR(36)    NOT NULL,
  shift_id                      CHAR(36)    NOT NULL,
  requested_by                  CHAR(36)    NOT NULL,
  target_staff_profile_id       CHAR(36)    NULL,
  status                        ENUM('pending','accepted','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  note                          VARCHAR(1000) NULL,
  reviewed_by                   CHAR(36)    NULL,
  reviewed_at                   DATETIME    NULL,
  applied_at                    DATETIME    NULL,
  applied_shift_id              CHAR(36)    NULL,
  applied_from_staff_profile_id CHAR(36)    NULL,
  client_event_id               CHAR(36)    NULL,
  created_at                    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY shift_swaps_client_event (client_event_id),
  KEY shift_swaps_status (org_id, status),
  KEY shift_swaps_requester (org_id, requested_by),
  KEY shift_swaps_target (org_id, target_staff_profile_id),
  CONSTRAINT shift_swaps_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT shift_swaps_shift FOREIGN KEY (org_id, shift_id) REFERENCES shifts (org_id, id) ON DELETE CASCADE,
  CONSTRAINT shift_swaps_requester FOREIGN KEY (org_id, requested_by) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT shift_swaps_target FOREIGN KEY (org_id, target_staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One decision per person per period. recalculation_required_at is set when a clock event inside an approved period is corrected.
CREATE TABLE IF NOT EXISTS timesheets (
  id                        CHAR(36)     NOT NULL,
  org_id                    CHAR(36)     NOT NULL,
  staff_profile_id          CHAR(36)     NOT NULL,
  period_start              DATE         NOT NULL,
  period_end                DATE         NOT NULL,
  total_minutes             INT UNSIGNED NOT NULL DEFAULT 0,
  status                    ENUM('open','submitted','approved','exported') NOT NULL DEFAULT 'open',
  approved_by               CHAR(36)     NULL,
  approved_at               DATETIME     NULL,
  version                   INT UNSIGNED NOT NULL DEFAULT 0,
  recalculation_required_at DATETIME     NULL,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY timesheets_period (org_id, staff_profile_id, period_start, period_end),
  KEY timesheets_status (org_id, status, period_start),
  CONSTRAINT timesheets_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT timesheets_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT timesheets_period_order CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
