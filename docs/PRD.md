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

| Area          | Target                                                           |
| ------------- | ---------------------------------------------------------------- |
| Time to rota  | A manager builds a full week's rota in **< 10 minutes**          |
| Performance   | Lighthouse ≥ 95 (Performance, A11y, Best Practices, PWA)         |
| Offline       | Staff can open the app and see their shifts with **no** network  |
| Sync          | Offline actions (clock-in, leave request) reconcile on reconnect |
| Reliability   | 100% of unhandled errors captured in Sentry                      |
| Tenant safety | Zero cross-tenant data access (enforced by RLS on every table)   |

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
3. **Rota builder**. Weekly/fortnightly/monthly grid, drag-and-drop, shift templates,
   copy-previous-week, **repeat a week forward up to 26 weeks** in one transaction
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
- Documents with expiry **automation** — expiry is already stored and surfaced as a rota-review insight (`src/lib/rotaInsights.ts`); what is missing is a scheduled reminder. (DBS, Right to Work, visas, certificates).
- SSO, custom per-tenant branding, open API, advanced compliance.
- **Subscription billing**. Stripe Checkout + Billing Portal shipped `0050`
  (`create-checkout-session`, `create-portal-session`, `stripe-webhook` — see
  `ARCHITECTURE.md` §9c): plan gating, invoice sync, dunning-triggered
  suspension all wired to real `subscriptions`/`invoices` tables, and every
  plan (Starter/Professional/Business/Enterprise) has a real Stripe price
  configured — checkout is not gated on any plan. What's not yet done: no
  real completed charge has been run through it end-to-end (verified
  2026-08-20 that the code path is correctly wired; see
  `docs/QA-AUDIT-REPORT.md`). Apple Pay / Google Pay / PayPal remain unbuilt.

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
