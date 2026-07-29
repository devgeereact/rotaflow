# Project Memory — RotaFlow

_Last updated: 2026-07-28_

## Confirmed Decisions
- **App name:** RotaFlow (working name, user-supplied).
- **Positioning:** Intelligent, multi-tenant workforce scheduling PWA — build/manage/communicate staff rotas in minutes; modern mobile experience that works online and offline.
- **Primary users:** Public / anyone (SaaS — any organisation self-serves).
- **Location for scaffold:** New folder in the user's workspace.
- **Target industries:** care homes, NHS/agency, domiciliary care, hospitality, retail, warehouses, manufacturing, security, cleaning, education, churches, events, logistics, offices. Design generic; minimal industry-specific customisation.
- **Deployment/stack:** FIXED FOUNDATION (see below). RotaFlow shaped to fit it.

## Fixed Foundation (ground truth — not re-opened)
- Static, offline-first PWA: React 18 + Vite + Tailwind + Workbox SW, deployed to cPanel static hosting. No SSR / Node server / in-repo serverless.
- Auth + DB: Supabase (Postgres + Row Level Security). MFA available via Supabase.
- Media: ImageKit. Monitoring: Sentry.
- Background/async: Inngest (write-only client events) → functions hosted on Supabase Edge Functions.
- Server/scheduled logic: Supabase Edge Functions + Postgres triggers / pg_cron only.
- TypeScript strict, Tailwind-only styling, RLS-guarded browser keys.

## Stack reconciliation (user's proposal → foundation equivalent)
- Next.js/React frontend → React 18 + Vite PWA. ✓ (no SSR)
- NestJS + Prisma backend → Supabase (Postgres + RLS + auto REST/Realtime). ✓ replace
- Clerk/Auth.js + MFA + RBAC → Supabase Auth + MFA + RLS/roles. ✓ replace
- Redis + BullMQ background jobs → Inngest + Edge Functions + pg_cron. ✓ replace
- Socket.IO realtime → Supabase Realtime (Postgres changes). ✓ replace
- AWS S3 / R2 storage → Supabase Storage + ImageKit transforms. ✓ replace
- FCM / Web Push → Web Push API (VAPID) via Edge Function. ✓ (native FCM optional)
- Email (Resend/Postmark), SMS (Twilio) → called from Edge Functions (write-only client events). ✓
- FullCalendar / shadcn / TanStack Query / Zustand → compatible client libs (within Tailwind-only + TS strict). ✓ keep as needed

## Assumptions
- CONFIRMED: User wants the FULL platform scope (all modules, all roles, billing in V1, GPS clock-in, comms, swaps). Scaffold = working PWA foundation + core rota loop as code, PLUS complete docs specifying the entire platform + phased build plan. Nothing dropped; built out module-by-module in later sessions.
- ASSUMPTION: Multi-tenancy via a single Supabase project with `org_id` on every table + RLS tenant isolation (not DB-per-tenant).
- ASSUMPTION: Region/compliance = UK (GDPR/UK GDPR terminology throughout).
- CONFIRMED: Email = SMTP only (no Resend/Postmark). SMTP send from a Supabase Edge Function; SMTP creds server-side only.
- CONFIRMED: SMS = design the space (schema fields, notification-channel enum, service seam) but NO active integration for now. Twilio deferred; do not wire it in V1.
- CONFIRMED: Payments = Apple Pay, Google Pay, PayPal (and similar wallets). Architect the billing/subscription layer around a pluggable payment-provider abstraction from the start, but IMPLEMENT it LAST (final phase). Not Stripe-specific. Webhooks/verification via Supabase Edge Function.

## Design & Naming (CONFIRMED)
- Aesthetic: Clean & professional (Linear/Notion-like; trusted-tool feel).
- Theme: auto — follows device (prefers-color-scheme); both light & dark supported.
- Accent: Blue. Primary ≈ #2563EB (blue-600), dark-mode accent ≈ #3B82F6 (blue-500).
- appName: RotaFlow · shortName: RotaFlow (8 chars) · slug: rotaflow.

## Open Questions
- What is the ONE feature that must delight on day one? (rota builder drag-drop? offline staff view? GPS clock-in?)
- Confirm the V1 MVP cut vs V2 (see proposed split below).
- Billing in V1 or start free/manual? (Stripe billing needs Edge Function webhooks.)
- Short name (≤~12 chars) + confirm slug `rotaflow`.
- Brand direction: colours, light/dark default, aesthetic.

## Risks
- RISK (scope): Full described platform (Super Admin billing console, 15+ modules, AI scheduling, payroll integrations, SMS) vastly exceeds a scaffold. Must ruthlessly scope V1 or the project stalls. → Mitigation: lock lean V1 core loop.
- RISK (multi-tenant RLS): Tenant isolation via RLS is correct but easy to get wrong; every table needs org_id + policy. Foundation supports it; requires careful SCHEMA.md.
- RISK (billing/Super Admin): Platform-level super-admin + subscription billing implies cross-tenant compute; belongs in Edge Functions, not the static client. Defer to V2 unless required.
- RISK (native push/SMS): True background push + SMS need server surface (Edge Functions) + third-party accounts (VAPID, Twilio). Fine, but out of a pure-static path — flag as integration work.

## Future Features (V2+)
- AI auto-fill / demand forecasting / burnout detection (a first slice of NL
  scheduling — the `ai-rota-assistant` Supabase Edge Function, OpenRouter-backed
  — landed early; see docs/ARCHITECTURE.md §9. Auto-fill/forecasting/burnout
  detection remain V2).
- Payroll integrations (Sage, Xero, QuickBooks, BrightPay, Staffology).
- Super Admin platform console + subscription billing (Stripe) + plan gating.
- SSO (enterprise), advanced analytics, API access, custom branding per tenant.
- SMS notifications (Twilio), document expiry automation, read receipts.
- Advanced clock-in modes: NFC, WiFi validation, photo verification.

## Out of Scope (V1)
- TBD — pending MVP confirmation.

## Captured Spec
### Product (→ PRD.md)
Multi-tenant staff rota scheduling. Managers build rotas; staff view/interact on mobile; works offline and syncs.

### Users, Roles & Permissions (→ PRD.md / SCHEMA.md RLS)
- Super Admin (platform) — tenant mgmt, billing, support, audit, feature flags, GDPR tools. [V2 for full console]
- Organisation Owner — invite managers, subscription, locations, company settings, departments, roles, policies, reports.
- Manager — build schedules, approve leave, assign shifts, clock-in review, payroll export, notifications, overtime, swaps, availability.
- Staff (largest group) — view rota, notifications, clock in/out, request leave/overtime, swap shifts, update availability, view hours, download rota, emergency contact, calendar sync.

### Data Model / Entities (→ SCHEMA.md) — candidate
organisations, locations, departments, users/staff_profiles, roles/memberships, shifts, shift_templates, shift_types, rotas, availability, leave_requests, overtime_requests, shift_swaps, timesheets/clock_events (GPS), emergency_contacts, documents, announcements, notifications, audit_logs. All carry org_id.

### AI / Automation / Background Jobs (→ Inngest / Edge Functions)
Notifications (push/email/SMS), calendar ICS generation, auto-scheduling (V2), reminders/pg_cron, document expiry checks, payroll export generation.

### Integrations & External APIs
Web Push (VAPID); email via SMTP only (Edge Function); SMS = schema/seam reserved, NOT integrated yet; calendar ICS/subscriptions (Google/Apple/Outlook); payments = Apple Pay / Google Pay / PayPal via pluggable provider abstraction, built last; ImageKit (photos/docs); Sentry.

### Design & Brand (→ DESIGN.md)
TBD.

### Naming & Branding (→ forge.config.json)
appName: RotaFlow · shortName: TBD · slug: rotaflow · colors: TBD · url: TBD
