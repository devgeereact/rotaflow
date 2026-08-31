# Supabase PostgreSQL Schema & Security. RotaFlow

The canonical, runnable source is `supabase/migrations/`. `0001_init.sql` ships the
built-in `profiles` + `app_settings` and conventions; **`0002_rotaflow.sql`** adds the
RotaFlow domain; **`0003_fix_organisations_select_rls.sql`** fixes an org-creation
RLS bootstrap bug (see §5); **`0004_rotas_draft_unique.sql`** adds partial unique
indexes so concurrent callers can't create duplicate draft rotas; **`0005_narrow_organisations_select_rls.sql`**
closes the permanent creator-read bypass `0003` left open (see §5). Apply via the
Supabase SQL editor or `supabase db push`. This intro only narrates the earliest
migrations; §3 and §4 below cover every table through the current
`00NN_*.sql` file — re-read those rather than this paragraph for anything past `0005`.

RotaFlow is **multi-tenant on a single database**: every domain table carries an
`org_id`, and Row Level Security isolates tenants. RLS is the last line of defence. The client also scopes every query, but the database guarantees no cross-tenant leak.

## 1. Tenancy & roles model

```text
auth.users ──1:1──> public.profiles
                        │  (is_platform_admin flag = Super Admin)
                        ▼
                  public.memberships ──> role: owner | manager | staff
                        │  (user_id, org_id, role, status)
                        ▼
                  public.organisations  (the tenant root)
                        ├── locations ── departments
                        ├── staff_profiles (may exist before an auth user; user_id nullable)
                        ├── shift_types
                        ├── rotas ── shifts
                        ├── availability · leave_requests · overtime_requests · shift_swaps
                        ├── clock_events · timesheets
                        ├── emergency_contacts · documents
                        ├── announcements · notifications
                        ├── subscriptions (billing seam)
                        └── audit_logs
```

- **Super Admin** = `profiles.is_platform_admin = true` (platform-wide; not an org
  membership).
- **Owner / Manager / Staff** = a row in `memberships` for that `org_id`.
- A person can belong to multiple organisations (each with its own role).
- **There is no location-scope column on `memberships`.** A manager's site scope is
  inferred through `departments.location_id`; nothing narrows a membership to a site.

## 2. Built-in tables (from `0001_init.sql`)

### `profiles`

| Column       | Type          | Notes                                   |
| ------------ | ------------- | --------------------------------------- |
| `id`         | `uuid` PK     | FK → `auth.users.id`, cascade on delete |
| `email`      | `text`        | unique, not null                        |
| `full_name`  | `text`        | nullable                                |
| `avatar_url` | `text`        | nullable (often an ImageKit URL)        |
| `created_at` | `timestamptz` | default `now()`                         |
| `updated_at` | `timestamptz` | default `now()`, bumped by trigger      |

`0002` adds **`is_platform_admin boolean not null default false`** (Super Admin flag).
`0015` turns it into a derived mirror — see §4 below; nothing may write it directly.

### `app_settings`

Per-user preferences (`theme`, `notifications_enabled`). Unchanged. `theme` values
`dark`/`light`. The app defaults to **light** and never reads
`prefers-color-scheme` — a brand decision, see `src/context/ThemeContext.tsx`.
`notifications_enabled` is read on the send path by
`supabase/functions/send-notification` — a person who switches it off is dropped
before any channel runs. An **absent row means the column default (`true`)**, never
"opted out"; do not infer consent from a missing row.

## 3. RotaFlow tables (from `0002_rotaflow.sql`)

Every table below has `id uuid PK`, `org_id uuid` (FK → `organisations`, except
`organisations` itself), `created_at`, `updated_at`, RLS enabled, and a
`set_updated_at()` trigger.

| Table                     | Key columns                                                                                                                                                                                                                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `organisations`           | `name`, `slug` (unique), `plan`, `settings jsonb`, `created_by`, `status` (`active`\|`suspended`\|`archived`, `0017`), `suspended_at?`, `support_access_allowed` (default `true`, `0017`), `is_demo` (default `false`, `0035`)                            | Tenant root. `status` moves only via `set_org_status()` (§6). `support_access_allowed` is the customer's opt-out, enforced by `request_support_access()` (§4), not just advisory. `is_demo` survives as a column only: the seed scripts it gated were deleted with the UI badge in `#120`, so nothing reads or writes it outside the generated types.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `memberships`             | `org_id`, `user_id`→profiles, `role` (`owner`\|`manager`\|`staff`), `status`                                                                                                                                                                              | Who belongs to an org and as what.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `locations`               | `org_id`, `name`, `address`, `latitude`, `longitude`, `timezone`, `geofence_radius_m`, `location_type?`, `status` (`setup`\|`active`\|`maintenance`\|`inactive`, default `setup`, `0045`)                                                                 | Sites; clock-in geofencing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `departments`             | `org_id`, `location_id?`, `name`                                                                                                                                                                                                                          | Kitchen, Nursing, Reception…                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `staff_profiles`          | `org_id`, `user_id?`, `email?` (`0053`), `first_name`, `last_name`, `job_title`, `department_id?`, `contract_type`, `weekly_hours`, `holiday_allowance`, `skills text[]`, `payroll_id`, `start_date`, `phone`, `photo_url`, `active`                      | Employee record. `email` (`0053`) exists only to auto-link `user_id` to the real login once matched by a trigger or `accept_invite()`, in whichever order the HR record and the invite happen — before `0053` nothing ever set `user_id`, so a published rota was invisible to every real invited staff member.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `shift_types`             | `org_id`, `name`, `colour`, `default_start`, `default_end`, `is_paid`, `category`                                                                                                                                                                         | Morning/Late/Night/On-Call…                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `rotas`                   | `org_id`, `location_id`, `name`, `period_start`, `period_end`, `status` (`draft`\|`published`\|`archived`), `published_at`, `published_by`, `supersedes_rota_id`, `archived_at`, `created_by`                                                             | A schedule for a period/location. See §6a for the lifecycle — `0061` made it server-enforced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `shifts`                  | `org_id`, `rota_id?`, `location_id`, `department_id?`, `staff_profile_id?`, `shift_type_id?`, `starts_at`, `ends_at`, `break_minutes`, `status` (`open`\|`assigned`\|`confirmed`\|`cancelled`), `colour`, `notes`                                         | The atomic scheduled unit. `staff_profile_id` null = open shift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `availability`            | `org_id`, `staff_profile_id`, `weekday?`, `date?`, `start_time`, `end_time`, `status` (`available`\|`unavailable`\|`preferred`), `recurring`                                                                                                              | Recurring or one-off availability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `leave_requests`          | `org_id`, `staff_profile_id`, `type`, `start_date`, `end_date`, `status` (`pending`\|`approved`\|`rejected`\|`cancelled`), `reason`, `reviewed_by?`, `reviewed_at?`                                                                                       | Holiday/sick/unpaid requests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `overtime_requests`       | `org_id`, `staff_profile_id`, `date`, `hours`, `status`, `note`                                                                                                                                                                                           | Staff offer / manager allocate overtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `shift_swaps`             | `org_id`, `shift_id`, `requested_by`, `target_staff_profile_id?`, `status` (`pending`\|`accepted`\|`approved`\|`rejected`\|`cancelled`), `note`                                                                                                           | Swap workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `clock_events`            | `org_id`, `staff_profile_id`, `shift_id?`, `type` (`in`\|`out`\|`break_start`\|`break_end`), `event_at`, `event_at_reported?` (`0068`), `latitude?`, `longitude?`, `accuracy?`, `method` (`gps`\|`qr`\|`manual`), `location_name?`, `synced`              | Attendance; offline-created then synced. `event_at_reported` records what the device claimed when `clock_events_guard_event_at` overrode it; **null means `event_at` is exactly what was submitted**, which is the normal case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `timesheets`              | `org_id`, `staff_profile_id`, `period_start`, `period_end`, `total_minutes`, `status`                                                                                                                                                                     | Summarised hours for payroll export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `emergency_contacts`      | `org_id`, `staff_profile_id`, `name`, `relationship`, `phone`, `secondary_phone?`, `medical_notes?`                                                                                                                                                       | Per-employee.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `documents`               | `org_id`, `staff_profile_id`, `type`, `name`, `file_url`, `issued_at?`, `expires_at?`                                                                                                                                                                     | Contracts, DBS, RTW, visas; expiry surfaced in Phase 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `announcements`           | `org_id`, `author_user_id`, `scope` (`org`\|`location`\|`department`), `location_id?`, `department_id?`, `title`, `body`, `urgent`, `published_at`                                                                                                        | Communication centre.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `notifications`           | `org_id`, `user_id`, `type`, `title`, `body`, `channel` (`push`\|`email`\|`sms`), `read_at?`                                                                                                                                                              | In-app + delivery record. **`sms` is a reserved channel value, not delivered in V1.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `subscriptions`           | `org_id`, `plan` (`starter`\|`professional`\|`business`\|`enterprise`), `status`, `provider`, `provider_ref?`, `stripe_customer_id?`, `price_pence?`, `started_at`, `current_period_end?`, `canceled_at?`                                                 | Billing seam, now wired to Stripe (`0050_stripe_billing.sql`, `supabase/functions/stripe-webhook`). `plans.stripe_price_id` maps each tier to its Stripe Price. `price_pence` overrides the plan's list price only where a deal was struck; MRR/churn reconstruction (`src/lib/revenue.ts`) sums `coalesce(price_pence, plan price)` over rows the arithmetic selects. `canceled_at` is set the moment cancellation is _requested_ (Stripe's Customer Portal defaults to cancel-at-period-end), not when it takes effect — it is **not** immutable, and can be cleared back to `null` if the customer un-cancels before period end. Only `status = 'canceled'` means a subscription has actually, fully ended; MRR/churn code gates on `status`, never on `canceled_at` alone. |
| `audit_logs`              | `org_id`, `actor_user_id?`, `action`, `entity_type`, `entity_id?`, `metadata jsonb`, `created_at`                                                                                                                                                         | GDPR + compliance trail (append-only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `invoices`                | `org_id`, `number` (unique), `period_start/end`, `amount_pence`, `tax_pence`, `currency`, `status` (`draft`\|`open`\|`paid`\|`past_due`\|`refunded`\|`void`), `issued_on`, `due_on`, `paid_at?`, `failure_reason?`, `provider?`, `provider_ref?` (`0023`) | One org's billing history. Read by the org's own owner (they're the customer) and platform finance; written only by the RPCs that issue/mark them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `minimum_cover_rules`     | `org_id`, `location_id`, `weekday` (0=Sunday..6=Saturday, matching `availability.weekday`), `min_staff` (`0036`)                                                                                                                                          | Per-site, per-weekday staffing minimum. A standing policy, not a schedule — client-side conflict logic (`src/lib/rotaInsights.ts`) reads it alongside `shifts` to compute the gap; nothing server-side enforces it (§6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `announcement_reads`      | `org_id`, `announcement_id`, `staff_profile_id`, `read_at` (`0046`)                                                                                                                                                                                       | Read receipts for `announcements` — an org-shared fact ("who has seen this"), not a personal inbox item, so every member of the org can read every receipt for their org.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `invites`                 | `org_id`, `email`, `role`, `token`, `expires_at`, `accepted_at?`, `revoked_at?` (`0006`)                                                                                                                                                                  | One-time join links. `create_invite()` returns the token; **nothing emails it** — a manager copies the link by hand (`docs/SAAS.md` GAP-005). `accept_invite()` links the new `auth.users` row to a pre-existing `staff_profiles` row by email (`0053`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `push_subscriptions`      | `user_id`, `endpoint`, `p256dh`, `auth_key` (`0009`)                                                                                                                                                                                                      | Web Push endpoints. **User-scoped, not org-scoped — the one domain table with no `org_id`**, because a browser subscription belongs to a person, not a tenant. `send-notification` prunes 404/410 endpoints on send.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `org_smtp_settings`       | `org_id` PK, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `from_email`, `from_name?`, `verified_at?` (`0010`)                                                                                                                                      | Per-org SMTP so mail leaves the organisation's own server. `smtp_pass` is excluded from the column-level SELECT grant for `authenticated`, so it can never come back through the client; read `org_smtp_settings_safe` instead. `verified_at` is written **only** by a successful `test-smtp` send — "saved" and "known to work" are different claims.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `notification_deliveries` | `org_id`, `user_id`, `channel` (`in_app`\|`email`\|`push`), `status` (`sent`\|`failed`\|`skipped`\|`expired`), `event_type`, `detail?` (`0067`)                                                                                                           | Was this person told, on which channel, and did it land. One row per recipient per channel per notification — `send-notification` computed this and discarded it until `0067`. Written only by that function (service_role); there is no client write policy. A manager or owner reads their org's rows and a person reads their own; `anon` is refused by the GRANT before RLS is consulted. **`sent` means the provider accepted it, not that a human saw it.** No retention policy yet — see `docs/SAAS.md` GAP-027.                                                                                                                                                                                                                                                        |
| `notification_outbox`     | `org_id`, `event_name`, `payload jsonb`, `status` (`pending`\|`sent`\|`failed`\|`abandoned`), `attempts`, `request_id?`, `last_error?`, `dispatched_at?` (`0069`)                                                                                         | Notifications the database knows are owed, written in the same transaction as the event that caused them — so a closed browser tab cannot lose one. `rotas_enqueue_publish_notification` fills it on a rota publish, and since `0087` `leave_requests_enqueue_reviewed`, `shift_swaps_enqueue_reviewed` and `announcements_enqueue_published` fill it on the other three events the product notifies about — nothing is dispatched from the browser any more; `dispatch_notification_outbox()` drains it on a pg_cron tick via `pg_net`, reconciling each response before retrying. Owners and managers read their own org's queue; no client write policy. Secrets for the drain live in `vault`, never in a migration.                                                       |

## 4. Platform-level tables (from `0015`+)

Unlike §3, these aren't tenant data — they're the platform console's own
tables. Most carry no `org_id` at all (`platform_admins`, `feature_flags`,
`plans`, …); the few that do (`support_cases`, `integration_sync_runs`, the
announcement/incident fan-out tables) are administered by platform staff, not
by a tenant's own owner. Nearly every table below has **no insert/update/
delete policy at all** — every mutation goes through a `security definer` RPC
(`grant_platform_role`, `request_support_access`, `log_gdpr_request`, …) so
validation — bounds checks, required justifications, the last-owner guard —
can't be bypassed by writing to the table directly. Exceptions are called out
per subsection below.

### 4.1 Administration (`0015`, `0018`–`0020`)

| Table                     | Key columns                                                                                                                                                                                            | Purpose                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_admins`         | `user_id` PK, `role` (`platform_owner`\|`platform_admin`\|`platform_support`\|`platform_finance`), `granted_by/at`, `revoked_by/at`, `note`                                                            | Source of truth for _which kind_ of platform administrator someone is. `profiles.is_platform_admin` is a trigger-maintained mirror of "any non-revoked row exists" — `UPDATE` on that column is revoked from `authenticated` entirely, so nothing can desync it.                              |
| `platform_settings`       | singleton (`id boolean primary key default true`), `platform_name`, `support_email`, `platform_url`, `default_timezone`, `registration_enabled`, `maintenance_mode`, `maintenance_message`             | Deployment-wide config, one row, seeded on migration. `maintenance_mode` is a banner, not a kill switch — nothing in a static PWA can refuse to serve itself, so it doesn't gate anything server-side.                                                                                        |
| `support_access_sessions` | `org_id`, `admin_user_id`, `reason` (≥15 chars), `case_ref`, `scope` (`read`\|`read_write`), `granted_at`, `expires_at`, `revoked_at/by`                                                               | Time-boxed, justified record of platform staff accessing a tenant. Since `0028_support_access_gate.sql` this **is** the access grant, not just a note about one — see §5's "Platform-admin access is session-gated" — 15 minutes to 24 hours per session, one open session per admin per org. |
| `gdpr_requests`           | `org_id?`, `subject_email`, `kind` (`access`\|`portability`\|`rectification`\|`erasure`\|`restriction`\|`objection`), `status`, `received_on`, `due_on`, `extended_to?`, `closed_at?`, `outcome_note?` | UK GDPR Article 15–22 request register. `due_on` is computed server-side as `received_on + 1 month` (Article 12(3)) — never client-supplied. Closing a request (`completed`/`refused`) requires `outcome_note`, enforced by both a CHECK and the RPC.                                         |

### 4.2 Incidents (`0021`; `0033` cleaned up a duplicate)

| Table              | Key columns                                                                                                                                                                                                                                                         | Purpose                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `incidents`        | `reference` (unique, e.g. `INC-0142`), `title`, `impact`, `severity` (`critical`\|`high`\|`medium`\|`low`), `status` (`investigating`\|`identified`\|`monitoring`\|`resolved`), `service`, `started_at`, `detected_at?`, `resolved_at?`, `resolution?`, `is_public` | Distinct from `audit_logs` on purpose: an audit row is written once and never changes, an incident is edited repeatedly while open. A resolved incident must have both `resolved_at` and `resolution` (CHECK). `is_public` is reserved for a future status page — no policy grants `anon` access today, so setting it changes nothing yet. |
| `incident_updates` | `incident_id`, `author_id?`, `status`, `body`                                                                                                                                                                                                                       | The timeline entries on one incident.                                                                                                                                                                                                                                                                                                      |

Platform staff only, for now — see the header of `0021` for why. `0033` found and
dropped a second, undeclared `platform_incidents`/`incident_events` implementation
that had been written directly to production outside the migration set (turned up by
diffing generated types against migrations) — empty, unreferenced by any code, and a
reminder to re-run that diff before any future release.

### 4.3 Feature flags (`0022`, entitlements split out in `0030`)

| Table                  | Key columns                                                                                                                 | Purpose                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature_flags`        | `key` PK (`^[a-z][a-z0-9_]{2,63}$`), `name`, `enabled`, `rollout` (0–100), `environment`, `critical`, `target_plans text[]` | A disabled flag is off for everyone regardless of `rollout`. `flag_enabled_for_org()` hashes `key` + `org_id` so a staged rollout is stable per organisation across renders — raising 10%→20% only ever _adds_ orgs, never removes one. |
| `feature_flag_targets` | `flag_key`, `org_id` (composite PK)                                                                                         | Orgs explicitly opted in ahead of the rollout percentage (pilots).                                                                                                                                                                      |
| `feature_flag_changes` | `flag_key`, `actor_id?`, `actor_name?`, `field`, `before_value?`, `after_value?`                                            | Before/after history in a shape the flag screen reads directly, alongside (not instead of) the immutable `audit_logs` entry for the same change.                                                                                        |

`0030` drew a line this table can't enforce on its own: what a customer pays for
belongs on `plans` (§4.4), not here, and four of the six rows `0022` created were
entitlements wearing a flag's clothes. Those were moved and marked retired rather
than deleted, since `feature_flag_changes` still references them.

`0090` finished the job. `beta_integrations` was described here as a genuine
dark-launch flag "the application now checks before rendering"; it checked nothing,
and what it described — unreleased payroll and HR connectors — does not exist, so it
is retired too. **`ai_rota_assistant` is the only live flag**, and the AI Edge
Function honours it alongside the plan entitlement.

### 4.4 Commercials (`0023`; Stripe columns in `0050`)

| Table   | Key columns                                                                                                                                                               | Purpose                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plans` | `code` PK (`starter`\|`professional`\|`business`\|`enterprise`), `name`, `monthly_price_pence`, `currency`, `seat_limit?`, `location_limit?`, `stripe_price_id?` (`0050`) | The price list. `subscriptions.price_pence` (§3) overrides it only where a deal was struck and is `null` otherwise — MRR is `coalesce(subscription.price_pence, plan.monthly_price_pence)` summed over active subscriptions, a definition anyone can check. Readable by any signed-in user (the upgrade screen needs it). |

`invoices` — one org's billing history — lives in §3 alongside `subscriptions`,
since an org's own owner reads their own invoices; it isn't platform-staff-only
like the tables on this page.

### 4.5 Support desk (`0024`)

| Table                   | Key columns                                                                                                                                                                                                                     | Purpose                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `support_cases`         | `reference` (unique), `org_id?`, `requester_id?`, `requester_email`, `category`, `priority`, `status` (`open`\|`pending`\|`on_hold`\|`resolved`\|`closed`), `assigned_to?`, `first_response_at?`, `resolved_at?`, `csat` (1–5)? | `org_id`/`requester_id` are nullable — a case can arrive from a prospect or someone emailing from a personal address, before any tenant is known. `first_response_at` is stamped once, by the function posting the first public reply from a platform agent, so "median first response" has one definition nobody can compute differently. |
| `support_case_messages` | `case_id`, `author_id?`, `author_name?`, `author_side` (`customer`\|`platform`), `body`, `is_internal`                                                                                                                          | `author_side` is set by the RPC from the caller's platform role, never from an argument — a customer cannot post as staff. `is_internal` notes are excluded by the read policy itself, not hidden client-side.                                                                                                                             |

Read: the requester sees their own case (even if not an org member); platform staff
see everything. `internal` messages never reach a tenant reader regardless.

### 4.6 Announcements (`0025`)

Platform-to-tenant broadcast — distinct from `notifications` (one user, one org) and
tenant `announcements` (§3, one org's own noticeboard). Neither could say "tell every
org on Business and above about Tuesday's maintenance window".

| Table                              | Key columns                                                                                                                                                                                        | Purpose                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_announcements`           | `title`, `body`, `kind` (`maintenance`\|`incident`\|`product`\|`billing`\|`policy`), `audience` (`all`\|`plans`\|`organisations`), `channel`, `status` (`draft`\|`scheduled`\|`sent`\|`cancelled`) | The message.                                                                                                                                      |
| `platform_announcement_deliveries` | `announcement_id`, `org_id`, `sent_at?`, `read_at?`, `failed_at?`, `failure_reason?`                                                                                                               | One row per recipient org, so "Sent" and "Read" are counts over real rows rather than a counter column that could drift on a half-failed fan-out. |
| `platform_announcement_optouts`    | `org_id` PK, `opted_out_by?`                                                                                                                                                                       | Orgs that opted out of broadcasts entirely.                                                                                                       |

Nothing here sends email or push — fan-out writes delivery rows; turning those into a
real notification is an Edge Function's job (needs the service role and a provider).
`sent_at` on the delivery row is stamped by whatever actually sent it, so an unsent
row reads as unsent rather than assumed delivered.

### 4.7 Integrations (`0026`; every connector marked planned in `0073`)

| Table                    | Key columns                                                                                                                                                                                    | Purpose                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration_connectors` | `key` PK, `name`, `category` (`payroll`\|`hr`\|`calendar`\|`communication`\|`accounting`\|`identity`), `status` (`planned`\|`operational`\|`degraded`\|`down`\|`beta`\|`retired`), `available` | The catalogue — what can be connected, and the connector's own health (distinct from any one tenant's connection failing). **`planned` (`0073`) means the connector does not exist yet**, and every row currently carries it with `available = false`; anything else asserts running code, so do not set one until there is an Edge Function behind it. |
| `org_integrations`       | `org_id`, `connector_key`, `status` (`connected`\|`paused`\|`error`\|`disconnected`), `credentials_ref?`, `last_sync_at?`, `last_error?`                                                       | One tenant's connection. `credentials_ref` **names** a secret held by an Edge Function or the provider — no token, key or password is stored in this schema.                                                                                                                                                                                            |
| `integration_sync_runs`  | `org_integration_id`, `connector_key`, `org_id`, `started_at`, `finished_at?`, `duration_ms?`, `outcome` (`running`\|`success`\|`partial`\|`failed`), `records`, `error?`                      | One sync attempt. "Organisations connected" and failure counts are sums over this table, never columns on the catalogue, so they can't drift from the rows they summarise. **Has never had a writer** — no Edge Function syncs anything yet, which is why every connector is `planned`.                                                                 |

**Plus a view.** `integration_connector_stats` (`0026`, `security_invoker`) joins the three
tables above into the row `/admin/integrations` renders: `key`, `name`, `category`, `status`,
`available`, `orgs_connected`, `runs_24h`, `failed_24h`, `success_rate_7d`,
`median_duration_ms`, `last_sync_at`. It is one of the three views in `public` and, like the
other two, invoker-rights — so a caller sees the aggregate of exactly the rows their own RLS
lets them see, not the platform total. Since `0073` marked every connector `planned`, every
count it returns is zero, and that is correct rather than broken.

### 4.8 Platform configuration, health & retention (`0027`, `0029`)

| Table                     | Key columns                                                                                                                       | Purpose                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform_ip_allowlist`   | `cidr` (unique, `inet`/`cidr` type — Postgres validates the range), `label`                                                       | Console-access IP allowlist.                                                                                                                                                                                                                                                                                                                                                       |
| `retention_policies`      | `data_type` PK, `label`, `retain_months?` (null = indefinite), `enforced`                                                         | The schedule. `0027` created it with `enforced = false` on five of six rows — a promise, not a control — until `0029` added `enforce_retention()` + a nightly `pg_cron` job, which flips `enforced = true` because it now is. `audit_logs` keeps `retain_months = null` (indefinite) permanently; that's the exemption, enforced by the job skipping `null` rather than by memory. |
| `retention_runs`          | `ran_at`, `dry_run`, `data_type`, `rows_removed`, `cutoff?`, `error?`                                                             | One row per nightly run (or dry run) of `enforce_retention()`.                                                                                                                                                                                                                                                                                                                     |
| `platform_health_samples` | `service`, `status` (`operational`\|`degraded`\|`down`), `latency_ms?`, `source` (`console`\|`scheduled`\|`manual`), `checked_at` | Point-in-time reachability probes. `source` is kept distinct because a browser in London and a cron in `eu-west-2` measure different things — averaging them silently would produce a number someone eventually depends on.                                                                                                                                                        |
| `background_jobs`         | `queue`, `job_key`, `status` (`queued`\|`running`\|`succeeded`\|`failed`\|`cancelled`), `attempts`, `org_id?`, `payload jsonb`    | Generic job-queue bookkeeping for whatever schedules through it.                                                                                                                                                                                                                                                                                                                   |

**Two more tables live here that no role but `service_role` can touch**, added after this
section was last written and absent from it until 2026-08-31:

| Table                    | Key columns                                                     | Purpose                                                                                     |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `platform_health_probes` | `request_id` (the `pg_net` id), `service`, `sent_at`, `classify` | `0076`/`0079`. One row per in-flight probe, so the reply can be matched back to what asked it |
| `rate_limit_events`      | `id`, `bucket`, `subject`, `created_at`                          | `0085`. The shared limiter's ledger — one row per counted attempt, per bucket and subject     |

Both have **RLS enabled and zero policies**, and grants to `service_role` alone. That is not
an oversight and it is not the RLS-without-a-policy hazard `rls_invariants.test.sql` fails on:
that test asks whether a table any client role can *reach* has a policy, and no client role
can reach these. `anon` and `authenticated` hold nothing on either, so RLS-on-no-policy is a
second closed door behind a locked one.

`rate_limit_events` in particular must stay unreadable. It records who attempted what and
when, keyed by user id or IP, across every limited action — an audit trail of failed
attempts that would tell one tenant about another.

Deleted-tenant data (the thirty-day grace on a removed organisation and everything
cascading from it) is deliberately **not** on this schedule — a different and more
dangerous operation than ageing out old shifts, left manual until someone decides who
may trigger it.

### 4.9 What 2026-08-31 added (`0099`–`0110`)

Twelve migrations in one day, six of them new tables. Recorded here rather
than left to `docs/SAAS.md`, because this file is what a session is told to
read before touching the schema, and a reference that stops at `0098` is a
reference that will be trusted and be wrong.

| Table                    | Key columns                                                                                              | Purpose and the decision inside it                                                                                                                                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar_feed_tokens`   | `token` PK, `org_id`, `staff_profile_id`, `last_used_at?`, `revoked_at?` (`0099`)                        | A subscribable ICS feed. The token **is** the credential — a calendar client cannot present a header — so it reads one person's shifts and nothing else, and a partial unique index enforces one live token per person. `calendar_feed_shifts()` is granted to `service_role` alone.                                                    |
| `staff_pay_rates`        | `org_id`, `staff_profile_id`, `hourly_rate_pence`, `effective_from`, unique per `(staff, date)` (`0104`) | **Not a column on `staff_profiles`**: that table's select policy is `is_org_member`, so a rate there would publish everybody's pay to every colleague. A history rather than a value, because overwriting a rate rewrites what last quarter cost. `labour_cost()` returns money without handing out the rates it used.                  |
| `staff_locations`        | `(staff_profile_id, location_id)` PK, `org_id` (`0105`)                                                  | Somebody who works more than one site. A site used to be inherited from the department, so everybody had exactly one by construction. Nothing recorded falls back to the department; explicit sites stop that fallback, so it cannot grant a site nobody assigned. A trigger refuses a row whose `org_id` disagrees with either parent. |
| `role_delegations`       | `org_id`, `from_user_id`, `to_user_id`, `starts_at`, `ends_at`, `revoked_at?` (`0106`)                   | Cover while somebody is away. **Enforced inside `has_org_role`**, so every managerial policy honours it at once. Confers `manager` and never `owner`, and cannot be chained: `delegate_role` reads the caller's own membership rather than `has_org_role`, which now returns true for a delegate.                                       |
| `notification_templates` | `org_id?` (null = platform default), `key`, `channel`, `subject`, `body` (`0108`)                        | What a notification says. A row rather than code, because Edge Functions do not deploy on merge. `render_notification()` substitutes `{{placeholders}}` in **two passes**, so a value containing `{{…}}` cannot rewrite the message around it.                                                                                          |
| `support_sla_targets`    | `priority` PK, `first_response_minutes`, `resolution_minutes` (`0110`)                                   | What support promises. Rows rather than constants, so the promise changes without a deploy and is readable by anybody it is made to.                                                                                                                                                                                                    |

Columns added to existing tables:

| Table               | Columns                                               | Why                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscriptions`     | `past_due_since`, `grace_until` (`0098`)              | A failed payment now has a date somebody can act on. Set by trigger, and a **second** failed payment does not restart the clock — otherwise a weekly retry is never at risk.                |
| `leave_requests`    | `starts_half`, `ends_half` (`0109`)                   | Half days. Two booleans rather than a portion enum whose values mean different things at the two ends of a range. `leave_days()` never returns zero.                                        |
| `support_cases`     | `first_response_due_at`, `resolution_due_at` (`0110`) | Computed from when the case ARRIVED, so escalating a late case cannot reset its clock and make a breach disappear.                                                                          |
| `platform_settings` | `require_mfa` now **enforced** (`0102`)               | It existed from `0027`, defaulted true, and was checked by nothing. `is_platform_admin()` now requires an `aal2` session when it is on; `0102` set it false because that was what was true. |

New functions worth knowing before writing a query: `my_sessions()` /
`revoke_my_other_sessions()` (`0100`), `my_mfa_status()` /
`set_platform_mfa_required()` (`0102`), `open_shifts()` / `claim_open_shift()`
(`0103`), `labour_cost()` / `current_pay_rates()` (`0104`),
`staff_at_location()` (`0105`), `delegate_role()` / `revoke_delegation()`
(`0106`), `repeat_rota_weeks()` (`0107`), `render_notification()` (`0108`),
`leave_days()` (`0109`), `support_sla_state()` (`0110`).

**Two predicates changed behaviour**, which matters more than any new table:
`is_platform_admin()` gained an MFA condition (`0102`) and `has_org_role()`
gained delegation (`0106`). Every policy in this schema calls one of those, so
both changes are schema-wide by design — see §5.

## 5. Row Level Security

RLS is **enabled on every table**. Policies use `security definer` helper functions
(the core four from `0002`; `has_platform_role` from `0015`; `has_support_access`
from `0028`, which also redefined the first two) so membership checks don't recurse:

| Function                                              | Returns | Meaning                                                                                                                                         |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.is_platform_admin()`                          | bool    | current user is a Super Admin                                                                                                                   |
| `public.is_org_member(org uuid)`                      | bool    | current user belongs to `org` (any role), **or** holds a read support session (`0028`)                                                          |
| `public.has_org_role(org uuid, roles text[])`         | bool    | current user's role in `org` ∈ `roles`, **or** holds a `read_write` support session (`0028`)                                                    |
| `public.my_staff_profile_id(org uuid)`                | uuid    | the caller's own `staff_profiles.id` in `org`                                                                                                   |
| `public.has_support_access(org uuid, write boolean?)` | bool    | this admin holds an unrevoked, unexpired `support_access_sessions` row for `org` (`0028`); `write` additionally requires `scope = 'read_write'` |
| `public.has_platform_role(roles text[])`              | bool    | current user holds one of these `platform_admins.role` values (`0015`)                                                                          |

### 5a. Grants — the outer envelope (`0056`, narrowed by `0075`)

RLS decides which rows; GRANT decides whether the role reaches the table at all.
`0056` made the grants explicit so the migration set is reconstructible, and
recorded them exactly as the hosted project had them. `0075` narrows `anon`,
which `0056` deliberately left for a reviewed migration of its own.

**`anon` now holds nothing in `public`** except `usage` on the schema and
`execute` on `preview_invite` — the one thing the logged-out app calls, so
`/invite/:token` can render who invited someone before they have an account.
It also loses `execute` on the six security predicates and every other callable
function, so `/rest/v1/rpc/` answers nothing to an anonymous caller.

Three things worth knowing, each verified against the live catalogue rather than
inferred from the migration files:

- **The CRUD grants really were inert.** Every policy in `public` requires one
  of the identity predicates above; no table has RLS disabled; no RLS-enabled
  table lacks a policy; and all three views are `security_invoker = true`. An
  anon session could already read no row.
- **`TRUNCATE` was not inert.** The hosted default ACL grants `arwdDxtm`, not
  the CRUD set `0056` documented, and **RLS does not filter TRUNCATE**. It was
  unreachable only because `anon` is `NOLOGIN` and PostgREST never issues the
  statement — a property of a component we do not control. `0075` removes it
  from `anon` entirely and from `authenticated` too, along with `REFERENCES`
  and `TRIGGER`.
- **`0056`'s claim that "a new table gets no privileges" was false here.**
  It holds for a fresh Postgres built from these migrations; on the hosted
  project `pg_default_acl` grants `anon=arwdDxtm` on every table created in
  `public`, so the next migration to add a table would have undone the revoke.
  `0075` alters the default privileges for `anon` only. `authenticated` and
  `service_role` keep theirs deliberately: a new table that is dead on arrival
  for `authenticated` turns a forgotten GRANT into a silent 401 in a feature
  nobody had reason to suspect.

Fifteen `returns trigger` functions still carry PUBLIC EXECUTE and are left
alone: Postgres refuses to call a trigger function directly, so the grant
confers nothing.

> ⚠️ **The default ACL keeps `authenticated`, so a new function is callable by
> every signed-in user unless you say otherwise — and `revoke … from public,
anon` does NOT say otherwise.** `announcement_audience` (`0087`) shipped with
> exactly that mistake and needed `0088` to close it: revoking the two roles
> named left the grant that was never named. A SECURITY DEFINER helper whose
> callers do its authorisation for it must be revoked from `authenticated`
> explicitly, and the revoke is worth an assertion, because nothing about the
> migration's text shows the grant that is still there.

Baseline policy shape:

| Scope                                                                                                                    | Read                                                                                                       | Write                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Shared scheduling data (`organisations`, `locations`, `departments`, `shift_types`, `rotas`, `shifts`, `announcements`)  | `is_org_member(org_id)`                                                                                    | `has_org_role(org_id, ['owner','manager'])`                              |
| Personal data (`availability`, `leave_requests`, `overtime_requests`, `clock_events`, `emergency_contacts`, `documents`) | own row (`staff_profile_id = my_staff_profile_id(org_id)`) **or** manager/owner in org                     | staff may write their **own** rows; managers/owners may write any in org |
| `memberships`                                                                                                            | `is_org_member(org_id)`                                                                                    | `has_org_role(org_id, ['owner'])` (owners manage the team)               |
| `notifications`                                                                                                          | `user_id = auth.uid()`                                                                                     | insert by service/Edge Function; user updates `read_at` on own rows      |
| `subscriptions`, `invoices`, `audit_logs`                                                                                | `has_org_role(org_id, ['owner'])` (+ platform roles: `invoices` finance, `audit_logs` all)                 | Edge Functions / owners only                                             |
| Platform tables (`incidents`, `feature_flags`, `plans`, `support_cases`, `platform_settings`, …)                         | own `is_platform_admin()`/`has_platform_role()` policy per table (§4) — **not** gated by a support session | SECURITY DEFINER RPCs only                                               |

There is **no** blanket public-read policy. Unauthenticated requests return nothing.
These policies are a solid, working baseline. Tighten per feature as flows land.

**Platform-admin access to tenant data is session-gated, not standing** (`0028_support_access_gate.sql`).
Every tenant policy above resolves through `is_org_member()`/`has_org_role()`, and since `0028`
those no longer treat `is_platform_admin()` as sufficient on its own — a platform administrator
reads a tenant only while `has_support_access(org, false)` is true (an open `support_access_sessions`
row, per §4), and writes only with `has_support_access(org, true)` (`scope = 'read_write'`). Before
`0028` the two functions ended `or public.is_platform_admin()`, so every platform administrator could
read and write every organisation's rotas, staff records, clock events and leave at any time, with no
grant and no expiry — `support_access_sessions` (`0019`) recorded a reason but nothing consulted it.
Without an open session, `AdminOrganisationDetailPage`'s Users/Locations/Data tabs return nothing for
a platform administrator, by design — the screen says so rather than rendering an empty table. Platform
tables (`incidents`, `feature_flags`, `plans`, `platform_settings`, and the rest of §4) deliberately do
**not** route through these two functions and keep their own `is_platform_admin()`/`has_platform_role()`
policies — running the business doesn't require an open session on a tenant. Aggregate sizing
(`platform_tenant_counts()`, §6) is the one exception that reads past this gate: it's SECURITY DEFINER,
gated on `is_platform_admin()` directly, and returns counts only, never a row — a support session isn't
needed to know an organisation has 248 staff, only to know who they are.

**`organisations` read is a deliberate exception** to the table above:
`is_org_member(id) OR (created_by = auth.uid() AND no membership row exists yet for
that org)` (`0003_fix_organisations_select_rls.sql`, narrowed by
`0005_narrow_organisations_select_rls.sql`). Without the `created_by` clause,
`insert(...).select().single()` fails RLS for the very first org a user creates. Postgres checks the new row against the SELECT policy for `RETURNING` _before_ the
`on_org_created` trigger has inserted their membership row, so `is_org_member` alone
can't see it yet. `0003`'s original fix left that clause unconditional, which let the
creator read the org forever, even after their membership was removed or suspended.
`0005` scopes it to the genuine bootstrap window only. The instant `on_org_created`
inserts the owner's membership row (same transaction), the `not exists` check flips
and only `is_org_member()` governs access, same as every other tenant table.

## 6. Automation

**This section is selective, and says so on purpose.** It explains the functions whose
*behaviour* a reader has to know before changing something — the ones that are load-bearing
for tenancy, for the audit trail, or for a boundary. It is **not** a catalogue: there are
111 `security definer` functions in `public` and roughly half are named here. Do not read an
absence as "does not exist". The list itself is one query, and a query cannot go stale:

```sql
select proname, prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' order by 1;
```

Enumerating all of them here was considered and rejected: a hand-maintained list of a
hundred names is the same shape as every count this repository has had to correct, and the
one thing it would add over the query is the opportunity to be wrong.

- **`handle_new_user()`** (from `0001`): creates `profiles` + `app_settings` on sign-up.
- **`set_updated_at()`**: keeps `updated_at` accurate on every table.
- **Conflict/summary logic** (rota conflict detection, timesheet rollups): computed in
  the client for V1; heavier/scheduled jobs move to **Supabase Edge Functions +
  `pg_cron`** (never on cPanel). Inngest was the dispatch path until `0087` and
  is no longer used: notifications are enqueued by triggers and drained by
  `pg_cron` + `pg_net`.
- **`set_org_status(org, status, reason?)`** (`0017`, `security definer`): the only
  write path that can move an `organisations.status` into `suspended`/`archived`.
  Gated to a platform owner/admin's own JWT — **except** `auth.uid() is null`
  (`0051_org_status_service_role.sql`), which lets `supabase/functions/stripe-webhook`
  call it too: that function runs as `service_role` with no end-user session, since
  Stripe calls it directly, so it uses this to suspend an organisation once Stripe's
  dunning (Smart Retries) is exhausted. Every real admin caller has a real
  `auth.uid()`, so the exception never widens what an authenticated user can do.
- **`has_support_access(org, write?)`**, and `is_org_member()`/`has_org_role()`
  redefined to consult it (`0028`, `security definer`): see §5 — a platform
  administrator reads/writes tenant data only through an open
  `support_access_sessions` row, not by virtue of the role alone.
- **`platform_tenant_counts(org)`** (`0028`, `security definer`): the one function
  that reads _past_ the `0028` gate — returns staff/location/rota/shift counts for
  an org with no open support session required, gated on `is_platform_admin()`
  directly. A number, never a row: sizing a tenant doesn't require knowing who's in it.
- **`consume_org_rate_limit(bucket, org, limit, window)`** (`0089`,
  `security definer`, `authenticated`): a per-ORGANISATION limiter, alongside
  `consume_my_rate_limit`'s per-user one. It is the only client-callable
  limiter that takes its subject as an argument, and it checks `is_org_member`
  before using it — that check is the entire reason naming a subject is safe
  here, since a member can only spend an allowance they could spend anyway by
  making the requests. Buckets are a fixed list (`ai_assistant_org`), because
  an invented bucket name would be an unlimited private allowance.
- **`announcement_audience(announcement)`** (`0087`, `security definer`, stable): the
  user ids an announcement is addressed to, from its own department/location scope.
  One definition, shared by the publish trigger and the unread reminder — the page
  used to resolve the audience from its own loaded staff list, so an announcement's
  reach depended on a client-side cache.
- **`remind_announcement_unread(announcement)`** (`0087`, `security definer`,
  owner/manager): enqueues one reminder to everyone in the audience who has no
  `announcement_reads` row, and returns the count. An RPC rather than a trigger
  because pressing "Remind unread" changes no row — there is no transition to hang a
  trigger on. It still commits the outbox row before returning, which is the property
  that matters.
- **Notification enqueue triggers** (`0087`): `leave_requests_enqueue_reviewed` and
  `shift_swaps_enqueue_reviewed` fire when a request moves to `approved`/`rejected`,
  and `announcements_enqueue_published` when `published_at` first becomes non-null.
  Each skips the case where the reviewer IS the requester, and an edit to an
  already-published announcement notifies nobody a second time.
- **`probe_platform_health()`** (`0076`, `security definer`, `pg_cron` every five
  minutes): writes `platform_health_samples` with `source = 'scheduled'` whether or
  not anyone is looking — the database directly, Auth and REST over `pg_net`. Records
  **status only**: `net._http_response` carries no duration, and `created - sent_at`
  includes the pg_net worker's polling interval, so a latency built from it would be
  mostly scheduler noise. Prunes the table at 90 days, which nothing else does — it is
  deliberately not in `retention_policies`, because that register is the
  customer-facing data-protection one and platform telemetry holds no personal data.
  `platform_health_summary` therefore answers **two questions from two sources**:
  uptime from scheduled samples where they exist (`measured_from`), latency from
  whatever actually timed something (`latency_from`). Averaging a browser round trip
  with an in-region one is what `0027` warned about.
- **`rate_support_case(case, score, comment?)`** (`0024`, message clarified in
  `0077`): the requester's satisfaction score for a _resolved_ case, 1-5. Three
  refusals, all with their own wording since `0077`: not the requester (`42501`),
  not yet resolved (`22023`), score out of range (`22023` — it used to fall through
  to the column CHECK and read as `support_cases_csat_check`). Re-rating is allowed
  deliberately, so a mis-tap is correctable. Called from `/app/help`; it had no
  caller at all between `0024` and 2026-08-30, which is why `csat` was always null.
- **`platform_staff_counts()`** (`0078`, `security definer`, platform-admin-only):
  active staff per organisation across every tenant, aggregate only. This is the
  population `plans.seat_limit` is enforced on by `enforce_seat_limit()` (`0070`) —
  the console's Usage bar used **memberships** until 2026-08-30, which is a
  different and much smaller number because `staff_profiles.user_id` is nullable
  (BUG-062). Aggregate-only for the reason `platform_location_counts()` gives: since
  `0028` a platform administrator needs a support session to read tenant rows, so a
  direct select would return a confident zero for every organisation without one.
- **`enforce_retention(dry_run?)`** (`0029`, `security definer`, `pg_cron` nightly):
  deletes rows past their `retention_policies.retain_months` window and writes a
  `retention_runs` row. Skips any policy with `retain_months = null` (indefinite —
  `audit_logs`) and skips deleted-tenant cascade entirely (§4.8).
- **`flag_enabled_for_org(key, org)`** (`0022`): hashes `key` + `org_id` so the same
  org always lands on the same side of a percentage rollout. Nothing in `src/` calls
  it directly; the client-facing entry point is **`my_feature_access(org)`** (`0030`),
  read by `useFeatureAccess`.
- **`org_has_feature(org, feature)`** (`0030`): a plan entitlement, not a flag —
  true when `plans.features` lists it. Enforced server-side by
  `supabase/functions/ai-rota-assistant`, which refuses `ai_rota_assistant` with a
  403 and `code: 'plan_required'` before reading any tenant data or contacting
  OpenRouter. The UI gate is a courtesy; this is the control, because the endpoint is
  reachable with any member's JWT and every call spends money.
- Both entitlement functions are guarded by `is_org_member` since **`0074`**. They
  are `security definer`, so RLS does not apply inside them, and before that guard
  any signed-in user could read which plan tier any organisation was on by passing
  its id. The predicate is `is_org_member` **alone**: per `0028` that already covers
  a platform administrator holding an active support-access session, and adding
  `or is_platform_admin()` would re-open the standing cross-tenant access `0028`
  exists to close. A non-member gets `false` and an empty set rather than an error,
  so the refusal does not confirm the organisation exists.
- Every name in `plans.features` is read by something (`0090`, BUG-064).
  `ai_rota_assistant` is enforced in the Edge Function that spends the money
  (`0074`); `advanced_reporting` gates the Reports screen; `gps_clock_in` was
  **removed from every plan**, because every plan included it and a gate that can
  never refuse is not a gate. It now resolves to `false`, deliberately: a name that
  answers "false" fails visibly if somebody wires it up, where one answering "true
  for everyone" would not.
- **`advanced_reporting` is enforced in the client, and that is the honest ceiling.**
  The Reports screen computes every row in the browser from `clock_events` and
  `staff_profiles` — rows RLS already grants the organisation because they are its
  own records. There is no server-side report endpoint to refuse, and withholding a
  customer's own data from them would be a worse product than an unlocked screen. It
  is packaging, not a control, and the difference matters: `seat_limit` and
  `location_limit` govern writes and are enforced by triggers (`0070`), and
  `ai_rota_assistant` spends money per use and is enforced server-side (`0074`).
- **`admin_create_organisation_with_invite(...)`** (`0052`, `security definer`,
  platform-admin-only): atomically inserts an organisation with `created_by = null`
  (so `on_org_created` never fires and no membership row is created), creates its
  subscription at the negotiated price, and issues the owner invite for the real
  contact — for the case where a prospect contacted sales directly instead of
  self-serve signup (`organisations_insert`, `0002`, which requires
  `auth.uid() = created_by`). The platform admin never holds membership, not even
  transiently within the transaction.
- **`create_invite(org, email, role)`** (`0006`; bootstrap exception in `0052`): both
  of its permission gates now also accept a platform owner/admin inviting the very
  first `owner` into a genuinely member-less org — the counterpart the admin-created
  org above needs to actually reach its real owner. Every other caller is unaffected;
  the exception only fires when no membership row exists yet for that org.
- **`staff_profiles_auto_link_account()`** (`0053`, trigger, `security definer`,
  before insert/update of `email`/`org_id` on `staff_profiles`): if `email` is set
  and `user_id` is still null, links it to a matching active membership in the same
  org. Never overwrites an existing `user_id`.
- **`accept_invite(token)`** (`0006`; account-linking added `0053`): now also links
  any `staff_profiles` row in the invite's org still waiting on that email — the
  other half of the auto-link trigger above, for whichever order the HR record and
  the invite acceptance happen in.
- **`platform_location_counts()`** (`0054`, `security definer`, platform-admin-only):
  per-org location counts with no open support session required, the same shape as
  `platform_tenant_counts` above — `locations_select` itself stayed gated behind
  `is_org_member()` (`0028`)/`0031`'s carve-out never covered it, so a direct count
  silently read zero for every org without an open session.

## 6a. Rota lifecycle (`0061`) — Draft, Published, Amended

A published rota is **immutable**. It is what staff have been told, so it is not
edited in place; it is replaced.

```text
draft ──publish_rota()──> published ──begin_rota_revision()──> draft (supersedes_rota_id = published.id)
                              │                                     │
                              │                                     ├─ publish_rota()  ─> published, and the one it
                              │                                     │                     supersedes becomes archived
                              │                                     └─ discard_rota_revision() ─> gone; published unchanged
                              └── unpublish_rota() ─> draft   (refused while an amendment is open)
```

Staff read paths filter on `status = 'published'` and need no change: both the
amendment (`draft`) and the version it replaced (`archived`) fall outside that
filter, so staff see exactly one version of a week at all times, including
during an amendment.

Three guards make this true for a direct PostgREST call, not only for the UI —
the defect being closed (BUG-028) was a rule stated in one screen's copy and
honoured by no mutation path at all:

- **`shifts_guard_immutable_rota`** — refuses any `insert`/`update`/`delete` of a
  shift whose rota is `published` (`ROTA1`) or `archived` (`ROTA2`).
- **`rotas_guard_status_change`** — a rota is born a draft, and `status` moves only
  inside the functions below, which set a transaction-local
  `rotaflow.rota_transition` flag. A raw `PATCH` of the column is refused (`ROTA3`).
- **`rotas_published_unique_location` / `_no_location`** — at most one published
  rota per org/location/period, the published-side counterpart to `0059`'s draft
  indexes.

Both guards stand down when `auth.uid()` is null: that is server-side code (the
nightly retention job, Edge Functions on `service_role`), not an end user.

**The one end-user exception** is `apply_swap_reassignment(swap_id)`. Approving a
shift swap legitimately changes a published rota — both people agreed and it was
approved, and staff should see the new name immediately rather than waiting for a
republish. It is narrowed to one column, checks the same people 0002/0043 allow to
finalize the swap, sets `rotaflow.shift_transition` to pass the guard, and writes a
`rota.shift_reassigned` audit event that the previous client-side `updateShift`
call did not.

Audit coverage is `rota.published`, `rota.republished`, `rota.unpublished`,
`rota.superseded`, `rota.amendment_started`, `rota.amendment_discarded`,
`rota.shift_reassigned` and — new in `0061`, closing BUG-035 — **`rota.deleted`**.
Before this a rota could disappear with no record at all, which made a production
disappearance impossible to attribute.

## 6b. Deleting an organisation (`0063`)

Nothing could delete a tenant before this — no UI, no console action, no RPC
(BUG-009). Five database guards refused it, and they surfaced one at a time,
each failure hiding the next:

| Guard                                                                      | Why it refused                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `organisations_audit`, `memberships_audit`, `rotas_audit`, `invites_audit` | each cascade fires an audit trigger that INSERTs an `audit_logs` row referencing the organisation being deleted → `audit_logs_org_id_fkey` |
| `memberships_keep_one_owner` (`0047`)                                      | refuses to remove the last owner, with no exemption for "the organisation is going too"                                                    |

`delete_organisation(org, confirm_name)` sets a transaction-local
`rotaflow.org_deleting`; `audit_write` and `memberships_keep_one_owner` stand
down **for that organisation, in that transaction only**. Every other tenant's
guards stay armed — which `alter table … disable trigger` would not have
managed, and which has already gone wrong here once: a script disabled
`audit_logs_no_update` and never re-enabled it.

Caller must be an owner of the organisation or a platform admin, and must type
the organisation's name exactly. `organisation_deletion_preview(org)` returns
the row counts the confirmation dialog shows.

**The cascade is the mechanism, so new tables are covered automatically — and
that was verified rather than assumed on 2026-08-31.** `0063`'s header says
the delete "cascades into 32 tables"; production now reports **37** foreign
keys to `organisations` with `on delete cascade`, and the difference is
exactly the five tenant tables added that day (`calendar_feed_tokens`,
`staff_pay_rates`, `staff_locations`, `role_delegations`,
`notification_templates`). The number in the migration header is immutable and
now stale; this is where to read the current one.

What that does NOT cover is a table whose foreign key is `on delete set null`
rather than cascade: those rows SURVIVE the organisation, with `org_id` null.
Three do, and the difference between them matters:

| Table           | Survives with a null `org_id` because                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_logs`    | Deliberate, and stated in `0063`: an audit trail a tenant deletion erases is not an audit trail. The organisation's NAME is copied onto each row so the history stays readable.                                                                                |
| `gdpr_requests` | Almost certainly right and **not written down anywhere until now**: the evidence that an erasure or access request was handled has to outlive the tenant, or the one record proving compliance disappears with the customer who complained.                    |
| `support_cases` | Same shape, weaker argument. A closed support history is useful and is not obviously ours to keep. Worth a decision rather than an inheritance — nobody chose this, it came from the column being nullable so a case could arrive before the tenant was known. |

None of them is visible to a tenant afterwards: every policy on those tables
goes through `is_org_member(org_id)`, which is false for null, so a surviving
row is reachable only by a platform admin.

The check is one query, and is worth running after adding any table:

```sql
select child.relname from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_class parent on parent.oid = c.confrelid
 where c.contype = 'f' and parent.relname = 'organisations'
   and c.confdeltype <> 'c';
```

What survives, by design: `audit_logs`, `gdpr_requests` and `support_cases` all
hold `org_id … on delete set null`, and audit rows carry an `org_name`
snapshot. The `org.deleted` event is written _before_ the delete so it survives
the same way. Everything else org-scoped (32 cascading tables) goes.

## 6c. Indexes (`0002`, then `0072`)

`0002` gave every table single-column indexes on its foreign keys. Almost every
list query in `src/services` is shaped `.eq(<scope>, …).order(<time>, desc)`, so
those served the filter and Postgres sorted the result afterwards. `0072` adds
the composite that covers both halves, one per query that actually issues it:

| Table               | Index                                                                      | Read it serves                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rotas`             | `(org_id, location_id, period_start, period_end)`                          | `listRotasForPeriod` — the only prior cover was 0059's two **partial** unique indexes (`where status = 'draft'`), and this lookup deliberately does not filter on status |
| `shifts`            | `(org_id, starts_at)`                                                      | `listShiftsForPeriod` — every schedule view                                                                                                                              |
| `shifts`            | `(rota_id, starts_at)`                                                     | `listShiftsForRotas` — the builder grid                                                                                                                                  |
| `clock_events`      | `(staff_profile_id, event_at)`                                             | one person's timesheet                                                                                                                                                   |
| `clock_events`      | `(org_id, event_at desc)`                                                  | manager review                                                                                                                                                           |
| `staff_profiles`    | `(org_id, first_name) where active`                                        | `listStaff`, on nearly every screen — partial, so it stays small                                                                                                         |
| `leave_requests`    | `(org_id, created_at desc)`, `(staff_profile_id, created_at desc)`         | the manager queue and a person's own history                                                                                                                             |
| `overtime_requests` | `(org_id, created_at desc)`, `(staff_profile_id, date desc)`               | same pair; the staff view sorts by the day worked, not the claim date                                                                                                    |
| `shift_swaps`       | `(org_id, created_at desc)`, `(requested_by)`, `(target_staff_profile_id)` | the last two are separate rather than composite so the `requested_by OR target` lookup can take a BitmapOr                                                               |
| `notifications`     | `(user_id, created_at desc)`                                               | the bell, polled on every page                                                                                                                                           |
| `audit_logs`        | `(org_id, created_at desc)`                                                | 0016 indexed the actor and platform views but not the org-scoped one an owner opens                                                                                      |
| `documents`         | `(org_id, expires_at)`                                                     | expiry reminders                                                                                                                                                         |

The single-column indexes stay — they still serve lookups that do not sort.

⚠️ `0072` uses a plain `CREATE INDEX`, not `CONCURRENTLY`, because the latter
cannot run inside a transaction and the CLI wraps each migration in one. That is
safe only because production is effectively empty. **Replaying it against a
populated database would take a SHARE lock and block writes for the duration —
build those by hand with `CONCURRENTLY` instead.**

## 7. Generating TypeScript types

Keep `src/types/database.types.ts` in sync once the DB exists:

```bash
supabase gen types typescript --project-id <ref> --schema public \
  > src/types/database.types.ts
```

The Supabase client is `createClient<Database>(…)`, so every query is fully typed.
`src/types/index.ts` exposes row aliases (`Organisation`, `Shift`, `LeaveRequest`, …). Add them there as tables are generated.

## 8. Migration policy

- One numbered file per change (`0002_rotaflow.sql`, `0003_…`). Additive & idempotent
  (`if not exists`). **Never edit an applied migration**. Add a new one.
- Every new table: `org_id`, RLS enabled, membership-scoped policies, `set_updated_at`.
