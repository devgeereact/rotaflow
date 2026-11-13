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
separate platform role (`platform_owner`, `platform_admin`, `platform_support` or `platform_finance`, from
`GET /me`; `isPlatformAdmin` is `platformRole !== null` in `src/context/OrgContext.tsx`), not a fourth role.

**Technology references, checked 9 November 2026.** This file's route claims were compared with `src/App.tsx`
(each backticked front-end route resolves, apart from the DEV-only preview routes, the API paths, and the routes the text itself says do not exist) and its technology claims with the code. A
four-digit number such as `0103` is a migration of the Supabase era (`supabase/migrations`), kept as the record of
when a screen shipped; the live schema is `backend/migrations` and the live data calls are the PHP routes in
`docs/API-SPEC.md`. **NOT VERIFIED (not read in this pass):** the behaviour descriptions in the rows of sections 1
to 7d that the notes below do not mention. They are the 2026 screen audits' statements about what each page does,
and were not re-read against the pages; only the statements that name a retired technology were changed. The
previous text is at the tag: `git show live-supabase-2026-11-01:docs/UX-SPEC.md`.

---

## 1. Public, auth, onboarding & launch

| Status | Design                        | Screen                                   | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `marketting.png`              | Marketing home                           | `/`. Hero, product shot, 8-benefit grid, sector cards, "Why teams choose", social-proof slot, CTA banner and a 5-column footer. Full nav: `/features` `/solutions` `/pricing` `/resources` `/about` `/contact`, all routed and asserted by `navigationTargets.test.ts`. **Traction figures and testimonials are deliberately absent**, see below                                                                                                                                                                                                                                                                     |
| ✅     | ,                             | Features · Solutions · Pricing           | `/features`, `/solutions`, `/pricing`. Pricing states plainly that signup takes no card: the organisation's owner picks a plan afterwards and pays through Stripe checkout, from Settings → Billing (§3)                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅     | ,                             | Resources · About · Contact              | `/resources` publishes a built / partial / not-built breakdown of the product. `/contact` posts to the public `POST /enquiries` route (`backend/src/Mod/Enquiries.php`; the `public-enquiry` Edge Function in the Supabase era) and says "Thanks, we've got your message. We reply within one working day." only after a 201; any failure shows the support address instead. Fields: name, work email, organisation, team size, sector, message, "I'd like a demo" (ticked by `?demo=1`, which every Book a demo link carries) and an unticked marketing box. The honeypot is off-screen and hidden from assistive technology; Turnstile renders only when `VITE_TURNSTILE_SITE_KEY` is set. See `ContactPage` |
| ✅     | `signin.png`                  | Sign in. Clerk email code (the mockup shows password, magic link and OAuth) | `/login`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `signup.png`                  | Sign up. Carries an invite token through | `/signup`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ✅     | `splash-screen.png`           | Cold-start splash                        | `/splash`, also inline while auth resolves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ✅     | `appboot.png`                 | App boot / "setting up organisation"     | In production this renders **inline** from `ProtectedRoute` while auth/org resolve. It has no production URL. `/appboot` is a design-loop **preview route only**, with fixed props, existing so the state can be screenshotted. The reference's five stages are built (`AppBootScreen`: Secure connection → Loading your data → Setting up organisation → Preparing features → Finalising), each driven by a real signal rather than a timer. Whether it _matches_ the mockup is `docs/UX-SPEC.md#design-match-loop`'s call                                                                                          |
| ✅     | `Organisation-Onboarding.png` | Onboarding 1. Create org                 | `/onboarding`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ✅     | `Organisation-about.png`      | Onboarding 2. About your org             | `/onboarding`. **Industry is asked here and only here** since 2026-09-10 (BUG-097): step 1 asked for it too and pre-filled this one from it, so the wizard looked as though it had forgotten an answer given one screen earlier                                                                                                                                                                                                                                                                                                                                                                                      |
| ✅     | `Team-onboarding.png`         | Onboarding 3. Invite team                | `/onboarding`. Department and location fields are now persisted to `invites.department_id` and `invites.location_id` as of `0126`, applied to the staff record when the invite is accepted                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ✅     | `Plan-Selection.png`          | Onboarding 4. Choose plan                | `/onboarding`. Writes `settings.intended_plan` and `settings.billing_period`, **not** `organisations.plan` — since `0120` only a paid subscription sets that, so the organisation starts its 30-day trial on Professional limits (`0154`) and becomes read-only if the trial ends without a plan; there is no free Starter tier. This row said "writes `organisations.plan`" until 2026-09-10, which had been wrong since `0120`. The step tells the customer the trial terms (BUG-091, updated for D2 on 2026-10-12). Payment happens afterwards, from Settings → Billing (see §3)                                  |
| ✅     | `Onboarding-Complete.png`     | Onboarding 5. Done                       | `/onboarding`. One primary action, "Build your first rota" (`/app/rota`), and one secondary, "Open setup checklist" (`/app/setup`), since 2026-10-11 (O6). The mockup's four next-step cards and two dashboard buttons are gone: two cards and both buttons duplicated each other, and nothing reached the checklist. Headline "Your organisation is ready." (O12)                                                                                                                                                                                                                                                   |

## 2. Core scheduling & workforce

| Status | Design                        | Screen                                                                                                                      | Route                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅     | `Workforce-Dashboard.png`     | Manager dashboard                                                                                                           | `/app/dashboard`. Two branches, chosen by role: `OperationsDashboard` for an owner or manager, `StaffDashboard` for staff. The staff branch reached an error boundary for every staff member until 2026-09-10 (GAP-118) and is now covered by `e2e/staff-dashboard.spec.ts` — the design here is the manager one, and the staff branch has no reference PNG                                                        |
| ✅     | `Rota-Builder.png`            | Rota builder. Drag/drop, AI fill, publish                                                                                   | `/app/rota`                                                                                                                                                                                                                                                                                                                                                                                                        |
| ✅     | `Schedule-dashboard.png`      | Schedule. Manager default view                                                                                              | `/app/schedule`                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅     | `live-schedule.png`           | Schedule. Staff "live" agenda state                                                                                         | `/app/schedule`                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅     | `published-schedule.png`      | Schedule. Post-publish state                                                                                                | `/app/schedule`                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅     | `staff.png`                   | Staff directory                                                                                                             | `/app/team` (`StaffPage`), manager-only via `RequireRole`. `/app/staff` is a redirect to it, not a screen                                                                                                                                                                                                                                                                                                          |
| ✅     | `Staff-Profile.png`           | Staff profile detail                                                                                                        | `/app/team/:staffId` → `StaffProfilePage`. Five real tabs (Overview, Shifts, Documents, Leave, Activity); Activity is honestly empty, no per-person feed exists in the schema. `/app/staff/:staffId` redirects here                                                                                                                                                                                                |
| ✅     | `Availability.png`            | Availability. Staff pattern + team view                                                                                     | `/app/availability`                                                                                                                                                                                                                                                                                                                                                                                                |
| ✅     | `Leave.png`                   | Leave. Requests, entitlement, approvals                                                                                     | `/app/leave`, Balances shows Annual only (`holiday_allowance` is one number). Overtime is its own screen, `/app/overtime` (§5). One person may hold one live booking per day: an overlapping request is refused by `0152` at the database, not by the form (GAP-123)                                                                                                                                               |
| ✅     | `Swap-Request.png`            | Shift swaps. Request, respond, approve                                                                                      | `/app/swaps`                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | ,                             | Open shifts. Uncovered shifts anybody can take                                                                              | `/app/open-shifts` → `OpenShiftsPage` (CAP-010, `0103`). No design reference: `shifts.status = 'open'` existed from `0002` with no staff-facing surface at all, so this screen is new rather than a match. A shift clashing with the reader's own roster is shown and flagged, never filtered out. Times are read on the organisation's clock, resolved as `SchedulePage` does, not the browser's (O7, 2026-10-11) |
| ✅     | ,                             | Approvals. Everything waiting on a manager                                                                                  | `/app/approvals` → `ApprovalsPage` (CAP-093), manager-only via `RequireRole`. Leave, swaps and overtime in one list, oldest first, decided in place. A swap still waiting on a colleague is deliberately absent — a queue with rows you cannot clear stops being read                                                                                                                                              |
| ✅     | `Timesheets-Dashboard.png`    | Timesheets. Real hours from clock events; a staff member's own week past the Policies overtime threshold is highlighted     | `/app/timesheets`                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅     | `Reports-Dashboard.png`       | Reports. CSV export                                                                                                         | `/app/reports`                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅     | `Announcements-Dashboard.png` | Announcements. Table, preview rail, composer                                                                                | `/app/announcements`                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅     | `Locations-Management.png`    | Locations                                                                                                                   | `/app/locations`                                                                                                                                                                                                                                                                                                                                                                                                   |
| ✅     | `Location-department.png`     | Departments within a location                                                                                               | `/app/locations` (`DepartmentManager`)                                                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `clockin.png`                 | Clock in/out. GPS + manual, offline-queued                                                                                  | `/app/clock`                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | none — new 2026-09-06         | Team Attendance. The managerial counterpart of Clock In: who actually turned up, against who was rostered, with corrections | `/app/attendance` (owner/manager)                                                                                                                                                                                                                                                                                                                                                                                  |

## 3. Settings area-8 designed tabs, all 8 built as tabs

`/app/settings` is a layout route with the tab bar in the layout, so a new
section is one `<Route>` plus a `SETTINGS_TABS` entry, and a missing half is
immediately visible. `navigationTargets.test.ts` asserts every tab resolves.

**Who sees which tab** (`settingsTabsForRole`, 2026-10-11, O1 and O2). An owner
sees all eight. A manager sees Roles, Policies, Notifications and Integrations:
Organisation, Permissions, Billing and Audit are owner-only, and showing a manager
a tab only to refuse them on arrival read as a broken product. `/app/settings`
itself lands on the first tab the role can use (`defaultSettingsPath`), so an
owner lands on Organisation and a manager on Roles. The page title is the tab's
name with "settings" after it, for example "Organisation settings" (O3). Hiding a
tab is presentation; the API's access check (`Scope::membership`) remains the boundary.

Where the reference asks for something the system genuinely cannot do, the
screen **says so on the screen, with the reason** rather than faking it. That is
the pattern to follow when extending these.

| Status | Design                      | Tab           | Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `SettingsOrganisation.png`  | Organisation  | Org details, preferences and role display labels, through a typed `orgPreferences` reader over the `organisations.settings` jsonb                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ✅     | ,                           | Permissions   | Membership + staff-profile derived; absorbed the old `/app/team` invite/revoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✅     | ,                           | Roles         | Owner/manager/staff. States plainly that custom roles cannot be represented, `memberships.role` is a three-value CHECK (P2-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅     | `Settingspolicy.png`        | Policies      | Scheduling policies over `organisations.settings`. The reference's ~55-policy engine with per-policy scope/history and live rota validation remains a separate project                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ✅     | `SettingsNotifications.png` | Notifications | Per-category defaults. SMS is shown as unavailable. There is no provider. Templates are stored in `notification_templates` (`0108`), and rendering respects organisation-specific wording where one exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅     | `SettingsIntegrations.png`  | Integrations  | Per-org SMTP with a real test-send; the verified time is `en-GB` on the organisation's clock. Moved here from top-level `/app/integrations`, which redirects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ✅     | `Settingsbilling.png`       | Billing       | Reads `subscriptions` and starts Stripe checkout / the hosted Customer Portal (`billingCheckoutService`, over `POST /orgs/{o}/billing/checkout` and `/billing/portal` and the signed `POST /stripe/webhook`, `backend/src/Mod/Billing.php`; Edge Functions in the Supabase era). Since `0156` an **Invoices** section lists the owner's last 12 invoices (`listOwnerInvoices`, `BillingInvoices.tsx`): date, number, amount in the invoice's currency, status in words (Paid, Open, Failed, Void, Refunded), and "View" / "Download PDF" links to the stored Stripe documents in a new tab, a table from `sm` up and stacked rows on a phone. Saved cards and the full history stay in Stripe's portal; there is still no usage meter or credits ledger. Since `0154` it also reads `GET /orgs/{o}/billing/state` (`my_org_billing_state` in the Supabase era) for "Trial, N days left" and the read-only notice |
| ✅     | `Settingsaudit.png`         | Audit         | Reads `audit_logs` (`auditService.listAuditLogs`). No longer thin: `audit_write` (0016) plus triggers and RPCs across 0017, 0021-0026, 0030, 0034, 0039-0040 write real events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 4. My account area-7 designed tabs, 5 built as tabs and 2 now redirecting (since the Clerk cutover), plus Your data

Same layout-route pattern as §3, at `/app/account`, titled "My account" (the one name for it everywhere since 2026-10-11, O5). Every role sees the same tabs. This is a person's own account. API Tokens is routed but not in the tab bar (see its row).

| Status | Design                 | Tab                | Reality                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | `ProfileSettings.png`  | Profile            | Name, contact, job title, department, and the notification matrix                                                                                                                                                                                                                                                                                                                         |
| ✅     | `profileprefrence.png` | Preferences        | Theme and the preferences `app_settings` can actually hold. The reference's ~20 fields exceed the two-column table; the gap is stated on the screen                                                                                                                                                                                                                                       |
| ✅     | `ProfileSecurity.png`  | Security           | Hosts Clerk's account screen (`UserProfile`, `src/pages/app/account/SecurityPage.tsx`): sign-in methods, two-step verification, connected accounts and signed-in devices are Clerk's, because RotaFlow keeps no passwords, factors or sessions of its own. In the Supabase era the page had password change and TOTP enrolment (`0102`). Backup codes and trusted devices are still named as not built rather than shown as a "100% secure" ring over checks nothing performs                                                                                                                                                                                         |
| ✅     | ,                      | Connected Accounts | **Redirects to Security since the Clerk cutover:** `/app/account/accounts` is a `Navigate` to `/app/account/security` in `src/App.tsx`, and connected accounts are managed in Clerk's account screen. The Supabase-era page listed the identities on the login and linked or unlinked OAuth providers. The ✅ is the unchanged Supabase-era status; whether it should now read ❌ is the owner's decision |
| ✅     | ,                      | Sessions           | **Redirects to Security since the Clerk cutover:** `/app/account/sessions` is a `Navigate` to `/app/account/security`; devices and sessions are Clerk's (the API stores no session, only `users.last_seen_at`). The Supabase-era page listed every device and signed the others out (`my_sessions`, `0100`). The ✅ is the unchanged Supabase-era status; whether it should now read ❌ is the owner's decision |
| ✅     | ,                      | API Tokens         | Explains there is no public API to hold a token for, and why issuing long-lived JWTs would be a security incident rather than a feature. See `TokensPage`. **Hidden from the tab bar** since 2026-10-11 (`hidden: true` in `PROFILE_TABS`); the route still resolves so a saved link works                                                                                                |
| ✅     | ,                      | Activity           | Reads `audit_logs` for this user                                                                                                                                                                                                                                                                                                                                                          |
| ✅     | ,                      | Your data          | `/app/account/data` (GAP-057, 2026-10-21). Files an access, portability, correction or erasure request for the signed-in person in the `gdpr_requests` register (`POST /me/data-requests`, `backend/src/Mod/Gdpr.php`; `request_my_data`, `0160`, in the Supabase era) and lists their own requests with the deadline that applies. It files a case rather than acting on the spot: the employer's record is checked first. No design reference; laid out like the Sessions tab was |

## 5. Built with no design mockup

| Status | Screen                                               | Route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Team management. Issue/revoke invites                | Settings → Permissions (`/app/settings/permissions`). The _directory_ is a separate screen, `/app/team`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | Overtime. Raise, withdraw, approve                   | `/app/overtime` → `OvertimePage` / `OvertimeView`. Open to every role; the page's Team toggle is what gates the approval queue behind `canApprove`                                                                                                                                                                                                                                                                                                                                                                            |
| ✅     | Help & support                                       | `/app/help` → `HelpPage`. FAQ, "Contact support" (`openSupportCase`, 0024) landing in the platform console's queue (§11), and "Your requests": the requester's own cases, the non-internal thread, a **reply** into it on any case that is not closed (`reply_to_support_case`, GAP-012) and a 1-5 rating once resolved                                                                                                                                                                                                       |
| ✅     | Setup checklist. What the organisation still needs   | `/app/setup` (CAP-114), owner and manager. Ten steps, six required and four recommended, each derived from a count read back through the API rather than a stored flag. Added 2026-10-11 to this table; it had no row here                                                                                                                                                                                                                                                                                                        |
| ✅     | Notifications inbox. Read, push opt-in               | `/app/notifications`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅     | Account settings                                     | `/app/account/*` (see §4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅     | Forgot / reset password                              | `/forgot-password`, `/reset-password`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✅     | Accept invite. Public, pre-signup                    | `/invite/:token`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ✅     | Legal. Privacy, Terms, Cookies, Accessibility, Trust | **Five routes, not four.** `/legal/privacy`, `/legal/cookies` and `/legal/accessibility` are written from the code and checkable against it (CAP-060, 2026-08-31); `/legal/trust` publishes the sub-processor list, the AI transparency notice and the security disclosure policy from `src/lib/subprocessors.ts`, and `pnpm run check:docs` now resolves each row's cited path (BUG-067); `/legal/terms` is still the placeholder shell, because a contract cannot be derived from a codebase. All linked from `PublicFooter` |
| ✅     | OAuth / magic-link return                            | `/auth/callback` → `AuthCallbackPage` (`src/components/RouteAliases.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅     | Permission denied. Role, requirement, way back       | rendered by `RequireRole` on a gated route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅     | 404                                                  | `*` → `NotFoundPage`. Since 2026-10-22 the server answers an unknown path with a real 404 status and a prerendered copy of this screen (`.htaccess`, `scripts/prerender.mjs`); the screen keeps `noindex` for installed clients, whose service worker answers without a status                                                                                                                                                                                                                                                |

The platform console (`/admin/*`, 18 screens) also has no mockup PNG. It has its
own reference, `docs/design/PLATFORM_CONSOLE.html`, and its own section: **§11**.

## 6. Navigation. Settled

The restructure this section used to describe as an open question landed in #75,
and the shell around it in the product-vision pass. Current state:

**Sidebar** is role-resolved, not a flat constant (`navItemsForRole`). A manager
sees thirteen workspace entries, a staff member ten (no Rota Builder, Team or
Locations). Beneath them `footerNavItemsForRole` adds two more: Help & Support
for everyone, plus Settings for a manager or My account for staff. The three
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

| Piece                                                                            | Where                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tagline, org switcher, profile block, Help & Support, collapse toggle            | `Sidebar` + `SidebarOrgSwitcher` + `SidebarFooter`. Help & Support points at `/app/help` (§5), not the public contact page                                                                                     |
| Global search (`⌘K`). Screens and actions, role-filtered                         | `GlobalSearch`, catalogue in `src/lib/globalSearch.ts`                                                                                                                                                         |
| Mobile bottom tab bar. Home · Rota (staff: My rota) · Clock in · Requests · More | `MobileTabBar`; `More` opens the sidebar drawer. Requests lands on Leave, and a phone-only switch (Leave · Swaps · Overtime, `RequestsLayout`) at the top of all three screens reaches the other two (O4, O10) |
| Route-level role gate + permission-denied screen                                 | `RequireRole`, `PermissionDenied`                                                                                                                                                                              |

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
| ✅     | Staff self-service for own contacts/documents | My account → Profile (1 November 2026, design gap F33): own phone and photo, and **own emergency contacts** in the Contact details card through the same window a manager uses (`EmergencyContactsModal`); the API has always allowed the person. Own documents are on `/app/compliance` (My documents) behind `staff_documents`. Employment fields stay owner/manager |
| ✅     | Document / avatar upload                      | Built on the PHP API: photos upload from My account → Profile and the staff profile (`POST /orgs/{o}/staff/{s}/photo`, S8c-2, signed `/api/files` links); documents upload from the Documents window (`documentService`, signed `/api/document-files`). Row corrected 1 November 2026 |
| ✅     | Email change                                  | My account → Security is Clerk's own profile screen, which changes the sign-in email with a code to the new address (S9). Profile's email field now points there. Row corrected 1 November 2026 |
| ❌     | QR clock-in                                   | GPS + manual only. `clock_events` records `gps \| qr \| manual`, but nothing generates a per-location code. **Deferred by decision, 1 November 2026:** it needs a migration (a replaceable per-site secret), an API route and a camera scanner, so it is a planned slice after the cutover, not a design fix. The screens are drawn in `docs/design/RF-GAPS.html` page 11. See `ClockActionPane` |

Two long-standing ❌ rows here have been closed and moved:

- **Overtime requests** ship. `/app/overtime` → `OvertimePage` /
  `OvertimeView` / `overtimeService`, refreshed by polling (`useRealtimeRefresh`, section 10), with the approval
  queue behind `canApprove` (§5, §10).
- **The Super Admin console** ships, as 18 screens under `/admin` (§11).

## 7a. Compliance (R2 slice S10), behind the `staff_documents` flag

Design reference since 1 November 2026: `docs/design/RF-GAPS.html`, page 07 Compliance (manager board and staff view);
matched in code for visible disabled reasons. Every screen below is hidden while the flag is off (the
default), so the module ships dark.

| Status | Screen | Route | What it does |
| ------ | ------ | ----- | ------------ |
| ✅ | Compliance (managers) / My documents (staff) | `/app/compliance`, rail row after Overtime | Staff: what is required of them with a status chip each, whether they are cleared, and "Upload or manage". Owners and managers also get four tiles (awaiting review, expiring in 30 days, expired, people not cleared), the review queue oldest first (open, Approve, Not accepted with a reason; Approve is disabled with the reason in its title for your own document or one you uploaded), and required documents by type |
| ✅ | Documents window | Staff → a person → Documents; Staff profile → Upload document; Compliance → Upload or manage | Each document with its status chip (Draft, Awaiting review, Approved, Not accepted, Withdrawn, Replaced, Expired) and the reason if not accepted; Send for review and Withdraw where allowed; upload against a type with an optional name, issue and expiry dates, and "Send for review now" (else a draft). The profile's own documents list shows approved documents only |
| ✅ | Settings: Document types | `/app/settings/document-types` (owners and managers; tab after Policies) | Active types with "Required to work", add and edit (name, description, months it lasts, required, needs an expiry date), archive with a confirmation, and the UK examples to add in one click (not legal advice) |
| ✅ | Eligibility chip | Rota builder, under each name; Open shifts, on each card | "Not cleared" (the missing types in the title and for screen readers) or "Expiring". It informs and never blocks: rostering stays the manager's decision, and the open-shift claim gains the server check in S12 |

## 7b. Scheduling (R2 slice S11), behind the `scheduling_tools` flag

Design reference since 1 November 2026: `docs/design/RF-GAPS.html`, page 09 Scheduling checks. Hidden while the flag
is off (the default).

| Status | Screen | Where | What it does |
| ------ | ------ | ----- | ------------ |
| ✅ | Warnings at assign | Rota builder, Add shift / Edit shift | A "things to check" panel as the manager types: short rest, over the weekly limit, approved leave, declared unavailable. Save is never blocked ("These are warnings, not rules") |
| ✅ | Before you publish | Rota builder, Publish | Opens first: what changes (new, unchanged, removed, cancelled), the warnings by kind with each shift, and any double-booking. A double-booking disables Publish (the server refuses it too); warnings show "Publish anyway". If the check cannot load, Publish stays available and the server still refuses a double-booking |
| ✅ | Generate pattern | Rota builder, Week actions (a draft week) | Days of the week, or days on / days off from a start date; one to six time blocks (split shifts; an end before the start runs overnight); a person or open shifts; shift type, break, notes. Preview, then Create draft shifts; skipped shifts are counted by reason and warned shifts listed |
| ✅ | Shifts to cover after leave | Leave and Approvals, after Approve | "Leave approved: shifts to cover" lists the person's shifts inside the leave (draft ones marked) and offers Open the rota. Nothing is changed automatically |

## 7c. Cover (R2 slice S12), behind the `cover_tools` flag

Design reference since 1 November 2026: `docs/design/RF-GAPS.html`, page 08 Cover; disabled Take it, Approve and
Offer to cover state their reason as text. Hidden while the flag is off (the default). Swaps UI unchanged.

| Status | Screen | Where | What it does |
| ------ | ------ | ----- | ------------ |
| ✅ | Cover (staff) | `/app/cover`, rail row "Cover" | Upcoming published shifts with "Cannot work it" (a reason for the manager; Withdraw while open), shifts a manager is finding cover for with "Offer to cover" or the reason the reader cannot, and what happened to recent reports and offers |
| ✅ | Cover board (owners, managers) | `/app/cover` | Counts; who cannot work (Find cover, Keep on shift); requests with each offer's eligibility (Approve disabled with the reason when someone cannot take it; Turn down); unfilled shifts in the next 72 hours (Ask for cover); "Who could take it": ranked candidates with reasons, warnings, hours that week and Assign |
| ✅ | Open shifts | `/app/open-shifts`, each card | A shift a manager opened for cover shows "Manager choosing cover" and Offer to cover (to the Cover page) instead of Take it; a shift the reader cannot take shows why beside a disabled Take it. The API refuses both regardless |
| ✅ | Two-way swaps (S12d, `two_way_swaps` with `cover_tools`) | `/app/swaps`, Offer a shift; each request row | Once a colleague is named, "In return (optional)" lists their upcoming shifts; choosing one makes a swap both ways. The row shows "Taking" (the shift in return) beside "Giving Away". Off, the dialog and rows are as before |

## 7d. Timesheets (R2 slice S13), behind the `timesheet_tools` flag

Design reference since 1 November 2026: `docs/design/RF-GAPS.html`, page 10 Timesheets. Hidden while the flag is off
(the default): the page, its
existing "Export CSV" (the visible day's rows, built in the browser) and the Policies save are exactly as before.

| Status | Screen | Where | What it does |
| ------ | ------ | ----- | ------------ |
| ✅ | Flag chips | `/app/timesheets`, beside each line's status (managers and staff) | "Late 12 min", "Early finish 15 min", "Overtime 25 min" from the server's lines, only beyond the organisation's tolerance. No chip for no clock-in / no clock-out: the status already says so. If the lines cannot load the page shows no chips and works as before |
| ✅ | Export payroll CSV | `/app/timesheets` header (owners, managers) | A dialog with From and To (defaults: this week), at most 31 days (the sentence shows and Download is disabled otherwise), then the server's file downloads as is: approved periods only, one row per person per period |
| ✅ | Timesheet flags | Settings, Policies | "Tolerance", whole minutes 0 to 120 (default 10), with a worked example. Saved with the other policies (owner) |

## 8. Tables with no UI

**The MariaDB tables that no route returns to a screen, found 9 November 2026 by searching `backend/src` for a
`FROM` or `JOIN` of each of the 69 tables in `backend/migrations` outside the code that writes them.** The method reads
SQL text, so it finds a table no module ever selects; it cannot find a table a route returns by another name. Five
tables are never selected by any module, and all five are correct to be so:

- **`rate_limits`**, the limiter's counters (`backend/src/RateLimiter.php`), keyed by bucket and subject. A screen over
  it would be a defect: it is who attempted what and when, by user id and address.
- **`incident_counter` and `support_counter`**, one-row counters that mint the next `INC-` and support reference
  (`backend/src/Mod/Incidents.php`, `backend/src/Mod/Support.php`).
- **`notification_deliveries`**, the delivery log `Dispatcher` writes (`backend/src/Dispatcher.php`) and retention removes
  after 12 months. `/admin/notifications` reads `notifications`, not this table (`Console::notificationActivity`), so no
  screen shows a delivery attempt. Whether one should is a product question, not a defect.
- **`timesheet_reopenings`**, the reason and the before and after status written whenever a manager reopens an exported
  timesheet (`backend/src/Mod/Timesheets.php`). **No route returns these rows**, so a reopening's recorded reason is
  never shown to anybody. That is a gap, not a design choice.

A further group is read only by the cron job or the webhook and has no screen by design: the queues `storage_deletions`,
`account_deletions` and `notification_outbox`, the reminder ledger `document_reminders` and the webhook ledger
`billing_events`. `schema_migrations` is created by `backend/bin/migrate.php`, is not one of the 69 and has no reader.

**Tables the older text listed as having no UI, and what reads them now.** `audit_logs` is returned by
`GET /orgs/{o}/audit` (Settings, Audit; My account, Activity) and `GET /platform/audit` (`/admin/audit`);
`subscriptions` by `GET /orgs/{o}/billing` and the platform billing routes, and written by the signed
`POST /stripe/webhook`; `overtime_requests` by `/overtime` behind `/app/overtime` and the reports analytics card.

**History, Supabase era.** The section used to name `platform_health_probes` and `rate_limit_events`, tables that
had row level security (retired) enabled, no policy and grants to `service_role` alone (`pg_net`, `0076` and `0085`), and
`shift_templates`, which `0096` dropped on 2026-08-31 (BUG-051). The first two no longer exist in MariaDB:
`backend/src/DataMove/Map.php` records the health tables as replaced by an external uptime check, and `rate_limits` is
the limiter's table. The method that old section recorded (grep `src/` for `from('<table>')`) was blind to a table no
client role could reach, which is why reading the SQL in `backend/src` is the better test; do not re-derive the list from
the old text.

## 9. GDPR. Built, deliberately narrower than "delete everything"

Per-staff **export** (JSON of what the API's list routes return for that person) and **erase** (scrub the personal
fields, keep operational rows) on `/app/team`, owner-only. Erase is `POST /orgs/{o}/staff/{s}/erase`
(`Gdpr::eraseStaff`, `backend/src/Mod/Gdpr.php`; `anonymize_staff_member`, `0011`, in the Supabase era). The export
and its gaps (the documents dataset is always empty) are written up in `docs/SECURITY.md` section 4. That button
deliberately does not:

- Delete the person's RotaFlow login, which can span organisations. A person can **ask** for it from My account, Your data
  (§4), which files an erasure case in the register; closing that case as completed queues the login, and
  `Gdpr::cron` deletes it from Clerk and then from `users` (GAP-057, shipped).
- Delete the file behind a legacy pasted link (`documents.file_url`): only the row goes. Uploaded files are queued for
  deletion and removed by `Lifecycle::cron`.

The _obligation_ side — the Article 12(3) one-month clock on each request — is a separate screen in the platform
console, `/admin/gdpr` (§11). This section is the action; that one is the register.

## 10. Realtime (Supabase Realtime retired)

There is no longer any realtime channel. `useRealtimeRefresh` (`src/hooks/useRealtimeRefresh.ts`,
`docs/ARCHITECTURE.md#hook-contracts` §11) keeps its name and its callers but **polls**: it re-runs the screen's own load
function on a timer, fastest-table-wins, and also when the tab becomes visible or the network returns. The intervals are
`POLL_MS` in that file: clock events 15 s, shifts and rotas 20 s, notifications and swaps 30 s, leave and overtime 45 s,
availability, announcements, staff profiles and invites 60 s, locations, departments and shift types 120 s. There is no
`EventSource`, `WebSocket` or server push in `src` (`git grep -nE "EventSource|WebSocket" -- src` finds only comments); the
nav badges and the notification bell have their own timers. Sixteen pages and the invite manager in Settings, Permissions
call the hook (`git grep -l useRealtimeRefresh -- src`): Dashboard, Schedule, Approvals, Attendance, Leave, Swaps,
Overtime, Timesheets, Clock in, Availability, Announcements, Notifications, Open shifts, Setup, Team directory and
Locations.

**Rota Builder is deliberately excluded.** Its load path calls `getOrCreateRotaForPeriod`, which INSERTs, so a naive
refresh would write, then refetch, in a loop, and a mid-drag refetch could disturb an in-progress edit. It would need a
mutation-aware guard first. (Whether the builder still calls that function is `NOT VERIFIED`: not re-read in this pass.)

The text of this section in the Supabase era described 14 tables published by `0012_realtime.sql` and
`0013_realtime_overtime.sql`, and said `org_smtp_settings` and `audit_logs` were deliberately not published because a
change payload would hand out a column clients cannot read. Polling has no such payload: each refresh is an ordinary
authenticated API read.

## 11. Platform console (`/admin`)-19 screens, all built

This section used to read "Super Admin console does not exist". It does. Twenty
files in `src/pages/admin/`, nineteen of them routed in `src/App.tsx` (counted 9 November 2026: the index route
and eighteen nested paths); the twentieth is `AdminPreviewHarness`, the DEV-only design-loop harness. The section
heading said 18 until that count; the table below has always listed 19 rows.

It sits **outside `/app`** on purpose: the area is above organisations, so it is
gated on a platform role from `GET /me` (`RequirePlatformAdmin`: `isPlatformAdmin` is `platformRole !== null`)
rather than on a `MembershipRole`. `ProtectedRoute` still wraps it, so an anonymous visitor is sent
to sign in rather than told the area exists. Fifteen of the screens narrow it further with
`RequirePlatformRole`, because a hidden nav link that still renders when the URL
is typed is a decoration, not a permission. The boundary itself is the API: the `/platform/*` routes answer 404 to
a caller without the needed platform role (`backend/src/Mod/Console.php`; `GET /platform/settings` is the one any signed-in person may read), so the gates here are presentation.

Reference for this area is `docs/design/PLATFORM_CONSOLE.html`, not a PNG. There is no
mockup file for any of these, so none of them appears in the §-counts below.

| Status | Screen              | Route                                  | Note                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Overview            | `/admin` (index)                       | Platform-wide counts plus a real `audit_logs` activity feed                                                                                                                                                                                                                                                                                                                                     |
| ✅     | Organisations       | `/admin/organisations`                 | Tenant register                                                                                                                                                                                                                                                                                                                                                                                 |
| ✅     | Organisation detail | `/admin/organisations/:organisationId` | Nine of the reference's ten tabs. Activity is stated-not-shown on the Data tab. No route gate on purpose: finance needs Subscription and Usage, so the operational tabs are hidden per role in `src/lib/organisationTabs.ts` instead. Usage copy states the staff and location limits (`0070` in the Supabase era; the limits are enforced in `backend/src/Billing.php`)                                                                                                    |
| ✅     | Users               | `/admin/users`                         | Cross-tenant accounts. The platform-admin grant is the one write, and it refuses to strand the platform                                                                                                                                                                                                                                                                                         |
| ✅     | User detail         | `/admin/users/:userId`                 | One account across every tenant. Sign-in facts live in Clerk, so the screen shows only what the API knows (created, last seen: `GET /platform/users/{u}`, `src/services/platformFactsService.ts`); `platform_user_auth_facts` (0027) was the source in the Supabase era                                                                                                                                                                                                                                                                                                               |
| ✅     | Subscriptions       | `/admin/subscriptions`                 | `RequirePlatformRole` → `PLATFORM_BILLING_ROLES`. Keyed on organisations, so a tenant with no subscription shows. Read-only: no plan control, since plan changes happen in the customer's Stripe Billing Portal. Stripe's `canceled` displays as "Cancelled"                                                                                                                                    |
| ✅     | Billing             | `/admin/billing`                       | `PLATFORM_BILLING_ROLES`. MRR/ARR/collected/outstanding, all summed in `src/lib/revenue.ts` over `invoices` and `subscriptions × plans` (0023)                                                                                                                                                                                                                                                  |
| ✅     | Enquiries           | `/admin/enquiries`                     | The website contact form's inbox (`0155`). `PLATFORM_OPERATIONAL_ROLES` on the route and the nav, matching the API's operational roles (`Enquiries::OPERATIONAL`, `backend/src/Mod/Enquiries.php`). Status filter on the shared `useFilterState` contract, search kept out of the URL, and a dialog with the message and a status change (New, Replied, Demo booked, Closed). Not a CRM: replies go from the team's mailbox. Previewed at `/admin-preview/enquiries` |
| ✅     | Support Centre      | `/admin/support`                       | The `support_cases` queue (0024). `/app/help` is the requester-facing door into it                                                                                                                                                                                                                                                                                                              |
| ✅     | Support case detail | `/admin/support/:caseId`               | Reply, status, assign. Status/assign need `PLATFORM_SUPPORT_ROLES`; the controls disable rather than vanish                                                                                                                                                                                                                                                                                     |
| ✅     | Support access      | `/admin/support-access`                | Time-boxed tenant access. A session genuinely gates the data: `Scope::supportMembership` (`backend/src/Scope.php`) re-checks it on every request (`has_support_access()`, 0028, in the Supabase era)                                                                                                                                                                                                                                                                                                   |
| ✅     | Audit logs          | `/admin/audit`                         | Cross-tenant `audit_logs`                                                                                                                                                                                                                                                                                                                                                                       |
| ✅     | Platform health     | `/admin/platform-health`               | Configured-integration reporting plus a re-probing Watch mode                                                                                                                                                                                                                                                                                                                                   |
| ✅     | Incidents           | `/admin/incidents`                     | `incidents` + `incident_updates` (0021)                                                                                                                                                                                                                                                                                                                                                         |
| ✅     | Integrations        | `/admin/integrations`                  | Platform services (build-time config) kept separate from tenant integrations (per-org SMTP, the only one)                                                                                                                                                                                                                                                                                       |
| ✅     | Notifications       | `/admin/notifications`                 | `PLATFORM_CONFIG_ROLES`, gated on the route as well as the nav: it is a cross-tenant view of who was told what                                                                                                                                                                                                                                                                                  |
| ✅     | Feature flags       | `/admin/feature-flags`                 | `PLATFORM_CONFIG_ROLES`. Lists and edits the platform feature flags through `GET` and `POST /platform/flags` (`backend/src/Mod/FeatureFlags.php`, tables `feature_flags` and `feature_flag_targets`). It reports `registration_enabled` and `maintenance_mode` as recorded values rather than switches; the page header says they have no consumer, which `NOT VERIFIED` here, since `GET /platform/settings` is what the app reads the maintenance notice from                                                                                                                                                                                            |
| ✅     | GDPR & data         | `/admin/gdpr`                          | `PLATFORM_OPERATIONAL_ROLES` on the route and the nav (finance excluded, matching `Gdpr::OPERATIONAL`; `0138` in the Supabase era). A deadline register (Article 12(3)), not a data browser. The per-staff action lives in §9                                                                                                                                                                                                            |
| ✅     | Platform settings   | `/admin/settings`                      | `PLATFORM_CONFIG_ROLES`. Authentication (two-step verification for platform staff is set in the Clerk dashboard: `setPlatformMfaRequired` rejects with 405 `not_available` in `src/services/platformSettingsService.ts`, so the `require_mfa` switch of the Supabase era is gone), Data Retention (`GET /platform/retention`) and Administrators. General and Maintenance are hidden: their columns drive nothing, so their values are kept but not shown                                                                                                                                                 |

**Preview harness.** `/admin-preview/*` mounts the real `AdminShell` and the real
page components with `fetch` intercepted so a client answers from
fixtures (the harness's own comment still names the retired Supabase client; whether the fixtures answer the PHP API's routes is `NOT VERIFIED`, not run). DEV only, defined behind `devPage(...)` so Rollup drops it from the
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
`TRACTION` and `TESTIMONIALS` are empty constants. While `TRACTION` is empty the
stats band renders nothing (its capability stand-in of "6", "Offline",
"Multi-site" and "UK" was removed on 11 October 2026, being a stats band with no
numbers in it); the social-proof slot renders an honest alternative. Both switch
over automatically once real figures exist. Nothing else has to change. The
approved headline claims are listed in
`docs/DESIGN-SYSTEM.md#approved-website-claims`.

This is not caution for its own sake: publishing "10,000+ active users" or a
quote attributed to a named person at a named company would be a false factual
claim to a buyer, which is a CAP Code breach and the kind of thing a competitor
or the ASA can act on. The 2026-07-31 audit reached the same conclusion
independently.

The same rule governs feature claims: nothing goes in `PRODUCT_BENEFITS` that is
not built, checked against this document first.

It governs structured data too. Since 2026-10-21 `index.html` carries a JSON-LD
block naming the publisher (`Organization`) and the product
(`SoftwareApplication`), and nothing else: no `aggregateRating`, `review`, `award`
or `offers`. Stars in search results would need reviews that do not exist, and a
price there would be a copy of `PLANS` nothing reconciles.
`src/lib/structuredData.test.ts` fails if any of those keys appear or the block
stops parsing.

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
- **19 platform-console screens in §11** (`/admin/*`), referenced by
  `docs/design/PLATFORM_CONSOLE.html`.
- **6 designed tabs** specified by the §3/§4 tab bars — Permissions, Roles,
  Connected Accounts, Sessions, API Tokens, Activity. Four are built as tabs; Connected Accounts and Sessions
  were built and now redirect to Security (Clerk, §4).
- **1 undesigned tab**, Your data (§4, 2026-10-21).

**Front-end routes in `src/App.tsx`, counted 9 November 2026.** Command: `grep -nE '<Route|^ +path=' src/App.tsx`,
tallied by reading its output and leaving out the DEV-only preview block (the `import.meta.env.DEV` branch; there are
no scripts tracked for this). Redirects are `Navigate` or `*Redirect` elements. **Twenty** top-level `<Route>` elements
(twelve public pages, `/login/*`, `/signup/*`, `/forgot-password` and `/reset-password`, which both redirect to `/login`,
`/splash`, `/auth/callback`, `/invite/:token` and `/onboarding`), plus a catch-all 404. **Thirty** `<Route>` elements
directly under `/app`: 22 screens and 8 redirects (`/app`, `staff`, `staff/:staffId`, `locations/departments`,
`locations/:locationId`, `clock-in`, `integrations`, `profile/*`). Under `/app/settings`, 9 screens and 1 redirect; under
`/app/account`, 6 screens and 3 redirects (`/app/account`, `accounts`, `sessions`). Under `/admin`, 19 screens and no
redirect. The earlier figures in this section (18 console screens, 7 designed account tabs "all built") are the 2026-08-20 and
2026-10 counts, which these supersede.

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

The core scheduling product, the platform console, Settings and My account are
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

Most matched screens live behind auth and need a real Clerk session, an org and
seeded rows, which the loop cannot produce. The pattern already in use is a
**`*-preview` route** carrying fixed mock data that reproduces the reference's exact
numbers. Seventeen exist (counted 9 November 2026), all inside the one `import.meta.env.DEV` block in
`src/App.tsx`, which Rollup drops from the production bundle (`scripts/check-bundle-size.mjs` fails on a DEV page in `dist/`): `/appboot`, `/onboarding-preview`,
`/dashboard-preview`, `/rota-builder-preview`, `/schedule-preview`,
`/timesheets-preview`, `/clockin-preview`, `/admin-preview` (the whole platform
console nested under it), `/staff-preview`, `/staff-preview/:staffId`,
`/locations-preview`, `/locations-preview/departments`, `/announcements-preview`,
`/reports-preview`, `/app-preview/*`, `/dashboard-live-preview` and
`/settings-preview/*`.

`/settings-preview/*` (added 2026-10-21, `SettingsLivePreviewPage`) mounts the
**real** Settings and My account pages inside their tab layouts, with
`fetch` answering from fixtures: `/settings-preview/{organisation,
policies,notifications,integrations,billing,audit}` and
`/settings-preview/account/{profile,preferences,security}`. Before it, none of
those nine screens could be captured without a session, which is why they had
never been compared.

**Which reference wins.** For the Organisation section (the workspace screens,
Settings and My account), `docs/design/ORGANISATION_WORKSPACE.html` has been the
sole reference since 2026-08-12, and the flat visual language (decision D10,
`docs/DESIGN-SYSTEM.md`) since 2026-10-12. The PNGs for those screens are older
and show subsystems the product does not have (template libraries, an
integrations catalogue, a policy engine). Compare structure and content against
the HTML file first; use the PNG for layout proportions only. Several screens
recorded as matched against their PNG before then (dashboard, timesheets) no
longer resemble it, by later decision rather than drift.

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

One status table for every screen with a mockup. **built** is the §1 to §4 answer (does the feature exist and work); **matches design** is this section's (has a design-match pass compared it with its reference). Every designed screen is built as of 11 October 2026, and since the 2026-10-22 pass every one is matched, either against its PNG or against `docs/design/ORGANISATION_WORKSPACE.html` where that file supersedes it (GAP-088, closed). Reopen a row only for a regression.

| `<SCREEN>`          | route                                            | `<REF>`                                   | built | matches design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------ | ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marketing-home      | `/`                                              | `docs/design/marketting.png`              | ✅    | **Matched (2026-10-22 pass).** From `xl` the hero sets the copy on the left and the product shot on the right, on the nav's width, as the ref does; below `xl` the shot stacks under centred copy because a half-width column squeezes the seven-day grid. Headings take the website's two weights. Deliberately absent: traction figures, logos and the testimonial (honesty rule, §1), the filled call-to-action band (a bordered panel under the flat language, D10) and the six-item benefit strip (eight benefits in a grid). Since 2026-10-21 the hero enters on staggered CSS keyframes and the sections below reveal on scroll (DESIGN-SYSTEM §4). Since 2026-10-22 it and the other thirteen sitemap pages are prerendered to static HTML and hydrated, so a crawler or a visitor without JavaScript gets the page, not an empty `<div>` |
| splash              | `/splash`                                        | `docs/design/splash-screen.png`           | ✅    | Matched. Re-checked 2026-10-22 after the flat tokens: same lockup, progress, four value lines and wave; "Compliant & Secure" reads "Role-based Access"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| appboot             | `/appboot` (preview)                             | `docs/design/appboot.png`                 | ✅    | **Matched (2026-10-21 pass).** Same lockup, five stages, progress card, four value lines and wave background. Wordmark and tagline scaled up to the reference. Two differences are deliberate: the percentage is driven by real signals rather than a fixed 60%, and "Compliant & Secure" reads "Role-based Access", a claim the product can back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| login               | `/login`                                         | `docs/design/signin.png`                  | ✅    | Matched (#27). Re-checked 2026-10-22 after the flat tokens. The ref's product mock-up, testimonial and Google and Microsoft buttons are absent on purpose: a feature list, no invented quote, and magic link as the second way in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| signup              | `/signup`                                        | `docs/design/signup.png`                  | ✅    | Matched. Standalone route, carries an invite token through. Re-checked 2026-10-22 after the flat tokens, same differences as login                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| onboarding-org      | `/onboarding-preview?step=1`                     | `docs/design/Organisation-Onboarding.png` | ✅    | Matched. Re-checked 2026-10-22 after the flat tokens. Fixed in that pass: the panel's wave rose with the copy and sat behind the last feature's text; it now fills only the illustration's band (`OnboardingWave`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| onboarding-about    | `/onboarding-preview?step=2`                     | `docs/design/Organisation-about.png`      | ✅    | Matched. Re-checked 2026-10-22 after the flat tokens, with the wave fix above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| onboarding-team     | `/onboarding-preview?step=3`                     | `docs/design/Team-onboarding.png`         | ✅    | Matched (#26). Re-checked 2026-10-22 after the flat tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| onboarding-plan     | `/onboarding-preview?step=4`                     | `docs/design/Plan-Selection.png`          | ✅    | Matched (#28). Re-checked 2026-10-22 after the flat tokens. Prices and limits are the live plan catalogue, not the ref's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| onboarding-complete | `/onboarding-preview?step=5`                     | `docs/design/Onboarding-Complete.png`     | ✅    | Matched. Swaps two dead mockup links for real ones. Re-checked 2026-10-22 after the flat tokens; the preview's location count now agrees with step 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| dashboard           | `/dashboard-preview`                             | `docs/design/Workforce-Dashboard.png`     | ✅    | Matched (#31), then **replaced by design**: `OperationsDashboard` (CAP-110, #295) is attendance-led and no longer resembles `Workforce-Dashboard.png`. Spot-checked 2026-10-21 pass; compare future changes with `docs/design/ORGANISATION_WORKSPACE.html`'s dashboard, not the PNG                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| rotabuilder         | `/rota-builder-preview`                          | `docs/design/Rota-Builder.png`            | ✅    | Matched (#33, #40). Re-checked 2026-10-22 after the flat tokens: toolbar, filters, staff-by-day grid and unfilled row. The shift-details panel opens on selection rather than standing open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| schedule            | `/schedule-preview`                              | `docs/design/Schedule-dashboard.png`      | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens). The manager view was rebuilt to that file (commit `3d2cafc`): who is on, where, right now, with today's counts. `Schedule-dashboard.png`'s week grid lives in the rota builder, so the PNG is superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| schedule-live       | `/schedule-preview` (live state)                 | `docs/design/live-schedule.png`           | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens); the PNG is superseded, as for schedule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| schedule-published  | `/schedule-preview` (published state)            | `docs/design/published-schedule.png`      | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens); the PNG is superseded, as for schedule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| timesheets          | `/timesheets-preview`                            | `docs/design/Timesheets-Dashboard.png`    | ✅    | Matched (#44). Spot-checked 2026-10-21 pass: the screen now follows `docs/design/ORGANISATION_WORKSPACE.html` (planned, actual, paid, status per day) and the flat tokens, so it no longer resembles `Timesheets-Dashboard.png`'s weekly cost table. The preview's payroll cut-off fixture is a fixed August date                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| clockin             | `/app/clock` + `/clockin-preview`                | `docs/design/clockin.png`                 | ✅    | Matched **and live**, rebuilt again against the ref in #123. Both routes render the same `ClockInView`. Capture at 1590 wide and scale by **0.80**. The ref is a 1920×1280 design at 80%; see `docs/design/.loop/clockin-log.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| staff               | `/app/team` + `/staff-preview`                   | `docs/design/staff.png`                   | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass).** That file has been the Organisation section's sole reference since 2026-08-12 and the page follows it: the six summary cards, Person, Department, Site, Contract, Rostered, Today and Actions columns, Export and Add Staff. `staff.png` predates it (skills, availability dots, a side details panel) and is superseded, not debt                                                                                                                                                                                                                                                                                                                                                                                                                               |
| staff-profile       | `/app/team/:staffId` + `/staff-preview/:staffId` | `docs/design/Staff-Profile.png`           | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass).** Overview, Shifts, Documents, Leave and Activity tabs, details and work cards, emergency contacts. `Staff-Profile.png` puts upcoming shifts, a shift summary and recent activity on the Overview tab; here they are their own tabs, as the HTML reference has them. Its pay rate, date of birth and gender rows are not shown                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| availability        | `/app/availability`                              | `docs/design/Availability.png`            | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 and 2026-10-22 passes).** Weekly pattern with Change, exceptions, and, for a manager, "Team availability" for a day, exactly as that file draws it (captured at `/app-preview/availability?role=manager`). There is no `/app/team-availability` route: the sidebar labels the same page "Team Availability" for a manager. `Availability.png`'s manager week grid is superseded, not missing                                                                                                                                                                                                                                                                                                                                                                              |
| leave               | `/app/leave`                                     | `docs/design/Leave.png`                   | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens): the five figures (awaiting decision, approved next 30 days, sickness, cover risk, entitlement used), the balances note and the request table. `/leave-preview` was removed; capture `/app-preview/leave`. `Leave.png`'s side column (overview chart, quick actions) is superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| swaps               | `/app/swaps`                                     | `docs/design/Swap-Request.png`            | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens): four figures, requests with decisions, and the Swap Rules card. Capture `/app-preview/swaps`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| reports             | `/app/reports` + `/reports-preview`              | `docs/design/Reports-Dashboard.png`       | ✅    | Matched (#123). Re-checked 2026-10-22 after the flat tokens: workforce trends on top, as the HTML reference has them, then the catalogue as `Reports-Dashboard.png` draws it. Staff cost and agency spend are absent (no data behind them)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| announcements       | `/announcements-preview`                         | `docs/design/Announcements-Dashboard.png` | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens): announcement cards with read counts and reminders, and a Reach card. `Announcements-Dashboard.png`'s table and preview pane are superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| locations           | `/locations-preview`                             | `docs/design/Locations-Management.png`    | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens): four figures and one card per site with its departments and minimum cover. `Locations-Management.png`'s table and details pane are superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| locations-depts     | `/locations-preview/departments`                 | `docs/design/Location-department.png`     | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html`** (Re-checked 2026-10-22 after the flat tokens). Departments open from each site card; the live `/app/locations/departments` redirects to `/app/locations` (`src/App.tsx`). `Location-department.png`'s separate table is superseded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| settings-org        | `/app/settings/organisation`                     | `docs/design/SettingsOrganisation.png`    | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass),** captured at `/settings-preview/organisation`. Title now names the section, as every reference does. `SettingsOrganisation.png` shows read-only summary cards with Edit buttons; the screen edits in place. Industry Pack and Platform Support Access history are still not built (no tables), and working week, date format and currency were removed on 2026-10-11                                                                                                                                                                                                                                                                                                                                                                                              |
| settings-integr     | `/app/settings/integrations`                     | `docs/design/SettingsIntegrations.png`    | ✅    | **Matched by decision (2026-10-22, owner).** The SMTP card, then an "Also connected" card listing what exists today, each with a link to where it lives: the payroll CSV (Reports), the calendar feed (My rota) and the Stripe billing state (`stripeConnectionLabel`, Billing), with one line saying direct payroll and HR connections come later. The PNG's catalogue of third-party integrations is Phase 2 (CAP-067) and is deliberately not drawn                                                                                                                                                                                                                                                                                                                                                                                            |
| profile             | `/app/account/profile`                           | `docs/design/ProfileSettings.png`         | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass),** captured at `/settings-preview/account/profile`. A "Recent account activity" card now sits under Role & access, as in `ProfileSettings.png`. Still absent from the PNG: preferred language (no i18n), about me, the notification grid (it is Preferences), the security ring and plan card                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| profile-prefs       | `/app/account/preferences`                       | `docs/design/profileprefrence.png`        | ✅    | **Matched by decision (2026-10-22, owner).** A "Time and week" section stores the clock format and the first day of the person's own week, and Notifications gains an email summary choice (`0163`, `app_settings`). The clock follows everywhere `src/lib/format.ts` is used; the week start moves My rota only, because rota periods stay Monday-keyed (GAP-116); the summary is stored and labelled as not sent yet. Left out on purpose: "Match device" (the theme stays light-first), density, default views and display toggles                                                                                                                                                                                                                                                                                                             |
| settings-policy     | `/app/settings/policies`                         | `docs/design/Settingspolicy.png`          | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass),** captured at `/settings-preview/policies`: the rules the product acts on, each with a worked example. The PNG's ~55 policies across ten categories are a policy engine, not a screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| settings-audit      | `/app/settings/audit`                            | `docs/design/Settingsaudit.png`           | ✅    | **Matched (2026-10-21 pass),** captured at `/settings-preview/audit`. Area and Severity columns added from `audit_logs.entity_type` and `severity`, as `Settingsaudit.png` has them. The note under the table said only staff anonymisation was recorded; since 0016 almost every decision is, so it now lists what is and is not (sign-ins, single shift edits). Still absent: IP address (nothing writes it), filters, summary tiles                                                                                                                                                                                                                                                                                                                                                                                                            |
| settings-billing    | `/app/settings/billing`                          | `docs/design/Settingsbilling.png`         | ✅    | **Matched in structure (2026-10-21 pass),** captured at `/settings-preview/billing`: plan, payment and invoices in the order `Settingsbilling.png` has them. Its card brand, credit balance and usage meters are absent because none is stored (the card lives in Stripe's portal). Still not verified against a real completed charge or a real Stripe invoice (CAP-036)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| settings-notifs     | `/app/settings/notifications`                    | `docs/design/SettingsNotifications.png`   | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass),** captured at `/settings-preview/notifications`: event rows across in-app, email and push, and the SMS-unavailable note. The PNG's template library and delivery statistics are absent: no `notification_templates` table and no SMS provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| profile-security    | `/app/account/security`                          | `docs/design/ProfileSecurity.png`         | ✅    | **Matched against `docs/design/ORGANISATION_WORKSPACE.html` (2026-10-21 pass),** captured at `/settings-preview/account/security`: password change, sign-in facts, two-factor. Backup codes are "Not built" in the HTML reference too. The PNG's security score and trusted devices are deliberately absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
| yourdata      | `/app/account/data`    | `docs/design/ProfileSettings.png` (tab and card layout) |
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
6. **You may run the dev server for this task.** Start `pnpm run dev` in the background
   if it isn't already running and reuse it. Do not spawn a second instance.
7. This is a **static front end** on a PHP API (`backend/`). Anything server-side (data,
   auth) goes through the API per `docs/API-SPEC.md` / `docs/ARCHITECTURE.md`; don't
   invent a backend for a screen that needs real data. Wire it to the API or use
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
2. `pnpm run typecheck` and `pnpm run lint`, both must be clean before you screenshot.
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
inferred rather than read from the design system. Then run `pnpm run typecheck` and
`pnpm run lint` one final time. If you could not reach the dev server, say so plainly. Do not claim the screen renders.
