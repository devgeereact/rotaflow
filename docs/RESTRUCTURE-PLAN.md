# Restructure plan: slices, risks and per-module detail

Status: **PLANNED** (Phase 02 of the App-Kit Route B merge, 30 October 2026). Nothing here is built.
The target it serves is `docs/MERGE-TARGET.md`, which the owner approved on 30 October 2026
(module list, Super Admin as a database role, Clerk `email` session claim, cut list, no
location-scoped managers). Capability status is still set only in `docs/SAAS.md`.

## 1. Source to destination map

Classes follow the kit: KEEP (copy as is), REFACTOR, MIGRATE (data, auth, config, separate plan),
GENERATED (rebuild), DUPLICATE, ARCHIVE, UNSURE.

| Area                                                          | Class        | Plan                                                                                   |
| ------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| RotaFlow `src/components`, `src/pages` (non-auth), design tokens, marketing, prerender | KEEP         | Unchanged apart from the data layer under them                                         |
| RotaFlow `src/services/*` (59 modules)                        | REFACTOR     | Same exported functions, re-pointed from supabase-js to `src/lib/api.ts`               |
| RotaFlow `src/lib` pure logic (hours, geo, filters, attendance) | KEEP         | `moduleBoundaries.test.ts` keeps it free of I/O                                        |
| RotaFlow auth pages and `useSupabaseAuth` (38 readers)        | REFACTOR     | Keep the hook's shape; Clerk behind it. Password, OAuth, MFA, session screens deleted |
| RotaFlow `useRealtimeRefresh` (17 call sites)                 | REFACTOR     | Same signature; polling inside                                                         |
| RotaFlow offline outbox (`offlineOutbox.ts`, `syncQueue.ts`)  | REFACTOR     | Keep; replace Postgres error-code and unique-index-name detection with API 409 codes   |
| RotaFlow `vite.config.ts` PWA                                 | REFACTOR     | Stop caching authenticated GETs                                                        |
| RotaFlow `supabase/migrations` (164), functions (12), tests (83 pgTAP) | ARCHIVE      | Stay in git history; not carried into the PHP tree. Retired by the owner at the end    |
| RotaFlow docs                                                 | REFACTOR     | Rewrite list in section 7                                                              |
| SiteRelay `backend/src` infrastructure                        | MIGRATE (code) | Copy with the fixes in the Phase 0 report (section 8 of `siterelay-backend.md`)      |
| SiteRelay modules Compliance, Cover, Scheduling, Timesheets, Calendar | REFACTOR | Re-made for RotaFlow's tables and roles; rules and tests ported                         |
| SiteRelay People, Fieldwork, Incidents, Requests, Reports, PublicSite | ARCHIVE | Read-only in the archive taken in Phase 8                                              |
| SiteRelay `src`, `site`, `app`, demo, dev harness             | DUPLICATE / GENERATED | Not carried; screens re-made in RotaFlow design                               |
| SiteRelay `tests/*.test.ts` pure logic                        | REFACTOR     | Ported into vitest beside the RotaFlow logic they test (DST/time, leave, swap, timesheet flags) |

New top-level folder: **`backend/`** (PHP API, migrations, cron, tests), the house-standard location. It is
the one addition to `docs/ARCHITECTURE.md`'s layout and is recorded there in slice S1.
Only `backend/public/api/index.php` is web-reachable; everything else is outside the webroot on the server.

## 2. Delivery shape: two releases

**Recommendation: R1 is a like-for-like re-platform; R2 brings in the SiteRelay modules.**
Why: the Clerk switch is all-or-nothing for the browser (a build cannot talk to Supabase Auth and
Clerk at once), so there is no safe half-way release. Mixing new behaviour into that cutover would
make a regression impossible to attribute. R1 then has one question ("does it behave as before"),
R2 adds behaviour one module at a time.

All work lands on a local branch `move/cpanel-clerk` (the owner's house convention). `main` and
rotaflow.space keep running on Supabase until the R1 cutover is approved. Nothing is pushed
without the owner's word.

## 3. Slice order

Each slice ends with: the gate green (`pnpm check` once S0 lands), new-user, error and
permission-denied paths exercised, policy -> PHP check -> test rows written, the owning docs updated,
`.agent/CURRENT-TASK.md` updated. A slice that fails stops the line.

### R1: re-platform (no new behaviour)

| Slice | Content                                                                                                      | Depends on | Owner action needed                                           |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------- |
| S0    | Tooling to house standard: pnpm, Biome, Node 24 pin, `.node-version`, one `check` script. Mechanical commits; format commit separate | none | Approve running the installer and Biome formatter; `check` stays green before and after |
| S1    | API skeleton in `backend/`: router, `Jwt` (fixed J1/J2/J4/J7), `Db`, `HttpError`, `RateLimiter`, `Audit`, `Files`, migration runner (real splitter), cron runner, PHP test harness on a throwaway local MariaDB, `GET /health`. Local database built from structure only | S0 | Install local MariaDB if absent (3307 per `PORTS.md`) |
| S2    | Identity and tenancy: `users`, `organisations`, `memberships`, `invites`, `platform_admins`, `role_delegations`, `audit_logs`, `Scope` (404 for non-members, composite FKs), Clerk sign-in in the browser behind `useSupabaseAuth`'s shape, `src/lib/api.ts` | S1 | Phase 3 asks: Clerk `email` session claim (a Clerk write, needs your "go"); `VITE_CLERK_PUBLISHABLE_KEY` GitHub variable; cPanel database and two users |
| S3    | People and places: `locations`, `departments`, `job_titles`, `staff_profiles`, `staff_locations`, `staff_pay_rates`, `emergency_contacts`, `app_settings`, onboarding/setup | S2 | none |
| S4    | Rota: `shift_types`, `rotas`, `shifts`, `availability`, `minimum_cover_rules`; draft/publish/amend/repeat; publish lock; `useRealtimeRefresh` becomes polling | S3 | none |
| S5    | Time and requests: `clock_events` and corrections, `leave_requests` (overlap check in a locked transaction), `overtime_requests`, `shift_swaps`, open-shift claim, `timesheets` and approvals; offline outbox re-mapped to 409 codes | S4 | none |
| S6    | Communication: `notifications`, outbox + digest + retry, `notification_templates`, deliveries, announcements and reads, SMTP (hardened), `org_smtp_settings` with the password encrypted, web push sender with the existing VAPID keys, calendar feed (PHP iCalendar helpers), cPanel cron entries | S5 | Cron entry on the server (exact line supplied; you add it) |
| S7    | Billing and plans: plans, subscriptions, invoices, credits, `billing_events`; checkout, portal and billing-account endpoints; Stripe webhook with signature check and claim/complete/fail; seat and site limits, trial, grace, read-only as PHP checks. **Test mode only** | S2 | none (test keys stay in the server's private config) |
| S8    | Platform and compliance of the platform: Super Admin console (directories, support access with consent, cases and SLA, flags, platform announcements, health replaced by an external uptime check), GDPR requests and erasure, retention job, `storage_deletions`/`account_deletions` drained by cron (Clerk Backend API delete), enquiries with Turnstile, AI rota assistant endpoint, private file store for staff photos and documents | S2-S7 | Server-side Clerk secret key in private config (you place it) |
| S9    | Cut-over clean-up: remove supabase-js and every `supabase/` reference from `src`, CSP naming the five Clerk hosts, `/api` pass-through in the merged `.htaccess`, remove ImageKit and dead env vars, update docs. Access-sweep test over every route as stranger, wrong-tenant user, staff, manager, owner, anonymous | all above | none |
| **R1 gate** | Phase 5 (local-live), Phase 6 cutover plan, your written approval, then release | S9 | Backup, additive migrations first, rsync with `--exclude '/.htaccess'`, smoke tests, rollback, as in `docs/DEPLOYMENT.md` |

### R2: SiteRelay modules (one at a time, each its own gate and release candidate)

| Slice | Module                          | Order reason                                                          |
| ----- | ------------------------------- | --------------------------------------------------------------------- |
| S10   | Compliance (documents)          | Self-contained; its eligibility check is what S12 consumes            |
| S11   | Scheduling (warnings, patterns) | Pure logic first; low risk; extends the rota builder                  |
| S12   | Cover (absence, requests, eligibility on claim) | Depends on S10 and S11                                  |
| S13   | Timesheets (CSV, tolerance flags) | Independent; last because payroll output deserves the longest soak   |
| R2 gate | Same release process as R1, once per module or once for all, as you choose | |

SiteRelay infrastructure (Outbox, Housekeeping, Files, Calendar helpers, RateLimiter, Settings,
migration and cron runners) arrives inside R1 slices S1, S6 and S8, because the re-platform needs it.

## 4. Per-module detail (R2)

Endpoint paths are `/api/orgs/{o}/...` (RotaFlow tenant), method GET/POST only, JSON errors
`{"error":{"code","message"}}`. Migration names continue the new MariaDB series at the next number
after S9. Tests are PHP suites in `backend/tests/` plus vitest where logic is pure.

### S10 Compliance

| Aspect     | Plan                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screens    | Staff profile "Documents" section gains upload with type, status chips and a submit/withdraw action. New manager page "Compliance" (review queue, summary by type). Settings "Document types" (UK presets). Eligibility chip in the rota builder and open-shift card |
| Endpoints  | `GET/POST document-types`, `POST document-types/presets`, `POST document-types/{t}/update|archive`, `GET/POST documents`, `GET documents/queue`, `POST documents/{d}/submit|review|withdraw`, `GET compliance/me`, `GET compliance/summary`. Eligibility is an internal service, not an endpoint |
| Tables     | New `document_types`, `document_reminders`; `documents` altered (status, reviewed_by, reviewed_at, issued_on, superseded_by). Not copied: `document_type_sites`, `member_documents`, `member_profiles` (RotaFlow has richer equivalents). Existing `documents` rows stay valid (status defaults to `approved`, so nothing already uploaded becomes ineligible) |
| Rules kept | Upload never counts until approved; expiry computed in the org's timezone; replacing supersedes on approval; four-eyes (reviewer is not the person; a manager who uploaded for someone cannot approve unless owner); reminders d30/d14/d7 idempotent per document and stage; the existing `0093` expiring-document alert is folded into this job, not duplicated |
| Roles      | Manager and Owner: define types, review, queue, summary. Staff: own documents. Super Admin: none                                                                                                                                                              |
| Cron       | Reminder job on the 15-minute runner                                                                                                                                                                                                                         |
| Tests      | Port `060-compliance` cases; access sweep rows; vitest for the pure `expiryState` and eligibility functions                                                                                                                                                  |
| Docs       | `DATA-MODEL` (tables), `API-SPEC` (endpoints), `NOTIFICATIONS-SPEC` (job and kinds), `UX-SPEC` (screens), `SECURITY` (document retention), `SAAS` (rows), `CHANGELOG`                                                                                          |

### S11 Scheduling

| Aspect     | Plan                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screens    | Rota builder: warnings panel (rest, weekly hours, leave clash, unavailable) at assign and at publish preview; "Generate pattern" dialog. Leave decision dialog shows clashing shifts |
| Endpoints  | `GET rotas/{r}/publish-preview`, `POST rotas/{r}/patterns/generate`, leave decision response gains `clashing_shifts`. Copy-week stays RotaFlow's `repeat_rota_weeks` |
| Tables     | None new. Two org settings: minimum rest hours (default 11), maximum weekly hours (default 48), in `organisations.settings`                                          |
| Rules kept | Warnings never block; overlap does. Pattern times are org-local wall-clock so DST is safe; limits 92 days and 500 shifts per generation. **Port `src/account/time.ts` maths into `src/lib` with the clock-change tests, pinned to `Europe/London`** |
| Tests      | vitest for rest/hours/pattern/DST (the SiteRelay `scheduling-tools`, `time` and `leave` tests port directly); PHP suite for the endpoints                              |
| Docs       | `API-SPEC`, `UX-SPEC`, `DATA-MODEL` (settings keys), `SAAS`                                                                                                           |

### S12 Cover

| Aspect     | Plan                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screens    | Staff: "Report absence" and "Apply to cover" on the schedule and open-shift pages. Manager: cover board (absences, requests, applications, candidates with eligibility reasons). Swaps UI unchanged                       |
| Endpoints  | `GET cover/overview|open|mine`, `GET cover/shifts/{s}/candidates`, `POST cover/shifts/{s}/apply|assign`, `POST cover/requests` and `/{r}/cancel`, `POST cover/applications/{a}/withdraw|approve|reject`, `POST cover/absences` and `/{a}/withdraw|dismiss` |
| Tables     | New `cover_absences`, `cover_requests`, `cover_applications` (composite FKs on `org_id`). RotaFlow's `shift_swaps` and `claim_open_shift` stay                                                              |
| Rules kept | Approval in one transaction with the org row locked first, shift row locked, eligibility re-checked (active, no overlap, not the absentee, availability, leave, documents via S10); only that shift is published. **The instant claim on open shifts gains the same eligibility check.** Swaps auto-void if either shift changes, if RotaFlow's does not already (verify first) |
| Roles      | Manager/Owner decide. Staff apply and report                                                                                                                                                               |
| Cron       | Sweep: close cover requests for started or cancelled shifts                                                                                                                                                |
| Tests      | Port `030-cover` and `095-workflow`; concurrency test for two claims on one shift                                                                                                                          |
| Docs       | `DATA-MODEL`, `API-SPEC`, `NOTIFICATIONS-SPEC` (cover kinds), `UX-SPEC`, `SAAS`                                                                                                                            |

### S13 Timesheets

| Aspect     | Plan                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Screens    | Timesheets page: "Export payroll CSV" for approved periods, flag chips (late, early finish, overtime) beside each line                      |
| Endpoints  | `GET timesheets/export` (approved only, 31-day cap), flags computed in the existing list response                                           |
| Tables     | None new. Tolerance setting (default 10 minutes) in `organisations.settings`                                                                |
| Rules kept | Minutes from UTC instants, exact across DST; scheduled break deducted both sides; CSV with BOM and formula-injection-safe cells (`csvCell`) |
| Not ported | SiteRelay's per-line adjust/unlock model: RotaFlow's clock corrections and period approvals already cover it                               |
| Tests      | Port `081-timesheets` and the `timesheets` logic tests; CSV injection cases (`=`, `+`, `-`, `@`, tab)                                       |
| Docs       | `API-SPEC`, `UX-SPEC`, `SAAS`                                                                                                              |

## 5. Test strategy

- **Unit and logic:** vitest, pinned to `Europe/London`, exactly as now. Ported SiteRelay logic tests join it.
- **PHP:** one suite per module in `backend/tests/`, each in its own process on a fresh local MariaDB whose
  name must contain "test" and host must be local (SiteRelay's guard). Never live data.
- **Tenancy proof:** SiteRelay's access sweep, extended to RotaFlow's roles. It reads the router, then calls
  every route as anonymous, a user from another organisation, staff, manager and owner with random ids,
  and fails on any 500 or any data leak. This replaces the pgTAP RLS-invariant tests.
- **Policy table:** `docs/RLS-TO-PHP.md` is created in S2 and grows each slice: policy -> PHP check -> test.
  Done when all 119 final policies and the 6 storage policies are accounted for.
- **Browser:** Playwright specs stay, retargeted at the API; the offline spec is the one that must not regress.
- **Not run by me until cutover:** Stripe live mode, a real push on a phone, a real GPS clock-in on a phone.
  They stay NOT TESTED and appear on the cutover checklist as owner checks.

## 6. Risk list

| #  | Risk                                                                                                         | Likelihood / impact | Mitigation                                                                                                      |
| -- | ------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1  | 157 SECURITY DEFINER functions and 36 triggers hold rules nobody lists in one place; one missed becomes a security hole | High / High | Section 3 of the Phase 0 backend report is the checklist; each slice lists the rules it takes; `RLS-TO-PHP.md`; access sweep |
| 2  | Browser-only enforcement creeping back (limits, entitlements, minimum cover were once browser-only)          | Med / High          | Every limit and entitlement is a PHP check with a test that calls the API directly, not the UI                  |
| 3  | Clerk token lacks an `email` claim, or session tokens arrive "pending"                                       | Med / High          | Claim configured before S2 (needs your go); Jwt rejects `sts` != active; test against the dev instance first    |
| 4  | All-or-nothing auth switch: no half-way build                                                                | Certain / Med       | Branch isolation, R1 contains no new features, rollback is the previous build and its `.htaccess`               |
| 5  | Leave-overlap exclusion constraint has no MariaDB twin: double leave under concurrency                      | Med / Med           | Locked overlap check inside a transaction, concurrency test                                                     |
| 6  | Offline outbox depends on Postgres error codes and index names                                              | High / Med          | API returns stable 409 `already_applied`; outbox updated and re-tested in a browser (offline spec)              |
| 7  | Stripe webhook replays and namespace bugs (RF-04, RF-05 were exactly this and typechecked)                   | Med / High          | Port `reconcile.ts` and its 454-line test; signature check; claim/complete/fail events; read by hand            |
| 8  | Test-mode Stripe and web push have never been proven on a real charge or phone                               | Certain / Med       | Declared NOT TESTED; owner checks on the cutover list; live Stripe untouched                                    |
| 9  | CI is unavailable (Actions disabled since about 22 Oct); results unverified                                  | Certain / Med       | Local gate is the evidence; I prepare the enable command and ask before running it; rsync, no `--delete`        |
| 10 | Merged `.htaccess` loses the Cloudflare origin lock, or `/api` falls into the SPA fallback                   | Low / High          | Never overwrite; merge; explicit `/api` pass-through; deploy with `--exclude '/.htaccess'`; check after deploy  |
| 11 | CSP blocks Clerk (five hosts) and sign-in fails silently                                                     | Med / High          | CSP names clerk.rotaflow.space, cdn.protect.clerk.com, challenges.cloudflare.com, img.clerk.com, clerk-telemetry.com; smoke test signs in |
| 12 | The Clerk app has an unused development instance and a production user named "Founder TEST" who never signed in | Low / Low          | Treat as the Super Admin seed; confirm with you at S2                                                           |
| 13 | Plaintext secrets in the old schema (`smtp_pass`)                                                            | Low / Med           | Encrypted at rest with libsodium; key in private config; migration re-encrypts on first save                    |
| 14 | pgTAP coverage (817 assertions) disappears with Postgres                                                     | Certain / Med       | Access sweep plus per-module PHP suites; count of protected behaviours listed in `RLS-TO-PHP.md`                |
| 15 | cPanel shared hosting limits (PHP time, cron granularity, no long-running worker)                            | Med / Med           | Outbox drain every minute by cron, bounded batches; polling not websockets; web push sender batch-limited      |
| 16 | The tooling change in S0 (ESLint to Biome) hides regressions in a large codebase                             | Med / Low           | Format commit separate from lint-rule commits; `tsc` and tests unchanged and green before and after             |
| 17 | SiteRelay Jwt.php reuse brings its weaknesses                                                                | Med / Med           | J1, J2, J4, J7 fixed first; J6 resolved by the claim decision; its alg-confusion tests copied                   |
| 18 | Documentation drift: 14 docs reference Supabase, RLS or Postgres                                             | Certain / Med       | Section 7; `check:docs` runs per slice; a doc is rewritten in the slice that makes it false                     |

## 7. Documentation rewrite list

Rewritten in the slice that makes each statement false, not at the end: `ARCHITECTURE` (S1 onward),
`DATA-MODEL` (S2 onward, new MariaDB tables and the policy table), `API-SPEC` (every slice),
`NOTIFICATIONS-SPEC` (S6), `SECURITY` (S8), `DEPLOYMENT` (S9 and cutover), `RULES` (S0/S2),
`CLAUDE.md` and `README.md` (S9), `qa/README.md` CI table (S9), `UX-SPEC` (module slices),
`SAAS` (status as each capability moves), `CHANGELOG` and `KNOWN-ISSUES` (each release). Dated audits
under `qa/` are historical and stay as they are.

## 8. What I need from you, in the order it is needed

| When        | Needed from you                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Now         | Approve this plan; say whether I may create the local branch `move/cpanel-clerk` and commit to it            |
| Before S0   | Say go to running `pnpm import`/install and the Biome formatter in this folder                               |
| Before S1   | Local MariaDB available on 3307 (tell me if it needs installing; I will give the exact steps)               |
| Before S2   | "Go" to set the Clerk `email` session claim on the rotaflow Clerk app (both instances; dry run shown first); GitHub variable `VITE_CLERK_PUBLISHABLE_KEY`; cPanel database and two users (runtime and migration) with passwords placed in private config by you |
| Before S6   | The cron line added in cPanel (supplied by me, with a backup of the existing crontab first)                  |
| Before S8   | Clerk secret key placed in private config by you                                                            |
| Before R1   | The cutover plan approved in writing (Phase 6)                                                              |
