# RotaFlow — Screen Inventory (Splash → Logout)

Full map of every screen the app needs, reconciled from the current codebase
(`src/pages/`, `src/App.tsx`), the route table in `ARCHITECTURE.md` §3, and gaps found
in `SCHEMA.md` / `PRD.md` that have no named route yet.

**Legend:** `[Built]` exists today · `[V1]` in scope now, not yet built · `[Phase 2]`
explicitly deferred per `PRD.md` · `[Gap]` implied by schema/PRD but missing from
`ARCHITECTURE.md`'s route table.

Role note: the codebase's actual `MembershipRole` is `owner | manager | staff`.
"Super Admin" is a separate `is_platform_admin` flag per the PRD, not a 4th membership
role — it gates the `/admin` console only.

---

## 1. System / launch (no auth required, global)

| Screen                    | Status    | Notes                                                                                                                                                                                  |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Splash / launch screen    | `[V1]`    | Shown on cold PWA start while auth/session resolves. `DESIGN.md` §7 has a source image (`splashscreen.png`); currently only a bare spinner in `ProtectedRoute.tsx` stands in for this. |
| Update-available banner   | `[Built]` | `src/components/UpdatePrompt.tsx`                                                                                                                                                      |
| Offline banner            | `[Built]` | `src/components/OfflineBanner.tsx`                                                                                                                                                     |
| Install prompt            | `[Built]` | `src/components/InstallPrompt.tsx`                                                                                                                                                     |
| Error boundary fallback   | `[Built]` | `src/components/ErrorBoundary.tsx`                                                                                                                                                     |
| Offline fallback (static) | `[Built]` | `public/offline.html`                                                                                                                                                                  |
| 404 Not Found             | `[Built]` | `src/pages/NotFoundPage.tsx`                                                                                                                                                           |

## 2. Auth & onboarding (public → establishes session/org)

| Screen                                  | Status                 | Notes                                                                                                    |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Marketing / home                        | `[Built]`              | `src/pages/HomePage.tsx`                                                                                 |
| Sign in                                 | `[Built]`              | `src/pages/LoginPage.tsx` — email+password, magic link, Google/GitHub OAuth                              |
| Sign up                                 | `[Gap]`                | Currently a toggle inside `LoginPage.tsx`, not the standalone `/signup` route named in `ARCHITECTURE.md` |
| Forgot / reset password                 | `[V1]`                 | No UI exists anywhere                                                                                    |
| Email verification / magic-link landing | `[V1]`                 | Needs a screen to handle the Supabase confirmation callback                                              |
| Accept invite (join org via email link) | `[V1]`                 | No invite-token flow exists                                                                              |
| Onboarding — create an organisation     | `[Built, create-only]` | `/onboarding`. "Join an org" not built — no `invites` table exists yet                                   |
| Org switcher                            | `[Built]`              | `useOrg().switchOrg` + `OrgSwitcher` in the header; hidden when only one membership                      |

## 3. Shared app shell (post-login, role varies content)

| Screen                         | Status             | Notes                                                                                                                            |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                      | `[Built, partial]` | `src/pages/DashboardPage.tsx` — minimal vs. the full spec (today's shifts, absences, pending requests, shortages)                |
| Notifications inbox / center   | `[Built]`          | `/app/notifications` — read + mark-read; genuinely empty until `send-notification` is deployed (manual, out-of-repo step)        |
| Announcements feed (read view) | `[Built]`          | `/app/announcements`                                                                                                             |
| Account / profile settings     | `[V1]`             | `profiles` table, no dedicated screen yet                                                                                        |
| Org settings                   | `[Built]`          | `/app/settings` — name, industry, org type, country, timezone, working week                                                      |
| Notification preferences       | `[V1]`             | Toggle exists on Dashboard, belongs in Settings                                                                                  |
| Theme (light/dark) control     | `[Built]`          | `ThemeContext` + toggle                                                                                                          |
| Logout                         | `[Built]`          | `useSupabaseAuth().signOut()` in `DashboardPage.tsx` — consider a brief "Signed out" confirmation before redirecting to `/login` |

## 4. Staff-facing screens

| Screen                              | Status                | Notes                                                                                                                                                                              |
| ----------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| My schedule (rota view)             | `[V1]`                | `/app/schedule` — month/week/day, ICS subscribe/download                                                                                                                           |
| Availability submission             | `[Built]`             | `/app/availability` (staff mode) — recurring weekly pattern; a one-off date is representable in the schema but not exposed yet, closer to a leave request                          |
| Leave request + tracking            | `[Built]`             | `/app/leave` (staff mode) — includes entitlement (`holiday_allowance` − approved days used this calendar year)                                                                     |
| Overtime request/offer              | `[Gap]`               | `overtime_requests` table exists, no named route — still deferred, no route was ever named in `ARCHITECTURE.md` unlike availability/leave/swaps                                    |
| Shift swap request + status         | `[Built]`             | `/app/swaps` (staff mode) — request an owned upcoming shift, optionally targeting a colleague; approving here does not move the shift, see manager row below                       |
| Clock in/out                        | `[Built, GPS+manual]` | `/app/clock` — GPS + manual, offline-queued via `useSyncQueue`. QR deferred: nothing generates a per-location code to scan yet                                                     |
| My timesheets / hours               | `[Built]`             | `/app/timesheets` (staff mode) — real hours computed from `clock_events`, not the `timesheets` table's submit/approve workflow (unspecified business rules; see PROJECT-MEMORY.md) |
| My documents                        | `[Phase 2]`           | `documents` table exists, automation deferred                                                                                                                                      |
| Emergency contact management        | `[Gap]`               | `emergency_contacts` table exists, no route                                                                                                                                        |
| AI Rota Assistant (restricted view) | `[Built]`             | Staff/non-managers see a restriction message on `/app/rota` instead of the builder                                                                                                 |

## 5. Manager-facing screens

| Screen                         | Status                | Notes                                                                                                                                                                                                                       |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rota builder                   | `[Built]`             | `/app/rota` — real drag-and-drop (dnd-kit) + click-to-assign modal (same write path), AI auto-fill, publish/unpublish. Published weeks reload correctly as of Phase 1.5. No templates, conflict detection, or undo/redo yet |
| Shift type/template management | `[Built, modal only]` | `shift_types` CRUD via a modal on the rota toolbar — no standalone route. `shift_templates` still untouched                                                                                                                 |
| Staff directory                | `[Built]`             | `/app/staff` — full CRUD, soft-delete via `active`                                                                                                                                                                          |
| Staff profile detail/edit      | `[Built, partial]`    | Edit modal covers core fields; no nested emergency contacts/documents yet                                                                                                                                                   |
| Team availability view         | `[Built]`             | `/app/availability` ("Team" toggle)                                                                                                                                                                                         |
| Leave approvals                | `[Built]`             | `/app/leave` ("Approvals" toggle) — approve/reject; RLS (`has_org_role`) is the real enforcement                                                                                                                            |
| Swap approvals                 | `[Built]`             | `/app/swaps` ("Approvals" toggle) — approving marks the swap approved only; a manager still reassigns the shift itself in the rota builder, same write path as any other reassignment                                       |
| Clock-in review                | `[Built]`             | `/app/timesheets` (manager mode, "Team" toggle) — hours review only, no export yet                                                                                                                                          |
| Announcements composer         | `[Built]`             | `/app/announcements` (manager mode)                                                                                                                                                                                         |
| Reports & exports              | `[Built]`             | `/app/reports` — CSV export (timesheets, leave, shifts, swaps) for a date range, owner/manager                                                                                                                              |
| AI Rota Assistant (full)       | `[Built]`             | "Auto Fill" inside `/app/rota` (`AutoFillPanel`) — no longer a standalone page                                                                                                                                              |

## 6. Owner / org-admin screens

| Screen                                 | Status                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locations & departments management     | `[Built]`                      | `/app/locations` — writable by owner **and** manager per RLS (not owner-only, despite the section heading)                                                                                                                                                                                                                                                                                                                                    |
| Roles & team management / invite users | `[Built]`                      | `/app/team` (see Phase 2 in "Suggested next step" below) — the `/app/settings` reference below is stale, this already shipped separately                                                                                                                                                                                                                                                                                                      |
| Integrations (org SMTP)                | `[Built]`                      | `/app/integrations` — owner-only; per-org SMTP so notification emails send from the org's own domain, falling back to the global sender when unconfigured; test-send via `test-smtp` Edge Function                                                                                                                                                                                                                                            |
| Subscription/billing (view only)       | `[V1 view / Phase 2 charging]` | PRD scopes live charging out of V1                                                                                                                                                                                                                                                                                                                                                                                                            |
| Org-wide reports                       | `[Built]`                      | Same `/app/reports` as Manager's row above — one screen, not a separate owner view                                                                                                                                                                                                                                                                                                                                                            |
| GDPR data export/delete                | `[Built, org-scoped]`          | Per-staff actions on `/app/staff` (owner-only): export everything RotaFlow holds on them as JSON, or anonymize their PII in this org (0011_gdpr_anonymize.sql). Does **not** delete their RotaFlow login — that can span other orgs and needs the Auth Admin API, a platform-level operation out of an org owner's reach. Deliberately anonymizes rather than hard-deletes shift/timesheet/leave history — see the migration's header for why |

## 7. Super Admin / platform console (explicitly deferred)

| Screen                                       | Status      | Notes                                      |
| -------------------------------------------- | ----------- | ------------------------------------------ |
| `/admin` console home                        | `[Phase 2]` | Gated by `is_platform_admin`               |
| Tenant management                            | `[Phase 2]` |                                            |
| Platform-wide subscription/billing oversight | `[Phase 2]` | Distinct from the per-org view in §6       |
| Support tools                                | `[Phase 2]` |                                            |
| Audit log viewer (platform-wide)             | `[Phase 2]` | RLS already allows Super Admin read access |
| Feature flags management                     | `[Phase 2]` |                                            |
| GDPR tools (platform-level)                  | `[Phase 2]` | Distinct from org-level screen in §6       |

---

## Known reconciliation gaps

1. ~~`ARCHITECTURE.md`'s route table omits the AI Rota Assistant~~ — resolved; it's
   documented as `AutoFillPanel` inside `/app/rota` (§9).
2. No route for **notifications inbox** despite a full `notifications` table.
3. No route for **overtime requests** despite a full `overtime_requests` table.
4. ~~No route for shift type management~~ — resolved as a modal, not a route
   (deliberate, see `ARCHITECTURE.md`'s IA note). `shift_templates` is still untouched.
5. No route for **emergency contacts** or **documents** — likely meant to nest under a staff profile screen.
6. `ProtectedRoute.tsx` only checks authentication, not role — role-specific screens
   still gate in-page (e.g. `/app/rota`'s `canBuildRota` check) rather than at the
   route level.
7. **New:** no "join an organisation" mechanism — no `invites` table. Onboarding is
   create-only; adding a second real user to an org needs a schema addition first.
8. **New:** `rotas` has no unique constraint on `(org_id, location_id, period_start,
period_end)` — concurrent builders on the same week could create duplicate drafts.
   Low risk for a single-manager MVP; flagged for a fast-follow migration.

## Suggested next step

Foundation + core loop (onboarding → locations → staff → rota builder → publish) is
built, verified end-to-end, and hardened by the Phase 1.5 pass (see
`PROJECT-MEMORY.md` — published-rota reload, session teardown on sign-out,
load-failure vs empty-state, toasts, OAuth gating).

**Phase 2 — access & identity — is now built** (code complete, see below for the
one outstanding step). It closes gap #7 and several `[V1]`/`[Gap]` rows above:

| Screen                     | Now                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sign up                    | `[Built]` — standalone `/signup`, carries an invite token through email confirmation                             |
| Forgot / reset password    | `[Built]` — `/forgot-password`, `/reset-password`                                                                |
| Email verification landing | `[Built]` — handled by `detectSessionInUrl` + PKCE on whichever page the link lands on; no separate route needed |
| Accept invite              | `[Built]` — `/invite/:token`, public so an invitee can preview before signing up                                 |
| Onboarding                 | `[Built]` — 5-step wizard (create org → about → invite team → plan → done), replacing the create-only stub       |
| Roles & team management    | `[Built]` — `/app/team`, issue and revoke invitations                                                            |
| Splash / app boot          | `[Built]` — `AppBootScreen` drives real boot stages from connectivity, auth and org resolution                   |

Migrations `0006_invites.sql` and `0007_slug_available.sql` were applied
2026-07-29 and the invite round-trip is live.

**Not yet real:** invitations produce a link to send manually. Automated email
delivery needs the SMTP Edge Function, which belongs to the notifications phase.
Plan selection records intent only — no payment is collected anywhere.

**Phase 3 — staff schedule view — is built.** `/app/schedule`, published-only,
day/week/2-week/month, ICS export, staff agenda vs manager grid.

**Phase 4 (part 1) — offline write outbox — is built.** `useSyncQueue` +
IndexedDB outbox, to the exact `docs/HOOKS.md` §8 contract. Landed with no
consumer at the time; Phase 5's clock-in screen is its first.

**Phase 5 — time & attendance — is built**, to the scope below:

| Screen                    | Now                                                         |
| ------------------------- | ----------------------------------------------------------- |
| Clock in/out              | `[Built, GPS+manual]` — `/app/clock`, offline-queued        |
| My hours                  | `[Built]` — `/app/timesheets`, computed from `clock_events` |
| Clock-in review (manager) | `[Built]` — `/app/timesheets` "Team" toggle                 |

**Deliberately not built:** QR clock-in (nothing generates a per-location code
to scan), the `timesheets` table's submit/approve/export workflow (no
automation populates it, and its period/approval rules were never specified —
see `PROJECT-MEMORY.md`), and payroll export.

**Phase 6 — requests workflow — is built**, to the scope below:

| Screen                          | Now                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability (staff + team)     | `[Built]` — `/app/availability`                                                                                                                                                                      |
| Leave request + entitlement     | `[Built]` — `/app/leave`                                                                                                                                                                             |
| Leave approvals                 | `[Built]` — `/app/leave` "Approvals" toggle                                                                                                                                                          |
| Shift swap request              | `[Built]` — `/app/swaps`                                                                                                                                                                             |
| Swap respond (target colleague) | `[Built]` — needed `0008_shift_swaps_target_respond.sql`, a real RLS gap flagged when `swapService.ts` first landed in Phase 4 (the target colleague could read but not write a swap targeting them) |
| Swap approvals (manager)        | `[Built]` — `/app/swaps` "Approvals" toggle, final sign-off only                                                                                                                                     |

**Deliberately not built:** overtime requests (`overtime_requests` table
exists, but no route was ever named in `ARCHITECTURE.md`, unlike the other
three — genuinely `[Gap]`, not deferred `[V1]`). Approving a swap does not
reassign the shift on the rota — that write happens in the rota builder, the
same path as any other reassignment, so it keeps the builder's conflict and
coverage context rather than bypassing it from an approval click.

Migration `0008_shift_swaps_target_respond.sql` is written but **not yet
applied** — same status 0006/0007 had before they were run. The target-accept
path does not work until it is.

**Phase 7 — notifications & announcements — is built**, to the scope below:

| Screen                        | Now                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Notifications inbox           | `[Built]` — `/app/notifications`, read + mark-read, web push via `useWebPush` |
| Announcements feed + composer | `[Built]` — `/app/announcements`, staff read / owner+manager compose          |

**Not yet real:** delivery itself. `send-notification` (Edge Function) and
`0009_push_subscriptions.sql` are written but not yet deployed/applied — both
manual, out-of-repo steps. The screens are correct and ready for whenever
that lands; until then, `notifications` stays empty on a fresh deploy.

**Phase 8 — settings & integrations — is built**, to the scope below:

| Screen       | Now                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Org settings | `[Built]` — `/app/settings`, owner-only edit of name + the same industry/type/country/timezone/working-week fields captured at onboarding                                                        |
| Integrations | `[Built]` — `/app/integrations`, owner-only per-org SMTP (host/port/user/password/from) so notification email sends from the org's own mailbox instead of a shared sender, with a real test-send |

Per-org SMTP (`0010_org_smtp_settings.sql`) is read by `send-notification`,
which now prefers it and falls back to the global `SMTP_*` secrets when an
org hasn't configured its own. RLS itself does permit the owner to `SELECT`
the row (the write policy is `for all`, which covers `SELECT` too) — what
actually keeps `smtp_pass` from ever coming back through the client is the
column-level GRANT, which excludes it entirely for `authenticated`.
`org_smtp_settings_safe` (a `security_invoker` view) is what the UI actually
queries, and `test-smtp` is the only Edge Function that ever reads the
password.

**Reports/CSV export and GDPR data export/delete are now built too** — see
Phase 9 below. An audit log viewer remains genuinely deferred: `audit_logs`
exists and is written to (e.g. by the GDPR anonymize RPC), but nothing reads
it back yet.

Everything that was manual/out-of-repo as of Phase 8 is now done: migrations
`0009`/`0010` applied, `send-notification`/`test-smtp` deployed, real SMTP
credentials set (`info@rota.gakinz.com` via cPanel mail), and Inngest event
routing configured (see Phase 9's own Inngest note below for the one thing
that turned out to be missing — a hosted app, not a dashboard setting).

**Phase 9 — reports & GDPR — is built**, to the scope below:

| Screen                | Now                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reports & exports     | `[Built]` — `/app/reports`, owner/manager, date-range CSV export for timesheets (from real `clock_events`, matching `/app/timesheets`'s own math), leave, published shifts, and swaps |
| GDPR export/anonymize | `[Built, org-scoped]` — per-staff actions on `/app/staff`, owner-only: export everything as JSON, or anonymize their PII in this org via `anonymize_staff_member` (0011)              |

GDPR delete is **anonymize, not hard-delete** — a deliberate choice: shift,
timesheet and leave rows stay intact (so payroll history and rota records
remain consistent and defensible for UK payroll retention), but every column
identifying _who_ it was is scrubbed on `staff_profiles`, and
`emergency_contacts`/`documents` (pure PII containers with no operational
value once the person is gone) are deleted outright. Scope is deliberately
one organisation: this does not delete the person's RotaFlow login
(`profiles`/`auth.users`), which can span other orgs and needs Supabase's
Auth Admin API — a platform-level operation, not an org owner's to trigger.
`documents.file_url` points at externally-hosted files (ImageKit); only the
database row is removed, not the underlying file — a real "erase everything"
flow needs a follow-up call to ImageKit's own API, flagged rather than
silently left half-done.

Also discovered and fixed this phase: **Inngest Cloud has no dashboard-level
"route event X to a URL" webhook feature.** Functions are code you host
yourself; Inngest discovers them by syncing an app URL. `supabase/functions/
inngest/index.ts` now hosts that app (one function per event
`useInngestDispatch` sends), deployed with `--no-verify-jwt` since Inngest's
own request signing — not Supabase's gateway JWT check — authenticates calls
into it.

Migration `0011_gdpr_anonymize.sql` is written but **not yet applied** to
the live database — same status every new migration has before the user
runs it. The GDPR actions on `/app/staff` will fail until it is.

Not yet built, still genuinely deferred: an audit log viewer (platform-wide,
`[Phase 2]` per §7 — `audit_logs` is written to but nothing reads it back in
the product yet), overtime requests, emergency contacts/documents screens
(the tables exist and the GDPR export now reads them, but there's still no
UI to create or edit one), and the Super Admin console.
