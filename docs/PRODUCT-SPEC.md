# Product Requirements Document (PRD). RotaFlow

> **Scope, not status.** This document says what RotaFlow is meant to do.
> **`docs/SAAS.md` says what it actually does** — per capability, with evidence, and
> including the ones this file has claimed in the wrong direction. Where the two
> disagree, the register wins.

## 1. Overview

RotaFlow is a **multi-tenant, offline-first workforce scheduling PWA**. Organisations
build and communicate staff rotas in minutes; staff get a modern mobile experience
that works with no signal and syncs when connectivity returns. It runs entirely as a
static bundle (installable, offline-capable, instantly responsive) with all dynamic
behaviour offloaded to Supabase and other managed services.

**Problem it solves:** rota management is still done in spreadsheets, WhatsApp groups
and paper. Managers waste hours rebuilding schedules; staff never know their shifts;
clock-in and leave are untracked. RotaFlow gives each organisation a single, reliable,
mobile-first system, with tenant-isolated data, that replaces all of that.

**Positioning:** an intelligent workforce scheduling platform that suits many
industries (care homes, NHS/agency, domiciliary care, hospitality, retail, warehouses,
manufacturing, security, cleaning, education, churches, events, logistics, offices)
with minimal industry-specific customisation.

## 2. Target users

- **Public / anyone**. Any organisation self-serves and onboards its own team.
- Four roles per tenant (see §4): **Super Admin** (platform), **Organisation Owner**,
  **Manager**, **Staff** (the largest user group).

## 3. Goals & success metrics

| Area          | Target                                                                                                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to rota  | A manager builds a full week's rota in **< 10 minutes**                                                                                                                                                                                        |
| Performance   | Lighthouse ≥ 95 (Performance, A11y, Best Practices, PWA)                                                                                                                                                                                       |
| Offline       | Staff can open the app and see their shifts with **no** network — **not met**: `docs/ARCHITECTURE.md#offline-and-pwa` §2 classes the rota view, my shifts and clock history as network required. What ships is queued writes, not cached reads |
| Sync          | Offline actions (clock-in, leave request) reconcile on reconnect                                                                                                                                                                               |
| Reliability   | 100% of unhandled errors captured in Sentry                                                                                                                                                                                                    |
| Tenant safety | Zero cross-tenant data access (enforced by RLS on every table)                                                                                                                                                                                 |

## 4. Roles & permissions (drives PRD + Supabase RLS)

| Role                   | Scope                    | Can do                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Super Admin**        | Platform                 | Tenant management, subscription/billing oversight, support, audit logs, feature flags, GDPR tools. _(Shipped: 18 console screens under `/admin`, gated by `RequirePlatformAdmin` with four routes narrowed further by platform role.)_ |
| **Organisation Owner** | One org                  | Invite managers, manage subscription, locations, departments, roles, company settings, policies, org-wide reports.                                                                                                                     |
| **Manager**            | Org / assigned locations | Build & publish rotas, assign shifts, approve leave & overtime, review clock-ins, approve swaps, manage availability, export payroll/timesheets, send announcements.                                                                   |
| **Staff**              | Self                     | View rota, receive notifications, clock in/out, request leave & overtime, request/accept shift swaps, set availability, view hours, download rota, manage emergency contact, calendar sync.                                            |

All permissions are enforced by **Supabase RLS predicates** scoped by `org_id` and
role membership, never in the client alone.

## 5. Feature set (full platform, phased)

### Phase 1. Core scheduling loop

1. **Multi-tenant foundation**. Organisations, locations, departments; every record
   `org_id`-scoped with RLS isolation; role-based memberships.
2. **Staff management**. Profiles (photo, job title, department, skills, contract
   type, working hours, holiday allowance, emergency contact, documents, payroll ID).
3. **Rota builder**. Weekly/fortnightly/monthly grid, drag-and-drop,
   copy-previous-week, **repeat a week forward up to 26 weeks** in one transaction
   (shift templates were dropped in `0096`)
   (`0107`, arithmetic done in the site's timezone so a 07:00 shift is still 07:00
   after the clocks change), colour coding, conflict
   detection (double-booking, availability, leave, max hours, min rest).
4. **Shift types & templates**. Reusable, org-defined (Morning, Late, Night, Split,
   Weekend, On-Call, Bank, Training, etc.).
5. **Staff mobile rota view**. Installable PWA, offline-first, calendar month/week/day
   views, ICS calendar **file download** and a **subscription feed** — a per-person
   tokenised URL served by an Edge Function (`0099`). The old note here said a
   subscription was impossible because "a static PWA cannot serve one", which was
   true of the PWA and forgot the Edge Functions the rest of the product runs on.
6. **Availability**. Staff submit available/unavailable/preferred/recurring; managers
   schedule around it.
7. **Leave**. Request, approve/reject, entitlement tracking, calendar conflicts.
   The holiday **year is a policy** rather than the calendar year, a joiner is
   pro-rated, unused days carry over up to a cap, and **half days** are bookable at
   either end of a range (`0109`). UK **bank holidays** are computed rather than
   seeded, per nation, and named in the request form before it is sent.
8. **Shift swaps**. Staff request → colleague → manager approval → rota updates.
   An **open shift** anybody can take is now visible to staff (`/app/open-shifts`,
   `0103`) — the `'open'` status existed from `0002` with no staff-facing surface —
   and everything waiting on a manager is in one queue at `/app/approvals`.
9. **GPS clock in/out**. GPS + manual (QR is deferred; the schema accepts `'qr'` but nothing generates a code), timesheets, hours dashboard.
10. **Notifications**. Web Push + email (SMTP) for assignments, changes, approvals,
    reminders, announcements.
11. **Announcements / communication centre**. Org/department/location broadcasts.
12. **Reports & exports**. Hours, absence, holiday, overtime; **rostered labour cost**
    per site, from a pay-rate history so a raise does not rewrite what last quarter
    cost (`0104`); CSV payroll export (no Excel writer in the dependency tree);
    per-employee/department/location rota export; **CSV import** of a staff list.
13. **Offline + background sync**. View rota, clock in/out, request leave, read
    announcements offline; reconcile on reconnect.
14. **GDPR essentials**. Audit logging, data export and anonymisation. **No consent
    capture exists** — nothing records or stores a consent decision, and that is a
    decision rather than an omission: consent is the wrong lawful basis for
    employment data, and a checkbox would create a right to withdraw that an
    employer cannot honour (`docs/SAAS.md` CAP-058). The organisation export covers
    33 tables and names the seven it deliberately leaves out.

### Phase 2. Intelligence, enterprise & billing

- AI scheduling / auto-fill, demand forecasting, burnout detection, natural-language
  scheduling ("schedule three nurses for nights next weekend").
- Payroll integrations (Sage, Xero, QuickBooks, BrightPay, Staffology).
- Advanced analytics (utilisation, coverage gaps). **Labour cost shipped early**
  (`0104`) — it needed a rate table, not a forecast, and a rota approved without a
  cost is approved against the wrong question.
- Documents with expiry **automation** — expiry is stored and surfaced as a rota-review insight (`src/lib/rotaInsights.ts`). Scheduled reminders run every 15 minutes via `pg_cron` and `notification_outbox` (`0093_scheduled_alerts.sql`), notifying owners and managers of missed clock-ins and expiring documents. (DBS, Right to Work, visas, certificates).
- SSO, custom per-tenant branding, open API, advanced compliance.
- **Subscription billing**. Stripe Checkout + Billing Portal shipped `0050`
  (`create-checkout-session`, `create-portal-session`, `stripe-webhook` — see
  `ARCHITECTURE.md` §9c): plan gating, invoice sync, dunning-triggered
  suspension all wired to real `subscriptions`/`invoices` tables, and every
  plan (Starter/Professional/Business/Enterprise) has a real Stripe price
  configured — checkout is not gated on any plan. What's not yet done: no
  real completed charge has been run through it end-to-end (verified
  2026-08-20 that the code path is correctly wired; see
  `qa/FUNCTIONAL-AUDIT.md`). Apple Pay / Google Pay / PayPal remain unbuilt.

## 6. Non-functional requirements

- **Static-first:** zero server runtime; dynamic behaviour is client-side or offloaded
  to Supabase (Auth/DB/RLS, Edge Functions, `pg_cron` + `pg_net`), ImageKit,
  Sentry and Stripe. Inngest is fully retired (`0087`) — no function, no key.
- **Multi-tenant:** single Supabase project; `org_id` on every table; RLS tenant
  isolation is the last line of defence.
- **Type-safe:** TypeScript strict, no implicit `any`.
- **Portable UI:** styling stays NativeWind-compatible for a future Expo export.
- **Secure:** only write-scoped / RLS-guarded keys reach the browser; SMTP, payment
  and signing secrets live only in Edge Functions.
- **Accessible:** WCAG AA contrast, 44px touch targets, visible focus rings; never
  convey shift state by colour alone.
- **Region/compliance:** UK-first (GDPR / UK GDPR terminology); PII handled with care.

## 7. Out of scope (V1)

- Full Super Admin billing console self-serve on every plan, and a real
  end-to-end-verified live charge (infra is built — see §5's Phase 2 billing
  entry — but not yet exercised with a real completed payment).
- SMS notifications (schema + channel seam reserved; **not** wired up yet).
- Payroll integrations, SSO, open API (all Phase 2). **AI scheduling shipped early** —
  `supabase/functions/ai-rota-assistant` plus two deterministic tabs; see
  `docs/ARCHITECTURE.md` §9. Auto-fill, forecasting and burnout detection remain Phase 2.
- Native app-store submission (the Expo bridge is a later milestone).

## 8. Future roadmap

Phase 2 (above) → advanced clock-in modes (NFC, WiFi validation, photo verification)
→ SMS via Twilio → document-expiry automation → Expo/React Native shell reusing hooks
and components.

## Metrics and events

What computes each success metric in §3, and whether that data exists yet. Merged from the deleted `docs/OBSERVABILITY.md` on 11 October 2026; the dated first pass of 13 August 2026 is kept as written, so treat its counts as a snapshot.

**Status:** First pass, 13 August 2026. Answers
`docs/SAAS.md` ("publish event taxonomy") and
maps directly onto that plan's §12 success-metrics table — this document
names, for each metric, exactly what data computes it and whether that data
exists today. Nothing here is instrumented as a dashboard; several rows are
already computable from existing tables with a query, not a new event.
Where something needs new capture, that is stated plainly rather than
implied.

### How to read the table

- **Computable now** — the data already exists in the schema; what is
  missing is the query/aggregation, not new instrumentation. Verified
  against real migrations, not assumed.
- **Needs a small addition** — most of the metric is computable, but one
  input genuinely does not exist yet (a specific timestamp, a specific
  event).
- **Needs new capture** — nothing today produces this signal; it requires
  either a new event/table or a process outside the app (a survey, an
  interview).
- **Out of scope for instrumentation** — a human or business process
  (interviews, pricing conversations), not something client-side tracking
  can produce regardless of effort.

| Metric                 | State                                | What actually computes it                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activation             | **Computable now**                   | `organisations.created_at`, first `locations.created_at`, first `invites.created_at`, first `rotas.published_at` for that org, all within 7 days of `organisations.created_at`.                                                                                                                                                                                                      |
| Time to first rota     | **Computable now**                   | `organisations.created_at` → the org's earliest `rotas.published_at`. Median across orgs.                                                                                                                                                                                                                                                                                            |
| Rota completion        | **Needs a small addition**           | The publish half is `rotas.published_at`, real. The denominator — how many times a manager _opened_ the builder, including the ones that didn't end in a publish — is not captured anywhere; nothing records a builder-session start today.                                                                                                                                          |
| Staff adoption         | **Needs new capture**                | Nothing records "viewed the published schedule" as a distinct event. `invites.accepted_at` gives invited→joined; view is a genuine gap.                                                                                                                                                                                                                                              |
| Attendance reliability | **Computable now, with a caveat**    | `clock_events.synced`, `clock_events.event_at` (when it happened on-device) vs `clock_events.created_at` (when the row landed server-side) approximates time-to-sync — the gap between the two for a previously-`synced = false` row. This is a proxy, not an instrumented sync-duration field; stated as such rather than presented as exact.                                       |
| Workflow completion    | **Computable now**                   | `leave_requests`/`shift_swaps`/`overtime_requests` all carry `created_at` and `reviewed_at`. Completion time is the gap; verified present on all three tables, not assumed.                                                                                                                                                                                                          |
| AI quality             | **Partially computable**             | Acceptance/drop counts and the requester are real, written by `ai-rota-assistant` on every completed request (`audit_logs`, action `ai_assistant.rota_suggestions_generated`). Manager-edit-before-save and an explicit usefulness rating are not captured — the audit row records what the model produced and what passed verification, not what the manager did with it afterward. |
| Accessibility          | **Computable now**                   | The `e2e` CI job's axe output is a real automated violation count per run, already gating merges. Manual keyboard/screen-reader pass rate is a human UAT process (P0 #5 of the transformation plan), not something to automate.                                                                                                                                                      |
| Performance            | **Needs new capture**                | No Web Vitals collection exists client-side. p75 LCP/INP/CLS need a reporting mechanism (e.g. the `web-vitals` library posting to Sentry or a dedicated table) that does not exist yet.                                                                                                                                                                                              |
| Satisfaction/retention | **Partially computable**             | `support_cases.csat` is real (written by the support flow). NPS/interviews are a human process. 30/60/90-day active-org retention is computable from `organisations.last_activity_at` (maintained by `touch_org_activity()`, 0023) once there is enough history to measure against.                                                                                                  |
| Commercial             | **Out of scope for instrumentation** | Conversion, willingness-to-pay, support cost per org are pricing and sales-process outputs, not client-side events.                                                                                                                                                                                                                                                                  |

### The queries were run, not just proposed

Every row marked "computable now" was actually run against the live
demo/seed dataset (13 August 2026), not just checked for schema presence.

> ⚠️ **That dataset no longer exists.** It was torn down on 2026-08-14 and every seed
> script was deleted in `#120`. Production now holds **zero organisations, one auth
> user and zero clock events** (read live, 31 August 2026), so none of the figures below can be reproduced, and the recommendation later
> in this document to "re-run the six computable queries against the seed data" is not
> executable. The _queries_ and the schema columns they rely on are still correct; only
> the numbers are historical. Re-derive them against a real tenant before quoting any.

Two things came back wrong, and both point at the same root cause rather
than at the metric definitions:

- **Activation / time to first rota** returned **−33 days** for five of the
  demo companies — a rota `published_at` dated before its own
  organisation's `created_at`. Impossible for a real organisation; an
  artifact of the seed's rolling three-month rota window being generated
  independently of the organisation row's own timestamp on each re-seed.
- **Workflow completion** returned **negative average hours** on all three
  tables (leave, swaps, overtime) — a `reviewed_at` earlier than its own
  `created_at`, for the same reason: the seed assigns each timestamp
  relative to "now" independently rather than enforcing
  `reviewed_at >= created_at`.

Both are seed-data quality gaps, not query bugs or metric-design errors —
the SQL is correct and would return a sane number against real usage, where
a decision cannot be recorded before the request that prompted it. Worth
fixing in the seed scripts at some point — those files were deleted on
19 August 2026, so this is a note for whoever writes the next ones — constrain each
generated `reviewed_at`/`published_at` to be no earlier than the row it
depends on, the same class of fix as the `support_case_reference_seq`
collision that seed had —
but not urgent: nobody is reading these numbers as real product metrics
today, and the plan's own guidance is not to invent baselines yet
regardless. Recorded here so the next person to run these queries against
seed data doesn't mistake a seed-timestamp artifact for a broken metric —
or worse, a broken product.

> ⚠️ **Everything in this section is evidence from a dataset that no longer
> exists, and it cannot be reproduced.** The demo dataset these queries ran
> against was destroyed on 14 August 2026, and the seed scripts that built it
> (`supabase/seed/*.sql`) were deleted on 19 August. Production today holds
> **zero organisations and zero clock events**. The numbers below are kept
> because the _shapes_ they revealed are still true — the independent-timestamp
> bug, the `created_at`-minus-`event_at` proxy measuring seed generation rather
> than sync latency — but do not cite them as current figures, and do not try
> to re-run the queries expecting these results. Re-reading this section
> against production is the first thing to do when a real tenant has history.

The two that returned clean, plausible numbers **at the time**: **attendance
reliability** (3,506 clock events, 3,484 synced, 22 currently queued — a real,
sane online/offline split) and **CSAT** (6 rated cases, average 4.33/5, matching
the seed's own planted values). The sync-latency proxy itself (`created_at`
minus `event_at`) is still not a trustworthy number from seed data —
bulk-inserted historical rows have a `created_at` reflecting insert time,
not real device sync time, so the average it produced (~38 hours) measures
seed generation, not attendance reliability. Only real device usage will
make that column mean what the metric wants it to mean.

### What this means for Phase 3

Four of eleven rows need genuinely new work before they can report a real
number: rota-session starts, schedule-view events, an explicit AI-suggestion
outcome (edited/used as-is/discarded), and Web Vitals collection. The rest
are a query away from real, not a new instrumentation project — the
temptation to build a generic "event tracking" system before checking which
metrics already have their data is exactly the premature-dashboard mistake
`docs/SAAS.md`'s own Phase 3 guidance warns against
("do not invent targets before observing the first design partners").

**Recommended order, cheapest first:**

1. Query the six already-computable rows and confirm the numbers look
   sane against the live demo/seed data before writing a single new event.
2. Add the AI-suggestion-outcome capture (edited/used/discarded) as a small
   extension of the existing audit write in `ai-rota-assistant`, since that
   code path and its service-role audit client already exist.
3. Decide whether rota-session-start and schedule-view events are worth a
   first-party `product_events` table (same pattern as `audit_logs`,
   `incidents`, `support_cases` — org-scoped, RLS-guarded, stored in the
   same Supabase project rather than shipped to a third-party analytics
   vendor) or deferred until there is a design partner asking for the
   number. Either way, this is a schema decision — a migration — not
   something to apply ad hoc outside the normal review path.
4. Web Vitals collection is the most standalone of the four gaps and the
   least tied to a product decision; reasonable to build independently of
   the others.

No third-party analytics vendor is assumed or recommended here. A vendor
decision carries its own privacy-disclosure obligation. The current state
of storage, telemetry and consent is documented at `/legal/cookies` and
backed by config in `src/lib/legalFacts.ts`.
