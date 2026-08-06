# RotaFlow. Screen Inventory

Every design in `design/` mapped to whether it is actually built, verified against
the real route table in `src/App.tsx` and the real page code, not against what an
earlier version of this document claimed.

**Legend**

- ✅ **Built**, a real route, doing real work against real data
- 🟡 **Partial**. Something exists at that route, but the design specifies
  substantially more than is built
- ❌ **Not built**, no route, no component

**Scope of this document:** does the _feature_ exist and work. Pixel-fidelity to a
mockup is tracked separately in `docs/LOOP.md`, which is the authority on
design-match. A screen can be ✅ here and still not match its mockup visually.

Role note: the real `MembershipRole` is `owner | manager | staff`. "Super Admin" is a
separate `is_platform_admin` flag, not a fourth role.

---

## 1. Public, auth, onboarding & launch

| Status | Design                        | Screen                                    | Route                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `marketting.png`              | Marketing home                            | `/`. Hero, product shot, 8-benefit grid, sector cards, stats band, "Why teams choose", social-proof slot, CTA banner and a 5-column footer. Full nav: `/features` `/solutions` `/pricing` `/resources` `/about` `/contact`, all routed and asserted by `navigationTargets.test.ts`. **Traction figures and testimonials are deliberately absent**, see below |
| ✅     |, | Features · Solutions · Pricing            | `/features`, `/solutions`, `/pricing`. Pricing states plainly that billing is not live, because `subscriptions` is an empty seam and nothing can charge anyone (§3 Billing)                                                                                                                                                                                    |
| ✅     |, | Resources · About · Contact               | `/resources` publishes a built / partial / not-built breakdown of the product. `/contact` validates and composes an email, there is no contact table or form endpoint, and a fake "we'll be in touch" is worse than none. See `ContactPage`                                                                                                                   |
| ✅     | `signin.png`                  | Sign in. Password, magic link, OAuth     | `/login`                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | `signup.png`                  | Sign up. Carries an invite token through | `/signup`                                                                                                                                                                                                                                                                                                                                                      |
| ✅     | `splash-screen.png`           | Cold-start splash                         | `/splash`, also inline while auth resolves                                                                                                                                                                                                                                                                                                                     |
| 🟡     | `appboot.png`                 | App boot / "setting up organisation"      | In production this renders **inline** from `ProtectedRoute` while auth/org resolve. It has no production URL. `/appboot` is a design-loop **preview route only**, with fixed props, existing so the state can be screenshotted. Real either way, but it does not yet match the mockup's 5-step checklist UI, see `docs/LOOP.md`                              |
| ✅     | `Organisation-Onboarding.png` | Onboarding 1. Create org                 | `/onboarding`                                                                                                                                                                                                                                                                                                                                                  |
| ✅     | `Organisation-about.png`      | Onboarding 2. About your org             | `/onboarding`                                                                                                                                                                                                                                                                                                                                                  |
| ✅     | `Team-onboarding.png`         | Onboarding 3. Invite team                | `/onboarding`. Department/location fields on this step stage locally and are never persisted, a real, self-documented schema gap                                                                                                                                                                                                                              |
| ✅     | `Plan-Selection.png`          | Onboarding 4. Choose plan                | `/onboarding`. Records intent only; no charging exists (see §3 Billing)                                                                                                                                                                                                                                                                                        |
| ✅     | `Onboarding-Complete.png`     | Onboarding 5. Done                       | `/onboarding`. Deliberately swaps two dead mockup links for real ones                                                                                                                                                                                                                                                                                          |

## 2. Core scheduling & workforce

| Status | Design                        | Screen                                        | Route                                                                                                             |
| ------ | ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ✅     | `Workforce-Dashboard.png`     | Manager dashboard                             | `/app/dashboard`                                                                                                  |
| ✅     | `Rota-Builder.png`            | Rota builder. Drag/drop, AI fill, publish    | `/app/rota`                                                                                                       |
| ✅     | `Schedule-dashboard.png`      | Schedule. Manager default view               | `/app/schedule`                                                                                                   |
| ✅     | `live-schedule.png`           | Schedule. Staff "live" agenda state          | `/app/schedule`                                                                                                   |
| ✅     | `published-schedule.png`      | Schedule. Post-publish state                 | `/app/schedule`                                                                                                   |
| ✅     | `staff.png`                   | Staff directory                               | `/app/staff`                                                                                                      |
| 🟡     | `Staff-Profile.png`           | Staff profile detail                          | `/app/staff`, an edit modal plus emergency-contacts/documents modals over the list, not a `/app/staff/:id` route |
| ✅     | `Availability.png`            | Availability. Staff pattern + team view      | `/app/availability`                                                                                               |
| ✅     | `Leave.png`                   | Leave. Requests, entitlement, approvals      | `/app/leave`, Balances shows Annual only (`holiday_allowance` is one number); no overtime queue (P2-7)           |
| ✅     | `Swap-Request.png`            | Shift swaps. Request, respond, approve       | `/app/swaps`                                                                                                      |
| ✅     | `Timesheets-Dashboard.png`    | Timesheets. Real hours from clock events     | `/app/timesheets`                                                                                                 |
| ✅     | `Reports-Dashboard.png`       | Reports. CSV export                          | `/app/reports`                                                                                                    |
| ✅     | `Announcements-Dashboard.png` | Announcements. Table, preview rail, composer | `/app/announcements`                                                                                              |
| ✅     | `Locations-Management.png`    | Locations                                     | `/app/locations`                                                                                                  |
| ✅     | `Location-department.png`     | Departments within a location                 | `/app/locations` (`DepartmentManager`)                                                                            |
| ✅     | `clockin.png`                 | Clock in/out. GPS + manual, offline-queued   | `/app/clock`                                                                                                      |

## 3. Settings area-8 designed tabs, all 8 built as tabs

`/app/settings` is a layout route with the tab bar in the layout, so a new
section is one `<Route>` plus a `SETTINGS_TABS` entry, and a missing half is
immediately visible. `navigationTargets.test.ts` asserts every tab resolves.

Where the reference asks for something the system genuinely cannot do, the
screen **says so on the screen, with the reason** rather than faking it. That is
the pattern to follow when extending these.

| Status | Design                      | Tab           | Reality                                                                                                                                                                |
| ------ | --------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `SettingsOrganisation.png`  | Organisation  | Org details, preferences and role display labels, through a typed `orgPreferences` reader over the `organisations.settings` jsonb                                      |
| ✅     |, | Permissions   | Membership + staff-profile derived; absorbed the old `/app/team` invite/revoke                                                                                         |
| ✅     |, | Roles         | Owner/manager/staff. States plainly that custom roles cannot be represented, `memberships.role` is a three-value CHECK (P2-4)                                         |
| ✅     | `Settingspolicy.png`        | Policies      | Scheduling policies over `organisations.settings`. The reference's ~55-policy engine with per-policy scope/history and live rota validation remains a separate project |
| ✅     | `SettingsNotifications.png` | Notifications | Per-category defaults. SMS is shown as unavailable. There is no provider, and template administration has no table                                                   |
| ✅     | `SettingsIntegrations.png`  | Integrations  | Per-org SMTP with a real test-send. Moved here from top-level `/app/integrations`, which redirects                                                                     |
| ✅     | `Settingsbilling.png`       | Billing       | Reads `subscriptions`. States that no payment provider is connected rather than rendering an invoice table that cannot exist                                           |
| ✅     | `Settingsaudit.png`         | Audit         | Reads `audit_logs`. Still thin until more events are written (P1-5). The viewer exists, the writers mostly do not                                                     |

## 4. My Profile area-6 designed tabs, all 6 built as tabs

Same layout-route pattern as §3, at `/app/account`. Every role sees every tab. This is a person's own account.

| Status | Design                 | Tab         | Reality                                                                                                                                                   |
| ------ | ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `ProfileSettings.png`  | Profile     | Name, contact, job title, department, and the notification matrix                                                                                         |
| ✅     | `profileprefrence.png` | Preferences | Theme and the preferences `app_settings` can actually hold. The reference's ~20 fields exceed the two-column table; the gap is stated on the screen       |
| ✅     | `ProfileSecurity.png`  | Security    | Password change. MFA, backup codes and trusted devices are named as not built rather than shown as a "100% secure" ring over checks nothing performs      |
| ✅     |, | Sessions    | "Sign out everywhere" works. Supabase does not expose a session list to the client, and the screen says so instead of showing an empty device table       |
| ✅     |, | API Tokens  | Explains there is no public API to hold a token for, and why issuing long-lived JWTs would be a security incident rather than a feature. See `TokensPage` |
| ✅     |, | Activity    | Reads `audit_logs` for this user                                                                                                                          |

## 5. Built with no design mockup

| Status | Screen                                          | Route                                         |
| ------ | ----------------------------------------------- | --------------------------------------------- |
| ✅     | Team management. Issue/revoke invites          | Settings → Permissions; `/app/team` redirects |
| ✅     | Notifications inbox. Read, push opt-in         | `/app/notifications`                          |
| ✅     | Account settings                                | `/app/account/*` (see §4)                     |
| ✅     | Forgot / reset password                         | `/forgot-password`, `/reset-password`         |
| ✅     | Accept invite. Public, pre-signup              | `/invite/:token`                              |
| ✅     | Permission denied. Role, requirement, way back | rendered by `RequireRole` on a gated route    |
| ✅     | 404                                             | `*`                                           |

## 6. Navigation. Settled

The restructure this section used to describe as an open question landed in #75,
and the shell around it in the product-vision pass. Current state:

**Sidebar** is role-resolved, not a flat constant (`navItemsForRole`). A manager
sees the designed twelve plus Clock in; a staff member sees nine, with Settings
replaced by My Profile. The three differences from the mockups were decisions:

- **Integrations** moved into Settings, as every reference screen shows.
  `/app/integrations` redirects.
- **Team** folded into Settings → Permissions. It is invite/revoke, i.e.
  organisation administration. `/app/team` redirects.
- **Clock in** is kept for every role, against audit01 §7c's "staff only"
  recommendation. In a small care home the owner and manager are usually on the
  rota themselves; hiding it costs a working manager the screen they open twice
  a day, showing it costs a non-clocking manager one ignorable row.

**Also in the shell:**

| Piece                                                                 | Where                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| Tagline, org switcher, profile block, Help & Support, collapse toggle | `Sidebar` + `SidebarOrgSwitcher` + `SidebarFooter`     |
| Global search (`⌘K`). Screens and actions, role-filtered             | `GlobalSearch`, catalogue in `src/lib/globalSearch.ts` |
| Mobile bottom tab bar. Home · Schedule · Clock in · Leave · More     | `MobileTabBar`; `More` opens the sidebar drawer        |
| Route-level role gate + permission-denied screen                      | `RequireRole`, `PermissionDenied`                      |

**Collapsed state** persists in `localStorage` and is read during the initial
`useState` rather than in an effect, so the page does not jump sideways on load.

**Global search deliberately does not search records**, only screens and their
actions. A fan-out of `ilike` queries across a dozen tables on every keystroke is
a query storm against tenants with six-figure row counts. Record search drops in
as an extra result group; see `src/lib/globalSearch.ts`.

**Notifications** still has no sidebar entry in either design or build; it is
reached via the bell.

## 7. Other gaps (no design file)

| Status | Item                                          | Note                                                                                        |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ❌     | Overtime requests                             | `overtime_requests` table exists; no route, no UI, never scoped                             |
| ❌     | Shift templates                               | `shift_templates` table exists; nothing reads it                                            |
| ❌     | Staff self-service for own contacts/documents | Owner/manager-only today, via modals on `/app/staff`                                        |
| ❌     | Document / avatar upload                      | `documents.file_url` is a pasted link; no storage integration (ImageKit or otherwise) wired |
| ❌     | Email change                                  | Needs Supabase's confirmation round-trip on both addresses                                  |
| ❌     | QR clock-in                                   | GPS + manual only; nothing generates a per-location code                                    |
| ❌     | Super Admin console (`/admin`)                | `is_platform_admin` exists in the schema; the console does not                              |

## 8. Tables with no UI

`audit_logs` · `subscriptions` · `overtime_requests` · `shift_templates`

No screen **reads** any of these. Verified by grepping `src/` for
`from('<table>')`, zero hits for all four. Each is a seam someone deliberately left.

"No UI reads" is not the same as "inert", and the difference matters if you build
against them:

- **`audit_logs` is written to**, server-side, by the `anonymize_staff_member` RPC
  (`0011`). So it accumulates rows for exactly one event type and nothing else, no
  logins, rota publishes, shift edits or role changes. Treat it as provisioned but
  effectively empty, not as a populated log waiting for a viewer.
- **`subscriptions`, `overtime_requests`, `shift_templates`** have no reader _and_ no
  writer anywhere. Client or server. They are empty structure.

## 9. GDPR. Built, deliberately narrower than "delete everything"

Per-staff **export** (JSON of everything held) and **anonymize** (scrub PII, keep
operational rows) on `/app/staff`, owner-only, via `anonymize_staff_member`
(`0011_gdpr_anonymize.sql`, applied). Two things it deliberately does not do:

- Delete the person's RotaFlow login (`profiles`/`auth.users`), that can span
  organisations and needs the Auth Admin API, a platform-level operation.
- Delete the file behind a stored `documents.file_url`, only the row goes.

## 10. Realtime

12 screens live-update via `useRealtimeRefresh` (`docs/HOOKS.md` §11) against the 13
tables published in `0012_realtime.sql`: Dashboard, Schedule, Leave, Swaps,
Timesheets, Clock in, Availability, Announcements, Notifications, Staff, Locations,
Team.

**Rota Builder is deliberately excluded.** Its load path calls
`getOrCreateRotaForPeriod`, which INSERTs, so a naive subscription creates a
write→event→refetch cycle and a mid-drag refetch could disturb an in-progress edit.
It needs a mutation-aware guard first.

`org_smtp_settings` and `audit_logs` are deliberately **not** published. Publishing
a table whose whole design is that clients cannot read a column would hand that
column out in a change payload.

---

## Reference assets (not screens)

`designsystem.png` (token sheet, source of truth for `docs/DESIGN.md`) ·
`rotaflowui.png` (system applied) · `logo.png` / `logo-1.png` / `logo-2.png`.

## Marketing copy. The standing rule

RotaFlow is **pre-launch and has no customers**, and `/` is live at
rota.gakinz.com where real prospective buyers read it. So the public site carries
no invented traction, no testimonials and no customer logos.

`src/lib/marketing.ts` holds every word of copy and states the rule in full.
`TRACTION` and `TESTIMONIALS` are empty constants; the stats band and the
social-proof slot render honest alternatives while they are empty and switch over
automatically once real figures exist. Nothing else has to change.

This is not caution for its own sake: publishing "10,000+ active users" or a
quote attributed to a named person at a named company would be a false factual
claim to a buyer, which is a CAP Code breach and the kind of thing a competitor
or the ASA can act on. `docs/audit01.md` §4 reached the same conclusion
independently.

The same rule governs feature claims: nothing goes in `PRODUCT_BENEFITS` that is
not built, checked against this document first.

## Counts

35 screen mockups in `design/`: **33 ✅ built · 2 🟡 partial · 0 ❌ not built.**
Plus 7 built screens with no mockup, and 6 designed tabs (Permissions, Roles,
Sessions, API Tokens, Activity, Connected Accounts) specified by the tab bars but
having no mockup file of their own. All six now built.

> Updated after #75 (the 14 Settings and Profile screens) and the product-vision
> pass (marketing site, app shell). The two remaining 🟡 are `appboot.png`, which
> is real but does not match the mockup's 5-step checklist, and
> `Staff-Profile.png`. Several ✅ rows are built-and-working but deliberately
> narrower than their reference, and say so on the screen. See §3 and §4.

> Corrected 2026-07-31 (`docs/audit01.md`). This previously read 34/23/7 and listed
> Clock in under §5 "built with no design mockup", but `design/clockin.png` exists
> and the screen was matched to it in #43, so §5 was the wrong section and the total
> was one short. The cause: `clockin.png` was one of 18 mockups sitting **untracked**
> when this file was written, so `git ls-files design/` disagreed with `ls design/`.
> All 40 are now tracked. Count against the working tree, not the index.

The remaining work is concentrated almost entirely in **Settings**, **My Profile**
and the **marketing site**. The core scheduling product is built.

> Counts verified by parsing this file's own tables against `ls design/`, not by
> hand. The invariant, if you add a mockup: every **screen** `.png` in `design/`
> appears in exactly one status row here. Reference assets are excluded from that
> rule, `designsystem.png`, `rotaflowui.png`, `logo.png`, `logo-1.png`,
> `logo-2.png` are tokens and brand marks, not screens, and have no status row.
