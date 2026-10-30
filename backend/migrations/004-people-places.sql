-- 004 people and places: locations, departments, job titles, staff records, site assignment, pay rates,
-- emergency contacts, per-person settings. Composite (org_id, id) foreign keys make a cross-organisation
-- reference impossible in the database, which is what the old same-org triggers did. Parent deletes are
-- RESTRICT because MariaDB cannot SET NULL one column of a composite key; the API clears the references first.
-- Policy -> PHP check -> test: docs/RLS-TO-PHP.md.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS onboarding_completed_at DATETIME NULL;

ALTER TABLE invites ADD COLUMN IF NOT EXISTS department_id CHAR(36) NULL;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS location_id CHAR(36) NULL;

CREATE TABLE IF NOT EXISTS locations (
  id                CHAR(36)     NOT NULL,
  org_id            CHAR(36)     NOT NULL,
  name              VARCHAR(120) NOT NULL,
  address           VARCHAR(300) NULL,
  latitude          DOUBLE       NULL,
  longitude         DOUBLE       NULL,
  timezone          VARCHAR(64)  NOT NULL DEFAULT 'Europe/London',
  geofence_radius_m INT UNSIGNED NOT NULL DEFAULT 150,
  location_type     ENUM('Residential','Dementia care','Domiciliary','Head office') NULL,
  status            ENUM('setup','active','maintenance','inactive') NOT NULL DEFAULT 'setup',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY locations_org_id (org_id, id),
  CONSTRAINT locations_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id          CHAR(36)     NOT NULL,
  org_id      CHAR(36)     NOT NULL,
  location_id CHAR(36)     NULL,
  name        VARCHAR(120) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY departments_org_id (org_id, id),
  KEY departments_location (org_id, location_id),
  CONSTRAINT departments_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT departments_location FOREIGN KEY (org_id, location_id) REFERENCES locations (org_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The organisation's catalogue of occupations. name_normalised is generated so the comparison form cannot drift.
-- Two ACTIVE titles cannot share a colour; archiving releases it (active_colour is NULL once archived).
CREATE TABLE IF NOT EXISTS job_titles (
  id              CHAR(36)     NOT NULL,
  org_id          CHAR(36)     NOT NULL,
  name            VARCHAR(80)  NOT NULL,
  name_normalised VARCHAR(80)  AS (LOWER(TRIM(name))) PERSISTENT,
  colour          VARCHAR(16)  NULL,
  active          TINYINT(1)   NOT NULL DEFAULT 1,
  active_colour   VARCHAR(16)  AS (IF(active = 1, colour, NULL)) PERSISTENT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY job_titles_org_id (org_id, id),
  UNIQUE KEY job_titles_name (org_id, name_normalised),
  UNIQUE KEY job_titles_colour (org_id, active_colour),
  CONSTRAINT job_titles_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT job_titles_colour_palette CHECK (colour IS NULL OR colour IN ('indigo','sky','teal','moss','olive','amber','clay','rose','magenta','violet','slate','cocoa'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The employee record. email exists to link user_id to a login once that person signs in. payroll_id never changes once set
-- (except through erasure). Colleagues cannot read payroll_id, start_date, phone, email or holiday_allowance: that is the API's
-- column rule (Staff.php), because there are no column grants here. skills is a JSON array of strings.
CREATE TABLE IF NOT EXISTS staff_profiles (
  id                CHAR(36)     NOT NULL,
  org_id            CHAR(36)     NOT NULL,
  user_id           CHAR(36)     NULL,
  email             VARCHAR(255) NULL,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL DEFAULT '',
  job_title         VARCHAR(80)  NULL,
  job_title_id      CHAR(36)     NULL,
  department_id     CHAR(36)     NULL,
  contract_type     VARCHAR(40)  NULL,
  weekly_hours      DECIMAL(5,2) NULL,
  holiday_allowance DECIMAL(6,2) NULL,
  skills            JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  payroll_id        VARCHAR(60)  NULL,
  start_date        DATE         NULL,
  phone             VARCHAR(40)  NULL,
  photo_url         VARCHAR(500) NULL,
  photo_path        VARCHAR(300) NULL,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY staff_profiles_org_id (org_id, id),
  UNIQUE KEY staff_profiles_org_user (org_id, user_id),
  UNIQUE KEY staff_profiles_org_payroll (org_id, payroll_id),
  KEY staff_profiles_active (org_id, active, first_name),
  KEY staff_profiles_email (org_id, email),
  CONSTRAINT staff_profiles_org FOREIGN KEY (org_id) REFERENCES organisations (id) ON DELETE CASCADE,
  CONSTRAINT staff_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT staff_profiles_department FOREIGN KEY (org_id, department_id) REFERENCES departments (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_profiles_job_title FOREIGN KEY (org_id, job_title_id) REFERENCES job_titles (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_profiles_skills_json CHECK (JSON_VALID(skills))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Somebody who works more than one site. Nothing recorded falls back to the department's site.
CREATE TABLE IF NOT EXISTS staff_locations (
  staff_profile_id CHAR(36) NOT NULL,
  location_id      CHAR(36) NOT NULL,
  org_id           CHAR(36) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_profile_id, location_id),
  CONSTRAINT staff_locations_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE,
  CONSTRAINT staff_locations_location FOREIGN KEY (org_id, location_id) REFERENCES locations (org_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A history, not a value: overwriting a rate rewrites what last quarter cost. Readable by managers and the person themselves only.
CREATE TABLE IF NOT EXISTS staff_pay_rates (
  id                CHAR(36)     NOT NULL,
  org_id            CHAR(36)     NOT NULL,
  staff_profile_id  CHAR(36)     NOT NULL,
  hourly_rate_pence INT UNSIGNED NOT NULL,
  effective_from    DATE         NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY staff_pay_rates_day (staff_profile_id, effective_from),
  CONSTRAINT staff_pay_rates_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NOT NULL,
  staff_profile_id CHAR(36)     NOT NULL,
  name             VARCHAR(120) NOT NULL,
  relationship     VARCHAR(60)  NULL,
  phone            VARCHAR(40)  NOT NULL,
  secondary_phone  VARCHAR(40)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY emergency_contacts_staff (org_id, staff_profile_id),
  CONSTRAINT emergency_contacts_staff FOREIGN KEY (org_id, staff_profile_id) REFERENCES staff_profiles (org_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  user_id          CHAR(36)    NOT NULL,
  theme            ENUM('dark','light') NOT NULL DEFAULT 'dark',
  time_format      ENUM('24h','12h') NOT NULL DEFAULT '24h',
  week_start       ENUM('monday','sunday') NOT NULL DEFAULT 'monday',
  digest_frequency ENUM('immediate','daily','weekly') NOT NULL DEFAULT 'immediate',
  updated_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT app_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
