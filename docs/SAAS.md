# RotaFlow — SaaS Capability Register

**The single plan of record.** Five planning documents were merged into this file on
2026-08-29: the root project-memory file, the 13 August transformation plan, its 20 August
v2, the go-live decisions list, and the six shipped-feature plans and specs that lived
under a superpowers folder. They disagreed with the code and with each other. Do not start a sixth —
update this one.

## §0 How to use this file

**The rule: any PR that changes a capability's status updates its row in the same PR.**

This file records _what exists and what does not_. It does not restate the reference docs; it
links to them:

| Need                          | File                                    |
| ----------------------------- | --------------------------------------- |
| Coding standards              | `docs/RULES.md`                         |
| Folder layout, data flow      | `docs/ARCHITECTURE.md`                  |
| Tables, columns, RLS          | `docs/SCHEMA.md`                        |
| Hook contracts                | `docs/HOOKS.md`                         |
| Design tokens                 | `docs/DESIGN.md` + `tailwind.config.ts` |
| Screen-by-screen build status | `docs/SCREENS.md`                       |
| Metric definitions            | `docs/OBSERVABILITY.md`                 |
| Backup, retention, GDPR       | `docs/DATA_LIFECYCLE.md`                |
| Deploy                        | `docs/DEPLOYMENT.md`                    |
| Brand                         | `docs/BRAND.md`                         |

**Automated freshness.** `.github/workflows/plan-drift-audit.yml` reads this file weekly via
`PLAN_DOC`, resolves every repo path cited below to an `EXISTS`/`MISSING` verdict _before_ any
model runs, and appends to the Drift Audit Log at the bottom. A row whose evidence path
disappears is flagged automatically. Keep citations to one path per row so the audit stays
focused.

## §1 Status vocabulary

| Mark | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| 🟢   | Works end to end: UI → service → RPC/function → DB → RLS → audit → error path |
| 🟡   | Real implementation, important pieces missing                                 |
| 🔴   | No meaningful implementation                                                  |
| 🟠   | Exists, does not reliably do what it claims                                   |
| 🔵   | Works; not robust enough for a paying enterprise tenant                       |
| ⚪   | Present in schema, UI or docs only — not wired end to end                     |
| ⚫   | Deliberately deferred, reason given                                           |
| ❓   | Not audited. Never assume 🟢                                                  |

**A screen is not a capability. A table is not a feature. A toggle is not a control.** Do not
mark a row 🟢 because a button exists.

❓ rows name the exact test that would settle them. They exist because the repository cannot
answer everything — a real Stripe charge, an RLS fixture matrix against the deployed project,
real-device offline UAT and a restore-from-backup all need a live environment.

## §2 Verdict summary

Audited 2026-08-29 against `main` (66 migrations, `0001`–`0066`). Revised the same day as
#162, #163, #164 and #165 landed.

| Status                | Count | Δ since 08-29 |
| --------------------- | ----- | ------------- |
| 🟢 Complete           | 29    | +5            |
| 🟡 Partial            | 20    | +2            |
| 🟠 Defective          | 8     | −6            |
| 🔵 Hardening required | 9     | —             |
| ⚪ Surface only       | 7     | —             |
| 🔴 Missing            | 22    | —             |
| ⚫ Deferred           | 19    | —             |
| ❓ Not audited        | 7     | +1            |

**Overall maturity: 7/10**, revised up from 6.5 on 2026-08-29 after five P0 defects closed
(#162, #163, #165). It sat below the 7.5 recorded on 2026-08-20 not because anything regressed
but because the audit was deeper.

What still holds it here: production has no backups, no charge has ever completed, and there is
no rate limiting anywhere in the stack. What moved: the offline clock-in no longer reports
success for writes that never reached Postgres, an unset `STRIPE_MODE` no longer bills real
cards, and the notification path now honours the preferences it collects and can actually
display a push.

**Deployed 2026-08-29.** `supabase/functions/` does not deploy on merge, so this is a separate
manual step and worth recording when it happens: `send-notification` v17,
`create-checkout-session` v11 and `create-portal-session` v11 are live, and all three still
return 401 unauthenticated. CAP-020, CAP-021 and CAP-037 are therefore in production, not just
on `main`.

`STRIPE_MODE=live` was set on the project as part of that deploy. It had never existed — the old
code read "unset" as live, so the secret's absence was invisible until #163 made it a refusal.
Setting it preserves exactly the behaviour production already had. **`STRIPE_TEST_SECRET_KEY` is
still absent**, so the test-mode half of `0058` cannot be exercised, and the first charge (CAP-036)
cannot be a test charge until that secret exists.

The product is further along than its own documentation claimed in one direction and less far in
another. The scheduling core, the rota lifecycle, tenant isolation and the audit trail are
genuinely strong. The layers around them — delivery, entitlement, abuse control, and the
truthfulness of what the UI tells a user — are where the work is.

## §3 Maturity ladder

Each gate is phrased so two people could argue about whether it has been met.

| Stage           | Gate                                                                                                                                                      | Blocking                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1. Safe         | A restore has been performed from a backup into a scratch project, and no screen tells a user something happened that did not                             | GAP-001, BUG-045 (043/044 closed) |
| 2. Reliable     | Publishing a rota with the browser closed still results in a delivered, recorded notification                                                             | GAP-004, GAP-005, GAP-026, ❓-007 |
| 3. Commercial   | A real charge appears in the live Stripe dashboard against a real subscription row, and adding a 16th staff member to a Starter org fails at the database | ❓-002, GAP-008 (BUG-052 closed)  |
| 4. Professional | An organisation's staff receive mail from that organisation's own address, and the org can be branded                                                     | CAP-031, GAP-016                  |
| 5. Enterprise   | MFA can be required org-wide and enforced below the UI; a Trust Centre answers a security questionnaire without a human                                   | GAP-017, GAP-018                  |
| 6. Connected    | A third-party system can read a rota and receive a webhook when it changes                                                                                | GAP-019, GAP-020                  |
| 7. Intelligent  | A manager is warned about a coverage problem before it happens, from real data                                                                            | GAP-023                           |
| 8. Vertical     | One vertical's workflow is configurable without a code change                                                                                             | GAP-025                           |
| 9. Scaled       | A 500-staff, 20-site tenant loads the rota grid inside the performance budget                                                                             | HARDEN-007                        |

Stages are strictly ordered. Do not open stage 3 while stage 1 is unmet.

## §4 Capability register

### Scheduling

- [x] CAP-001 🟢 Rota builder — weekly/fortnightly/monthly grid, drag-and-drop, copy-previous-week
      `src/pages/app/RotaBuilderPage.tsx`
- [x] CAP-002 🟢 Rota lifecycle — draft/published/archived, DB-enforced, three guards no client can bypass
      `supabase/migrations/0061_rota_revisions.sql` · 18 pgTAP assertions
- [x] CAP-003 🟢 Amendment flow — a published rota is amended via a revision, the original stays visible
      `supabase/migrations/0061_rota_revisions.sql` (`begin_rota_revision`)
- [ ] CAP-004 🟠 Minimum cover — blocks publish in the client only; `publish_rota` never references cover
      `supabase/migrations/0061_rota_revisions.sql` · GAP-006 · P1
- [ ] CAP-005 ⚪ Shift templates — table created, never read or written by any UI
      `supabase/migrations/0002_rotaflow.sql` · BUG-051 · P2
- [ ] CAP-006 🔴 Recurring shifts / repeating patterns — only copy-previous-week and single duplicate exist
      `src/pages/app/RotaBuilderPage.tsx` · P3
- [x] CAP-007 🟢 Conflict detection — leave, overlap, declared unavailability as hard blockers
      `src/lib/rotaInsights.ts`
- [x] CAP-008 🟢 Overnight shifts and DST — absolute-instant arithmetic, fall-back day tested
      `src/lib/schedulePeriod.ts`
- [ ] CAP-009 🔴 Bank holidays — no table, no calendar, no holiday-aware logic anywhere
      P3
- [ ] CAP-010 🔴 Open-shift board for staff — `shifts.status='open'` has no staff-facing surface
      `src/lib/rotaGrid.ts` · P3

### Attendance

- [x] CAP-011 🟢 Clock in/out — GPS and manual, offline outbox, geofence recorded
      `src/pages/app/ClockInPage.tsx`
- [x] CAP-012 🟢 Offline clock-in honesty — a queued write is labelled "Saved on this device, not sent yet"
      `src/pages/app/ClockInPage.tsx` · BUG-043 closed #162
- [x] CAP-013 🟢 Sync state display — reads queue depth, not `navigator.onLine`
      `src/lib/clockRows.ts` (`syncStatusLabel`, 4 tests) · BUG-044 closed #162
- [ ] CAP-014 🟠 Offline timestamp integrity — `event_at` silently overwritten with `now()` past 72h
      `supabase/migrations/0037_close_self_approval_gaps.sql` · BUG-045 · **P0**
- [ ] CAP-015 🟠 Replay idempotency — no unique constraint, no id in payload; replay double-inserts
      `src/services/syncQueue.ts` · BUG-046 · P1
- [ ] CAP-016 🟡 Dead-letter recovery — surfaced and dismissable, but no retry path
      `src/components/FailedWritesNotice.tsx` · P1
- [ ] CAP-017 🔴 QR clock-in — schema accepts `'qr'`; nothing generates a code
      `src/pages/app/ClockInPage.tsx` · P3
- [x] CAP-018 🟢 Timesheets — week approval, amendment, CSV export
      `src/pages/app/TimesheetsPage.tsx`
- [ ] CAP-019 🟡 Missed clock-in — computed on every dashboard render; no job, no dedupe, flat staff set
      `src/lib/clockInAlerts.ts` · GAP-013 · P2

### Communications

- [x] CAP-020 🟡 Notification dispatch — a failed dispatch now queues in the offline outbox and retries; still browser-initiated
      `src/services/notificationDispatchService.ts` · BUG-047 closed #166 · deployed 2026-08-29 · GAP-026 · P1
- [x] CAP-021 🟢 Notification preferences — org matrix and per-user switch both read on the send path
      `supabase/functions/send-notification/index.ts` · BUG-048 closed #165 · deployed v17, 2026-08-29
- [ ] CAP-022 🟠 Channel record — `notifications.channel` hardcoded `'push'` regardless of delivery
      `supabase/functions/send-notification/index.ts` · BUG-049 · P1
- [x] CAP-023 🟡 Web push — handler shipped and imported into the generated SW; **not yet seen arriving on a device**
      `public/push-sw.js` · BUG-050 closed #165 · ❓-007 · P1
- [ ] CAP-023a ❓-007 A push has still never been seen arriving on a real device
      **Test:** subscribe on a phone, publish a rota, confirm the notification appears and opens `/app/notifications` · P1
- [ ] CAP-024 🔴 Delivery tracking — outcomes computed then discarded; no table
      `supabase/functions/send-notification/index.ts` · GAP-004 · P1
- [ ] CAP-025 🔴 Invite emails — `create_invite` returns a token the manager copies by hand
      `supabase/migrations/0006_invites.sql` · GAP-005 · P1
- [x] CAP-026 🟢 In-app notifications — per-recipient rows, no client insert policy
      `supabase/migrations/0002_rotaflow.sql`
- [x] CAP-027 🟢 Announcements with read receipts
      `supabase/migrations/0046_announcement_reads.sql`
- [ ] CAP-028 🔴 Rota change notice — amendment sends the same generic title as a first publish; no diff
      `src/pages/app/RotaBuilderPage.tsx` · GAP-007 · P1
- [ ] CAP-029 ⚫ SMS — channel reserved in schema, no provider. A toggle that sends nothing is worse than none
      `src/lib/orgPreferences.ts`

### Organisation identity

- [x] CAP-030 🟢 Per-org SMTP — org sends from its own mailbox; password never readable by the client
      `supabase/migrations/0010_org_smtp_settings.sql`
- [ ] CAP-031 🟡 Platform sender — `rotaflow.space` now carries MX ×3, SPF, DKIM, DMARC; templates still plain text
      `supabase/migrations/0064_rotaflow_space_domain.sql` · P2
- [ ] CAP-032 🔴 Per-tenant branding — `organisations` has no logo or colour column
      `src/types/database.types.ts` · GAP-016 · P3
- [ ] CAP-033 🔴 Email templates — no `notification_templates` table; body is `title` plus optional text
      `supabase/functions/send-notification/index.ts` · P3

### Billing and entitlements

- [x] CAP-034 🟢 Stripe Checkout, Billing Portal, signature-verified webhook
      `supabase/functions/stripe-webhook/index.ts`
- [x] CAP-035 🟢 Dual test/live credentials coexisting
      `supabase/migrations/0058_stripe_dual_mode.sql`
- [ ] CAP-036 ❓-002 No real charge has ever completed end to end
      **Test:** run one Stripe test-mode charge, then one live charge, and confirm the `subscriptions` row.
      Blocked on `STRIPE_TEST_SECRET_KEY`, which is not set on the project · **P0**
- [x] CAP-037 🟢 `STRIPE_MODE` fails closed — unset is refused with a 503 naming the secret, never assumed live
      `supabase/functions/_shared/stripe.ts` · BUG-052 closed #163 · deployed v11, 2026-08-29
- [ ] CAP-038 ⚪ Feature entitlements — `useFeatureAccess` and `org_has_feature()` have zero callers
      `src/hooks/useFeatureAccess.ts` · GAP-008 · P2
- [ ] CAP-039 🔴 Plan-limit enforcement — `seat_limit`/`location_limit` enforced nowhere
      `supabase/migrations/0023_commercials.sql` · GAP-008 · P2
- [ ] CAP-040 🟠 Price source of truth — prices duplicated between `plans` and marketing copy
      `src/lib/marketing.ts` · BUG-053 · P2
- [ ] CAP-041 🟡 Subscription state — mirrored DB row, no grace-period column, no dunning window
      `src/services/subscriptionService.ts` · P2

### Security

- [x] CAP-042 🟢 Tenant isolation — all 52 `public` tables have RLS enabled
      `supabase/migrations/0002_rotaflow.sql`
- [x] CAP-043 🟢 Security predicates — all six `SECURITY DEFINER` with `search_path` pinned
      `supabase/migrations/0028_support_access_gate.sql`
- [x] CAP-044 🟢 Support access — a time-boxed session is the actual RLS gate, not a log of intent
      `supabase/migrations/0028_support_access_gate.sql`
- [ ] CAP-045 ❓-003 Cross-tenant isolation has never been tested with two real orgs
      **Test:** the org A/org B matrix `docs/QA-AUDIT-REPORT.md` was blocked from running · **P0**
- [ ] CAP-046 🔴 Rate limiting — none anywhere: login, signup, reset, invites, notifications, AI, org creation
      `supabase/migrations/0002_rotaflow.sql` · GAP-009 · P1
- [ ] CAP-047 🔵 Grants wider than policies — `anon` holds CRUD on every tenant table; inert, but wrong
      `supabase/migrations/0056_table_grants_self_contained.sql` · HARDEN-001 · P2
- [ ] CAP-048 🔵 Predicate execute grants — four core predicates keep default `PUBLIC EXECUTE`
      `supabase/migrations/0002_rotaflow.sql` · HARDEN-002 · P2
- [ ] CAP-049 🔴 MFA — no `supabase.auth.mfa.*` call anywhere; `require_mfa` enforces nothing
      `src/pages/app/account/SecurityPage.tsx` · GAP-017 · P3
- [ ] CAP-050 🟡 Sessions — current session only; no server-side registry, no per-device revoke
      `src/pages/app/account/SessionsPage.tsx` · P3
- [ ] CAP-051 🔵 URL scheme validation — `photo_url` accepts any scheme; `file_url` validates `^https?://`
      `src/pages/app/account/ProfilePage.tsx` · HARDEN-003 · P2

### Compliance

- [x] CAP-052 🟢 GDPR anonymisation — live-tested end to end
      `supabase/migrations/0011_gdpr_anonymize.sql`
- [x] CAP-053 🟢 Organisation export and delete, with a pgTAP test
      `supabase/migrations/0063_delete_organisation.sql`
- [x] CAP-054 🟢 Retention enforcement — nightly `pg_cron`, running since 2026-08-21
      `supabase/migrations/0029_retention_enforcement.sql`
- [x] CAP-055 🟢 Audit trail — severity, scope, visibility, actor snapshot, immutability trigger
      `supabase/migrations/0016_audit_events.sql`
- [ ] CAP-056 🟠 Audit labelling — ~30 actions are written; the screen holds one label, so most render raw
      `src/pages/app/settings/SettingsAuditPage.tsx` · BUG-054 · P2
- [ ] CAP-057 🟠 Own-activity visibility — `/app/account/activity` is empty for anyone but an owner
      `supabase/migrations/0016_audit_events.sql` · BUG-055 · P2
- [ ] CAP-058 🔴 Consent capture — `docs/PRD.md` claims it; nothing exists
      `docs/PRD.md` · P3
- [ ] CAP-059 🔴 DPA, sub-processor list, AI transparency notice, security disclosure
      `src/pages/legal/` · GAP-014 · P2
- [ ] CAP-060 🟡 Legal pages — four routes exist, all render a placeholder shell
      `src/pages/legal/LegalNotice.tsx` · P2
- [ ] CAP-061 🟠 Data-residency claim — `DATA_LIFECYCLE.md` says no personal data leaves the UK/EU. It does
      `supabase/functions/ai-rota-assistant/index.ts` · BUG-056 · **P0**

### Integrations and API

- [x] CAP-062 🟢 CSV export — reports, timesheets, staff, and seven console screens
      `src/lib/csv.ts`
- [ ] CAP-063 🟡 Calendar — ICS file download only; no subscription feed, though the PRD claims one
      `src/lib/ics.ts` · P3
- [ ] CAP-064 ⚪ Connector catalogue — 8 connectors advertised with fabricated statuses; nothing syncs
      `supabase/migrations/0026_integrations.sql` · BUG-057 · P2
- [ ] CAP-065 🔴 Public API — no `/v1`, no tokens; the account tab explains why
      `src/pages/app/account/TokensPage.tsx` · GAP-019 · P3
- [ ] CAP-066 🔴 Outbound webhooks — none
      GAP-020 · P3
- [ ] CAP-067 🔴 Payroll integration — `payroll_id` and a timesheet CSV are the whole of it
      `src/components/staff/StaffFormModal.tsx` · GAP-021 · P3
- [ ] CAP-068 🔴 SSO / SCIM — marketing copy only
      `src/lib/marketing.ts` · GAP-018 · P3

### Intelligence

- [x] CAP-069 🟢 Deterministic rota review — pure functions over the org's own rows
      `src/lib/rotaInsights.ts`
- [x] CAP-070 🟢 AI grounding for rota suggestions — every id validated against real rows before return
      `supabase/functions/ai-rota-assistant/index.ts`
- [ ] CAP-071 🟠 AI announcement drafting — returned with no grounding check, unlike the rota task
      `supabase/functions/ai-rota-assistant/index.ts` · BUG-058 · P1
- [ ] CAP-072 🔵 AI cost control — no `max_tokens`, no prompt cap, no per-org request cap, no spend guard
      `supabase/functions/ai-rota-assistant/index.ts` · HARDEN-004 · P1
- [ ] CAP-073 🔴 Predictive insight — coverage risk, absence patterns, cost forecasting
      GAP-023 · P3

### Platform administration

- [x] CAP-074 🟢 Platform console — 19 screens, `RequirePlatformAdmin`, four role-narrowed routes
      `src/lib/adminNav.ts`
- [x] CAP-075 🟢 Incident register
      `supabase/migrations/0021_platform_incidents.sql`
- [ ] CAP-076 ⚪ Feature flags — rich schema, audited changes, and they gate nothing
      `supabase/migrations/0022_feature_flags.sql` · GAP-008 · P2
- [ ] CAP-077 ⚪ Demo constants in the console — `adminOverviewDemo.ts` still imported by five live files
      `src/lib/adminOverviewDemo.ts` · BUG-059 · P2
- [ ] CAP-078 🟡 Platform health — samples written only when an admin opens the page, timed from their device
      `src/pages/admin/AdminPlatformHealthPage.tsx` · GAP-011 · P2
- [ ] CAP-079 ⚪ Support CSAT — `rate_support_case` has zero callers, so CSAT can never be collected
      `supabase/migrations/0024_support_cases.sql` · BUG-060 · P2
- [ ] CAP-080 🟡 Support cases — a customer can open one but cannot see the reply; no SLA mechanism
      `src/pages/app/HelpPage.tsx` · GAP-012 · P2

### Workforce domain

- [x] CAP-081 🟢 Staff records — contract type, hours, skills, payroll id, documents, emergency contact
      `src/components/staff/StaffFormModal.tsx`
- [x] CAP-082 🟢 Leave, overtime and swap request/approval flows
      `src/pages/app/LeavePage.tsx`
- [x] CAP-083 🟢 Open swap board — claim an untargeted swap, RLS-enforced
      `supabase/migrations/0044_swap_open_board.sql`
- [ ] CAP-084 🔴 CSV import — no file input exists anywhere in the app
      `src/lib/csv.ts` · GAP-022 · P3
- [ ] CAP-085 🔴 Leave-year rules — calendar year hardcoded; no accrual, carry-over, pro-rata or half-days
      `src/lib/leaveInsights.ts` · P3
- [ ] CAP-086 🔴 Pay rates and labour cost — no rate column anywhere
      `src/lib/reportsOverview.ts` · P3
- [ ] CAP-087 🟡 Overtime — a self-declared number, not linked to worked hours
      `src/services/overtimeService.ts` · P3
- [ ] CAP-088 🟡 Document expiry — stored and counted on page load; no alerting job
      `src/services/documentService.ts` · GAP-013 · P3
- [ ] CAP-089 🔴 Multi-location workers — `staff_profiles` has no `location_id`
      `supabase/migrations/0002_rotaflow.sql` · P3
- [ ] CAP-090 🔴 Delegation — "Deputy Manager" is a display label, not a mechanism
      `src/lib/orgPreferences.ts` · P3
- [ ] CAP-091 🔴 Ownership transfer — only a manual role swap, guarded by a last-owner trigger
      `supabase/migrations/0047_membership_keep_one_owner.sql` · P3
- [ ] CAP-092 🔴 Duplicate detection — no check on staff or locations
      `src/services/staffService.ts` · P3
- [ ] CAP-093 🔴 Unified approvals queue — four screens; the dashboard card is read-only and omits two kinds
      `src/components/dashboard/ManagerDashboard.tsx` · P3
- [ ] CAP-094 🟡 Onboarding — org created at step 1 by design, but there is no resume path afterwards
      `src/pages/OnboardingPage.tsx` · GAP-015 · P2

### Reliability and operations

- [ ] CAP-095 🔴 Production backups — `pitr_enabled: false`, empty backup list
      `docs/DATA_LIFECYCLE.md` · GAP-001 · **P0**
- [ ] CAP-096 🔴 Migration safety gate — migrations auto-apply on merge, with no recoverable state behind them
      `docs/DATA_LIFECYCLE.md` · GAP-002 · **P0**
- [ ] CAP-097 🟡 Branch protection — `verify` required; `e2e` and `db-tests` are not, `enforce_admins` off
      `.github/workflows/ci.yml` · GAP-003 · **P0**
- [x] CAP-098 🟢 CI gates — typecheck, lint, format, 636 tests, build, SW assertion, dependency audit
      `.github/workflows/ci.yml`
- [ ] CAP-099 🟡 E2E coverage — one spec, 27 tests, 13 public pages, zero authenticated routes
      `e2e/marketing.spec.ts` · GAP-010 · P2
- [ ] CAP-100 🔴 Component tests — node environment, `.ts` only, so none exist
      `vitest.config.ts` · P2
- [ ] CAP-101 🔴 Bundle size gate — two bundle regressions found by audit, never by CI
      `.github/workflows/ci.yml` · P2
- [ ] CAP-102 🔴 Product analytics — no events, no `product_events` table
      `docs/OBSERVABILITY.md` · P3
- [ ] CAP-103 🟡 Error tracking — Sentry in the client; **no edge function reports to it**
      `src/lib/sentry.ts` · HARDEN-005 · P2
- [ ] CAP-104 🔵 Query shape — no composite index matches the hot predicates; the builder is N+1 per location
      `src/pages/app/RotaBuilderPage.tsx` · HARDEN-006 · P2
- [ ] CAP-105 🟠 Concurrency — no version column, no `updated_at` precondition; last write wins silently
      `src/services/leaveService.ts` · BUG-061 · P2
- [ ] CAP-106 ❓-004 Real-device offline UAT has never been performed
      **Test:** sign up → publish → no-signal clock-in → reconnect → correction, on real hardware · P1
- [ ] CAP-107 ❓-005 No restore has ever been performed from a backup
      **Test:** restore a snapshot into a scratch project and diff the row counts · **P0**
- [ ] CAP-108 ❓-006 `pg_cron` retention job scheduling is unverified against the live project
      **Test:** query `cron.job` on production · P2

## §5 The recommendation we rejected

An enterprise review recommended replacing per-org SMTP with a transactional provider carrying
per-tenant domain claim, DNS verification, DKIM signing and reputation isolation.

**Rejected.** `org_smtp_settings` already reaches the stated goal more cheaply: each organisation
supplies its own SMTP account, `send-notification` resolves org SMTP → global fallback → skip, and
`test-smtp` is the only writer of `verified_at`, so "saved" and "known to work" stay distinct.
Mail leaves the organisation's own server, which already holds valid SPF and DKIM and carries its
own reputation. The proposed workstream would rebuild that at significant cost.

The platform half is now better than that review assumed. Migration `0064` records the real
cause of the old deliverability failure: a **missing MX**, not missing SPF/DKIM. The old host
signed outbound mail correctly while silently dropping every reply. `rotaflow.space` carries MX
×3, one SPF, one DKIM and one DMARC.

The same review's pillar tree assumed QR clock-in, calendar sync, working push and eight live
connectors. None of those exist (CAP-017, CAP-063, CAP-023, CAP-064). A structure drawn over
absent features is not an information architecture.

## §5a The twelve go-live decisions, reconciled

The go-live decisions list (6 August, since deleted) posed twelve decisions only the owner could make.
Half were taken and the file never said so. Reconciled here against the code so the
resolved ones are not re-litigated.

| #   | Decision                                                                 | Status                                                                                                                                          |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Platform staff can read every tenant; a support session does not gate it | ✅ **Resolved** — `0028` redefines `is_org_member`/`has_org_role` onto `has_support_access`, so a time-boxed session is now the actual RLS gate |
| 2   | Demo data attached to real organisations                                 | 🟡 Dataset torn down 2026-08-14; seed scripts deleted in `#120`. `is_demo` survives as an unread column                                         |
| 3   | Feature flags control nothing                                            | 🔴 **Still true** — CAP-076                                                                                                                     |
| 4   | No payment provider                                                      | ✅ **Resolved** — Stripe shipped (`0050`, `0058`). Open sub-item: no charge has completed (CAP-036)                                             |
| 5   | Retention is a published policy nothing enforces                         | ✅ **Resolved** — nightly since 2026-08-21 (`0029`, fixed by `0057`)                                                                            |
| 6   | Three RPCs callable from nowhere                                         | 🟡 `touch_org_activity` and `mark_announcement_read` now have callers; `rate_support_case` still has none (CAP-079)                             |
| 7   | Health and uptime figures are seeded, not measured                       | 🟡 Now written — but only when an admin opens the page (CAP-078)                                                                                |
| 8   | Eleven console screens show demonstration figures                        | 🟡 `adminOverviewDemo.ts` still imported by five live files (CAP-077)                                                                           |
| 9   | An orphan `incident_events` table in production                          | ✅ **Resolved** — dropped by `0028`                                                                                                             |
| 10  | Public repo, `main` unprotected                                          | 🟡 `verify` is required; `e2e` and `db-tests` are not, and `enforce_admins` is off (CAP-097)                                                    |
| 11  | Support cases have no way in                                             | 🟡 `/app/help` opens one; no email ingress and no customer-facing thread (CAP-080)                                                              |
| 12  | The public status page                                                   | ⚫ Correctly deferred (GAP-024)                                                                                                                 |

**Settled, recorded so it is not re-opened:** every write to the platform tables goes through
a `SECURITY DEFINER` function with table grants revoked, so reference numbers, resolution
notes and audit rows cannot be skipped by a client. The marketing site carries no invented
traction, testimonials or logos.

**Still open, and not a code question:** a competitor ships under the RotaFlow name in the
same category and holds the `.app` domain. Naming has never been revisited. `rotaflow.space`
is ours and live since 2026-08-29.

## §5b Shipped-feature design records

Three features were built from written specs, since merged here: Stripe billing (`0050`,
`0058`), admin-assisted organisation creation (`0052`) and admin billing real data
(`2e1b924`). Their rationale now lives in the migration headers, which are the durable
record — each explains what it does to existing rows and why. The separate plan and spec
plan and spec files were deleted on 2026-08-29: all three specs still read
"pending implementation plan" for features that had shipped, and all 99 of their task
checkboxes were unticked against code that was already on `main`.

**Two deliberate loose ends.** Applied migrations are frozen, so four of them still name
`docs/audit01.md` (deleted 2026-08-04) in comments, and `0050_stripe_billing.sql` writes a
**column comment into production** that cites one of the deleted spec files. Editing an
applied migration risks a checksum mismatch on `supabase db push` for a comment nobody
executes, and correcting the column comment would mean a migration that auto-applies to a
database with no backups. Both are recorded here instead of chased.

## §6 Defect register

New findings start at BUG-043; 001–042 are in use across `docs/QA-AUDIT-REPORT.md`, migration
headers and source comments.

| ID          | Feature                  | Expected                        | Actual                                                                                                                                                                                                                                                                                                               | Severity |
| ----------- | ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ~~BUG-043~~ | Offline clock-in         | Queued state shown until synced | **CLOSED #162** — the status row now carries "Saved on this device, not sent yet" while the latest event is unsynced                                                                                                                                                                                                 | —        |
| ~~BUG-044~~ | Sync indicator           | Reflects queue depth            | **CLOSED #162** — `syncStatusLabel()` reads queue depth; "Synced" only when the outbox is empty                                                                                                                                                                                                                      | —        |
| BUG-045     | Clock timestamp          | The time the user clocked in    | Silently overwritten with `now()` past 72h, no error, counted as synced — `supabase/migrations/0037_close_self_approval_gaps.sql`                                                                                                                                                                                    | P0       |
| BUG-046     | Outbox replay            | Exactly once                    | No unique constraint and no id in the payload; a replay double-inserts — `src/services/syncQueue.ts`                                                                                                                                                                                                                 | P1       |
| ~~BUG-047~~ | Notification dispatch    | Delivered or recorded as failed | **CLOSED #166** — a failed dispatch queues in the outbox and retries. _The original diagnosis here was wrong: a rota cannot be published offline, because `publish_rota` is an RPC. The real failure is the second request to `inn.gs` failing after the publish already landed — a hostname content blockers drop._ | —        |
| ~~BUG-048~~ | Notification preferences | Honoured at send time           | **CLOSED #165** — org matrix and per-user switch both read in `send-notification`; opt-out drops the recipient                                                                                                                                                                                                       | —        |
| BUG-049     | `notifications.channel`  | Records how it was delivered    | Hardcoded `'push'` on every row — `supabase/functions/send-notification/index.ts`                                                                                                                                                                                                                                    | P1       |
| ~~BUG-050~~ | Web push                 | Displayed on the device         | **CLOSED #165** — `public/push-sw.js` imported into the generated SW. Unproven on a real device (❓-007)                                                                                                                                                                                                             | —        |
| BUG-051     | `shift_templates`        | Read by the builder             | No UI reader or writer; only the org export touches it — `src/services/orgLifecycleService.ts`                                                                                                                                                                                                                       | P2       |
| ~~BUG-052~~ | `STRIPE_MODE`            | Fails closed                    | **CLOSED #163** — unset is a 503 naming the secret, never assumed live                                                                                                                                                                                                                                               | —        |
| BUG-053     | Pricing page             | Reads `plans`                   | Prices hardcoded in marketing copy; a price change makes the page lie — `src/lib/marketing.ts`                                                                                                                                                                                                                       | P2       |
| BUG-054     | Audit screen             | Labels the actions written      | Holds one label for ~30 actions; the rest render as raw codes — `src/pages/app/settings/SettingsAuditPage.tsx`                                                                                                                                                                                                       | P2       |
| BUG-055     | Own activity             | A user sees their own actions   | `audit_logs_select` filters out managers and staff — `supabase/migrations/0016_audit_events.sql`                                                                                                                                                                                                                     | P2       |
| BUG-056     | Data-residency claim     | Accurate                        | Says no personal data leaves the UK/EU; staff names, titles, skills and hours go to OpenRouter (US) — `supabase/functions/ai-rota-assistant/index.ts`                                                                                                                                                                | P0       |
| BUG-057     | Connector catalogue      | Reflects real state             | Eight connectors carry fabricated statuses; `integration_sync_runs` has no writer — `supabase/migrations/0026_integrations.sql`                                                                                                                                                                                      | P2       |
| BUG-058     | AI announcement          | Grounded like the rota task     | Returned with no validation against org rows — `supabase/functions/ai-rota-assistant/index.ts`                                                                                                                                                                                                                       | P1       |
| BUG-059     | Console figures          | Real data                       | `adminOverviewDemo.ts` still imported by five live files — `src/lib/adminOverviewDemo.ts`                                                                                                                                                                                                                            | P2       |
| BUG-060     | Support CSAT             | Collectable                     | `rate_support_case` has zero callers — `supabase/migrations/0024_support_cases.sql`                                                                                                                                                                                                                                  | P2       |
| BUG-061     | Concurrent approval      | Second writer is rejected       | No version check; both succeed and the second overwrites — `src/services/leaveService.ts`                                                                                                                                                                                                                            | P2       |

**Carried forward, still open** from the 2026-08-23 release audit, which had no home in the repo
until this file: BUG-010, 011, 012, 013, 014, 015, 024, 029, 030, 031, 032, plus the `auth.users`
half of GDPR erasure.

## §7 Gap register

| ID      | Gap                                                        | Why it matters                                                                                                                    | Priority |
| ------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GAP-001 | No production backups                                      | A bad migration is unrecoverable, and migrations auto-apply on merge                                                              | P0       |
| GAP-002 | No migration safety gate                                   | "CI is green" is not "this is safe to apply to production"                                                                        | P0       |
| GAP-003 | `e2e` and `db-tests` are not required checks               | A PR can merge with Playwright and pgTAP failing                                                                                  | P0       |
| GAP-004 | No delivery tracking table                                 | A manager cannot tell whether staff were told; no data source for a notification centre                                           | P1       |
| GAP-005 | Invites send no email                                      | A silent hole in the onboarding funnel                                                                                            | P1       |
| GAP-006 | Minimum cover is client-side only                          | A direct RPC call publishes an understaffed rota                                                                                  | P1       |
| GAP-007 | No amendment diff                                          | The data is already archived by `0061`; nothing derives what changed                                                              | P1       |
| GAP-008 | Entitlements enforced nowhere                              | Plan limits are advisory in both the UI and the database                                                                          | P2       |
| GAP-009 | No rate limiting                                           | Unlimited org creation, unlimited invites, uncapped AI spend                                                                      | P1       |
| GAP-010 | No authenticated E2E coverage                              | The core loop is never exercised end to end by CI                                                                                 | P2       |
| GAP-011 | No scheduled health probe                                  | Uptime is arithmetic over rows an admin's browser inserted                                                                        | P2       |
| GAP-012 | Support has no reply path to the customer                  | RLS permits a thread; no screen renders one                                                                                       | P2       |
| GAP-013 | No scheduled job for expiry or missed clock-in             | Both are recomputed per page view, so neither can page anyone                                                                     | P2       |
| GAP-014 | DPA, sub-processors, AI notice, security disclosure absent | Blocks enterprise procurement                                                                                                     | P2       |
| GAP-015 | Onboarding has no resume path                              | Abandon after step 1 and steps 2–4 are unreachable forever                                                                        | P2       |
| GAP-026 | Dispatch is still browser-initiated                        | Close the tab before the outbox write flushes and the event is lost. Moving it into `publish_rota` or a trigger needs a migration | P1       |
| GAP-016 | No per-tenant branding                                     | Requires a schema change, not a settings screen                                                                                   | P3       |
| GAP-017 | No MFA                                                     | Enterprise buyers assume it                                                                                                       | P3       |
| GAP-018 | No SSO or SCIM                                             | Gates larger organisations                                                                                                        | P3       |
| GAP-019 | No public API                                              | Nothing can integrate                                                                                                             | P3       |
| GAP-020 | No outbound webhooks                                       | Nothing can react to a rota change                                                                                                | P3       |
| GAP-021 | No payroll integration                                     | The highest-value adjacency to the existing data                                                                                  | P3       |
| GAP-022 | No CSV import                                              | Every prospect is migrating off a spreadsheet                                                                                     | P3       |
| GAP-023 | No predictive insight                                      | The differentiator the data could support                                                                                         | P3       |
| GAP-024 | No customer-facing status page                             | `incidents.is_public` exists and grants nothing                                                                                   | P3       |
| GAP-025 | No vertical configuration                                  | Care, security, cleaning and hospitality all get one generic product                                                              | P3       |

## §8 Hardening register

| ID         | Capability                 | Weakness                                                                                    | Priority |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| HARDEN-001 | Table grants               | `anon` holds CRUD on every tenant table; inert only because policies are `auth.uid()`-based | P2       |
| HARDEN-002 | Security predicates        | Four keep default `PUBLIC EXECUTE` and answer at `/rest/v1/rpc/` for `anon`                 | P2       |
| HARDEN-003 | URL fields                 | `photo_url` takes any scheme while `file_url` validates                                     | P2       |
| HARDEN-004 | AI function                | No token cap, no spend guard, one model with no fallback                                    | P1       |
| HARDEN-005 | Edge functions             | No Sentry; failures are `console.error` strings in a log nobody watches                     | P2       |
| HARDEN-006 | Query shape                | No composite index on the hot predicates; ≥2 round trips per location per week load         | P2       |
| HARDEN-007 | Scale                      | Never tested beyond a single-org tenant                                                     | P3       |
| HARDEN-008 | Notification authorisation | The shared secret proves the caller, not that the caller was entitled to name those users   | P2       |
| HARDEN-009 | Session control            | No server-side registry, so "sign out everywhere" is the only lever                         | P3       |

## §9 Not building, and why

| Item                                             | Reason                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| SMS                                              | No provider, no delivery record. A toggle that sends nothing is worse than no toggle |
| Per-tenant sending domains with DNS verification | BYO-SMTP already achieves it — see §5                                                |
| Autonomous scheduling                            | Deterministic logic decides; the model only phrases. Do not invert that              |
| Dedicated sending IPs                            | No volume to justify it, and reputation is already per-tenant under BYO-SMTP         |
| Marketplace                                      | Requires an API and integrations that do not exist                                   |
| Internationalisation                             | UK-first until the UK product is excellent                                           |
| Public status page                               | A second surface with its own hosting and its own failure mode                       |

## §10 Roadmap

**P0 — nothing ships to a paying customer until these close.**

Closed 2026-08-29: ~~unsynced writes reported as success~~ (BUG-043, BUG-044, #162) ·
~~`STRIPE_MODE` defaulting live~~ (BUG-052, #163) · ~~preference controls read by nothing~~
(BUG-048, #165) · ~~push with no handler~~ (BUG-050, #165) · ~~the data-residency claim~~
(BUG-056, #161).

Closed since: ~~notification dispatch was fire-and-forget~~ (BUG-047, #166).

Still open: backups and one completed restore (GAP-001) · `event_at` silently rewritten past
72h (BUG-045 — needs a migration, and migrations auto-apply into a database with no backups) ·
one real Stripe charge (CAP-036) · re-run the multi-tenant isolation test (CAP-045) · require
`e2e` and `db-tests` as merge checks (GAP-003) · rotate the platform-owner credential onto a
live domain.

**Deploy debt: cleared 2026-08-29.** All three edge functions are deployed (see §2). Remember
that merging never deploys them; a future edge-function fix needs `supabase functions deploy`
naming it, or the register will claim something production does not have.

**P1 — reliability and communications as a system.**
Server-side notification dispatch · delivery outcomes persisted · preferences read at send time ·
minimum cover enforced in `publish_rota` · rate limiting and an AI cost cap · ground the AI
announcement output · amendment diff, then reason-for-change, then acknowledgement in that order
— the latter two need the diff · invite emails · outbox idempotency and a retry path ·
real-device UAT.

**P2 — entitlements, truthfulness, coverage.**
Enforce seat and location limits at write time · wire or delete `useFeatureAccess` · one price
source · stop advertising dead connectors · optimistic concurrency on approvals · composite
indexes and the builder N+1 · authenticated E2E and axe · a bundle-size gate · DPA and
sub-processors · label the audit actions · tighten grants · a scheduled health probe.

**P3 — after product-market fit.** Everything in §7 marked P3, in the order the maturity ladder
implies.

## Drift Audit Log

Written by `.github/workflows/plan-drift-audit.yml` (weekly). Each entry starts
`**YYYY-MM-DD**:` on its own line — required for the workflow's own staleness check to parse the
log.

**2026-08-13**: Seeded at creation. No automated audit has run yet — the workflow needs an
`OPENROUTER_API_KEY` repository secret before its first scheduled or manually-dispatched run can
execute. (This originally read `ANTHROPIC_API_KEY`; the audit was moved to OpenRouter on
2026-08-20 so that this project depends on a single AI provider — the same one the app's own
`ai-rota-assistant` Edge Function uses.)

**2026-08-20**: The audit revealed drift in the product plan document, specifically regarding the
status of the 'Run an RLS/destructive-action review on deployed Supabase' task, which is marked
as 'Not done' in the document but has evidence of being completed in the recent git history.
Additionally, the task 'Test the critical loop on real mobile devices' is also marked as 'Not
done' but lacks evidence of completion. The legal page for AI transparency is missing, which was
noted as a gap in the document.

**2026-08-24**: The audit revealed drift in the product plan document, specifically regarding the
status of the 'Run an RLS/destructive-action review on deployed Supabase' task, which is marked
as 'Not done' in the document but has evidence of being completed in the recent git history.
Additionally, the task 'Test the critical loop on real mobile devices' is also marked as 'Not
done' but lacks evidence of completion. The legal page for AI transparency is missing, which was
noted as a gap in the document.

**2026-08-29**: This file replaced the previous transformation-plan v2 as the audited
document. Five planning documents were merged in and deleted after nine read-only audits of the
repository. Sixty-plus contradictions were found between the documentation and the code,
including eight places where two documents contradicted each other and one — the data-residency
statement in `docs/DATA_LIFECYCLE.md` — that was feeding a customer-facing Privacy Notice.
`scripts/plan-drift-audit.mjs`'s system prompt was rewritten at the same time: it named V2's
section headings literally, so pointing it at this file without that change would have returned
`drift_found: false` against a register it never read.
