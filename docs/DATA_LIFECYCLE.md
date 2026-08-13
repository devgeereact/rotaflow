# Data lifecycle

**Status:** First pass, verified against the live deployment 13 August 2026 —
not yet reviewed by counsel. This is the technical record `docs/PRODUCT_TRANSFORMATION_PLAN.md`
P0 #1 needs as input for the published Privacy Notice; it is not that notice.
Where something is a gap rather than a fact, it is written as a gap.

## 1. Backup and restore

**Verified 13 August 2026 via the Supabase Management API**
(`GET /v1/projects/{ref}/database/backups`): `pitr_enabled: false`,
`backups: []`. **There are currently zero backups of the production
database.** `walg_enabled: true` means the underlying tool is present, not
that anything is scheduled.

This is the single most important gap this document records. A bad migration,
an accidental mass-delete, or a compromised admin credential has nothing to
restore from today. Point-in-time recovery and scheduled daily backups are a
paid-tier Supabase feature; closing this gap is a billing decision (upgrading
the project's plan), not a code change, and is deliberately left to the
account owner rather than actioned here.

**Until this is closed:** treat every destructive admin action (organisation
deletion, GDPR erasure, bulk membership changes) as unrecoverable in
practice, and say so to whoever performs one.

## 2. Data residency

The Supabase project runs in `eu-west-1` (Ireland). Sentry is configured for
an EU ingest region (`docs/DEPLOYMENT.md` §5). ImageKit and the cPanel mail
host (`premium17.web-hosting.com`) are UK-based. No component in the current
stack processes personal data outside the UK/EU.

## 3. Retention

`public.retention_policies` (migration `0027`) is the schedule, read by any
signed-in user via `/app/settings` and by platform admins in the console. Its
`enforced` column exists specifically so a declared schedule is never
mistaken for a running job:

| Data type                         | Declared retention          | Enforced?                                                                                                         |
| --------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Rota and shift history            | 84 months                   | **No**                                                                                                            |
| Attendance / clock-in (incl. GPS) | 36 months                   | **No**                                                                                                            |
| Leave records                     | 72 months                   | **No**                                                                                                            |
| Support cases                     | 36 months                   | **No**                                                                                                            |
| Platform audit log                | Indefinite                  | **Yes** — a dedicated trigger rejects every `UPDATE`/`DELETE` (§5); enforced by the database, not a scheduled job |
| Deleted-tenant data               | 1 month grace, then erasure | **No**                                                                                                            |

Five of six rows are a stated intention with no purge job behind them yet:
data older than its declared retention period is not automatically removed.
Building that job (and deciding whether it runs as a scheduled Edge Function
or an Inngest cron) is unstarted work, not a hidden one-line fix.

## 4. Export and deletion (GDPR Articles 15-21)

`public.gdpr_requests` (migration `0020`) tracks all six request types —
`access`, `portability`, `rectification`, `erasure`, `restriction`,
`objection` — as a case-managed workflow in `/admin/gdpr`, not an automated
self-service flow. What each type actually does today:

- **Erasure**, real, callable, and live-verified 2026-08-13 (previously only
  read from source): `anonymize_staff_member` (migration `0011`), called
  end-to-end as a real org owner against a real demo staff record. Before:
  a named person, a phone number, a payroll ID, 85 shifts, 1 emergency
  contact, 5 documents. After: `first_name`/`last_name` → "Deleted"/"Member",
  `phone`/`photo_url`/`payroll_id` → null, `active` → false, all 85 shifts
  untouched, `emergency_contacts` and `documents` both at 0, and a real
  `audit_logs` row (`gdpr_anonymize`) recording who did it and when. It
  deliberately leaves `shifts`/`clock_events`/`leave_requests`/`shift_swaps`/
  `timesheets` intact (now pointing at the anonymised "Deleted Member"), so
  payroll history stays consistent for UK retention requirements. It does
  not touch `auth.users` (needs the Auth Admin API, not yet wired to this
  flow) and does not delete the file behind `documents.file_url` on
  ImageKit, only the database row — both limits are in the migration's own
  header, and neither was contradicted by the live test.
- **Access / portability**: no one-click export exists. Fulfilling one today
  means a platform admin manually querying and exporting the relevant tables
  (the console's existing per-table CSV export, `src/lib/csv.ts`, covers the
  mechanics; nothing assembles a single subject-access package automatically).
- **Rectification / restriction / objection**: tracked as cases with no
  automated action; each is a manual data change by whoever is assigned the
  request.

A request sitting in `gdpr_requests` with no further action is a paper trail,
not a completed erasure — the case-tracking table and the actual data change
are two different things today, and closing a case does not yet imply both
happened.

## 5. Audit log

`public.audit_logs` is written by triggers on every organisation-scoped
mutation (`memberships_audit` and equivalents) and is immutable by a
dedicated trigger (`audit_logs_no_update`, migration `0016`): any `UPDATE` or
`DELETE` raises `audit_logs is append-only`, with a documented carve-out for
the row cascading away when its organisation itself is deleted. This
session's live RLS testing confirmed no role below platform admin can even
_read_ another tenant's audit rows (`ST1 (staff) cannot read own-org
audit_logs`); it did not separately attempt a write against this trigger, so
that specific guarantee is read from the migration source, not re-verified
live here. Retained indefinitely (see §3).

## 6. Incident response

No formal runbook or on-call rotation exists yet. What already exists to
build one on:

- **Detection**: Sentry (error events, EU region), `platform_health_samples`
  (`source = 'scheduled' | 'console' | 'manual'` — a scheduled prober is not
  yet wired up; today's samples come from an admin opening System status,
  which means there is currently no unattended detection between visits to
  that screen).
- **Declaration and tracking**: `public.incidents` (migration `0021`) and
  `/admin/incidents` are real — severity, status, timeline updates, owner.
  Nothing currently writes to this table automatically; every incident
  recorded there today was entered by hand.
- **Communication**: `platform_announcements` can notify affected
  organisations in-app; there is no public status page.
- **Missing**: a defined severity → response-time mapping, an on-call
  rotation, an escalation path from "Sentry fired" to "a human is paged", and
  a template for the customer communication that goes out during a live
  incident. This is squarely `docs/PRODUCT_TRANSFORMATION_PLAN.md` P0 #2
  ("confirm ownership... of error alerts... incident response"), which needs
  a person named, not more code.

## 7. Support escalation

`public.support_cases` and `/admin/support` are real (migration `0024`,
confirmed live with real rows this session) — priority, assignment, first
response and resolution timestamps are all measured, not invented. What
routes an inbound email into a case is not built: the queue only contains
what the app itself created, so a message to the contact mailbox today does
not become a case automatically.

## Open items, in priority order

1. **Enable backups** (§1) — billing decision, blocks a safe beta more than
   anything else in this document.
2. **Name an incident owner and an on-call path** (§6) — a decision, not
   code.
3. **Wire a scheduled health probe** so detection does not depend on someone
   opening the console (§6).
4. **Build the retention-purge job** for the five unenforced policies (§3),
   once the retention periods themselves are confirmed against legal advice.
5. **Build a subject-access export** that assembles one package instead of a
   manual per-table pull (§4).
