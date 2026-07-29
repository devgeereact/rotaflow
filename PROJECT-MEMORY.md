# Project Memory — RotaFlow

_Last updated: 2026-07-29_

## Domain & auth configuration (2026-07-29)
**Canonical URL: `https://rota.gakinz.com`** — a subdomain of the `gakinz.com`
cPanel account, docroot `~/rota.gakinz.com/`, origin `185.61.152.45`.

`rotaflow.app` — the scaffold placeholder — **is not ours.** It resolves to
Vercel and serves an unrelated, already-shipped shift-scheduling product
(iPhone/iPad/Apple Watch, App Store `id6758777908`). It had leaked into
`VITE_APP_URL`, which is the auth `redirectTo`, so magic-link and OAuth sign-ins
were being asked to return users to a third party's website. Replaced everywhere:
`.env`, `.env.example`, `forge.config.json`, `docs/DEPLOYMENT.md`, `README.md`,
and the `ai-rota-assistant` Edge Function's `HTTP-Referer`. The `VAPID_SUBJECT` /
`SMTP_USER` / `SMTP_FROM` identities moved to `@gakinz.com`, since mailboxes at a
domain we don't own could never have worked.

**Still open — an existing competitor ships under the RotaFlow name in the same
category and holds the `.app` domain.** Naming has not been revisited.

Auth verified live against project `vwqqbdvlskngrqrejzxi`: `email`, `google` and
`github` all enabled, both OAuth apps correctly registered against the callback
`https://vwqqbdvlskngrqrejzxi.supabase.co/auth/v1/callback`. Client-side gating is
per-provider (`VITE_ENABLE_OAUTH="google,github"`), because a single on/off flag
would necessarily be wrong for one provider whenever the two differ.

**LIVE as of 2026-07-29**, with **Google sign-in confirmed working end to end**
against the deployed site (the redirect allowlist can only be proven by a real
token round-trip — external probing cannot settle it). Verified: DNS
(Cloudflare-proxied, DNSSEC valid), TLS (`*.gakinz.com` wildcard), origin cert,
cPanel subdomain vhost (docroot `~/rota.gakinz.com`), app shell, SPA deep links,
PWA assets, HTTP→HTTPS redirect, and the security headers from `.htaccess`. The
live bundle has the correct `VITE_APP_URL` and both OAuth providers inlined.

**Two traps hit during that first deploy — both now fixed in the tooling:**
- **cPanel's Document Root field is relative to `$HOME`.** Entering the absolute
  path produced `/home/devgeereact/home/devgeereact/rota.gakinz.com`. Leave the
  auto-filled value; the stray nested directory was removed.
- **`rsync -a` preserves local file modes.** This repo's files are `600` locally,
  so `.htaccess` landed `600`, the web server could not read it, and the site
  served a **directory listing with no SPA routing**. `cpanel-deploy` now
  normalises to dirs `755` / files `644` over SSH after each sync (macOS ships
  `openrsync`, which rejects `--chmod=D755,F644`).

`cpanel-deploy` also excludes `*.map` by default, per `docs/DEPLOYMENT.md` §4 —
verified zero `.map` files on the server. Note that the SPA fallback returns
**200 for every unknown path**, so a 200 is not evidence a file exists; check the
content-type.

## Phase 1.5 — hardening pass (2026-07-29)
A re-smoke-test of Phase 1 (build + lint + typecheck, live HTTP probes against
the Supabase project, code audit) found one blocker and three high-severity
gaps. All five items below are fixed; `typecheck`, `lint` and `build` are clean
and every touched module transforms in dev.

1. **BLOCKER — publishing a rota orphaned it.** `getOrCreateDraftRota` filtered
   on `status = 'draft'`, so revisiting a published week found no draft, created
   an empty one, and rendered the grid as if the week had been wiped (the shifts
   were still attached to the published rota, which nothing ever read back —
   `listRotas` was dead code). Replaced with `findRotaForPeriod` /
   `getOrCreateRotaForPeriod`, which ignore status and prefer a published rota
   over a draft. Added `unpublishRota` + an Unpublish button so publish is no
   longer a one-way door, and blocked publishing an empty rota.
2. **Shared-device tenant leak.** `signOut` only cleared the Supabase token,
   leaving the `supabase-api` (authenticated REST, 5 min) and `imagekit-media`
   (staff photos, 30 days) Workbox caches plus `rotaflow:activeOrgId` intact for
   the next user on a ward tablet or warehouse terminal. New
   `src/lib/session.ts#clearTenantState`, invoked from `signOut` in a `finally`
   so it still runs when signing out offline.
3. **A failed load looked like "you have no organisation."** `OrgContext`
   swallowed query errors to Sentry, and `AppShell` read the resulting empty
   list as a new user and redirected to `/onboarding` — where an existing owner
   could create a duplicate org. Added `loadFailed` to the `useOrg` contract;
   `AppShell` and `OnboardingPage` now show a retry instead. **Never read
   `memberships: []` as "no org" without checking `loadFailed`.**
4. **Silent write failures.** No toast system existed anywhere, so drag-and-drop
   shift create/reassign failures went to Sentry only and the manager believed
   the shift saved. Added `ToastProvider` + `useToast`; wired into every rota
   write, plus the previously uncaught `reloadShifts` rejection.
5. **Dead OAuth buttons.** `/auth/v1/settings` on the live project reports
   `google: false, github: false`, but LoginPage rendered both. Now gated behind
   `VITE_ENABLE_OAUTH` (default `false`); flip it once the providers are
   actually enabled in the Supabase dashboard.

**Still open after this pass** (deliberately deferred, see the roadmap):
conflict detection (PRD Phase 1 item 3, needs availability/leave data first),
the stub Dashboard, dead stub tabs in the rota toolbar, the 1.24 MB `logo.png`
in a 2.29 MB precache, and unverifiable migration state — there is no Supabase
CLI installed or linked locally, and only 0001–0002 are confirmed applied.

## MVP build — Foundation + Core Loop (2026-07-29)
First real product increment, on top of the design system + AI assistant work.
Built and **verified end-to-end via live browser testing** (signup → confirm →
onboarding → add location → add staff → build a rota with drag-and-drop and
click-to-assign → publish): `/app` shell (sidebar/header/org-switcher),
`/onboarding` (create-org only — no invites table yet), `/app/locations`
(+departments), `/app/staff` (full CRUD, soft-delete), `/app/rota` (the rota
builder — `@dnd-kit` drag-and-drop + click-to-assign modal sharing one write
path, shift-type manager modal, AI "Auto Fill" folded in from the old
`AIRotaAssistantPage`, publish). `useOrg`/`usePermissions` rebuilt to match
`docs/HOOKS.md`'s documented contract. Full plan: see
`docs/SCREENS.md` for per-screen status.

**Real bug found and fixed via live testing, not code review**: org creation
failed RLS (`insert().select().single()`) because the SELECT policy
(`is_org_member`) couldn't see the row before the `on_org_created` trigger
granted membership — Postgres checks `RETURNING` visibility before that
trigger fires. Fixed in `0003_fix_organisations_select_rls.sql` by also
allowing `created_by = auth.uid()`. This is exactly the kind of bug that only
surfaces with a real authenticated client request — every prior test in this
project used elevated/service-role access that bypasses RLS entirely. Worth
remembering: **RLS-sensitive flows need at least one real signed-in-user test,
not just admin-privileged SQL checks.**

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

## Design & Naming (CONFIRMED — superseded 2026-07-29 by design/*.png + docs/DESIGN.md)
- Aesthetic: Clean & professional (Linear/Notion-like; trusted-tool feel). Still true.
- Theme: **light by default** (not auto/prefers-color-scheme as originally planned —
  revised once `design/rotaflowui.png` showed an explicit "Light Mode (Default)"
  toggle). Dark remains fully supported as a deliberate user choice.
- Accent: Blue, revised to `#3B6FE0` (was `#2563EB`) per `design/designsystem.png`.
  Same value in both themes — no separate dark-mode accent.
- appName: RotaFlow · shortName: RotaFlow (8 chars) · slug: rotaflow.
- Full token set (colours, type scale, shift-type palette, shadows, icons) now
  lives in `docs/DESIGN.md` — treat that as canonical, this entry as history.

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
