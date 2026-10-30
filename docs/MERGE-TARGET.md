# Merge target: RotaFlow absorbs SiteRelay

Status: **PLANNED** (Phase 01 of the App-Kit Route B merge, 30 October 2026). Nothing in this
document is built. It becomes the plan of record for the merge once the owner approves it, and
`docs/SAAS.md` stays the only place a capability's status is set.

Route B: RotaFlow is the base and keeps its code, design, brand and domain (rotaflow.space).
SiteRelay is a read-only donor whose behaviour is re-made in RotaFlow's design, then retired.
RotaFlow's Supabase back end is replaced by a PHP API, MariaDB on cPanel and Clerk (email code
only), per the owner's house-stack move. The evidence behind every statement here is the Phase 0
inventory (`.local-state/phase0/`, gitignored).

## 1. Product brief

**Who.** Organisations that run shift-based teams: owners and managers build and publish rotas,
staff view shifts, clock in, request leave, swap or claim shifts. One product, one database,
tenants separated by `org_id`.

**What changes.** The same product on a simpler, cheaper stack, plus the parts of SiteRelay that
RotaFlow lacks and that fit a rota product without a client or site model:

1. A review workflow for staff documents (right to work, DBS, first aid and similar), with
   eligibility used when someone claims or is assigned a shift.
2. Absence reporting and cover requests with a manager decision.
3. Working-time warnings when publishing or assigning (rest period, weekly hours).
4. A rota pattern generator that is safe across clock changes.
5. Timesheet export for payroll (CSV that cannot carry spreadsheet formulas) and tolerance flags.
6. SiteRelay's proven infrastructure: Clerk token check, hardened SMTP, email digest outbox with
   retry, private file storage, rate limiter, single-instance cron runner, checksummed migrations.

**Out of scope for this merge** (see section 5): sites and clients as a model, field visits,
incidents, service requests, client reports and portal, the website editor, SiteRelay's demo.

**Unchanged:** Stripe billing (test mode until the owner switches it), web push, GPS clock-in, AI
rota assistant, marketing pages, offline outbox, platform console core. Phase 0 found no piece of
these dead; the dead pieces are in the cut list.

## 2. Role model

| Role              | Source                                          | Notes                                                                                                                       |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Super Admin       | RotaFlow `platform_admins` row keyed by Clerk id | gakinz101@gmail.com. A database role, not a config list, so grants are audited. Platform sub-roles (support, finance) stay. |
| Organisation Owner | RotaFlow                                        | One per org at minimum (`memberships_keep_one_owner` rule becomes a PHP check).                                              |
| Manager           | RotaFlow, absorbs SiteRelay supervisor           | Supervisor is not a fifth role. Delegation (`role_delegations`) stays.                                                       |
| Staff             | RotaFlow, absorbs SiteRelay worker               | Own data only.                                                                                                              |
| Client contact    | SiteRelay                                       | **Dropped.** Needs the client/site model.                                                                                   |
| Content editor    | SiteRelay                                       | **Dropped.** RotaFlow's marketing pages are code.                                                                           |

**ASSUMPTION:** location-scoped managers (a supervisor who sees only their own site) do not exist
in RotaFlow today. This merge does not add them. Revisit with the site model if it is ever built.

Authorisation is a PHP check on every request, derived from the verified Clerk session and the
database, never from the request body. A UI role check stays cosmetic.

## 3. Data model

**Engine and conventions.** MariaDB, InnoDB, utf8mb4, ids `CHAR(36)` UUIDs generated in PHP,
all times UTC `DATETIME`, IANA timezone kept on `locations`/`organisations`. Every tenant table
carries `org_id`, with SiteRelay's composite foreign key pattern `(org_id, x_id) -> x(org_id, id)`
so a cross-tenant reference is impossible at the database, replacing RLS as the backstop. A
non-member gets 404, not 403. Numbered migrations with a checksum guard (SiteRelay's runner, with
a real statement splitter). Separate runtime and migration database users.

**Identity.** `auth.users` and `profiles` are replaced by `users(id, clerk_user_id unique, email)`.
`memberships.user_id` points at it. A first sign-in by an approved email links the record; an
unknown email gets no access. No passwords, sessions or MFA are stored.

**Kept from RotaFlow (about 52 tables)**, translated to MariaDB: organisations, memberships,
locations, departments, staff_profiles, staff_locations, staff_pay_rates, job_titles, shift_types,
rotas, shifts, availability, leave_requests, overtime_requests, shift_swaps, clock_events,
clock_event_corrections, timesheets, emergency_contacts, documents, announcements,
announcement_reads, notifications, notification_outbox, notification_deliveries,
notification_templates, push_subscriptions, org_smtp_settings, calendar_feed_tokens, invites,
subscriptions, plans, invoices, invoice_credits, billing_events, minimum_cover_rules,
role_delegations, audit_logs, gdpr_requests, enquiries, support_access_sessions, support_cases,
support_case_messages, support_sla_targets, platform_admins, platform_settings,
platform_announcements (+ deliveries, optouts), feature_flags (+ targets, changes), incidents and
incident_updates (the status page), retention_policies, retention_runs, storage_deletions,
account_deletions, app_settings.

**Added from SiteRelay (about 9 tables):** `files`, `rate_limits`, `schema_migrations`,
`notification_preferences`, `email_outbox`, `email_outbox_items`, `document_types`,
`cover_absences`, `cover_requests`, `cover_applications`. `document_reminders` and a review
status on `documents` replace the single `expires_at` check. `documents` gains
`status`, `reviewed_by`, `superseded_by`; the SiteRelay table `member_documents` is not copied.

**Changed in kind, not in meaning:** `jsonb` becomes `JSON` with `JSON_VALID`; `text[]` columns
(`skills`, `features`, `target_plans`, `audience_plans`, `permitted_file_types`) become join tables
or JSON; partial unique indexes become generated-column unique indexes; `inet`/`cidr` become
`VARCHAR`; the leave-overlap exclusion constraint becomes a locked overlap check in a transaction.

**Rule ownership.** The 157 SECURITY DEFINER functions and 36 trigger functions in
`docs/DATA-MODEL.md` become PHP service methods inside transactions. Only immutability (the audit
log cannot be updated or deleted) stays a database trigger. Phase 3 produces the
policy -> PHP check -> test table; the target is every one of the 119 final policies accounted
for, not sampled.

**Data.** Nothing is migrated by me. SiteRelay holds no business data (28 rows, none business).
RotaFlow production is effectively one organisation; the owner moves it, and I never read, copy or
write Supabase data.

## 4. SiteRelay modules: keep or skip (owner decides)

My recommendation is column three. "Port" means the rule, not the code or screen; screens are
re-made in RotaFlow's design.

| Module        | What RotaFlow already has                         | Recommendation | What comes in                                                                                           |
| ------------- | ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| Compliance    | `documents` with `expires_at` and an expiry alert | **Keep**       | Document types, submit and review, four-eyes, supersede, eligibility check, d30/14/7 reminders           |
| Cover         | `claim_open_shift`, swaps                         | **Keep, part** | Absence reporting, cover requests, manager approval, eligibility on claim. Swaps stay RotaFlow's        |
| Scheduling    | rotas, `repeat_rota_weeks`, leave, availability   | **Keep, part** | Rest and weekly-hours warnings, pattern generator, clash list when deciding leave. Not templates        |
| Timesheets    | weekly approvals, corrections                     | **Keep, part** | Payroll CSV (formula-safe), tolerance flags. Approvals stay RotaFlow's                                  |
| Calendar      | `calendar-feed` function                          | **Keep, part** | The PHP iCalendar helpers, reused for the feed rewrite                                                  |
| Outbox        | `notification_outbox` (pg_net drain)              | **Keep (infra)** | Becomes the delivery mechanism on PHP: DB outbox, digest coalescing, retry, preferences by group       |
| Housekeeping  | storage purge queue                               | **Keep (infra)** | Purge of unattached uploads, folded into the cron runner                                                |
| People        | richer `staff_profiles`                           | Skip           | Nothing                                                                                                 |
| Fieldwork     | clock-in only                                     | Skip           | Needs the site model. SiteRelay has no checklist editor, never checks GPS and stores the code in clear   |
| Incidents     | status-page incidents only                        | Skip           | Needs the site model                                                                                    |
| Requests      | none                                              | Skip           | Needs client contacts                                                                                   |
| Reports       | none                                              | Skip           | Needs client contacts and fieldwork                                                                     |
| PublicSite    | marketing pages, `enquiries`, public-enquiry      | Skip           | The editor is an extra surface; RotaFlow's pages and enquiry form already exist                         |

If you choose Fieldwork, Incidents, Requests or Reports, the site/client model comes in first as its
own slice, and the role model in section 2 must be reopened.

## 5. Cut list

Proposed for removal from RotaFlow. Each needs your approval before it goes; none is deleted by me
without it.

| Item                                                                 | Evidence it is dead or replaced                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `background_jobs` table                                              | Legacy Inngest log, no writer (Inngest retired in `0087`)               |
| `platform_ip_allowlist`                                              | Display only, nothing enforces it                                       |
| `integration_connectors`, `org_integrations`, `integration_sync_runs`| Every connector `planned`; no writer for sync runs; Phase 2 in CLAUDE.md |
| `platform_health_probes`, pg_net health cron                         | Probes Supabase itself, which is retired                                |
| ImageKit: env var, cache rule, CSP entry, `VITE_IMAGEKIT_PUBLIC_KEY` | No code builds or uploads to it                                         |
| `VITE_APP_NAME`                                                      | Read by nothing                                                         |
| Supabase Auth screens: password, magic link, OAuth, MFA, sessions    | Replaced by Clerk email code                                            |
| `@supabase/supabase-js`, 12 edge functions, 164 migrations           | Replaced by the PHP API and fresh MariaDB migrations (history kept in git) |
| pgTAP suite (83 files)                                               | Postgres only. Replaced by PHP tests including an access sweep over every route |
| Service-worker cache of authenticated REST GETs (`supabase-api`)     | Breaks the rule that the service worker never caches API responses      |
| SiteRelay: demo mode, dev harness, site generator, CMS, `001` migration | Not carried over                                                     |

Fixes that are not removals but must land with the port: encrypt `org_smtp_settings.smtp_pass`;
the three edge functions never deployed (`public-enquiry`, `purge-storage`, `delete-account`)
become PHP endpoints that are actually live; the content-security policy names the five Clerk hosts.

## 6. Decisions still open

1. Module list in section 4: confirm or change.
2. Super Admin as a database role keyed by Clerk id (recommended: RotaFlow already has the roster
   and audit trail, and a config list has neither).
3. Clerk needs a custom session claim `email` for the SiteRelay-style token check. That is a
   Clerk instance change, so it needs your "go" at the start of Phase 3. The alternative is a
   Backend API lookup per sign-in, which needs a Clerk secret key on the server.
4. RotaFlow's tooling moves to the house standard (pnpm, Biome, Node 24, one `check` script) as a
   separate step before any port.
