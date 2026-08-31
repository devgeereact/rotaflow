# RotaFlow. Design-Match Loop Prompt

Paste the block under **"The prompt"** into `/loop`. Swap `<SCREEN>` and `<REF>` per
screen using the tables below.

**This is a web PWA, not a mobile app**. There's no simulator. The loop drives a real
Chrome tab against the local Vite dev server (`http://localhost:5042`) and screenshots
that, not `xcrun simctl`.

## How to read the status column

`docs/SCREENS.md` answers "does the feature exist". **This file answers "does it
match its mockup"**. They are different questions and a screen is regularly ✅ in
one and not the other.

- **Matched**, a design-match pass has landed on `main`. Only reopen for a
  regression.
- **Not matched**. The feature is built and working, but nothing has ever
  compared it to its reference. **This is where the remaining work is.**
- **Not built**, no route, no component. Design-match is not the right tool yet;
  it needs a feature build first (schema, service, page), then a match pass.

## Preview routes. Read this before screenshotting

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
reference's literal font sizes or container widths. `docs/design/.loop/` carries
`shot.sh`, `compare.py` and `diff.py` from the leave pass, which do the scaling and
produce a registered red/green overlay. Working shown in
`docs/design/.loop/leave-log.md`.

Three caveats on those scripts, all of which have cost time:

1. They are **run by hand**. No `npm` script invokes any of them. (`scripts/` exists
   but holds only `plan-drift-audit.mjs`, which CI runs weekly; it has nothing to do
   with the design loop.) There is no
   `scripts/` directory.
2. `shot.sh`'s defaults are stale: it falls back to
   `http://localhost:5183/leave-preview`, and both halves are wrong. This project's
   dev port is **5042** (`strictPort` in `vite.config.ts`) and `/leave-preview` no
   longer exists. Always pass the URL explicitly, e.g.
   `shot.sh out.png 1450 1160 http://localhost:5042/app/leave`.
3. `compare.py` and `diff.py` open `docs/design/Leave.png` by a hardcoded relative path
   that the move under `docs/` broke, and `docs/design/.loop/` is **git-ignored**
   (`.gitignore:47`), so every log and capture cited here is a local artefact that a
   fresh clone will not have.

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

## Screens with a design reference

| `<SCREEN>`          | route                                            | `<REF>`                                   | status                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marketing-home      | `/`                                              | `docs/design/marketting.png`              | **Not matched.** Hero/features/industries/footer exist; the ref also specifies a product shot, "Why Teams Choose", logo row, testimonials, CTA banner and a 5-item nav with Book a Demo. Needs feature build + match together                                                                                                                |
| splash              | `/splash`                                        | `docs/design/splash-screen.png`           | Matched                                                                                                                                                                                                                                                                                                                                      |
| appboot             | `/appboot` (preview)                             | `docs/design/appboot.png`                 | **Not matched.** Renders, but not as the ref's 5-step checklist (Secure connection → Loading data → Setting up organisation → Preparing features → Finalising)                                                                                                                                                                               |
| login               | `/login`                                         | `docs/design/signin.png`                  | Matched (#27)                                                                                                                                                                                                                                                                                                                                |
| signup              | `/signup`                                        | `docs/design/signup.png`                  | Matched. Standalone route, carries an invite token through                                                                                                                                                                                                                                                                                   |
| onboarding-org      | `/onboarding-preview?step=1`                     | `docs/design/Organisation-Onboarding.png` | Matched                                                                                                                                                                                                                                                                                                                                      |
| onboarding-about    | `/onboarding-preview?step=2`                     | `docs/design/Organisation-about.png`      | Matched                                                                                                                                                                                                                                                                                                                                      |
| onboarding-team     | `/onboarding-preview?step=3`                     | `docs/design/Team-onboarding.png`         | Matched (#26)                                                                                                                                                                                                                                                                                                                                |
| onboarding-plan     | `/onboarding-preview?step=4`                     | `docs/design/Plan-Selection.png`          | Matched (#28)                                                                                                                                                                                                                                                                                                                                |
| onboarding-complete | `/onboarding-preview?step=5`                     | `docs/design/Onboarding-Complete.png`     | Matched. Swaps two dead mockup links for real ones                                                                                                                                                                                                                                                                                           |
| dashboard           | `/dashboard-preview`                             | `docs/design/Workforce-Dashboard.png`     | Matched (#31)                                                                                                                                                                                                                                                                                                                                |
| rotabuilder         | `/rota-builder-preview`                          | `docs/design/Rota-Builder.png`            | Matched (#33, #40)                                                                                                                                                                                                                                                                                                                           |
| schedule            | `/schedule-preview`                              | `docs/design/Schedule-dashboard.png`      | Matched (#42)                                                                                                                                                                                                                                                                                                                                |
| schedule-live       | `/schedule-preview` (live state)                 | `docs/design/live-schedule.png`           | Matched (#42)                                                                                                                                                                                                                                                                                                                                |
| schedule-published  | `/schedule-preview` (published state)            | `docs/design/published-schedule.png`      | Matched (#42)                                                                                                                                                                                                                                                                                                                                |
| timesheets          | `/timesheets-preview`                            | `docs/design/Timesheets-Dashboard.png`    | Matched (#44)                                                                                                                                                                                                                                                                                                                                |
| clockin             | `/app/clock` + `/clockin-preview`                | `docs/design/clockin.png`                 | Matched **and live**, rebuilt again against the ref in #123. Both routes render the same `ClockInView`. Capture at 1590 wide and scale by **0.80**. The ref is a 1920×1280 design at 80%; see `docs/design/.loop/clockin-log.md`                                                                                                             |
| staff               | `/app/team` + `/staff-preview`                   | `docs/design/staff.png`                   | **Not matched.** `StaffPage` ships and is routed (`src/App.tsx:603`); `/app/staff` is now a redirect to it (`:618`). No `design-staff-match` branch exists locally or on the remote, and there is no `staff-log.md`, so nothing has ever compared this to the ref                                                                            |
| staff-profile       | `/app/team/:staffId` + `/staff-preview/:staffId` | `docs/design/Staff-Profile.png`           | **Not matched.** The `:id` route is built now, `StaffProfilePage` at `src/App.tsx:611`, with `/app/staff/:staffId` redirecting (`:619`). No match log                                                                                                                                                                                        |
| availability        | `/app/availability`                              | `docs/design/Availability.png`            | **Not matched. Next up.** No preview route exists for it, so capture behind a real session                                                                                                                                                                                                                                                   |
| leave               | `/app/leave`                                     | `docs/design/Leave.png`                   | Matched. `/leave-preview` was removed; capture `/app/leave` at 1656×1300 and scale by `1672/1920`; see `docs/design/.loop/leave-log.md`                                                                                                                                                                                                      |
| swaps               | `/app/swaps`                                     | `docs/design/Swap-Request.png`            | Matched. `/swaps-preview` was removed; `/app/swaps` renders `SwapsView`, minus the Swap Rules card (no policy store). No log survives from that pass                                                                                                                                                                                         |
| reports             | `/app/reports` + `/reports-preview`              | `docs/design/Reports-Dashboard.png`       | Matched (#123). Both render `ReportsView`; the live catalogue omits the six of the ref's ten reports that have no query behind them, rather than showing them disabled. See `docs/design/.loop/reports-log.md`                                                                                                                               |
| announcements       | `/announcements-preview`                         | `docs/design/Announcements-Dashboard.png` | Matched. No log survives from that pass                                                                                                                                                                                                                                                                                                      |
| locations           | `/locations-preview`                             | `docs/design/Locations-Management.png`    | Matched. Merged with the Departments screen into one tabbed workspace                                                                                                                                                                                                                                                                        |
| locations-depts     | `/locations-preview/departments`                 | `docs/design/Location-department.png`     | Matched. Second tab of the same workspace. `DepartmentManager` now opens as a dialog, and the live `/app/locations/departments` redirects to `/app/locations` (`src/App.tsx:634`)                                                                                                                                                            |
| settings-org        | `/app/settings/organisation`                     | `docs/design/SettingsOrganisation.png`    | **Not matched.** `SettingsOrganisationPage` ships, adding the ref's contact block and sites/departments summary to the old flat screen; `/app/settings` redirects here (`src/App.tsx:680`). Industry Pack and Platform Support Access are deliberately not built, both need tables that do not exist                                         |
| settings-integr     | `/app/settings/integrations`                     | `docs/design/SettingsIntegrations.png`    | **Not matched.** It is a Settings tab now, as the ref shows; the old top-level `/app/integrations` redirects here (`src/App.tsx:676`)                                                                                                                                                                                                        |
| profile             | `/app/account/profile`                           | `docs/design/ProfileSettings.png`         | **Not matched, partly built**. See `docs/SCREENS.md` §4                                                                                                                                                                                                                                                                                      |
| profile-prefs       | `/app/account/preferences`                       | `docs/design/profileprefrence.png`        | **Not matched.** `PreferencesPage` ships the preferences that are really stored, `app_settings.theme`, `app_settings.notifications_enabled` and the device's push subscription. The ref's language selector is deliberately absent, there is no i18n layer                                                                                   |
| settings-policy     | `/app/settings/policies`                         | `docs/design/Settingspolicy.png`          | **Not matched.** `SettingsPoliciesPage` ships the six rules the product actually acts on, stored in `organisations.settings` rather than a policies table. The ref's ~55 policies across 10 categories are a policy engine, not a screen                                                                                                     |
| settings-audit      | `/app/settings/audit`                            | `docs/design/Settingsaudit.png`           | **Not matched.** `SettingsAuditPage` ships over `audit_logs`, which now has several writers, not only `anonymize_staff_member`: leave declines, clock-event amendments and the AI assistant's `audit_write`                                                                                                                                  |
| settings-billing    | `/app/settings/billing`                          | `docs/design/Settingsbilling.png`         | **Built, not ref-matched.** Stripe Checkout + Billing Portal wired (`0050`, `SettingsBillingPage.tsx`, `billingCheckoutService.ts`) — not verified against a real completed charge. See `docs/PRD.md` §5/§7                                                                                                                                  |
| settings-notifs     | `/app/settings/notifications`                    | `docs/design/SettingsNotifications.png`   | **Not matched.** `SettingsNotificationsPage` ships org-wide defaults across the three channels the product can deliver (in-app, email, web push). The ref's SMS column and 28-template library are deliberately absent, no provider and no `notification_templates` table. Distinct from `/app/notifications`                                |
| profile-security    | `/app/account/security`                          | `docs/design/ProfileSecurity.png`         | **Not matched.** `SecurityPage` ships password change and TOTP two-factor (`0102`), and `/app/account/sessions` lists real devices and revokes them (`0100`). Backup codes and trusted devices are still absent, and the ref's 100% "Security check-up" ring is deliberately not built — three of its four ticks cannot be answered honestly |

**Before starting any row whose status says a card or field is deliberately not
built**, read `docs/SCREENS.md` §3/§4 and the page's own header comment. Several of
those gaps need a migration or a whole subsystem, so a design-match loop alone
cannot close them.

| tokens only | `docs/design/designsystem.png` |

## Screens with NO design reference

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

## The prompt

ONE SCREEN AT A TIME.

PICK A SCREEN AND BUILD

Build the **`<SCREEN>`** screen so it visually matches `<REF>` as closely as possible.

### Ground rules (read before writing code)

1. Read `CLAUDE.md` and `docs/RULES.md`. Binding. Notably: TypeScript strict, no
   implicit `any`, explicit return types on functions/hooks; import app code with
   `@/…`; keep components small and typed (SDK setup in `src/lib`, data calls in
   `src/services`, reusable logic in `src/hooks`).
2. **Tokens already exist. Use them, don't invent.** `tailwind.config.ts` and
   `docs/DESIGN.md` define the full palette, spacing, radii, shadows, and type scale.
   Every value you use must be a token class (`bg-primary`, `text-content`,
   `rounded-2xl`, `shadow`, etc.), no raw hex, no arbitrary `p-[13px]`, no inline
   `style={{}}`. If the design system PNG needs a value that isn't a token yet, add it
   to `tailwind.config.ts` and note it as inferred in this screen's log.
3. Icons are `lucide-react` only, no ad-hoc SVGs, no second icon set.
4. Reuse/extend primitives in `src/components/ui` (`Button`, `Card`, etc.) instead of
   duplicating styles inline; add a new primitive there if the reference needs one
   that doesn't exist yet.
5. The reference image is light-mode only, but every surface still needs a working
   `dark:` variant per `docs/DESIGN.md` §1. Don't defer dark mode.
6. **You may run the dev server for this task.** Start `npm run dev` in the background
   if it isn't already running and reuse it. Do not spawn a second instance.
7. This is a **static PWA build**, no server runtime. Anything server-side (data,
   auth) goes through Supabase per `docs/SCHEMA.md` / `docs/ARCHITECTURE.md`; don't
   invent a backend for a screen that needs real data. Wire it to Supabase or use
   the same demo/mock pattern already used on built screens.

### Match target

Layout · spacing · typography (family, size, weight, line height, letter spacing) ·
colors and gradients · button styles and heights · input fields · border radius ·
shadows and elevation · icons · imagery and its cropping · alignment and padding ·
visual hierarchy · empty/loading/error states where the reference shows them.

Do not redesign or improvise. If the reference is ambiguous or something is missing
from it, implement the closest reasonable thing **and log it** rather than inventing
a different layout.

### The loop

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

### Stop conditions. Stop when ANY of these is true

- The screenshot and the reference are indistinguishable at a glance, and the last
  two iterations produced no new fixable diffs.
- You have completed **8 iterations**.
- The remaining diffs are all things you cannot fix from code (e.g. the reference
  uses an asset you do not have, or a font not in the project).

On stop, output: a short list of what still differs and why, plus every value you
inferred rather than read from the design system. Then run `npm run typecheck` and
`npm run lint` one final time. If you could not reach the dev server, say so plainly. Do not claim the screen renders.
