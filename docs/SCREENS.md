# RotaFlow — Screen Inventory

Every design in `design/` mapped to whether it is actually built, verified against
the real route table in `src/App.tsx` and the real page code — not against what an
earlier version of this document claimed.

**Legend**

- ✅ **Built** — a real route, doing real work against real data
- 🟡 **Partial** — something exists at that route, but the design specifies
  substantially more than is built
- ❌ **Not built** — no route, no component

**Scope of this document:** does the _feature_ exist and work. Pixel-fidelity to a
mockup is tracked separately in `docs/LOOP.md`, which is the authority on
design-match. A screen can be ✅ here and still not match its mockup visually.

Role note: the real `MembershipRole` is `owner | manager | staff`. "Super Admin" is a
separate `is_platform_admin` flag, not a fourth role.

---

## 1. Public, auth, onboarding & launch

| Status | Design                        | Screen                                    | Route                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ----------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡     | `marketting.png`              | Marketing home                            | `/` — hero, feature grid, industry strip and footer are built. The design also specifies a product screenshot, a "Why Teams Choose" block, a trusted-by logo row, a testimonial carousel, a CTA banner, and Features/Solutions/**Pricing**/Resources/Contact nav with "Book a Demo". None of those exist, and there are no `/pricing`, `/features` or `/contact` routes |
| ✅     | `signin.png`                  | Sign in — password, magic link, OAuth     | `/login`                                                                                                                                                                                                                                                                                                                                                                |
| ✅     | `signup.png`                  | Sign up — carries an invite token through | `/signup`                                                                                                                                                                                                                                                                                                                                                               |
| ✅     | `splash-screen.png`           | Cold-start splash                         | `/splash`, also inline while auth resolves                                                                                                                                                                                                                                                                                                                              |
| 🟡     | `appboot.png`                 | App boot / "setting up organisation"      | In production this renders **inline** from `ProtectedRoute` while auth/org resolve — it has no production URL. `/appboot` is a design-loop **preview route only**, with fixed props, existing so the state can be screenshotted. Real either way, but it does not yet match the mockup's 5-step checklist UI — see `docs/LOOP.md`                                       |
| ✅     | `Organisation-Onboarding.png` | Onboarding 1 — create org                 | `/onboarding`                                                                                                                                                                                                                                                                                                                                                           |
| ✅     | `Organisation-about.png`      | Onboarding 2 — about your org             | `/onboarding`                                                                                                                                                                                                                                                                                                                                                           |
| ✅     | `Team-onboarding.png`         | Onboarding 3 — invite team                | `/onboarding`. Department/location fields on this step stage locally and are never persisted — a real, self-documented schema gap                                                                                                                                                                                                                                       |
| ✅     | `Plan-Selection.png`          | Onboarding 4 — choose plan                | `/onboarding`. Records intent only; no charging exists (see §3 Billing)                                                                                                                                                                                                                                                                                                 |
| ✅     | `Onboarding-Complete.png`     | Onboarding 5 — done                       | `/onboarding`. Deliberately swaps two dead mockup links for real ones                                                                                                                                                                                                                                                                                                   |

## 2. Core scheduling & workforce

| Status | Design                        | Screen                                     | Route                                                                                                             |
| ------ | ----------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| ✅     | `Workforce-Dashboard.png`     | Manager dashboard                          | `/app/dashboard`                                                                                                  |
| ✅     | `Rota-Builder.png`            | Rota builder — drag/drop, AI fill, publish | `/app/rota`                                                                                                       |
| ✅     | `Schedule-dashboard.png`      | Schedule — manager default view            | `/app/schedule`                                                                                                   |
| ✅     | `live-schedule.png`           | Schedule — staff "live" agenda state       | `/app/schedule`                                                                                                   |
| ✅     | `published-schedule.png`      | Schedule — post-publish state              | `/app/schedule`                                                                                                   |
| ✅     | `staff.png`                   | Staff directory                            | `/app/staff`                                                                                                      |
| 🟡     | `Staff-Profile.png`           | Staff profile detail                       | `/app/staff` — an edit modal plus emergency-contacts/documents modals over the list, not a `/app/staff/:id` route |
| ✅     | `Availability.png`            | Availability — staff pattern + team view   | `/app/availability`                                                                                               |
| ✅     | `Leave.png`                   | Leave — requests, entitlement, approvals   | `/app/leave`                                                                                                      |
| ✅     | `Swap-Request.png`            | Shift swaps — request, respond, approve    | `/app/swaps`                                                                                                      |
| ✅     | `Timesheets-Dashboard.png`    | Timesheets — real hours from clock events  | `/app/timesheets`                                                                                                 |
| ✅     | `Reports-Dashboard.png`       | Reports — CSV export                       | `/app/reports`                                                                                                    |
| ✅     | `Announcements-Dashboard.png` | Announcements — feed + composer            | `/app/announcements`                                                                                              |
| ✅     | `Locations-Management.png`    | Locations                                  | `/app/locations`                                                                                                  |
| ✅     | `Location-department.png`     | Departments within a location              | `/app/locations` (`DepartmentManager`)                                                                            |

## 3. Settings area — 8 designed tabs, 2 have code, 0 are tabs

Counting **designed tabs**: the mockups specify Organisation · Permissions · Roles ·
Policies · Notifications · Integrations · Billing · Audit.

Of those 8: **1 is fully built** (Integrations), **1 is partial** (Organisation), and
**6 have no code at all**. Neither built one is actually a _tab_ — they are two
separate flat routes (`/app/settings`, `/app/integrations`), and no tab bar exists
anywhere in the app.

| Status | Design                      | Tab           | Reality                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | --------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡     | `SettingsOrganisation.png`  | Organisation  | `/app/settings` covers org name, industry, type, country, timezone, working week. The mockup adds registration no., website, phone, address, primary contact, an Industry Pack, org preferences (week start, date/time format, shift rounding, break deduction, overtime rule, publish time), role display labels, a sites/cost-centres summary, and Platform Support Access with grant/revoke + history — none built |
| ✅     | `SettingsIntegrations.png`  | Integrations  | `/app/integrations` — per-org SMTP with a real test-send. Lives at its own top-level route, not as a Settings tab                                                                                                                                                                                                                                                                                                     |
| ❌     | `Settingspolicy.png`        | Policies      | No route, no component, **no table**. Specifies ~55 policies across 10 categories, per-policy scope/status/history, a templates library, import/export, and real-time rota validation against the rules                                                                                                                                                                                                               |
| ❌     | `Settingsaudit.png`         | Audit         | No route, no component. `audit_logs` **table exists** but is effectively empty — only `anonymize_staff_member` ever writes to it; no login, rota-publish, shift-edit or role-change events are recorded. The mockup also needs `ip_address`, `severity` and an "area" field the table lacks, plus retention/archiving and scheduled reports                                                                           |
| ❌     | `Settingsbilling.png`       | Billing       | No route, no component. `subscriptions` **table exists** as a deliberate seam (`plan`, `status`, `provider`, `provider_ref`) but nothing reads or writes it and the billing Edge Functions it references were never built. No invoices, payment-methods, usage-metering or credit tables; no payment provider integrated                                                                                              |
| ❌     | `SettingsNotifications.png` | Notifications | No route, no component, **no table**. This is _template administration_ (28 templates, per-channel routing, recipient rules, delivery/open analytics) — distinct from `/app/notifications`, which is an end-user inbox. Would need an SMS provider and delivery tracking                                                                                                                                              |
| ❌     | —                           | Permissions   | No design file, no code, no table. Referenced only as a tab in the other mockups                                                                                                                                                                                                                                                                                                                                      |
| ❌     | —                           | Roles         | No design file, no code. Roles are a fixed 3-value CHECK on `memberships.role`; the custom roles shown in `SettingsOrganisation.png` (Team Leader, Scheduler, HR Advisor…) cannot be represented                                                                                                                                                                                                                      |

## 4. My Profile area — 6 designed tabs, 2 partial, 0 are tabs

Counting **designed tabs**: Profile · Preferences · Security · Sessions · API Tokens ·
Activity (a Connected Accounts tab also appears in one mockup's tab bar).

Of those 6: **0 are fully built**, **2 are partial** (Profile, Preferences — both
served by fragments of one page), and **4 have no code at all**. As with Settings,
none of it is a tab: it's a single flat `/app/account` page, reachable only from the
user menu.

| Status | Design                 | Tab         | Reality                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡     | `ProfileSettings.png`  | Profile     | `/app/account` has full name, read-only email, password change, and one notifications on/off toggle. The mockup adds photo upload, job title, phone, department, preferred language, an "about me" bio, a 4-channel × 5-type notification matrix, role & access, recent activity, sessions, a security check-up and plan info |
| 🟡     | `profileprefrence.png` | Preferences | `app_settings` holds exactly **two** fields (`theme`, `notifications_enabled`). The mockup specifies ~20: language, week start, time/date format, timezone, currency, default view, default rota range, density, six display toggles, four calendar toggles, plus change history and org-derived compliance rules             |
| ❌     | `ProfileSecurity.png`  | Security    | Password change exists on `/app/account`; nothing else does. Needs MFA/TOTP enrolment, backup codes, recovery email, trusted devices, session timeout, concurrent-session limits, login alerts, and a geolocated security event log                                                                                           |
| ❌     | —                      | Sessions    | No design file. No session listing or per-device revocation; Supabase's `auth.sessions` isn't surfaced                                                                                                                                                                                                                        |
| ❌     | —                      | API Tokens  | No design file, no code, no table                                                                                                                                                                                                                                                                                             |
| ❌     | —                      | Activity    | No design file, no code                                                                                                                                                                                                                                                                                                       |

## 5. Built with no design mockup

| Status | Screen                                      | Route                                 |
| ------ | ------------------------------------------- | ------------------------------------- |
| ✅     | Clock in/out — GPS + manual, offline-queued | `/app/clock`                          |
| ✅     | Team management — issue/revoke invites      | `/app/team`                           |
| ✅     | Notifications inbox — read, push opt-in     | `/app/notifications`                  |
| ✅     | Account settings                            | `/app/account` (see §4)               |
| ✅     | Forgot / reset password                     | `/forgot-password`, `/reset-password` |
| ✅     | Accept invite — public, pre-signup          | `/invite/:token`                      |
| ✅     | 404                                         | `*`                                   |

## 6. Navigation — the designs restructure it

The mockups' sidebar reads: Dashboard · Rota Builder · Schedule · Staff ·
Availability · Leave · Swaps · Timesheets · Reports · Announcements · Locations ·
**Settings** (expandable, 8 sub-items), with **My Profile** as its own sub-nav group.

The built sidebar is a flat 15-item list: Dashboard · Rota · Schedule · Clock in ·
Staff · Team · Locations · Availability · Leave · Swaps · Timesheets ·
Announcements · Reports · Integrations · Settings.

Differences that are decisions, not bugs — worth settling before building Settings:

- The designs have **no Clock in and no Team** in the sidebar. Both are built and
  routed; if the design is authoritative they need a new home.
- **Integrations** is a top-level nav item today but a Settings tab in the design.
- **Notifications** has no sidebar entry in either; it's reached via the bell.
- No collapsible nav group or tab-bar component exists yet — the Settings and
  Profile areas both need one before any of their tabs can be built.

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

No screen **reads** any of these — verified by grepping `src/` for
`from('<table>')`, zero hits for all four. Each is a seam someone deliberately left.

"No UI reads" is not the same as "inert", and the difference matters if you build
against them:

- **`audit_logs` is written to**, server-side, by the `anonymize_staff_member` RPC
  (`0011`). So it accumulates rows for exactly one event type and nothing else — no
  logins, rota publishes, shift edits or role changes. Treat it as provisioned but
  effectively empty, not as a populated log waiting for a viewer.
- **`subscriptions`, `overtime_requests`, `shift_templates`** have no reader _and_ no
  writer anywhere — client or server. They are empty structure.

## 9. GDPR — built, deliberately narrower than "delete everything"

Per-staff **export** (JSON of everything held) and **anonymize** (scrub PII, keep
operational rows) on `/app/staff`, owner-only, via `anonymize_staff_member`
(`0011_gdpr_anonymize.sql`, applied). Two things it deliberately does not do:

- Delete the person's RotaFlow login (`profiles`/`auth.users`) — that can span
  organisations and needs the Auth Admin API, a platform-level operation.
- Delete the file behind a stored `documents.file_url` — only the row goes.

## 10. Realtime

12 screens live-update via `useRealtimeRefresh` (`docs/HOOKS.md` §11) against the 13
tables published in `0012_realtime.sql`: Dashboard, Schedule, Leave, Swaps,
Timesheets, Clock in, Availability, Announcements, Notifications, Staff, Locations,
Team.

**Rota Builder is deliberately excluded.** Its load path calls
`getOrCreateRotaForPeriod`, which INSERTs, so a naive subscription creates a
write→event→refetch cycle and a mid-drag refetch could disturb an in-progress edit.
It needs a mutation-aware guard first.

`org_smtp_settings` and `audit_logs` are deliberately **not** published — publishing
a table whose whole design is that clients cannot read a column would hand that
column out in a change payload.

---

## Reference assets (not screens)

`designsystem.png` (token sheet, source of truth for `docs/DESIGN.md`) ·
`rotaflowui.png` (system applied) · `logo.png` / `logo-1.png` / `logo-2.png`.

## Counts

34 screen mockups in `design/`: **23 ✅ built · 6 🟡 partial · 5 ❌ not built.**
Plus 7 built screens with no mockup, and 6 designed tabs (Permissions, Roles,
Sessions, API Tokens, Activity, Connected Accounts) specified by the tab bars but
having no mockup file of their own.

The remaining work is concentrated almost entirely in **Settings**, **My Profile**
and the **marketing site** — the core scheduling product is built.

> Counts verified by parsing this file's own tables against `ls design/`, not by
> hand. The invariant, if you add a mockup: every **screen** `.png` in `design/`
> appears in exactly one status row here. Reference assets are excluded from that
> rule — `designsystem.png`, `rotaflowui.png`, `logo.png`, `logo-1.png`,
> `logo-2.png` are tokens and brand marks, not screens, and have no status row.
