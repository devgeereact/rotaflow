-- 005 the rota: shift types, rotas (draft, published, archived; an amendment is a draft that supersedes a published rota),
-- shifts, availability and minimum cover. Times are UTC DATETIME; the API accepts and returns ISO 8601 with an offset.
-- A published or archived rota is immutable: that rule lives in Rotas.php / Shifts.php (the Postgres triggers are gone).
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

CREATE TABLE IF NOT EXISTS shift_types (
  id            CHAR(36)     NOT NULL,
  org_id        CHAR(36)     NOT NULL,
  name          VARCHAR(80)  NOT NULL,
  colour        VARCHAR(20)  NOT NULL DEFAULT '#2563eb',
  default_start TIME         NULL,
  default_end   TIME         NULL,
  is_paid       TINYINT(1)   NOT NULL DEFAULT 1,
  category      VARCHAR(40)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY shift_types_org_id (org_id, id),
  CONSTRAINT shift_types_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One draft and one published rota per organisation, site and period (NULL site = the whole organisation).
-- site_key is the site id, or '-' for the whole organisation (a CHECK keeps it honest; a NULL cannot sit in a unique key).
-- The generated is_draft / is_published columns are NULL for other statuses and NULLs never collide, so these are plain unique keys.
CREATE TABLE IF NOT EXISTS rotas (
  id                 CHAR(36)     NOT NULL,
  org_id             CHAR(36)     NOT NULL,
  location_id        CHAR(36)     NULL,
  name               VARCHAR(120) NOT NULL,
  period_start       DATE         NOT NULL,
  period_end         DATE         NOT NULL,
  status             ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  published_at       DATETIME     NULL,
  published_by       CHAR(36)     NULL,
  archived_at        DATETIME     NULL,
  supersedes_rota_id CHAR(36)     NULL,
  created_by         CHAR(36)     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  site_key           CHAR(36)     NOT NULL DEFAULT '-',
  is_draft           TINYINT      AS (IF(status = 'draft', 1, NULL)) PERSISTENT,
  is_published       TINYINT      AS (IF(status = 'published', 1, NULL)) PERSISTENT,
  PRIMARY KEY (id),
  UNIQUE KEY rotas_org_id (org_id, id),
  UNIQUE KEY rotas_one_draft (org_id, site_key, period_start, period_end, is_draft),
  UNIQUE KEY rotas_one_published (org_id, site_key, period_start, period_end, is_published),
  KEY rotas_period (org_id, period_start, period_end),
  KEY rotas_supersedes (supersedes_rota_id),
  CONSTRAINT rotas_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT rotas_location FOREIGN KEY (org_id, location_id) REFERENCES locations (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT rotas_period_order CHECK (period_end >= period_start),
  CONSTRAINT rotas_site_key CHECK (site_key = IFNULL(location_id, '-'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- rota_id may be NULL: a loose shift (an open shift, an ad hoc cover shift) belongs to no rota and every member can read it.
CREATE TABLE IF NOT EXISTS shifts (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NOT NULL,
  rota_id          CHAR(36)     NULL,
  location_id      CHAR(36)     NULL,
  department_id    CHAR(36)     NULL,
  staff_profile_id CHAR(36)     NULL,
  shift_type_id    CHAR(36)     NULL,
  starts_at        DATETIME     NOT NULL,
  ends_at          DATETIME     NOT NULL,
  break_minutes    INT UNSIGNED NOT NULL DEFAULT 0,
  status           ENUM('open','assigned','confirmed','cancelled') NOT NULL DEFAULT 'open',
  colour           VARCHAR(20)  NULL,
  notes            VARCHAR(1000) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY shifts_org_id (org_id, id),
  KEY shifts_by_rota (rota_id, starts_at),
  KEY shifts_org_start (org_id, starts_at),
  KEY shifts_by_staff (org_id, staff_profile_id, starts_at),
  CONSTRAINT shifts_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT shifts_rota FOREIGN KEY (org_id, rota_id) REFERENCES rotas (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_location FOREIGN KEY (org_id, location_id) REFERENCES locations (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_department FOREIGN KEY (org_id, department_id) REFERENCES departments (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_type FOREIGN KEY (org_id, shift_type_id) REFERENCES shift_types (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_time_order CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A person's availability: a weekday pattern (weekday 0=Sunday .. 6=Saturday) or one date.
CREATE TABLE IF NOT EXISTS availability (
  id               CHAR(36)   NOT NULL,
  org_id           CHAR(36)   NOT NULL,
  staff_profile_id CHAR(36)   NOT NULL,
  weekday          TINYINT UNSIGNED NULL,
  date             DATE       NULL,
  start_time       TIME       NULL,
  end_time         TIME       NULL,
  status           ENUM('available','unavailable','preferred') NOT NULL DEFAULT 'available',
  recurring        TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY availability_by_staff (org_id, staff_profile_id),
  CONSTRAINT availability_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT availability_weekday CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One site's staffing minimum for one day of the week. Publishing a rota refuses a future day that falls short.
CREATE TABLE IF NOT EXISTS minimum_cover_rules (
  id          CHAR(36)     NOT NULL,
  org_id      CHAR(36)     NOT NULL,
  location_id CHAR(36)     NOT NULL,
  weekday     TINYINT UNSIGNED NOT NULL,
  min_staff   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY minimum_cover_site_day (location_id, weekday),
  KEY minimum_cover_org (org_id),
  CONSTRAINT minimum_cover_location FOREIGN KEY (org_id, location_id) REFERENCES locations (org_id, id) ON DELETE CASCADE,
  CONSTRAINT minimum_cover_weekday CHECK (weekday BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
