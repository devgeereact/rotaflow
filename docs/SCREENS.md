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
| Notifications inbox / center   | `[Gap]`            | `notifications` table exists, no route or UI                                                                                     |
| Announcements feed (read view) | `[V1]`             | `/app/announcements`                                                                                                             |
| Account / profile settings     | `[V1]`             | `profiles` table, no dedicated screen yet                                                                                        |
| Org settings                   | `[V1]`             | `/app/settings`                                                                                                                  |
| Notification preferences       | `[V1]`             | Toggle exists on Dashboard, belongs in Settings                                                                                  |
| Theme (light/dark) control     | `[Built]`          | `ThemeContext` + toggle                                                                                                          |
| Logout                         | `[Built]`          | `useSupabaseAuth().signOut()` in `DashboardPage.tsx` — consider a brief "Signed out" confirmation before redirecting to `/login` |

## 4. Staff-facing screens

| Screen                              | Status      | Notes                                                                              |
| ----------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| My schedule (rota view)             | `[V1]`      | `/app/schedule` — month/week/day, ICS subscribe/download                           |
| Availability submission             | `[V1]`      | `/app/availability` (staff mode)                                                   |
| Leave request + tracking            | `[V1]`      | `/app/leave` (staff mode)                                                          |
| Overtime request/offer              | `[Gap]`     | `overtime_requests` table exists, no named route                                   |
| Shift swap request + status         | `[V1]`      | `/app/swaps` (staff mode)                                                          |
| Clock in/out                        | `[V1]`      | GPS/QR/manual (`clock_events`, `useGeolocation`, `useSyncQueue`)                   |
| My timesheets / hours               | `[V1]`      | `/app/timesheets` (staff mode)                                                     |
| My documents                        | `[Phase 2]` | `documents` table exists, automation deferred                                      |
| Emergency contact management        | `[Gap]`     | `emergency_contacts` table exists, no route                                        |
| AI Rota Assistant (restricted view) | `[Built]`   | Staff/non-managers see a restriction message on `/app/rota` instead of the builder |

## 5. Manager-facing screens

| Screen                              | Status                | Notes                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rota builder                        | `[Built]`             | `/app/rota` — real drag-and-drop (dnd-kit) + click-to-assign modal (same write path), AI auto-fill, publish/unpublish. Published weeks reload correctly as of Phase 1.5. No templates, conflict detection, or undo/redo yet |
| Shift type/template management      | `[Built, modal only]` | `shift_types` CRUD via a modal on the rota toolbar — no standalone route. `shift_templates` still untouched                                                                                                                 |
| Staff directory                     | `[Built]`             | `/app/staff` — full CRUD, soft-delete via `active`                                                                                                                                                                          |
| Staff profile detail/edit           | `[Built, partial]`    | Edit modal covers core fields; no nested emergency contacts/documents yet                                                                                                                                                   |
| Team availability view              | `[V1]`                | `/app/availability` (manager mode)                                                                                                                                                                                          |
| Leave approvals                     | `[V1]`                | `/app/leave` (manager mode)                                                                                                                                                                                                 |
| Swap approvals                      | `[V1]`                | `/app/swaps` (manager mode)                                                                                                                                                                                                 |
| Clock-in review / timesheet exports | `[V1]`                | `/app/timesheets` (manager mode)                                                                                                                                                                                            |
| Announcements composer              | `[V1]`                | `/app/announcements` (manager mode)                                                                                                                                                                                         |
| Reports & exports                   | `[V1]`                | `/app/reports`                                                                                                                                                                                                              |
| AI Rota Assistant (full)            | `[Built]`             | "Auto Fill" inside `/app/rota` (`AutoFillPanel`) — no longer a standalone page                                                                                                                                              |

## 6. Owner / org-admin screens

| Screen                                 | Status                         | Notes                                                                                                      |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Locations & departments management     | `[Built]`                      | `/app/locations` — writable by owner **and** manager per RLS (not owner-only, despite the section heading) |
| Roles & team management / invite users | `[V1]`                         | Likely folded into `/app/settings`                                                                         |
| Subscription/billing (view only)       | `[V1 view / Phase 2 charging]` | PRD scopes live charging out of V1                                                                         |
| Org-wide reports                       | `[V1]`                         | Overlaps with Manager's `/app/reports`                                                                     |
| GDPR data export/delete                | `[V1]`                         | Backed by `audit_logs`                                                                                     |

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

Next: **Phase 2 — access & identity completion.** The `invites` table (gap #7) is
the true blocker: with no way to add a second user to an org, none of the
staff-facing screens can be tested with a real staff account. Then the staff
schedule view, since the PRD identifies staff as the largest user group.
