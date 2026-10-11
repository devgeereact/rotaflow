# RotaFlow. Screen Inventory

Every design in `docs/design/` mapped to whether it is actually built, verified against
the real route table in `src/App.tsx` and the real page code, not against what an
earlier version of this document claimed.

**Legend**

- ✅ **Built**, a real route, doing real work against real data
- 🟡 **Partial**. Something exists at that route, but the design specifies
  substantially more than is built
- ❌ **Not built**, no route, no component

**Scope of this document:** does the _feature_ exist and work. Pixel-fidelity to a
mockup is tracked separately in `docs/UX-SPEC.md#design-match-loop`, which is the authority on
design-match. A screen can be ✅ here and still not match its mockup visually.

Role note: the real `MembershipRole` is `owner | manager | staff`. "Super Admin" is a
separate `is_platform_admin` flag, not a fourth role.

---

## 1. Public, auth, onboarding & launch

| Status | Design                        | Screen                                   | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `marketting.png`              | Marketing home                           | `/`. Hero, product shot, 8-benefit grid, sector cards, stats band, "Why teams choose", social-proof slot, CTA banner and a 5-column footer. Full nav: `/features` `/solutions` `/pricing` `/resources` `/about` `/contact`, all routed and asserted by `navigationTargets.test.ts`. **Traction figures and testimonials are deliberately absent**, see below                                                                                                                                                                |
| ✅     | ,                             | Features · Solutions · Pricing           | `/features`, `/solutions`, `/pricing`. Pricing states plainly that signup takes no card: the organisation's owner picks a plan afterwards and pays through Stripe checkout, from Settings → Billing (§3)                                                                                                                                                                                                                                                                                                                    |
| ✅     | ,                             | Resources · About · Contact              | `/resources` publishes a built / partial / not-built breakdown of the product. `/contact` validates and composes an email, there is no contact table or form endpoint, and a fake "we'll be in touch" is worse than none. See `ContactPage`                                                                                                                                                                                                                                                                                 |
| ✅     | `signin.png`                  | Sign in. Password, magic link, OAuth     | `/login`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅     | `signup.png`                  | Sign up. Carries an invite token through | `/signup`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ✅     | `splash-screen.png`           | Cold-start splash                        | `/splash`, also inline while auth resolves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅     | `appboot.png`                 | App boot / "setting up organisation"     | In production this renders **inline** from `ProtectedRoute` while auth/org resolve. It has no production URL. `/appboot` is a design-loop **preview route only**, with fixed props, existing so the state can be screenshotted. The reference's five stages are built (`AppBootScreen`: Secure connection → Loading your data → Setting up organisation → Preparing features → Finalising), each driven by a real signal rather than a timer. Whether it _matches_ the mockup is `docs/UX-SPEC.md#design-match-loop`'s call |
| ✅     | `Organisation-Onboarding.png` | Onboarding 1. Create org                 | `/onboarding`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅     | `Organisation-about.png`      | Onboarding 2. About your org             | `/onboarding`. **Industry is asked here and only here** since 2026-09-10 (BUG-097): step 1 asked for it too and pre-filled this one from it, so the wizard looked as though it had forgotten an answer given one screen earlier                                                                                                                                                                                                                                                                                             |
| ✅     | `Team-onboarding.png`         | Onboarding 3. Invite team                | `/onboarding`. Department and location fields are now persisted to `invites.department_id` and `invites.location_id` as of `0126`, applied to the staff record when the invite is accepted                                                                                                                                                                                                                                                                                                                                  |
| ✅     | `Plan-Selection.png`          | Onboarding 4. Choose plan                | `/onboarding`. Writes `settings.intended_plan` and `settings.billing_period`, **not** `organisations.plan` — since `0120` only a paid subscription sets that, so the organisation stays on free Starter until Checkout completes. This row said "writes `organisations.plan`" until 2026-09-10, which had been wrong since `0120`. The step now tells the customer the same thing (BUG-091). Payment happens afterwards, from Settings → Billing (see §3)                                                                   |
| ✅     | `Onboarding-Complete.png`     | Onboarding 5. Done                       | `/onboarding`. Deliberately swaps two dead mockup links for real ones                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 2. Core scheduling & workforce

| Status | Design                        | Screen                                                                                                                      | Route                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `Workforce-Dashboard.png`     | Manager dashboard                                                                                                           | `/app/dashboard`. Two branches, chosen by role: `OperationsDashboard` for an owner or manager, `StaffDashboard` for staff. The staff branch reached an error boundary for every staff member until 2026-09-10 (GAP-118) and is now covered by `e2e/staff-dashboard.spec.ts` — the design here is the manager one, and the staff branch has no reference PNG |
| ✅     | `Rota-Builder.png`            | Rota builder. Drag/drop, AI fill, publish                                                                                   | `/app/rota`                                                                                                                                                                                                                                                                                                                                                 |
| ✅     | `Schedule-dashboard.png`      | Schedule. Manager default view                                                                                              | `/app/schedule`                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `live-schedule.png`           | Schedule. Staff "live" agenda state                                                                                         | `/app/schedule`                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `published-schedule.png`      | Schedule. Post-publish state                                                                                                | `/app/schedule`                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `staff.png`                   | Staff directory                                                                                                             | `/app/team` (`StaffPage`), manager-only via `RequireRole`. `/app/staff` is a redirect to it, not a screen                                                                                                                                                                                                                                                   |
| ✅     | `Staff-Profile.png`           | Staff profile detail                                                                                                        | `/app/team/:staffId` → `StaffProfilePage`. Five real tabs (Overview, Shifts, Documents, Leave, Activity); Activity is honestly empty, no per-person feed exists in the schema. `/app/staff/:staffId` redirects here                                                                                                                                         |
| ✅     | `Availability.png`            | Availability. Staff pattern + team view                                                                                     | `/app/availability`                                                                                                                                                                                                                                                                                                                                         |
| ✅     | `Leave.png`                   | Leave. Requests, entitlement, approvals                                                                                     | `/app/leave`, Balances shows Annual only (`holiday_allowance` is one number). Overtime is its own screen, `/app/overtime` (§5). One person may hold one live booking per day: an overlapping request is refused by `0152` at the database, not by the form (GAP-123)                                                                                        |
| ✅     | `Swap-Request.png`            | Shift swaps. Request, respond, approve                                                                                      | `/app/swaps`                                                                                                                                                                                                                                                                                                                                                |
| ✅     | ,                             | Open shifts. Uncovered shifts anybody can take                                                                              | `/app/open-shifts` → `OpenShiftsPage` (CAP-010, `0103`). No design reference: `shifts.status = 'open'` existed from `0002` with no staff-facing surface at all, so this screen is new rather than a match. A shift clashing with the reader's own roster is shown and flagged, never filtered out                                                           |
| ✅     | ,                             | Approvals. Everything waiting on a manager                                                                                  | `/app/approvals` → `ApprovalsPage` (CAP-093), manager-only via `RequireRole`. Leave, swaps and overtime in one list, oldest first, decided in place. A swap still waiting on a colleague is deliberately absent — a queue with rows you cannot clear stops being read                                                                                       |
| ✅     | `Timesheets-Dashboard.png`    | Timesheets. Real hours from clock events                                                                                    | `/app/timesheets`                                                                                                                                                                                                                                                                                                                                           |
| ✅     | `Reports-Dashboard.png`       | Reports. CSV export                                                                                                         | `/app/reports`                                                                                                                                                                                                                                                                                                                                              |
| ✅     | `Announcements-Dashboard.png` | Announcements. Table, preview rail, composer                                                                                | `/app/announcements`                                                                                                                                                                                                                                                                                                                                        |
| ✅     | `Locations-Management.png`    | Locations                                                                                                                   | `/app/locations`                                                                                                                                                                                                                                                                                                                                            |
| ✅     | `Location-department.png`     | Departments within a location                                                                                               | `/app/locations` (`DepartmentManager`)                                                                                                                                                                                                                                                                                                                      |
| ✅     | `clockin.png`                 | Clock in/out. GPS + manual, offline-queued                                                                                  | `/app/clock`                                                                                                                                                                                                                                                                                                                                                |
| ✅     | none — new 2026-09-06         | Team Attendance. The managerial counterpart of Clock In: who actually turned up, against who was rostered, with corrections | `/app/attendance` (owner/manager)                                                                                                                                                                                                                                                                                                                           |

## 3. Settings area-8 designed tabs, all 8 built as tabs

`/app/settings` is a layout route with the tab bar in the layout, so a new
section is one `<Route>` plus a `SETTINGS_TABS` entry, and a missing half is
immediately visible. `navigationTargets.test.ts` asserts every tab resolves.

Where the reference asks for something the system genuinely cannot do, the
screen **says so on the screen, with the reason** rather than faking it. That is
the pattern to follow when extending these.

| Status | Design                      | Tab           | Reality                                                                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `SettingsOrganisation.png`  | Organisation  | Org details, preferences and role display labels, through a typed `orgPreferences` reader over the `organisations.settings` jsonb                                                                                                                                                                                                                  |
| ✅     | ,                           | Permissions   | Membership + staff-profile derived; absorbed the old `/app/team` invite/revoke                                                                                                                                                                                                                                                                     |
| ✅     | ,                           | Roles         | Owner/manager/staff. States plainly that custom roles cannot be represented, `memberships.role` is a three-value CHECK (P2-4)                                                                                                                                                                                                                      |
| ✅     | `Settingspolicy.png`        | Policies      | Scheduling policies over `organisations.settings`. The reference's ~55-policy engine with per-policy scope/history and live rota validation remains a separate project                                                                                                                                                                             |
| ✅     | `SettingsNotifications.png` | Notifications | Per-category defaults. SMS is shown as unavailable. There is no provider. Templates are stored in `notification_templates` (`0108`), and rendering respects organisation-specific wording where one exists                                                                                                                                         |
| ✅     | `SettingsIntegrations.png`  | Integrations  | Per-org SMTP with a real test-send. Moved here from top-level `/app/integrations`, which redirects                                                                                                                                                                                                                                                 |
| ✅     | `Settingsbilling.png`       | Billing       | Reads `subscriptions` and starts Stripe checkout / the hosted Customer Portal (`billingCheckoutService`, over the `create-checkout-session`, `create-portal-session` and `stripe-webhook` Edge Functions). Invoice history and saved cards live in Stripe's portal rather than being rebuilt here; there is still no usage meter or credits ledger |
| ✅     | `Settingsaudit.png`         | Audit         | Reads `audit_logs` (`auditService.listAuditLogs`). No longer thin: `audit_write` (0016) plus triggers and RPCs across 0017, 0021-0026, 0030, 0034, 0039-0040 write real events                                                                                                                                                                     |

## 4. My Profile area-7 designed tabs, all 7 built as tabs

Same layout-route pattern as §3, at `/app/account`. Every role sees every tab. This is a person's own account.

| Status | Design                 | Tab                | Reality                                                                                                                                                                                                                |
| ------ | ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `ProfileSettings.png`  | Profile            | Name, contact, job title, department, and the notification matrix                                                                                                                                                      |
| ✅     | `profileprefrence.png` | Preferences        | Theme and the preferences `app_settings` can actually hold. The reference's ~20 fields exceed the two-column table; the gap is stated on the screen                                                                    |
| ✅     | `ProfileSecurity.png`  | Security           | Password change, and TOTP two-factor enrolment since `0102`. Backup codes and trusted devices are still named as not built rather than shown as a "100% secure" ring over checks nothing performs                      |
| ✅     | ,                      | Connected Accounts | `/app/account/accounts`. Lists the Supabase identities on this login and links/unlinks the OAuth providers `env.ts` has configured. See `ConnectedAccountsPage`                                                        |
| ✅     | ,                      | Sessions           | Lists every device on the account with its user agent, IP and last use, and signs the others out (`my_sessions`, `0100`). It said Supabase exposed no session list; `auth.sessions` always had one and nothing read it |
| ✅     | ,                      | API Tokens         | Explains there is no public API to hold a token for, and why issuing long-lived JWTs would be a security incident rather than a feature. See `TokensPage`                                                              |
| ✅     | ,                      | Activity           | Reads `audit_logs` for this user                                                                                                                                                                                       |

## 5. Built with no design mockup

| Status | Screen                                               | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Team management. Issue/revoke invites                | Settings → Permissions (`/app/settings/permissions`). The _directory_ is a separate screen, `/app/team`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | Overtime. Raise, withdraw, approve                   | `/app/overtime` → `OvertimePage` / `OvertimeView`. Open to every role; the page's Team toggle is what gates the approval queue behind `canApprove`                                                                                                                                                                                                                                                                                                                                                                            |
| ✅     | Help & support                                       | `/app/help` → `HelpPage`. FAQ, "Contact support" (`openSupportCase`, 0024) landing in the platform console's queue (§11), and "Your requests": the requester's own cases, the non-internal thread, a **reply** into it on any case that is not closed (`reply_to_support_case`, GAP-012) and a 1-5 rating once resolved                                                                                                                                                                                                       |
| ✅     | Setup checklist. What the organisation still needs   | `/app/setup` (CAP-114), owner and manager. Ten steps, six required and four recommended, each derived from a count read back through RLS rather than a stored flag. Added 2026-10-11 to this table; it had no row here                                                                                                                                                                                                                                                                                                        |
| ✅     | Notifications inbox. Read, push opt-in               | `/app/notifications`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅     | Account settings                                     | `/app/account/*` (see §4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅     | Forgot / reset password                              | `/forgot-password`, `/reset-password`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✅     | Accept invite. Public, pre-signup                    | `/invite/:token`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ✅     | Legal. Privacy, Terms, Cookies, Accessibility, Trust | **Five routes, not four.** `/legal/privacy`, `/legal/cookies` and `/legal/accessibility` are written from the code and checkable against it (CAP-060, 2026-08-31); `/legal/trust` publishes the sub-processor list, the AI transparency notice and the security disclosure policy from `src/lib/subprocessors.ts`, and `npm run check:docs` now resolves each row's cited path (BUG-067); `/legal/terms` is still the placeholder shell, because a contract cannot be derived from a codebase. All linked from `PublicFooter` |
| ✅     | OAuth / magic-link return                            | `/auth/callback` → `AuthCallbackPage` (`src/components/RouteAliases.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅     | Permission denied. Role, requirement, way back       | rendered by `RequireRole` on a gated route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅     | 404                                                  | `*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The platform console (`/admin/*`, 18 screens) also has no mockup PNG. It has its
own reference, `docs/design/PLATFORM_CONSOLE.html`, and its own section: **§11**.

## 6. Navigation. Settled

The restructure this section used to describe as an open question landed in #75,
and the shell around it in the product-vision pass. Current state:

**Sidebar** is role-resolved, not a flat constant (`navItemsForRole`). A manager
sees thirteen workspace entries, a staff member ten (no Rota Builder, Team or
Locations). Beneath them `footerNavItemsForRole` adds two more: Help & Support
for everyone, plus Settings for a manager or My Profile for staff. The three
differences from the mockups were decisions:

- **Integrations** moved into Settings, as every reference screen shows.
  `/app/integrations` redirects.
- **Team management** — invite/revoke — folded into Settings → Permissions, as
  organisation administration. The nav's "Team" entry is the workforce
  _directory_ at `/app/team`; `/app/staff` redirects there.
- **Clock in** is kept for every role, against the 2026-07-31 audit's "staff only"
  recommendation. In a small care home the owner and manager are usually on the
  rota themselves; hiding it costs a working manager the screen they open twice
  a day, showing it costs a non-clocking manager one ignorable row.

**Also in the shell:**

| Piece                                                                 | Where                                                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tagline, org switcher, profile block, Help & Support, collapse toggle | `Sidebar` + `SidebarOrgSwitcher` + `SidebarFooter`. Help & Support points at `/app/help` (§5), not the public contact page |
| Global search (`⌘K`). Screens and actions, role-filtered              | `GlobalSearch`, catalogue in `src/lib/globalSearch.ts`                                                                     |
| Mobile bottom tab bar. Home · Schedule · Clock in · Leave · More      | `MobileTabBar`; `More` opens the sidebar drawer                                                                            |
| Route-level role gate + permission-denied screen                      | `RequireRole`, `PermissionDenied`                                                                                          |

**Collapsed state** persists in `localStorage` and is read during the initial
`useState` rather than in an effect, so the page does not jump sideways on load.

**Global search deliberately does not search records**, only screens and their
actions. A fan-out of `ilike` queries across a dozen tables on every keystroke is
a query storm against tenants with six-figure row counts. Record search drops in
as an extra result group; see `src/lib/globalSearch.ts`.

**Notifications** still has no sidebar entry in either design or build; it is
reached via the bell.

## 7. Other gaps (no design file)

| Status | Item                                          | Note                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚫     | Shift templates                               | **Removed rather than built, `0096`.** The table was created in `0002` and never read; a reader would have largely duplicated `shift_types`, which already carries name, colour and default times. Deleting the row was the decision, not the deferral (BUG-051)                                                        |
| ❌     | Staff self-service for own contacts/documents | Narrower than it reads: `0042` lets a staff member update their own `phone` and `photo_url`, and a trigger holds everything else to owner/manager. Emergency contacts and documents are still read and written only from `/app/team/:staffId` (`RequireRole`, manager-gated); no `/app/account/*` screen touches either |
| ❌     | Document / avatar upload                      | `documents.file_url` and `photo_url` are pasted links. Nothing signs an upload. The ImageKit URL builder, `src/lib/imagekit.ts`, had no caller and was removed on 11 October 2026                                                                                                                                       |
| ❌     | Email change                                  | Needs Supabase's confirmation round-trip on both addresses. `supabase.auth.updateUser` is called for passwords only                                                                                                                                                                                                     |
| ❌     | QR clock-in                                   | GPS + manual only. `clock_events` records `gps \| qr \| manual`, but nothing generates a per-location code, and there is no PIN in the schema either. See `ClockActionPane`                                                                                                                                             |

Two long-standing ❌ rows here have been closed and moved:

- **Overtime requests** ship. `/app/overtime` → `OvertimePage` /
  `OvertimeView` / `overtimeService`, realtime-refreshed, with the approval
  queue behind `canApprove` (§5, §10).
- **The Super Admin console** ships, as 18 screens under `/admin` (§11).

## 8. Tables with no UI

**`platform_health_probes` and `rate_limit_events`. Both correctly so.**

`shift_templates`, the entry this section existed for, is gone: `0096` dropped it on
2026-08-31 rather than building the reader it had been waiting for since `0002`, because
`shift_types` already carries the name, colour and default times a template would have
(BUG-051).

The two that remain are a different thing, and it is worth saying why rather than
striking the section. They hold **RLS enabled, zero policies, and grants to
`service_role` alone** — `platform_health_probes` matches a `pg_net` reply back to the
probe that asked for it (`0076`), and `rate_limit_events` is the shared limiter's ledger
of who attempted what and when (`0085`). A screen reading either would be a defect, not a
feature: the second is an audit trail of failed attempts keyed by user id and IP, and
exposing it would tell one tenant about another.

**They were missing from this section, and from `docs/DATA-MODEL.md`, until 2026-08-31** —
along with the `integration_connector_stats` view. The method recorded below is why: it
greps `src/` and `supabase/` for `from('<table>')`, which finds every table a _client_
touches and is blind by construction to one no client role can reach. A tool that can only
see what is reachable will always report the unreachable as absent. Both are now in
`docs/DATA-MODEL.md` §4.8 with their grants written down.

Do not re-derive this from a memory of the old text: the section named four tables at one
point, three grew UI, and the fourth was deleted. All four are listed here so the stale
version cannot be reconstructed:

- **`audit_logs`** is read by `auditService` (Settings → Audit, My Profile →
  Activity, and the Leave and Timesheets screens) and, in the console, by
  `listPlatformAuditLogs` (`/admin/audit`, `/admin` overview),
  `listOrgAuditLogs` (`/admin/organisations/:organisationId`) and
  `listUserAuditLogs` (`/admin/users/:userId`). It is written by `audit_write`
  (0016) and by triggers and RPCs across 0017, 0021-0026, 0030, 0034 and
  0039-0040, not just 0011's `anonymize_staff_member`.
- **`subscriptions`** is read by `subscriptionService` (Settings → Billing) and
  by `platformService` / `platformOrgService` (`/admin/subscriptions`,
  `/admin/billing`, `/admin/organisations/:id`), and written by the
  `stripe-webhook` Edge Function.
- **`overtime_requests`** is read and written by `overtimeService`, behind
  `/app/overtime` and the reports analytics card.

## 9. GDPR. Built, deliberately narrower than "delete everything"

Per-staff **export** (JSON of everything held) and **anonymize** (scrub PII, keep
operational rows) on `/app/team`, owner-only, via `anonymize_staff_member`
(`0011_gdpr_anonymize.sql`, applied). Two things it deliberately does not do:

- Delete the person's RotaFlow login (`profiles`/`auth.users`), that can span
  organisations and needs the Auth Admin API, a platform-level operation.
- Delete the file behind a stored `documents.file_url`, only the row goes.

The _obligation_ side — the Article 12(3) one-month clock on each request — is a
separate screen in the platform console, `/admin/gdpr` (§11). This section is the
action; that one is the register.

## 10. Realtime

13 screens live-update via `useRealtimeRefresh` (`docs/ARCHITECTURE.md#hook-contracts` §11) against the 14
tables published by `0012_realtime.sql` (13) and `0013_realtime_overtime.sql` (1):
Dashboard, Schedule, Leave, Swaps, Overtime, Timesheets, Clock in, Availability,
Announcements, Notifications, Team directory, Locations, and the invite manager in
Settings → Permissions.

**Rota Builder is deliberately excluded.** Its load path calls
`getOrCreateRotaForPeriod`, which INSERTs, so a naive subscription creates a
write→event→refetch cycle and a mid-drag refetch could disturb an in-progress edit.
It needs a mutation-aware guard first.

`org_smtp_settings` and `audit_logs` are deliberately **not** published. Publishing
a table whose whole design is that clients cannot read a column would hand that
column out in a change payload.

## 11. Platform console (`/admin`)-18 screens, all built

This section used to read "Super Admin console does not exist". It does. Nineteen
files in `src/pages/admin/`, eighteen of them routed in `src/App.tsx`; the
nineteenth is `AdminPreviewHarness`, the DEV-only design-loop harness.

It sits **outside `/app`** on purpose: the area is above organisations, so it is
gated on `profiles.is_platform_admin` (`RequirePlatformAdmin`) rather than on a
`MembershipRole`. `ProtectedRoute` still wraps it, so an anonymous visitor is sent
to sign in rather than told the area exists. Four routes narrow it further with
`RequirePlatformRole`, because a hidden nav link that still renders when the URL
is typed is a decoration, not a permission.

Reference for this area is `docs/design/PLATFORM_CONSOLE.html`, not a PNG. There is no
mockup file for any of these, so none of them appears in the §-counts below.

| Status | Screen              | Route                                  | Note                                                                                                                                           |
| ------ | ------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Overview            | `/admin` (index)                       | Platform-wide counts plus a real `audit_logs` activity feed                                                                                    |
| ✅     | Organisations       | `/admin/organisations`                 | Tenant register                                                                                                                                |
| ✅     | Organisation detail | `/admin/organisations/:organisationId` | Nine of the reference's ten tabs. Activity is stated-not-shown on the Data tab                                                                 |
| ✅     | Users               | `/admin/users`                         | Cross-tenant accounts. The platform-admin grant is the one write, and it refuses to strand the platform                                        |
| ✅     | User detail         | `/admin/users/:userId`                 | One account across every tenant. Auth facts via `platform_user_auth_facts` (0027)                                                              |
| ✅     | Subscriptions       | `/admin/subscriptions`                 | `RequirePlatformRole` → `PLATFORM_BILLING_ROLES`. Keyed on organisations, so a tenant with no subscription shows                               |
| ✅     | Billing             | `/admin/billing`                       | `PLATFORM_BILLING_ROLES`. MRR/ARR/collected/outstanding, all summed in `src/lib/revenue.ts` over `invoices` and `subscriptions × plans` (0023) |
| ✅     | Support Centre      | `/admin/support`                       | The `support_cases` queue (0024). `/app/help` is the requester-facing door into it                                                             |
| ✅     | Support case detail | `/admin/support/:caseId`               | Reply, status, assign. Status/assign need `PLATFORM_SUPPORT_ROLES`; the controls disable rather than vanish                                    |
| ✅     | Support access      | `/admin/support-access`                | Time-boxed tenant access. Since 0028 a session genuinely gates RLS via `has_support_access()`                                                  |
| ✅     | Audit logs          | `/admin/audit`                         | Cross-tenant `audit_logs`                                                                                                                      |
| ✅     | Platform health     | `/admin/platform-health`               | Configured-integration reporting plus a re-probing Watch mode                                                                                  |
| ✅     | Incidents           | `/admin/incidents`                     | `incidents` + `incident_updates` (0021)                                                                                                        |
| ✅     | Integrations        | `/admin/integrations`                  | Platform services (build-time config) kept separate from tenant integrations (per-org SMTP, the only one)                                      |
| ✅     | Notifications       | `/admin/notifications`                 | `PLATFORM_CONFIG_ROLES`, gated on the route as well as the nav: it is a cross-tenant view of who was told what                                 |
| ✅     | Feature flags       | `/admin/feature-flags`                 | `PLATFORM_CONFIG_ROLES`. Reports `platform_settings`' two real switches; per-tenant flags have no table and are absent rather than faked       |
| ✅     | GDPR & data         | `/admin/gdpr`                          | A deadline register (Article 12(3)), not a data browser. The per-staff action lives in §9                                                      |
| ✅     | Platform settings   | `/admin/settings`                      | `PLATFORM_CONFIG_ROLES`. Owns `maintenance_mode` + `maintenance_message` as one write                                                          |

**Preview harness.** `/admin-preview/*` mounts the real `AdminShell` and the real
page components with `fetch` intercepted so the Supabase client answers from
fixtures. DEV only, defined behind `devPage(...)` so Rollup drops it from the
production bundle. It is the only way to look at these screens without a seeded
platform-admin session.

---

## Reference assets (not screens)

`designsystem.png` (token sheet, source of truth for `docs/DESIGN-SYSTEM.md`) ·
`rotaflowui.png` (system applied) · `logo.png` / `logo-1.png` / `logo-2.png`.

## Marketing copy. The standing rule

RotaFlow is **pre-launch and has no customers**, and `/` is live at
rotaflow.space where real prospective buyers read it. So the public site carries
no invented traction, no testimonials and no customer logos.

`src/lib/marketing.ts` holds every word of copy and states the rule in full.
`TRACTION` and `TESTIMONIALS` are empty constants; the stats band and the
social-proof slot render honest alternatives while they are empty and switch over
automatically once real figures exist. Nothing else has to change.

This is not caution for its own sake: publishing "10,000+ active users" or a
quote attributed to a named person at a named company would be a false factual
claim to a buyer, which is a CAP Code breach and the kind of thing a competitor
or the ASA can act on. The 2026-07-31 audit reached the same conclusion
independently.

The same rule governs feature claims: nothing goes in `PRODUCT_BENEFITS` that is
not built, checked against this document first.

## Deleted from `docs/design/`

`screenshoots/` — 21 screenshots, 14 MB, referenced by nothing in this repository and
deleted on 2026-08-31. They were captures of the **demo dataset**, which was torn down on
2026-08-14, on **`rota.gakinz.com`**, which was retired on 2026-08-29, and they included
the owner's own browser chrome and bookmark bar. A design reference this document cites by
name earns its place; a screenshot of data that no longer exists on a host that no longer
exists does not, least of all in a public repository.

**They remain in git history.** Deleting a file from the working tree does not unpublish
it — treat anything ever committed here as public, and do not read this row as a
remediation.

## Counts

35 screen mockups in `docs/design/`: **35 ✅ built · 0 🟡 partial · 0 ❌ not built.**

Plus, with no mockup file of their own:

- **12 rows in §5** — team management, overtime, help, the setup checklist, notifications inbox,
  account settings, forgot/reset password, accept invite, the legal pages (five
  routes, in one row), the OAuth callback, permission denied, 404.
- **18 platform-console screens in §11** (`/admin/*`), referenced by
  `docs/design/PLATFORM_CONSOLE.html`.
- **6 designed tabs** specified by the §3/§4 tab bars — Permissions, Roles,
  Connected Accounts, Sessions, API Tokens, Activity. All six built.

> Recomputed 2026-08-20 by parsing this file's own tables, not by hand. The
> previous block read `33 ✅ · 2 🟡` and predated three landings: the admin
> console, `/app/overtime`, and the `/app/staff` → `/app/team` move. The two 🟡
> both closed on their own terms — `appboot.png`'s five-stage checklist is built
> in `AppBootScreen`, and `Staff-Profile.png` now has the `/app/team/:staffId`
> route whose absence was the reason for its 🟡.

**A ✅ here is not a design-match claim.** Several ✅ rows are built-and-working
but deliberately narrower than their reference, and say so on the screen (§3,
§4). `docs/UX-SPEC.md#design-match-loop` is the authority on whether a screen matches its mockup, and
its rows are maintained separately from these.

> Corrected 2026-07-31 by an audit doc that has since been deleted from the repo
> with no replacement, so this note is now the only surviving record of the fix.
> This previously read 34/23/7 and listed
> Clock in under §5 "built with no design mockup", but `clockin.png` exists
> and the screen was matched to it in #43, so §5 was the wrong section and the total
> was one short. The cause: `clockin.png` was one of 18 mockups sitting **untracked**
> when this file was written, so `git ls-files` disagreed with `ls`.
> All 40 design files under `docs/design/` are now tracked and present on disk — the rename is complete.

The core scheduling product, the platform console, Settings and My Profile are
built. What is left is listed in §7, and it is short.

> Counts verified by parsing this file's own tables against `ls docs/design/`, not
> by hand (the mockups moved out of the repo root into `docs/design/`; there is no
> top-level `docs/design/` any more). The invariant, if you add a mockup: every
> **screen** `.png` in `docs/design/` appears in exactly one status row here.
> Reference assets are excluded from that rule, `designsystem.png`,
> `rotaflowui.png`, `logo.png`, `logo-1.png`, `logo-2.png` are tokens and brand
> marks, not screens, and have no status row.

## Design-match loop

The `/loop` design-match prompt, driven against `localhost:5042`. Merged from the deleted `docs/LOOP.md` on 11 October 2026. §1 to §11 above answer "is the screen built"; this section answers "does it match its mockup".

Paste the block under **"The prompt"** into `/loop`. Swap `<SCREEN>` and `<REF>` per
screen using the tables below.

**This is a web PWA, not a mobile app**. There's no simulator. The loop drives a real
Chrome tab against the local Vite dev server (`http://localhost:5042`) and screenshots
that, not `xcrun simctl`.

### How to read the status column

§1 to §11 of this file answer "does the feature exist". **This section answers "does it
match its mockup"**. They are different questions and a screen is regularly ✅ in
one and not the other.

- **Matched**, a design-match pass has landed on `main`. Only reopen for a
  regression.
- **Not matched**. The feature is built and working, but nothing has ever
  compared it to its reference. **This is where the remaining work is.**
- **Not built**, no route, no component. Design-match is not the right tool yet;
  it needs a feature build first (schema, service, page), then a match pass.

### Preview routes. Read this before screenshotting

Most matched screens live behind auth and need a real Supabase session, an org and
seeded rows, which the loop cannot produce. The pattern already in use is a
**`*-preview` route** carrying fixed mock data that reproduces the reference's exact
numbers. Sixteen exist, all inside the one `import.meta.env.DEV` block in
`src/App.tsx` (`:435`-`:564`): `/appboot`, `/onboarding-preview`,
`/dashboard-preview`, `/rota-builder-preview`, `/schedule-preview`,
`/timesheets-preview`, `/clockin-preview`, `/admin-preview` (the whole platform
console nested under it), `/staff-preview`, `/staff-preview/:staffId`,
`/locations-preview`, `/locations-preview/departments`, `/announcements-preview`,
`/reports-preview`, `/app-preview/*` and `/dashboard-live-preview`.

There is **no `/leave-preview` and no `/swaps-preview`**, though earlier revisions of
this file named both. Screenshot those two on their live routes instead, `/app/leave`
and `/app/swaps`.

**The references are not 1:1 CSS pixels. Check the export scale before measuring
anything.** Several mockups are large designs exported smaller, and two separate
passes lost an iteration to this independently (locations, leave). So:

1. Divide the PNG's width and height by a plausible design size (start with
   1920×1080). **If both ratios agree, that is the export scale.** `Leave.png` is
   1672×941, `1672/1920 = 0.8708` and `941/1080 = 0.8713`.
2. Then either divide every measurement you take off the PNG by that scale before
   comparing it to a CSS pixel, or capture at the design size and scale your own
   screenshot down to match.

Skip this and correct type reads 15-30% too large, and you will spend an iteration
shrinking a type scale that was already right. Where the scale cannot be recovered
(the locations mockups' body text is ~0.7× `text-sm` and no clean ratio fits),
match _proportions and structure_ at the project's real type scale rather than the
reference's literal font sizes or container widths.

**The loop has no committed tooling, and this section used to imply otherwise.**
`docs/design/.loop/` is git-ignored (`.gitignore`, the `.loop/` lines) and does not exist in a fresh
clone. The `shot.sh`, `compare.py` and `diff.py` referred to below and in the
per-screen logs were written during the leave pass and live only in whatever working
copy produced them; nothing in this repository ships them, and `scripts/` holds
seven files, none of which is a design-loop script. So every capture, log and overlay
this document cites is a local artefact, and the loop is run by hand: capture the
screen, capture the reference, scale, compare.

The reference PNGs in `docs/design/` are committed and are the durable half. Pass the
URL explicitly when capturing — the dev port is **5042** (`strictPort` in
`vite.config.ts`) and several `-preview` routes named in older logs no longer exist.

Two things about the preview routes that have caused re-work:

1. **Preview pages render page content only, no `AppShell`.** Every reference PNG
   shows the sidebar and top bar, because that is how the screen looks in the
   product. The preview deliberately omits them. Do not "fix" the missing sidebar;
   compare the content region and ignore the chrome. The one exception is
   `/app-preview/*`, which exists precisely to render the shell (rail, org switcher,
   topbar, mobile tab bar) around those same page components.
2. They are **DEV-only and absent from the production bundle**. Both the routes and
   the `lazyPage(...)` definitions behind them sit inside `import.meta.env.DEV`
   (`src/App.tsx:68` and `:435`); Vite replaces that with the literal `false` at
   build time, so Rollup drops the routes _and_ tree-shakes every preview page and
   mock dataset out of `dist/`. Verify after a build with
   `grep -c PreviewPage dist/sw.js`, which must be `0`. The loop is unaffected: it
   drives the dev server, where `DEV` is true.

### Screens with a design reference

One status table for every screen with a mockup. **built** is the §1 to §4 answer (does the feature exist and work); **matches design** is this section's (has a design-match pass compared it with its reference). Every designed screen is built as of 11 October 2026, so the remaining work is entirely in the second column.

| `<SCREEN>`          | route                                            | `<REF>`                                   | built | matches design                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------ | ----------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marketing-home      | `/`                                              | `docs/design/marketting.png`              | ✅    | **Not matched.** The sections the ref specifies are now built (§1: product shot, benefit grid, "Why teams choose", CTA banner, full nav); traction figures and testimonials are deliberately absent. No match pass has been recorded since                                                                                                   |
| splash              | `/splash`                                        | `docs/design/splash-screen.png`           | ✅    | Matched                                                                                                                                                                                                                                                                                                                                      |
| appboot             | `/appboot` (preview)                             | `docs/design/appboot.png`                 | ✅    | **Not matched.** The ref's five stages are built (§1, `AppBootScreen`), each driven by a real signal. No match pass has been recorded since                                                                                                                                                                                                  |
| login               | `/login`                                         | `docs/design/signin.png`                  | ✅    | Matched (#27)                                                                                                                                                                                                                                                                                                                                |
| signup              | `/signup`                                        | `docs/design/signup.png`                  | ✅    | Matched. Standalone route, carries an invite token through                                                                                                                                                                                                                                                                                   |
| onboarding-org      | `/onboarding-preview?step=1`                     | `docs/design/Organisation-Onboarding.png` | ✅    | Matched                                                                                                                                                                                                                                                                                                                                      |
| onboarding-about    | `/onboarding-preview?step=2`                     | `docs/design/Organisation-about.png`      | ✅    | Matched                                                                                                                                                                                                                                                                                                                                      |
| onboarding-team     | `/onboarding-preview?step=3`                     | `docs/design/Team-onboarding.png`         | ✅    | Matched (#26)                                                                                                                                                                                                                                                                                                                                |
| onboarding-plan     | `/onboarding-preview?step=4`                     | `docs/design/Plan-Selection.png`          | ✅    | Matched (#28)                                                                                                                                                                                                                                                                                                                                |
| onboarding-complete | `/onboarding-preview?step=5`                     | `docs/design/Onboarding-Complete.png`     | ✅    | Matched. Swaps two dead mockup links for real ones                                                                                                                                                                                                                                                                                           |
| dashboard           | `/dashboard-preview`                             | `docs/design/Workforce-Dashboard.png`     | ✅    | Matched (#31)                                                                                                                                                                                                                                                                                                                                |
| rotabuilder         | `/rota-builder-preview`                          | `docs/design/Rota-Builder.png`            | ✅    | Matched (#33, #40)                                                                                                                                                                                                                                                                                                                           |
| schedule            | `/schedule-preview`                              | `docs/design/Schedule-dashboard.png`      | ✅    | Matched (#42)                                                                                                                                                                                                                                                                                                                                |
| schedule-live       | `/schedule-preview` (live state)                 | `docs/design/live-schedule.png`           | ✅    | Matched (#42)                                                                                                                                                                                                                                                                                                                                |
| schedule-published  | `/schedule-preview` (published state)            | `docs/design/published-schedule.png`      | ✅    | Matched (#42)                                                                                                                                                                                                                                                                                                                                |
| timesheets          | `/timesheets-preview`                            | `docs/design/Timesheets-Dashboard.png`    | ✅    | Matched (#44)                                                                                                                                                                                                                                                                                                                                |
| clockin             | `/app/clock` + `/clockin-preview`                | `docs/design/clockin.png`                 | ✅    | Matched **and live**, rebuilt again against the ref in #123. Both routes render the same `ClockInView`. Capture at 1590 wide and scale by **0.80**. The ref is a 1920×1280 design at 80%; see `docs/design/.loop/clockin-log.md`                                                                                                             |
| staff               | `/app/team` + `/staff-preview`                   | `docs/design/staff.png`                   | ✅    | **Not matched.** `StaffPage` ships and is routed (`src/App.tsx:603`); `/app/staff` is now a redirect to it (`:618`). No `design-staff-match` branch exists locally or on the remote, and there is no `staff-log.md`, so nothing has ever compared this to the ref                                                                            |
| staff-profile       | `/app/team/:staffId` + `/staff-preview/:staffId` | `docs/design/Staff-Profile.png`           | ✅    | **Not matched.** The `:id` route is built now, `StaffProfilePage` at `src/App.tsx:611`, with `/app/staff/:staffId` redirecting (`:619`). No match log                                                                                                                                                                                        |
| availability        | `/app/availability`                              | `docs/design/Availability.png`            | ✅    | **Not matched. Next up.** No preview route exists for it, so capture behind a real session                                                                                                                                                                                                                                                   |
| leave               | `/app/leave`                                     | `docs/design/Leave.png`                   | ✅    | Matched. `/leave-preview` was removed; capture `/app/leave` at 1656×1300 and scale by `1672/1920`; see `docs/design/.loop/leave-log.md`                                                                                                                                                                                                      |
| swaps               | `/app/swaps`                                     | `docs/design/Swap-Request.png`            | ✅    | Matched. `/swaps-preview` was removed; `/app/swaps` renders `SwapsView`, minus the Swap Rules card (no policy store). No log survives from that pass                                                                                                                                                                                         |
| reports             | `/app/reports` + `/reports-preview`              | `docs/design/Reports-Dashboard.png`       | ✅    | Matched (#123). Both render `ReportsView`; the live catalogue omits the six of the ref's ten reports that have no query behind them, rather than showing them disabled. See `docs/design/.loop/reports-log.md`                                                                                                                               |
| announcements       | `/announcements-preview`                         | `docs/design/Announcements-Dashboard.png` | ✅    | Matched. No log survives from that pass                                                                                                                                                                                                                                                                                                      |
| locations           | `/locations-preview`                             | `docs/design/Locations-Management.png`    | ✅    | Matched. Merged with the Departments screen into one tabbed workspace                                                                                                                                                                                                                                                                        |
| locations-depts     | `/locations-preview/departments`                 | `docs/design/Location-department.png`     | ✅    | Matched. Second tab of the same workspace. `DepartmentManager` now opens as a dialog, and the live `/app/locations/departments` redirects to `/app/locations` (`src/App.tsx:634`)                                                                                                                                                            |
| settings-org        | `/app/settings/organisation`                     | `docs/design/SettingsOrganisation.png`    | ✅    | **Not matched.** `SettingsOrganisationPage` ships, adding the ref's contact block and sites/departments summary to the old flat screen; `/app/settings` redirects here (`src/App.tsx:680`). Industry Pack and Platform Support Access are deliberately not built, both need tables that do not exist                                         |
| settings-integr     | `/app/settings/integrations`                     | `docs/design/SettingsIntegrations.png`    | ✅    | **Not matched.** It is a Settings tab now, as the ref shows; the old top-level `/app/integrations` redirects here (`src/App.tsx:676`)                                                                                                                                                                                                        |
| profile             | `/app/account/profile`                           | `docs/design/ProfileSettings.png`         | ✅    | **Not matched, partly built**. See `docs/UX-SPEC.md` §4                                                                                                                                                                                                                                                                                      |
| profile-prefs       | `/app/account/preferences`                       | `docs/design/profileprefrence.png`        | ✅    | **Not matched.** `PreferencesPage` ships the preferences that are really stored, `app_settings.theme`, `app_settings.notifications_enabled` and the device's push subscription. The ref's language selector is deliberately absent, there is no i18n layer                                                                                   |
| settings-policy     | `/app/settings/policies`                         | `docs/design/Settingspolicy.png`          | ✅    | **Not matched.** `SettingsPoliciesPage` ships the six rules the product actually acts on, stored in `organisations.settings` rather than a policies table. The ref's ~55 policies across 10 categories are a policy engine, not a screen                                                                                                     |
| settings-audit      | `/app/settings/audit`                            | `docs/design/Settingsaudit.png`           | ✅    | **Not matched.** `SettingsAuditPage` ships over `audit_logs`, which now has several writers, not only `anonymize_staff_member`: leave declines, clock-event amendments and the AI assistant's `audit_write`                                                                                                                                  |
| settings-billing    | `/app/settings/billing`                          | `docs/design/Settingsbilling.png`         | ✅    | **Built, not ref-matched.** Stripe Checkout + Billing Portal wired (`0050`, `SettingsBillingPage.tsx`, `billingCheckoutService.ts`) — not verified against a real completed charge. See `docs/PRODUCT-SPEC.md` §5/§7                                                                                                                         |
| settings-notifs     | `/app/settings/notifications`                    | `docs/design/SettingsNotifications.png`   | ✅    | **Not matched.** `SettingsNotificationsPage` ships org-wide defaults across the three channels the product can deliver (in-app, email, web push). The ref's SMS column and 28-template library are deliberately absent, no provider and no `notification_templates` table. Distinct from `/app/notifications`                                |
| profile-security    | `/app/account/security`                          | `docs/design/ProfileSecurity.png`         | ✅    | **Not matched.** `SecurityPage` ships password change and TOTP two-factor (`0102`), and `/app/account/sessions` lists real devices and revokes them (`0100`). Backup codes and trusted devices are still absent, and the ref's 100% "Security check-up" ring is deliberately not built — three of its four ticks cannot be answered honestly |

**Before starting any row whose status says a card or field is deliberately not
built**, read `docs/UX-SPEC.md` §3/§4 and the page's own header comment. Several of
those gaps need a migration or a whole subsystem, so a design-match loop alone
cannot close them.

| tokens only | `docs/design/designsystem.png` |

### Screens with NO design reference

No mockup exists for these; layout is **inferred** from the nearest built/referenced
screen plus the tokens in `docs/design/designsystem.png`. Run the loop against the
closest ref for surface/type/radius fidelity only. Do **not** try to make them
identical to it.

There is no longer a separate `team` row here. `/app/team` is the workforce directory
itself, so it has a real reference (`docs/design/staff.png`) and lives in the table
above under `staff`.

| `<SCREEN>`    | route                  | closest ref (inferred from)                             |
| ------------- | ---------------------- | ------------------------------------------------------- |
| notifications | `/app/notifications`   | `docs/design/Announcements-Dashboard.png` (feed layout) |
| notfound      | `*` (bad route)        | `docs/design/designsystem.png` (tokens only)            |
| errorboundary | thrown render          | `docs/design/designsystem.png` (tokens only)            |
| offlinebanner | global, offline        | `docs/design/designsystem.png` (status pill styles)     |
| installprompt | global, installable    | `docs/design/designsystem.png` (card + button styles)   |
| updateprompt  | global, new SW waiting | `docs/design/designsystem.png` (card + button styles)   |

### The prompt

ONE SCREEN AT A TIME.

PICK A SCREEN AND BUILD

Build the **`<SCREEN>`** screen so it visually matches `<REF>` as closely as possible.

#### Ground rules (read before writing code)

1. Read `CLAUDE.md` and `docs/RULES.md`. Binding. Notably: TypeScript strict, no
   implicit `any`, explicit return types on functions/hooks; import app code with
   `@/…`; keep components small and typed (SDK setup in `src/lib`, data calls in
   `src/services`, reusable logic in `src/hooks`).
2. **Tokens already exist. Use them, don't invent.** The `@theme` block in `src/index.css` and
   `docs/DESIGN-SYSTEM.md` define the full palette, spacing, radii, shadows, and type scale.
   Every value you use must be a token class (`bg-primary`, `text-content`,
   `rounded-2xl`, `shadow`, etc.), no raw hex, no arbitrary `p-[13px]`, no inline
   `style={{}}`. If the design system PNG needs a value that isn't a token yet, add it
   to the `@theme` block in `src/index.css` and note it as inferred in this screen's log.
3. Icons are `lucide-react` only, no ad-hoc SVGs, no second icon set.
4. Reuse/extend primitives in `src/components/ui` (`Button`, `Card`, etc.) instead of
   duplicating styles inline; add a new primitive there if the reference needs one
   that doesn't exist yet.
5. The reference image is light-mode only, but every surface still needs a working
   `dark:` variant per `docs/DESIGN-SYSTEM.md` §1. Don't defer dark mode.
6. **You may run the dev server for this task.** Start `npm run dev` in the background
   if it isn't already running and reuse it. Do not spawn a second instance.
7. This is a **static PWA build**, no server runtime. Anything server-side (data,
   auth) goes through Supabase per `docs/DATA-MODEL.md` / `docs/ARCHITECTURE.md`; don't
   invent a backend for a screen that needs real data. Wire it to Supabase or use
   the same demo/mock pattern already used on built screens.

#### Match target

Layout · spacing · typography (family, size, weight, line height, letter spacing) ·
colors and gradients · button styles and heights · input fields · border radius ·
shadows and elevation · icons · imagery and its cropping · alignment and padding ·
visual hierarchy · empty/loading/error states where the reference shows them.

Do not redesign or improvise. If the reference is ambiguous or something is missing
from it, implement the closest reasonable thing **and log it** rather than inventing
a different layout.

#### The loop

Each iteration:

1. Implement / refine the screen.
2. `npm run typecheck` and `npm run lint`, both must be clean before you screenshot.
   A type error means the iteration is not done.
3. Screenshot the running dev server:
   - Load the Chrome tools if not already loaded (ToolSearch:
     `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp"`).
   - Navigate to `http://localhost:5042<ROUTE>` and take a screenshot. Save/compare
     iterations under `docs/design/.loop/<SCREEN>-<N>.png` (`<N>` = iteration number,
     starting at 1; create `docs/design/.loop/` if absent).
4. **Read your own screenshot back** with the Read tool, side by side with `<REF>`.
   Do not trust the code. Trust the pixels.
5. Write the diffs to `docs/design/.loop/<SCREEN>-log.md`, appending a section per
   iteration: what differed, what you changed, what is still off, what you
   deliberately inferred. Read this log at the start of every iteration so you don't
   re-fix the same thing or oscillate between two wrong values.
6. Repeat.

Be strict. Look for: text baseline and vertical centering, button height and
horizontal padding, gap between stacked elements, corner radius (4 vs 8 vs 12 is
visible), shadow spread and opacity, icon weight and size, image crop and aspect,
exact font weight (500 vs 600 is visible), and color accuracy (sample the hex from
both images, do not eyeball it).

#### Stop conditions. Stop when ANY of these is true

- The screenshot and the reference are indistinguishable at a glance, and the last
  two iterations produced no new fixable diffs.
- You have completed **8 iterations**.
- The remaining diffs are all things you cannot fix from code (e.g. the reference
  uses an asset you do not have, or a font not in the project).

On stop, output: a short list of what still differs and why, plus every value you
inferred rather than read from the design system. Then run `npm run typecheck` and
`npm run lint` one final time. If you could not reach the dev server, say so plainly. Do not claim the screen renders.
