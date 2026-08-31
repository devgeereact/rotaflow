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
mockup is tracked separately in `docs/LOOP.md`, which is the authority on
design-match. A screen can be ✅ here and still not match its mockup visually.

Role note: the real `MembershipRole` is `owner | manager | staff`. "Super Admin" is a
separate `is_platform_admin` flag, not a fourth role.

---

## 1. Public, auth, onboarding & launch

| Status | Design                        | Screen                                   | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅     | `marketting.png`              | Marketing home                           | `/`. Hero, product shot, 8-benefit grid, sector cards, stats band, "Why teams choose", social-proof slot, CTA banner and a 5-column footer. Full nav: `/features` `/solutions` `/pricing` `/resources` `/about` `/contact`, all routed and asserted by `navigationTargets.test.ts`. **Traction figures and testimonials are deliberately absent**, see below                                                                                                                                           |
| ✅     | ,                             | Features · Solutions · Pricing           | `/features`, `/solutions`, `/pricing`. Pricing states plainly that signup takes no card: the organisation's owner picks a plan afterwards and pays through Stripe checkout, from Settings → Billing (§3)                                                                                                                                                                                                                                                                                               |
| ✅     | ,                             | Resources · About · Contact              | `/resources` publishes a built / partial / not-built breakdown of the product. `/contact` validates and composes an email, there is no contact table or form endpoint, and a fake "we'll be in touch" is worse than none. See `ContactPage`                                                                                                                                                                                                                                                            |
| ✅     | `signin.png`                  | Sign in. Password, magic link, OAuth     | `/login`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅     | `signup.png`                  | Sign up. Carries an invite token through | `/signup`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ✅     | `splash-screen.png`           | Cold-start splash                        | `/splash`, also inline while auth resolves                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `appboot.png`                 | App boot / "setting up organisation"     | In production this renders **inline** from `ProtectedRoute` while auth/org resolve. It has no production URL. `/appboot` is a design-loop **preview route only**, with fixed props, existing so the state can be screenshotted. The reference's five stages are built (`AppBootScreen`: Secure connection → Loading your data → Setting up organisation → Preparing features → Finalising), each driven by a real signal rather than a timer. Whether it _matches_ the mockup is `docs/LOOP.md`'s call |
| ✅     | `Organisation-Onboarding.png` | Onboarding 1. Create org                 | `/onboarding`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅     | `Organisation-about.png`      | Onboarding 2. About your org             | `/onboarding`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅     | `Team-onboarding.png`         | Onboarding 3. Invite team                | `/onboarding`. Department/location fields on this step stage locally and are never persisted, a real, self-documented schema gap                                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | `Plan-Selection.png`          | Onboarding 4. Choose plan                | `/onboarding`. Writes `organisations.plan` and nothing else, this step takes no card. Payment happens afterwards, from Settings → Billing (see §3)                                                                                                                                                                                                                                                                                                                                                     |
| ✅     | `Onboarding-Complete.png`     | Onboarding 5. Done                       | `/onboarding`. Deliberately swaps two dead mockup links for real ones                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 2. Core scheduling & workforce

| Status | Design                        | Screen                                       | Route                                                                                                                                                                                                               |
| ------ | ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `Workforce-Dashboard.png`     | Manager dashboard                            | `/app/dashboard`                                                                                                                                                                                                    |
| ✅     | `Rota-Builder.png`            | Rota builder. Drag/drop, AI fill, publish    | `/app/rota`                                                                                                                                                                                                         |
| ✅     | `Schedule-dashboard.png`      | Schedule. Manager default view               | `/app/schedule`                                                                                                                                                                                                     |
| ✅     | `live-schedule.png`           | Schedule. Staff "live" agenda state          | `/app/schedule`                                                                                                                                                                                                     |
| ✅     | `published-schedule.png`      | Schedule. Post-publish state                 | `/app/schedule`                                                                                                                                                                                                     |
| ✅     | `staff.png`                   | Staff directory                              | `/app/team` (`StaffPage`), manager-only via `RequireRole`. `/app/staff` is a redirect to it, not a screen                                                                                                           |
| ✅     | `Staff-Profile.png`           | Staff profile detail                         | `/app/team/:staffId` → `StaffProfilePage`. Five real tabs (Overview, Shifts, Documents, Leave, Activity); Activity is honestly empty, no per-person feed exists in the schema. `/app/staff/:staffId` redirects here |
| ✅     | `Availability.png`            | Availability. Staff pattern + team view      | `/app/availability`                                                                                                                                                                                                 |
| ✅     | `Leave.png`                   | Leave. Requests, entitlement, approvals      | `/app/leave`, Balances shows Annual only (`holiday_allowance` is one number). Overtime is its own screen, `/app/overtime` (§5)                                                                                      |
| ✅     | `Swap-Request.png`            | Shift swaps. Request, respond, approve       | `/app/swaps`                                                                                                                                                                                                        |
| ✅     | `Timesheets-Dashboard.png`    | Timesheets. Real hours from clock events     | `/app/timesheets`                                                                                                                                                                                                   |
| ✅     | `Reports-Dashboard.png`       | Reports. CSV export                          | `/app/reports`                                                                                                                                                                                                      |
| ✅     | `Announcements-Dashboard.png` | Announcements. Table, preview rail, composer | `/app/announcements`                                                                                                                                                                                                |
| ✅     | `Locations-Management.png`    | Locations                                    | `/app/locations`                                                                                                                                                                                                    |
| ✅     | `Location-department.png`     | Departments within a location                | `/app/locations` (`DepartmentManager`)                                                                                                                                                                              |
| ✅     | `clockin.png`                 | Clock in/out. GPS + manual, offline-queued   | `/app/clock`                                                                                                                                                                                                        |

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
| ✅     | `SettingsNotifications.png` | Notifications | Per-category defaults. SMS is shown as unavailable. There is no provider, and template administration has no table                                                                                                                                                                                                                                 |
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

| Status | Screen                                         | Route                                                                                                                                              |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Team management. Issue/revoke invites          | Settings → Permissions (`/app/settings/permissions`). The _directory_ is a separate screen, `/app/team`                                            |
| ✅     | Overtime. Raise, withdraw, approve             | `/app/overtime` → `OvertimePage` / `OvertimeView`. Open to every role; the page's Team toggle is what gates the approval queue behind `canApprove` |
| ✅     | Help & support                                 | `/app/help` → `HelpPage`. FAQ plus "Contact support", which calls `openSupportCase` (0024) and lands in the platform console's queue (§11)         |
| ✅     | Notifications inbox. Read, push opt-in         | `/app/notifications`                                                                                                                               |
| ✅     | Account settings                               | `/app/account/*` (see §4)                                                                                                                          |
| ✅     | Forgot / reset password                        | `/forgot-password`, `/reset-password`                                                                                                              |
| ✅     | Accept invite. Public, pre-signup              | `/invite/:token`                                                                                                                                   |
| ✅     | Legal. Privacy, Terms, Cookies, Accessibility  | `/legal/privacy`, `/legal/terms`, `/legal/cookies`, `/legal/accessibility` (`src/pages/legal/*`), linked from `PublicFooter`                       |
| ✅     | OAuth / magic-link return                      | `/auth/callback` → `AuthCallbackPage` (`src/components/RouteAliases.tsx`)                                                                          |
| ✅     | Permission denied. Role, requirement, way back | rendered by `RequireRole` on a gated route                                                                                                         |
| ✅     | 404                                            | `*`                                                                                                                                                |

The platform console (`/admin/*`, 18 screens) also has no mockup PNG. It has its
own reference, `docs/PLATFORM_CONSOLE.html`, and its own section: **§11**.

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

| Status | Item                                          | Note                                                                                                                                                                                                 |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ❌     | Shift templates                               | `shift_templates` table exists; nothing reads it, client or server. The one genuinely inert table left (§8)                                                                                          |
| ❌     | Staff self-service for own contacts/documents | Owner/manager-only today, via `/app/team/:staffId`, which `RequireRole` gates to managers. Nothing on `/app/account/*` edits emergency contacts or documents                                         |
| ❌     | Document / avatar upload                      | `documents.file_url` and `photo_url` are pasted links. ImageKit is wired for _delivery_ only (`src/lib/imagekit.ts` builds transformed URLs from a path already in storage); nothing signs an upload |
| ❌     | Email change                                  | Needs Supabase's confirmation round-trip on both addresses. `supabase.auth.updateUser` is called for passwords only                                                                                  |
| ❌     | QR clock-in                                   | GPS + manual only. `clock_events` records `gps \| qr \| manual`, but nothing generates a per-location code, and there is no PIN in the schema either. See `ClockActionPane`                          |

Two long-standing ❌ rows here have been closed and moved:

- **Overtime requests** ship. `/app/overtime` → `OvertimePage` /
  `OvertimeView` / `overtimeService`, realtime-refreshed, with the approval
  queue behind `canApprove` (§5, §10).
- **The Super Admin console** ships, as 18 screens under `/admin` (§11).

## 8. Tables with no UI

**`shift_templates`. That is the whole list** for the _UI_. Verified by grepping `src/` and
`supabase/` for `from('<table>')`: no screen reads or writes it, and its generated row
type in `src/types/database.types.ts` is otherwise unused. One server-side reader does
exist — `orgLifecycleService.ts` includes it in the organisation export, and `0063`
deletes it with the tenant — so "no reader anywhere" is no longer true. It remains
empty structure someone deliberately left.

This section used to name four tables. The other three grew UI and are listed
here so nobody re-derives the old claim from a stale memory:

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

13 screens live-update via `useRealtimeRefresh` (`docs/HOOKS.md` §11) against the 14
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

Reference for this area is `docs/PLATFORM_CONSOLE.html`, not a PNG. There is no
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

`designsystem.png` (token sheet, source of truth for `docs/DESIGN.md`) ·
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

## Counts

35 screen mockups in `docs/design/`: **35 ✅ built · 0 🟡 partial · 0 ❌ not built.**

Plus, with no mockup file of their own:

- **11 rows in §5** — team management, overtime, help, notifications inbox,
  account settings, forgot/reset password, accept invite, the four legal pages,
  the OAuth callback, permission denied, 404.
- **18 platform-console screens in §11** (`/admin/*`), referenced by
  `docs/PLATFORM_CONSOLE.html`.
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
§4). `docs/LOOP.md` is the authority on whether a screen matches its mockup, and
its rows are maintained separately from these.

> Corrected 2026-07-31 by an audit doc that has since been deleted from the repo
> with no replacement, so this note is now the only surviving record of the fix.
> This previously read 34/23/7 and listed
> Clock in under §5 "built with no design mockup", but `clockin.png` exists
> and the screen was matched to it in #43, so §5 was the wrong section and the total
> was one short. The cause: `clockin.png` was one of 18 mockups sitting **untracked**
> when this file was written, so `git ls-files` disagreed with `ls`.
> Count against the working tree, not the index — and right now those two
> disagree again, for a different reason. `docs/design/` was moved to `docs/design/`
> without `git mv`, so **61 files are still tracked at the old path** (which no
> longer exists on disk) and **none** at the new one. `git ls-files` and `ls`
> will keep contradicting each other until that rename is completed in git.

The core scheduling product, the platform console, Settings and My Profile are
built. What is left is listed in §7, and it is short.

> Counts verified by parsing this file's own tables against `ls docs/design/`, not
> by hand (the mockups moved out of the repo root into `docs/design/`; there is no
> top-level `docs/design/` any more). The invariant, if you add a mockup: every
> **screen** `.png` in `docs/design/` appears in exactly one status row here.
> Reference assets are excluded from that rule, `designsystem.png`,
> `rotaflowui.png`, `logo.png`, `logo-1.png`, `logo-2.png` are tokens and brand
> marks, not screens, and have no status row.
