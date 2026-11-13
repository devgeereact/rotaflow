# MariaDB data model. RotaFlow

The live schema is the files `backend/migrations/001-foundation.sql` to `backend/migrations/020-timesheet-reopenings.sql`: 19 migration files, 69 tables, on MariaDB behind the PHP API.
This document is read from those files and from `backend/src`; where it says a rule is "in PHP" the module is named.
It replaces the earlier description of the retired Postgres schema, which is kept in git (section 10).

RotaFlow is **multi-tenant on one database**: every domain table carries an `org_id` and every request is checked
against the caller's membership in PHP (`backend/src/Scope.php`). Row-level security is retired with the old stack (MariaDB has none), so the database
is a second line of defence only through composite foreign keys, unique keys, CHECK constraints and four triggers
(section 4). The first line is the PHP check (section 5).

## 1. Overview

### Engine and connection

- **Engine and character set.** Every `CREATE TABLE` in `backend/migrations` ends `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.
  The connection string comes from private configuration outside the web root; `backend/private/config.example.php`
  shows the shape (a `mysql:` DSN with `charset=utf8mb4`, user and password).
- **Connection settings.** `backend/src/Db.php` opens PDO with exceptions on errors, associative fetches and real
  prepared statements (`ATTR_EMULATE_PREPARES` off), then runs `SET time_zone = '+00:00'` and
  `sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'`. Strict mode is why an ENUM column refuses a value outside its list.
- **Server version.** A comment in `scripts/datamove-test.sh` states that the live host runs MariaDB 11.4.13. Nothing in the
  repository proves the version today: `NOT VERIFIED` (server state). The local test database is a throwaway server started by `scripts/test-db.sh`.
- **Identifiers and time.** Ids are `CHAR(36)` UUID v4 strings generated in PHP (`Db::uuid`). Three log tables use a
  `BIGINT UNSIGNED` auto-increment id instead: `audit_logs`, `notification_deliveries`, `retention_runs`. All times are UTC (`DATETIME`;
  `DATETIME(3)` on clock events and corrections). Booleans are `TINYINT(1)`. JSON columns are `JSON` with a `JSON_VALID` CHECK where the migration adds one.

### Counts, and the commands that give them

```bash
ls backend/migrations | wc -l      # 19 files, numbered 001 to 020 (there is no 012)
grep -hoE 'CREATE TABLE( IF NOT EXISTS)? `?[a-z_0-9]+' backend/migrations/*.sql | sed -E 's/.* `?//' | sort -u | wc -l   # 69
```

- **19 migrations, 69 tables.** There is no 012 file (the numbering skips from 011 to 013); `020-timesheet-reopenings.sql`
  is the last file and adds one table, `timesheet_reopenings`. `schema_migrations` is created by `backend/bin/migrate.php`
  itself and is not among the 69.
- **Tenant columns.** Of the 69 tables, 48 carry an `org_id` column (five of those allow it to be NULL) and 21 do not. The 21 are the tenant
  root `organisations`, per-person tables (such as `users` and `app_settings`) and platform-wide tables (such as `incidents` and `feature_flags`); the `org_id` column of
  the table in section 3 says which is which.
- **Legacy tree.** `supabase/migrations` (164 files) is the retired Postgres schema. It is kept only as the source of the
  data move until a later phase removes it (until Phase 6). Two checks still read it, not `backend/migrations`: `scripts/check-migration-safety.mjs`
  (`pnpm run check:migrations`) and `scripts/check-export-coverage.mjs` (`pnpm run check:export`).

## 2. Tenancy and roles

```text
users ──< memberships >── organisations (the tenant root)
  │            role: owner | manager | staff        status: invited | active | suspended
  └── platform_admins   (a platform role, separate from any membership)

organisations
  ├── locations ── departments ── job_titles
  ├── staff_profiles ── staff_locations · staff_pay_rates · emergency_contacts · availability · documents
  ├── shift_types · rotas ── shifts · minimum_cover_rules
  ├── clock_events (+ corrections) · leave_requests · overtime_requests · shift_swaps · timesheets
  ├── cover_absences · cover_requests · cover_applications
  ├── announcements · notifications · notification_outbox · notification_templates
  ├── invites · role_delegations · subscriptions · invoices · support_access_sessions
  └── audit_logs   (carries org_id, deliberately has no foreign key to organisations)
```

- **A row belongs to an organisation through `org_id`.** The tables with and without it are marked in section 3.
  Where a migration links two tenant tables it uses a **composite foreign key** on (`org_id`, `id`), so the database refuses a row that
  points into another organisation (`backend/migrations/002-identity.sql` header). Section 4 lists the single-column exceptions; some id
  columns carry no foreign key at all (for example `invites.department_id`, added by `backend/migrations/004-people-places.sql`).
- **Roles in an organisation** are the `memberships.role` ENUM: `owner`, `manager`, `staff`
  (`backend/migrations/002-identity.sql`). A person can hold a membership in several organisations. No column narrows a membership to a site.
- **Platform roles** are the `platform_admins.role` ENUM: `platform_owner`, `platform_admin`, `platform_support`, `platform_finance`
  (`backend/migrations/002-identity.sql`); a revoked row is kept with `revoked_at`. A platform role is held separately from any membership; `Scope::platformRole` reads it (`backend/src/Scope.php`).
- **Support access.** A platform administrator enters a customer organisation only through a `support_access_sessions` row
  (`backend/migrations/009-platform-access.sql`). `Scope::membership` lets them in as a `support` member with a manager's reach and never an owner's,
  only while the session is not revoked and not expired, the organisation still has `support_access_allowed` on, and the person's platform role is
  owner, admin or support (not finance). A `read` session refuses every write.
- **Delegation.** A staff member with a live `role_delegations` row (inside its window, lender still an active owner or manager) has an
  effective role of manager, never owner (`Scope::hasLiveDelegation`, `Scope::requireReal` for acts a delegate must not perform).
- **Organisation status.** `Scope::membership` ignores an archived organisation, and `Scope::requireWritable` refuses writes while an
  organisation is not `active` (suspended).
- **Creating an organisation.** `Ctx` carries `orgCreation`: `invite_only` (default; only a platform administrator creates one, by inviting the first
  owner) or `open` (`backend/src/Ctx.php`). The setting is the private configuration key `org_creation` (`backend/private/config.example.php`, read in `backend/public/api/index.php`; enforced in `backend/src/Mod/Orgs.php`, which lets a platform owner or admin through); its live value is `NOT VERIFIED`.
- **What a non-member sees.** An unknown or malformed organisation id, and a signed-in person who is not a member, get **404**, so ids cannot be
  probed; a member with the wrong role gets **403** (`backend/src/Scope.php`).
- **Row-level security is retired.** MariaDB has none. The former policies are mapped to PHP checks, with the test that proves each, in
  `docs/RLS-TO-PHP.md` (the record of the retired policies; its own status line currently reads PARTIAL). The live guard is the PHP check plus the access sweep suite (section 5).

## 3. Table inventory

All 69 tables, in migration order. **Written by** names the classes whose SQL inserts, updates or deletes the table, found with a search of
`backend/src` and `backend/bin` (a class `Mod\Staff` is `backend/src/Mod/Staff.php`; a class without `Mod\` such as `Dispatcher` is `backend/src/Dispatcher.php`).
Retention and organisation deletion also delete rows in several tables; they are described in sections 4 and 6. **Purpose** is taken from the migration comments and
column names. The `org_id` column reads `yes` (NOT NULL), `nullable`, `root` (the tenant root itself) or `no`.

### `backend/migrations/001-foundation.sql`

Abuse control only.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `rate_limits` | Fixed-window request counters behind `RateLimiter` (`hit(name, subject, limit, windowSeconds)`). | no | PK (`bucket`, `window_start`); index on `window_start`. | `RateLimiter` |

### `backend/migrations/002-identity.sql`

Identity and tenancy. Row-level security is retired; every read and write is a PHP check (`backend/src/Scope.php`) and composite (`org_id`, `id`) keys make a cross-organisation reference impossible in the database.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `users` | A person. `clerk_user_id` stays NULL until first sign-in, when a verified email that matches links it (`Users`). Replaces the retired auth user and profile pair. | no | Unique `clerk_user_id`; unique `email`. | `backend/bin/grant-platform-owner.php`, `Mod\Account`, `Mod\Gdpr`, `Users` |
| `organisations` | The tenant root: name, slug, `plan`, `status` (`active`, `suspended`, `archived`), `support_access_allowed`, `trial_ends_at`, `settings` JSON. Migration 004 adds `onboarding_completed_at`; 008 adds `industry`, `country`, `timezone`, `contact_email`, `contact_phone`, `suspended_reason`. | root | Unique `slug`; CHECK `settings` is valid JSON; `created_by` to `users` SET NULL. | `Billing`, `Mod\Account`, `Mod\Console`, `Mod\Lifecycle`, `Mod\OrgSettings`, `Mod\Orgs`, `Mod\Platform` |
| `memberships` | Who belongs to which organisation, as `owner`, `manager` or `staff`. `status` is `invited`, `active` or `suspended`; `Scope::membership` honours only `active`. | yes | Unique (`org_id`, `user_id`); unique (`org_id`, `id`); cascade from organisation and user. | `Mod\Invites`, `Mod\Orgs` |
| `invites` | One-time join links; only the SHA-256 of the token is stored. Migration 004 adds `department_id` and `location_id` (plain columns, no foreign key). | yes | Unique `token_hash`; generated `pending_email` makes unique (`org_id`, `pending_email`) mean one pending invite per email per organisation. | `Mod\Invites`, `Mod\Platform` |
| `platform_admins` | Platform staff: `platform_owner`, `platform_admin`, `platform_support`, `platform_finance`. A revoked row is kept with `revoked_at`. | no | PK `user_id`; cascade from `users`. | `backend/bin/grant-platform-owner.php`, `Mod\Console` |
| `role_delegations` | Temporary manager cover lent by one person to another. Confers manager, never owner, and cannot be passed on. | yes | Index (`org_id`, `to_user_id`, `revoked_at`, `ends_at`); cascades from organisation and both users. | `Mod\Orgs` |
| `audit_logs` | The append-only trail: actor, `action`, entity, JSON `metadata`, `severity` (`info`, `warning`, `critical`), `visibility` (`org`, `platform_only`), IP. The organisation name is copied onto each row. | nullable | No foreign key to `organisations`, on purpose. Update and delete refused by two triggers (`003-audit-immutable.sql`). `BIGINT` auto-increment id; CHECK `metadata` is valid JSON. | `Audit` |

### `backend/migrations/003-audit-immutable.sql`

No tables. Two triggers make `audit_logs` append-only; the migration user needs the TRIGGER privilege.

### `backend/migrations/004-people-places.sql`

People and places. Also adds `organisations.onboarding_completed_at` and `invites.department_id`, `invites.location_id`. Parent deletes are RESTRICT because MariaDB cannot SET NULL one column of a composite key; the API clears the references first.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `locations` | Sites, with address, coordinates, time zone (default `Europe/London`), `geofence_radius_m` (default 150), `location_type`, `status` (`setup`, `active`, `maintenance`, `inactive`). | yes | Unique (`org_id`, `id`); cascade from organisation. | `Mod\Places` |
| `departments` | A department, optionally at a site. | yes | Composite FK to `locations` RESTRICT; unique (`org_id`, `id`). | `Mod\Places` |
| `job_titles` | The organisation's catalogue of occupations, each with a palette colour. | yes | Generated `name_normalised` unique per organisation; generated `active_colour` unique per organisation, so two active titles cannot share a colour; CHECK colour is one of twelve palette names. | `Mod\Staff` |
| `staff_profiles` | The employee record. `user_id` stays NULL until that person signs in (`email` links it). Colleagues cannot read `payroll_id`, `start_date`, `phone`, `email` or `holiday_allowance`: that is a column rule in `Mod\Staff`, because MariaDB has no column grants here (migration comment). | yes | Unique (`org_id`, `user_id`); unique (`org_id`, `payroll_id`); composite FKs to `departments` and `job_titles` RESTRICT; `user_id` SET NULL; `skills` JSON array. | `Mod\Gdpr`, `Mod\Photos`, `Mod\Places`, `Mod\Staff` |
| `staff_locations` | Extra sites for a person who works more than one; none recorded falls back to the department's site. | yes | PK (`staff_profile_id`, `location_id`); composite FKs cascade. | `Mod\Staff` |
| `staff_pay_rates` | Pay-rate history (`hourly_rate_pence` from `effective_from`), a history rather than a value. | yes | Unique (`staff_profile_id`, `effective_from`); composite FK to `staff_profiles` cascade. | `Mod\Staff` |
| `emergency_contacts` | Emergency contacts for a staff record. | yes | Composite FK to `staff_profiles` cascade. | `Mod\Gdpr`, `Mod\Staff` |
| `app_settings` | Per-user preferences: `theme` (`dark`, `light`; column default `dark`), `time_format`, `week_start`, `digest_frequency`, and (migration 007) `notifications_enabled`. An absent row reads as enabled (`Dispatcher`). | no | PK `user_id`; cascade from `users`. | `Mod\Account` |

### `backend/migrations/005-rota.sql`

The rota. Times are UTC `DATETIME`. A published or archived rota is immutable, enforced in `backend/src/Mod/Rotas.php` and `backend/src/Mod/Shifts.php`, not in the database.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `shift_types` | Shift kinds: name, colour, default start and end, `is_paid`, `category`. | yes | Unique (`org_id`, `id`); cascade from organisation. | `Mod\Planning` |
| `rotas` | A schedule for a period and optional site: `draft`, `published`, `archived`. An amendment is a draft with `supersedes_rota_id`. | yes | Generated `site_key`, `is_draft`, `is_published` feed unique keys `rotas_one_draft` and `rotas_one_published` (one draft and one published rota per organisation, site and period); CHECK `period_end >= period_start`; CHECK `site_key` matches `location_id`; composite FK to `locations` RESTRICT. | `Mod\Rotas` |
| `shifts` | The scheduled unit. `rota_id` may be NULL: a loose shift (open shift, ad hoc cover) belongs to no rota. `status` is `open`, `assigned`, `confirmed` or `cancelled`. | yes | CHECK `ends_at > starts_at`; composite FKs to rotas, locations, departments, staff_profiles and shift_types, all RESTRICT; indexes by rota, organisation and staff with `starts_at`. | `Mod\Cover`, `Mod\Rotas`, `Mod\Scheduling`, `Mod\Shifts`, `Mod\Swaps` |
| `availability` | A weekday pattern (0 = Sunday to 6 = Saturday) or one date, with `status` `available`, `unavailable` or `preferred`. | yes | CHECK `weekday` between 0 and 6; composite FK to `staff_profiles` cascade. | `Mod\Planning` |
| `minimum_cover_rules` | One site's staffing minimum for one weekday; publishing a rota refuses a future day that falls short (migration comment). | yes | Unique (`location_id`, `weekday`); CHECK `weekday` between 0 and 6; composite FK to `locations` cascade. | `Mod\Planning` |

### `backend/migrations/006-time-and-requests.sql`

Time and requests. Also creates two triggers that make `clock_event_corrections` append-only. `client_event_id` is minted by the device before the first attempt; a replay answers 200 with `already_applied`.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `clock_events` | Attendance: `in`, `out`, `break_start`, `break_end`, with `method` (`gps`, `qr`, `manual`) and optional coordinates. `event_at_reported` keeps what the device claimed when it differs. `DATETIME(3)` times. | yes | Unique `client_event_id` (a replayed offline write finds its earlier row); `shift_id` to `shifts(id)` is a single-column link, SET NULL; composite FK to `staff_profiles` cascade. | `Mod\Clock` |
| `clock_event_corrections` | A correction to a clock event: before and after values, who changed it and why. | yes | Append-only by two triggers (`006-time-and-requests.sql`); CHECK `reason` is 3 to 500 characters; migration 013 adds a composite cascade FK to `clock_events` so retention and organisation deletion remove corrections with their event. | `Mod\Clock` |
| `leave_requests` | Leave: `type` (default `holiday`), dates, `starts_half`, `ends_half`, `status` (`pending`, `approved`, `rejected`, `cancelled`), review fields, `client_event_id`. | yes | Unique `client_event_id`; CHECK `end_date >= start_date`. No overlap constraint exists: `Mod\Leave` checks under a row lock on the person's staff record. | `Mod\Leave` |
| `overtime_requests` | Overtime: `date`, `hours`, `status`, `note`, review fields. | yes | CHECK `hours > 0`; composite FK to `staff_profiles` cascade. | `Mod\Leave` |
| `shift_swaps` | A swap offers a shift to a named colleague or the open board; approving moves the shift. Migration 017 adds `shift_fingerprint` and `void_reason`; 019 adds `take_shift_id` and `take_fingerprint` for two-way swaps. | yes | Unique `client_event_id`; composite FKs to `shifts` (cascade), requester (cascade) and target (RESTRICT); `shift_swaps_take_shift` cascade from `take_shift_id` (019). | `Mod\Swaps` |
| `timesheets` | One decision per person per period: `total_minutes`, `status` (`open`, `submitted`, `approved`, `exported`), `version`, `recalculation_required_at`. | yes | Unique (`org_id`, `staff_profile_id`, `period_start`, `period_end`); CHECK `period_end >= period_start`. | `Mod\Clock`, `Mod\Timesheets` |

### `backend/migrations/007-communication.sql`

Communication. Also adds `app_settings.notifications_enabled`.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `notifications` | The in-app inbox and delivery record: `type`, `title`, `body`, `channel`, `read_at`. `type` is `VARCHAR(40)` with no CHECK or ENUM, so it is free text; `channel` is an ENUM that includes a reserved `sms` value (no SMS sender exists in `backend/src`). | yes | Index (`user_id`, `org_id`, `created_at`); cascade from organisation and user. | `Dispatcher`, `Mod\Notifications` |
| `notification_outbox` | Notifications owed, written in the same transaction as the event. `status` `pending`, `sending`, `sent`, `failed`, `abandoned`; `attempts`, `next_attempt_at`, `claimed_at`. | yes | Unique `dedupe_key` (a scheduled alert is once-only); index (`status`, `next_attempt_at`); CHECK `payload` is valid JSON. | `Dispatcher`, `Notify` |
| `notification_deliveries` | Per recipient and channel: did it go (`sent`, `failed`, `skipped`, `expired`). | yes | `BIGINT` auto-increment id; index (`org_id`, `created_at`). | `Dispatcher` |
| `notification_templates` | Wording overrides: an organisation row wins over a platform row (`org_id` NULL, `org_key` `-`), which wins over the built-in default. | nullable | Unique (`org_key`, `key`, `channel`); CHECK `org_key` matches `org_id`. | `Mod\Templates` |
| `announcements` | Messages from managers: `scope` (`org`, `location`, `department`), `title`, `body`, `urgent`, `published_at`. | yes | `location_id` and `department_id` are single-column links, SET NULL; author SET NULL. | `Mod\Announcements` |
| `announcement_reads` | Read receipts per staff record. | yes | PK (`announcement_id`, `staff_profile_id`); composite FKs cascade. | `Mod\Announcements` |
| `push_subscriptions` | One row per browser device for web push; uniqueness is on the endpoint hash. | no | Unique `endpoint_hash`; cascade from `users`. | `Dispatcher`, `Mod\Notifications` |
| `org_smtp_settings` | An organisation's own mail account. The password is stored encrypted (`smtp_pass_enc`, AES-256-GCM with a key in private config, per the migration comment) and never returned. | yes | PK `org_id`; cascade from organisation. | `Mod\OrgSettings` |
| `calendar_feed_tokens` | Calendar feed tokens; only the SHA-256 of a token is stored. A person has one live token. | yes | Unique `token_hash`; composite FK to `staff_profiles` cascade. | `Mod\CalendarFeed`, `Mod\Gdpr` |

### `backend/migrations/008-billing.sql`

Billing. Also adds six `organisations` columns (`industry`, `country`, `timezone`, `contact_email`, `contact_phone`, `suspended_reason`) and seeds the four `plans` rows. Stripe stays in test mode until the owner switches it (private config `stripe.mode`).

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `plans` | The price list: `monthly_price_pence`, `seat_limit`, `location_limit` (NULL = unlimited), `features` JSON, Stripe price ids. Four rows are seeded by this migration. | no | PK `code`; CHECK `features` is valid JSON. | none in PHP: seeded by `008-billing.sql` and read by `Billing` and `Flags`; the data move carries Stripe price ids over (`DataMove\Map`) |
| `subscriptions` | One subscription per organisation: `plan`, `status` (`trialing`, `active`, `past_due`, `canceled`), `stripe_mode` (`test`, `live`), period and grace dates. | yes | Unique `org_id`; index on `provider_ref`; cascade from organisation. | `Billing` |
| `invoices` | An organisation's billing history: amounts in pence, `status`, dates, Stripe references and hosted-invoice links. | yes | Unique `number`; CHECKs: period and due order, `paid` needs `paid_at`, `refunded` needs `refunded_at`, document links must be Stripe hosts. | `Mod\StripeWebhook` |
| `billing_events` | The Stripe event ledger that makes a webhook idempotent; `processed_at` NULL means not yet done. | nullable | Unique (`provider`, `mode`, `event_id`); `org_id` SET NULL. | `Mod\StripeWebhook` |

### `backend/migrations/009-platform-access.sql`

Platform access. Seeds the single `platform_settings` row.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `platform_settings` | A single row of platform configuration (name, support email, URL, default time zone, `registration_enabled`, `maintenance_mode`). Seeded. | no | CHECK `id = 1`. | `Mod\Console` |
| `support_access_sessions` | Platform staff entering a customer's data: `reason`, `case_ref`, `scope` (`read`, `read_write`), `expires_at`, `revoked_at`. `Scope` re-reads it on every request. | yes | CHECKs: `reason` at least 15 characters, `case_ref` at least 3, expiry after grant; `admin_user_id` RESTRICT; index (`admin_user_id`, `org_id`, `revoked_at`, `expires_at`). | `Mod\Console`, `Mod\Gdpr` |

### `backend/migrations/010-support-desk.sql`

Support desk. Seeds `support_counter` and the four SLA targets.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `support_counter` | A single counter row for support case references (seeded at 4119, so the first is CASE-4120 per the migration comment). | no | CHECK `id = 1`. | `Mod\Support` |
| `support_sla_targets` | Response and resolution promises in wall-clock minutes by priority. Four rows are seeded. | no | PK `priority`; CHECK resolution is not shorter than first response. | `Mod\Support` |
| `support_cases` | A support case: `reference`, requester, `category`, `priority`, `status`, SLA due times, `csat`. `org_id` is SET NULL when an organisation is deleted: the case outlives the tenant. | nullable | Unique `reference`; CHECKs: resolved or closed needs `resolved_at`, `csat` 1 to 5, non-empty subject, email contains `@`. | `Mod\Support` |
| `support_case_messages` | Messages on a case; `author_side` `customer` or `platform`, `is_internal`. | no | Cascade from `support_cases`; CHECK non-empty body. | `Mod\Support` |

### `backend/migrations/011-platform-ops.sql`

Platform operations. Seeds `incident_counter`, the flag `ai_rota_assistant` and its first change-log row. Retired flags and the platform MFA switch are not carried over (the migration points to `docs/RLS-TO-PHP.md`).

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `incident_counter` | A single counter row for incident references (seeded at 137). | no | CHECK `id = 1`. | `Mod\Incidents` |
| `incidents` | The platform status record: `severity`, `status` (`investigating`, `identified`, `monitoring`, `resolved`), `service`, times, `resolution`. | no | Unique `reference`; CHECKs: a resolved incident must have `resolved_at` and a non-empty `resolution`, an open one must have neither; resolved and detected not before start. | `Mod\Incidents` |
| `incident_updates` | The timeline entries on one incident. | no | Cascade from `incidents`; CHECK non-empty body. | `Mod\Incidents` |
| `feature_flags` | Platform feature switches: `enabled`, `rollout` 0 to 100, `critical`, `target_plans` JSON, retirement fields. Flags exist by migration only (no create endpoint). Seeded by 011 (`ai_rota_assistant`, on), 015 (`staff_documents`), 016 (`scheduling_tools`), 017 (`cover_tools`), 018 (`timesheet_tools`), 019 (`two_way_swaps`); all but the first are seeded off. | no | PK `flag_key`; CHECKs: key pattern, rollout 0 to 100, `target_plans` valid JSON. | `Mod\FeatureFlags` |
| `feature_flag_targets` | Organisations a flag is switched on for (pilots). | yes | PK (`flag_key`, `org_id`); `flag_key` link to `feature_flags` is single-column, cascade. | `Mod\FeatureFlags` |
| `feature_flag_changes` | Change log for flags: field, before and after, actor. | no | Cascade from `feature_flags`. | `Mod\FeatureFlags` |
| `enquiries` | Website enquiries; platform-wide on purpose (a prospect belongs to no organisation). The raw address is never kept, only a keyed hash (`ip_hash`). | no | CHECKs on name, email, organisation, message length and `ip_hash` shape; indexes by status and age. | `Mod\Enquiries` |

### `backend/migrations/013-data-lifecycle.sql`

Data lifecycle. Deleting an organisation has no table: it is one transaction in `backend/src/Mod/Lifecycle.php`. Seeds eight `retention_policies` rows and adds a cascade foreign key from `clock_event_corrections` to `clock_events`.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `gdpr_requests` | The data-subject request register: `kind` (access, portability, rectification, erasure, restriction, objection), `status`, `received_on`, `due_on`, `extended_to`, outcome. | nullable | CHECKs: due not before receipt, extension later than due, a completed or refused request needs `closed_at` and `outcome_note`; `org_id` SET NULL. | `Mod\Gdpr` |
| `account_deletions` | A login owed to a completed erasure; holds the Clerk id because the local row goes first. | no | No foreign key to `users`, so the row outlives the account; `gdpr_request_id` SET NULL. | `Mod\Gdpr` |
| `storage_deletions` | A stored file or folder owed a delete (`bucket` `staff-documents` or `staff-photos`, `reason`, `status`, `attempts`). Queued by PHP in the transaction that removes the row. | yes | No foreign key to `organisations`, on purpose; index (`status`, `created_at`). | `Mod\Gdpr`, `Mod\Lifecycle`, `Mod\Photos` |
| `retention_policies` | Retention rules by `data_type` (`retain_months`, `enforced`). Eight rows are seeded. | no | PK `data_type`; CHECK `retain_months` is NULL or positive. | none in PHP: seeded by `013-data-lifecycle.sql`; read by `Retention` and `Mod\Lifecycle` |
| `retention_runs` | One row per retention run per data type: rows removed, cutoff, error. | no | `BIGINT` auto-increment id; index on `ran_at`. | `Retention` |

### `backend/migrations/014-platform-comms.sql`

Platform announcements and invoice credits.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `platform_announcements` | The platform telling organisations something: `kind`, `audience` (`all`, `plans`), `status` (`draft`, `scheduled`, `sent`, `cancelled`), `scheduled_for`. | no | CHECKs: a scheduled row needs `scheduled_for`, a sent row needs `sent_at`, a plans audience needs at least one plan. | `Mod\PlatformAnnouncements` |
| `platform_announcement_deliveries` | One delivery row per organisation per announcement; people are addressed through the notification outbox. | yes | Unique (`announcement_id`, `org_id`); `outbox_id` to `notification_outbox` SET NULL. | `Mod\PlatformAnnouncements` |
| `platform_announcement_optouts` | An organisation that does not want product, billing and policy announcements; maintenance and incident notices ignore it. | yes | PK `org_id`; cascade from organisation. | `Mod\PlatformAnnouncements` |
| `invoice_credits` | A credit recorded against an invoice, in the invoice's currency; it changes nothing else. | yes | Unique (`invoice_id`, `idempotency_key`); CHECKs: amount positive, currency three capitals, reason at least 10 characters; composite FK to `invoices` cascade. | `Mod\PlatformBilling` |

### `backend/migrations/015-compliance.sql`

Compliance. Seeds the flag `staff_documents` (off).

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `document_types` | Per-organisation document types: `requires_expiry`, `default_validity_months`, `required`, `preset_key`, `status` (`active`, `archived`), `version`. | yes | CHECK `default_validity_months` between 1 and 120; unique (`org_id`, `id`). | `Mod\Compliance` |
| `documents` | Staff documents with review: `status` (`uploaded`, `awaiting_review`, `approved`, `rejected`, `withdrawn`, `superseded`; default `approved`), `storage_path` or a legacy `file_url`, `expires_at`, `superseded_by`. | yes | Unique `storage_path`; CHECKs: exactly one of `file_url` and `storage_path`, the path starts with the row's own `org_id/staff_profile_id/`, expiry not before issue; composite FK to `document_types` RESTRICT. | `Mod\Compliance`, `Mod\Gdpr` |
| `document_reminders` | One row per (document, reminder stage) ever sent. | yes | PK (`document_id`, `stage`) makes reminders once-only across cron runs; composite FK to `documents` cascade. | `Mod\Compliance` |

### `backend/migrations/016-scheduling.sql`

No tables. Seeds the flag `scheduling_tools` (off). Its two limits are existing organisation settings (`min_rest_hours`, `max_weekly_hours` in `organisations.settings`; 11 and 48 apply when unset, per the migration comment).

### `backend/migrations/017-cover.sql`

Cover. Also adds `shift_swaps.shift_fingerprint` and `shift_swaps.void_reason`, and seeds the flag `cover_tools` (off).

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `cover_absences` | An absence report on a shift. | yes | `open_shift_id` equals `shift_id` while open and NULL once closed (CHECK), so unique (`org_id`, `open_shift_id`) allows one open report per shift; composite cascades. | `Mod\Cover`, `Mod\Gdpr` |
| `cover_requests` | A request to cover a shift: `status` (`open`, `filled`, `cancelled`), `respond_by`, who filled it, `close_reason`. | yes | Same `open_shift_id` pattern: one open request per shift; composite cascades. | `Mod\Cover` |
| `cover_applications` | A person's application to cover a shift; applying again after withdrawing reuses the row. | yes | Unique (`org_id`, `shift_id`, `staff_profile_id`); composite cascades. | `Mod\Cover`, `Mod\Gdpr` |

### `backend/migrations/018-timesheets.sql`

No tables. Seeds the flag `timesheet_tools` (off). The tolerance is an organisation setting (`timesheet_tolerance_minutes`, default 10 when unset, per the migration comment).

### `backend/migrations/019-two-way-swaps.sql`

No tables. Adds `shift_swaps.take_shift_id`, `shift_swaps.take_fingerprint`, an index and a same-organisation foreign key, and seeds the flag `two_way_swaps` (off).

### `backend/migrations/020-timesheet-reopenings.sql`

Timesheet reopenings. Additive; used only while the `timesheet_tools` flag is on.

| Table | Purpose | `org_id` | Keys and constraints | Written by |
| --- | --- | --- | --- | --- |
| `timesheet_reopenings` | One row per owner reopening of an exported period, with the reason (kept here, not in the audit log). | yes | `timesheet_id` single-column link, cascade; CHECK `reason` is 3 to 500 characters. | `Mod\Timesheets` |

## 4. What the database enforces, and what only PHP enforces

### Triggers

Four triggers exist in `backend/migrations`, and no others (`git grep -n 'CREATE TRIGGER' -- backend/migrations` prints exactly these):

- `audit_logs_no_update` and `audit_logs_no_delete` (`backend/migrations/003-audit-immutable.sql`) refuse any update or delete of `audit_logs`, for every user including the runtime one.
- `clock_event_corrections_no_update` and `clock_event_corrections_no_delete` (`backend/migrations/006-time-and-requests.sql`) do the same for `clock_event_corrections`.

Foreign-key cascades do not run triggers. `backend/migrations/013-data-lifecycle.sql` therefore adds a cascade from `clock_event_corrections` to `clock_events`, which is the one sanctioned way for retention and organisation deletion to remove corrections; a direct delete is still refused.

### Foreign keys

- **Composite links.** Links between tenant tables are (`org_id`, `id`) foreign keys onto a unique (`org_id`, `id`) key of the parent, `ON DELETE CASCADE` for most children and `RESTRICT` where PHP must clear the children first. The tables that sit on the restricting side, cleared child-first when an organisation is deleted, are listed in `Lifecycle::CLEAR_FIRST` (`backend/src/Mod/Lifecycle.php`: `shift_swaps`, `shifts`, `rotas`, `documents`, `staff_profiles`, `departments`).
- **Single-column links from a tenant table onto another tenant table.** The database does not tie these to the same organisation, so PHP does: `clock_events.shift_id` (`shifts`), `announcements.location_id` and `announcements.department_id`, `documents.superseded_by`, `platform_announcement_deliveries.outbox_id` and `timesheet_reopenings.timesheet_id`. Found by reading every `FOREIGN KEY` in the migrations on 2026-11-09 (no command is kept for it).
- **Deliberately no link to `organisations`:** `audit_logs` and `storage_deletions`, so that history and owed file deletions outlive a deleted tenant. `account_deletions` has no link to `users` for the same reason. `support_cases`, `gdpr_requests` and `billing_events` use `ON DELETE SET NULL` on `org_id`.
- **User references** (author, reviewer, actor) are `ON DELETE SET NULL` where the row must survive its user; several reviewer columns (for example `leave_requests.reviewed_by`) carry no foreign key at all.

### Unique keys that carry a business rule

| Rule | Key |
| --- | --- |
| One draft and one published rota per organisation, site and period | `rotas_one_draft`, `rotas_one_published` (generated `is_draft`, `is_published`, `site_key`), `backend/migrations/005-rota.sql` |
| One pending invitation per email per organisation | `invites_pending` on generated `pending_email`, `backend/migrations/002-identity.sql` |
| A replayed offline write finds its earlier row | `clock_events_client_event`, `leave_requests_client_event`, `shift_swaps_client_event` (`client_event_id`), `backend/migrations/006-time-and-requests.sql` |
| A scheduled alert is queued once | `notification_outbox_dedupe` (`dedupe_key`), `backend/migrations/007-communication.sql` |
| One subscription per organisation; invoice numbers are unique | `subscriptions_org`, `invoices_number`, `backend/migrations/008-billing.sql` |
| A Stripe event is recorded once per mode | `billing_events_identity` (`provider`, `mode`, `event_id`) |
| Two active job titles cannot share a name or a colour | `job_titles_name`, `job_titles_colour` (generated columns), `backend/migrations/004-people-places.sql` |
| One timesheet per person per period | `timesheets_period` (`backend/migrations/006-time-and-requests.sql`); leave overlap is not a key, see below |
| At most one open absence report and one open cover request per shift; one application per person per shift | `cover_absences_one_open`, `cover_requests_one_open`, `cover_applications_one_each`, `backend/migrations/017-cover.sql` |
| An expiry reminder is sent once per document and stage | primary key (`document_id`, `stage`) of `document_reminders`, `backend/migrations/015-compliance.sql` |
| A stored file path belongs to one document | `documents_storage_path` |
| An announcement reaches an organisation once; a credit is recorded once | `platform_deliveries_once`, `invoice_credits_once`, `backend/migrations/014-platform-comms.sql` |

### CHECK constraints that carry a business rule

Every CHECK is in the migration that creates its table. The ones that carry a rule rather than a format are: time order on shifts, rotas, leave, timesheets, invoices, support sessions and incidents; a `paid` invoice needs `paid_at` and a `refunded` one `refunded_at` (`backend/migrations/008-billing.sql`);
a resolved incident needs a resolution and an open one has none (`backend/migrations/011-platform-ops.sql`); a completed or refused data-subject request needs `closed_at` and `outcome_note` (`backend/migrations/013-data-lifecycle.sql`);
a document holds exactly one of `file_url` and `storage_path`, and the path starts with the row's own `org_id/staff_profile_id/` (`backend/migrations/015-compliance.sql`);
a support session needs a reason of at least 15 characters (`backend/migrations/009-platform-access.sql`); a cover record is open only while `open_shift_id` equals `shift_id` (`backend/migrations/017-cover.sql`);
an invoice document link must be a Stripe host (`invoices_docs_are_stripe`). ENUM columns carry the status vocabularies, so strict mode refuses any other value. `notifications.type` is the exception: it is free text.

### Rules enforced only in PHP

The database does not express these; the named code does. The pure decision logic is in `*Rules.php` modules that take no database (their headers say so).

| Rule | Where |
| --- | --- |
| A published or archived rota is never edited; an amendment is a draft that supersedes it, and publishing it archives the original in the same transaction | `backend/src/Mod/Rotas.php` (header, `publish`), `backend/src/Mod/Shifts.php` (`rota_published`, `rota_archived`) |
| Publishing refuses a future day below the site's minimum cover | `backend/src/MinimumCover.php`, called from `Rotas::publish` (`cover_below_minimum`) |
| With the `scheduling_tools` flag on, a double-booked person stops a publish | `backend/src/Mod/Scheduling.php`, `backend/src/SchedulingRules.php` |
| One person holds one live leave booking per day | `backend/src/Mod/Leave.php`: the check runs under a row lock on the person's staff record and answers `leave_overlap` (the earlier overlap constraint has no MariaDB equivalent, per the `006` header) |
| Seat and location limits of the plan | `backend/src/Billing.php` (`seat_limit`, `location_limit`) |
| Stripe signature check and event reconciliation | `backend/src/BillingRules.php` (`verifySignature`) |
| Document status, expiry and which reminder is due | `backend/src/ComplianceRules.php` (30, 14 and 7 days before expiry, then once the day after) |
| Cover eligibility, ranking and swap staleness | `backend/src/CoverRules.php` |
| Timesheet lines, tolerance flags and the payroll CSV | `backend/src/TimesheetRules.php` |
| Support reference numbers and SLA deadlines | `backend/src/SupportRules.php` |
| Which `staff_profiles` columns a colleague may read | `backend/src/Mod/Staff.php` (migration comment in `004`); there are no column grants |
| Which `staff_profiles` columns an erasure clears and which it keeps | `Gdpr::ERASURE_CLEARED` and `Gdpr::ERASURE_RETAINED` in `backend/src/Mod/Gdpr.php`; the suite `backend/tests/suites/190-lifecycle.php` fails when a new column is in neither list |
| Deleting an organisation | `backend/src/Mod/Lifecycle.php`: one transaction; exact name typed; audit row first; owed file deletions queued; restricting tables cleared child-first; the suite `backend/tests/suites/190-lifecycle.php` fails when a new restricting link is not covered. It takes effect at once; there is no grace period |
| Retention | `backend/src/Retention.php`: plain deletes by date for six data types; the audit trail is never touched |

The rota lifecycle in one line: `draft`, then `published`, then `archived` when an amendment is published; `unpublish` returns a published rota to `draft` unless an amendment is open (`backend/src/Mod/Rotas.php`).

## 5. Access checks in PHP (no row-level security since the cutover)

- **Every org-scoped handler starts with `Scope::membership`.** The organisation id comes from the URL and is validated as a UUID but never trusted; the role is read from the database
  (`memberships` joined to `organisations`, active membership, organisation not archived); a non-member gets 404 (`backend/src/Scope.php`).
  `Scope::require` compares the effective role and answers 403; `Scope::requireReal` uses the real role; `Scope::requireWritable` refuses writes to a suspended organisation and during a `read` support session.
- **Queries are scoped by `org_id`.** A handler's SQL carries `org_id = ?` with the validated id (for example the rota list in `backend/src/Mod/Rotas.php`), and a staff member who is not a manager is filtered further (staff never read a draft rota).
- **The database is the second line.** Composite foreign keys (section 4) refuse a cross-organisation reference between two tenant tables, and the append-only triggers protect the trails.
- **The proof.** `backend/tests/suites/099-access-sweep.php` reads the route table from the modules and calls every route as nobody, as a stranger (a member of a different organisation), as a signed-in person with no organisation and with random ids. Its rules: nothing returns 500, a protected route refuses nobody with 401, an org-scoped route answers a stranger and a non-member with 404 and no data. A new route is covered the day it is added.
- **The map.** `docs/RLS-TO-PHP.md` lists each retired policy, the PHP check that replaced it and the test.
- **Not covered by that sweep:** a PHP check that exists but is wrong for one role on one route. That needs a suite that names the route; the per-module suites in `backend/tests/suites` are where such cases live. Any claim that a given route is correct for every role is `NOT VERIFIED`.

## 6. Automation

There is no scheduler inside the database. `backend/bin/cron.php` runs every module that defines `public static function cron`, one run at a time under a lock file; the jobs decide for themselves whether they are due, so the schedule is only a heartbeat. The live host runs it every five minutes (header of `backend/bin/cron.php`; the 2026-11-08 section of `docs/AUDIT.md` records the check).

| Module (`backend/src/Mod`) | What its `cron` does | Tables it touches |
| --- | --- | --- |
| `Notifications` | queues scheduled alerts, then `Dispatcher::drain` empties the outbox (in-app rows, email, web push; abandoned after five attempts, claims older than ten minutes are reclaimed) | `notification_outbox`, `notifications`, `notification_deliveries`, `push_subscriptions`, `app_settings`, `notification_templates` |
| `Compliance` | sends expiry reminders for staff documents, at most once in fifteen minutes | `documents`, `document_reminders` |
| `Cover` | sweeps stale cover records for organisations with the `cover_tools` flag on | `cover_requests`, `cover_applications`, and `shift_swaps` through `Swaps::voidStale` |
| `Gdpr` | deletes the Clerk login, then the local user, for each owed erasure; prunes finished rows after a year | `account_deletions`, `users`, `support_access_sessions` |
| `Lifecycle` | removes queued stored files; once a day after 02:15 UTC runs retention | `storage_deletions`, `retention_runs`, and through `Retention` the tables below |
| `PlatformAnnouncements` | publishes due scheduled announcements and reconciles deliveries | `platform_announcements`, `platform_announcement_deliveries`, `notification_outbox` |
| `Enquiries` | emails a notice for each new website enquiry, if a notice address is configured | `enquiries` |

`Retention` (`backend/src/Retention.php`) deletes by date, in whole calendar months, from these tables for the rules in `retention_policies`: `shifts` and `rotas` (`rota_history`), `clock_events` and `timesheets` (`attendance`), `leave_requests`, resolved `support_cases`, `notification_deliveries` and sent or abandoned `notification_outbox` rows (`notifications`), and `enquiries`.
The policy row `deleted_tenant` is listed but not enforced (see `backend/migrations/013-data-lifecycle.sql`). Retention periods are the seeded rows of that migration; the live values are database state and `NOT VERIFIED`.

## 7. Files and indexes

- **Uploaded files are not in the database.** They are plain files under `<private root>/uploads`, outside every web root, in two buckets (`staff-documents`, `staff-photos`) laid out as `<org id>/<staff profile id>/<file>`, reached only through the API (`backend/src/FileStore.php`).
  The tables hold only pointers and descriptors: `documents.storage_path` (unique, CHECKed to start with the row's own organisation and person folder), `documents.mime`, and `staff_profiles.photo_path` and `photo_url`. There is no hash or size column.
  `storage_deletions` queues the file or folder to remove when a row goes (`Mod\Lifecycle`, `Mod\Gdpr`, `Mod\Photos`).
- **Indexes.** The inventory in section 3 names the unique keys. The other indexes are lookups that lead with `org_id`: for example `shifts_org_start`, `shifts_by_staff`, `clock_events_staff_time`, `leave_requests_status`, `notifications_inbox` (`user_id`, `org_id`, `created_at`), `notification_outbox_due` (`status`, `next_attempt_at`) and `audit_logs_org_created`.
  Every table that is the target of a composite link has a unique (`org_id`, `id`) key. `grep -n 'KEY' backend/migrations/*.sql` lists the keys; the earlier list of indexes for the retired schema is not carried over.

## 8. Migration policy

- **Where.** One file per change in `backend/migrations`, named `NNN-name.sql` with a three-digit number; `backend/bin/migrate.php` globs `[0-9][0-9][0-9]-*.sql` and sorts. The last number in use is 020.
- **Applying.** `php bin/migrate.php [--dry-run]` from `backend/`, run on the host with the migration identity (private `config/migrate.php`; schema rights and the TRIGGER privilege), after the files have been uploaded. It creates `schema_migrations` (`name`, `applied_at`, SHA-256 `checksum`), applies pending files in order, splitting statements with `RotaFlow\Sql::split`, and records each file only after all its statements ran.
- **The release does not apply migrations.** `scripts/release.mjs` contains no call to the migration runner; `release.json` uploads the `.sql` files to the private app folder. Running `migrate.php` is a separate step. Who runs it, when, and whether any live migration is pending is `NOT VERIFIED` (server state).
- **Forward only, and never edit an applied file.** There is no down path. A changed checksum on an applied file aborts the run with exit 2 before anything new is applied; a failing statement aborts with exit 3 and writes no log row.
  MariaDB commits DDL implicitly, so a file that fails halfway leaves its earlier statements in place: write statements that are additive and re-runnable (`IF NOT EXISTS`, `INSERT IGNORE`) so the corrected file can be applied again (header of `backend/bin/migrate.php`).
- **A new table** takes an `org_id` and composite links as in section 2 and an entry in this document (`docs/RULES.md` states the rule; the migration wins if the two disagree).
- **Tests.** Every PHP suite starts from a fresh database with every migration applied by the real runner (`backend/tests/lib.php`); `backend/tests/suites/010-migrate.php` tests the statement splitter.
- **What the gate does not cover.** `pnpm run check:migrations` (`scripts/check-migration-safety.mjs`) scans only `supabase/migrations`, the legacy tree, so nothing automatic checks the safety of `backend/migrations`. Pointing it at the MariaDB tree is a follow-up code change, not made in this phase.
- No other written policy (review rules, a naming rule beyond the number, a rollback plan) exists in the repository: `NOT VERIFIED`.

## 9. Generated types

`src/types/database.types.ts` is generated from the retired Supabase schema and does not match MariaDB. Comparing its `Tables` names with the 69 tables on 2026-11-09: it lists 61 tables, 7 of which have no MariaDB twin (`background_jobs`, `integration_connectors`, `integration_sync_runs`, `org_integrations`, `platform_health_samples`, `platform_ip_allowlist`, `profiles`) and 15 MariaDB tables are missing from it
(`rate_limits`, `users`, `notification_outbox`, `billing_events`, `support_counter`, `support_sla_targets`, `incident_counter`, `account_deletions`, `storage_deletions`, `document_types`, `document_reminders`, `cover_absences`, `cover_requests`, `cover_applications`, `timesheet_reopenings`).
The comparison was a one-off script over the file, not a repository command. Hand-written API types are the target (owner decision 8 November 2026); the types file is a code leftover for a later phase.

## 10. Legacy

The retired Postgres schema, its row-level-security policies, grants, triggers, the pg_cron jobs and the 164-migration history are in the previous version of this document:
`git show live-supabase-2026-11-01:docs/DATA-MODEL.md`. The retired schema's migration files stay in `supabase/migrations` until Phase 6.
