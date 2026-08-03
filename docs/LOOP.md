# RotaFlow — Design-Match Loop Prompt

Paste the block under **"The prompt"** into `/loop`. Swap `<SCREEN>` and `<REF>` per
screen using the tables below.

**This is a web PWA, not a mobile app** — there's no simulator. The loop drives a real
Chrome tab against the local Vite dev server (`http://localhost:5042`) and screenshots
that, not `xcrun simctl`.

## How to read the status column

`docs/SCREENS.md` answers "does the feature exist". **This file answers "does it
match its mockup"** — they are different questions and a screen is regularly ✅ in
one and not the other.

- **Matched** — a design-match pass has landed on `main`. Only reopen for a
  regression.
- **Not matched** — the feature is built and working, but nothing has ever
  compared it to its reference. **This is where the remaining work is.**
- **Not built** — no route, no component. Design-match is not the right tool yet;
  it needs a feature build first (schema, service, page), then a match pass.

## Preview routes — read this before screenshotting

Most matched screens live behind auth and need a real Supabase session, an org and
seeded rows, which the loop cannot produce. The pattern already in use is a
**`*-preview` route** carrying fixed mock data that reproduces the reference's exact
numbers: `/dashboard-preview`, `/rota-builder-preview`, `/schedule-preview`,
`/timesheets-preview`, `/clockin-preview`, `/onboarding-preview`, `/appboot`,
`/staff-preview`, `/locations-preview`, `/swaps-preview`, `/leave-preview`.

**The references are not 1:1 CSS pixels — check the export scale before measuring
anything.** Several mockups are large designs exported smaller, and two separate
passes lost an iteration to this independently (locations, leave). So:

1. Divide the PNG's width and height by a plausible design size (start with
   1920×1080). **If both ratios agree, that is the export scale.** `Leave.png` is
   1672×941 — `1672/1920 = 0.8708` and `941/1080 = 0.8713`.
2. Then either divide every measurement you take off the PNG by that scale before
   comparing it to a CSS pixel, or capture at the design size and scale your own
   screenshot down to match.

Skip this and correct type reads 15–30% too large, and you will spend an iteration
shrinking a type scale that was already right. Where the scale cannot be recovered
(the locations mockups' body text is ~0.7× `text-sm` and no clean ratio fits),
match _proportions and structure_ at the project's real type scale rather than the
reference's literal font sizes or container widths. `design/.loop/` carries
`shot.sh`, `compare.py` and `diff.py` from the leave pass, which do the scaling and
produce a registered red/green overlay. Working shown in
`design/.loop/locations-log.md` and `design/.loop/leave-log.md`.

Two things about them that have caused re-work:

1. **Preview pages render page content only — no `AppShell`.** Every reference PNG
   shows the sidebar and top bar, because that is how the screen looks in the
   product. The preview deliberately omits them. Do not "fix" the missing sidebar;
   compare the content region and ignore the chrome.
2. They are **currently reachable in production** and should be `import.meta.env.DEV`-gated —
   see `docs/audit01.md` P1-1. When that lands, the loop is unaffected: it drives
   the dev server, where they still exist.

## Screens with a design reference

| `<SCREEN>`          | route                                 | `<REF>`                              | status                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marketing-home      | `/`                                   | `design/marketting.png`              | **Not matched.** Hero/features/industries/footer exist; the ref also specifies a product shot, "Why Teams Choose", logo row, testimonials, CTA banner and a 5-item nav with Book a Demo. Needs feature build + match together |
| splash              | `/splash`                             | `design/splash-screen.png`           | Matched                                                                                                                                                                                                                       |
| appboot             | `/appboot` (preview)                  | `design/appboot.png`                 | **Not matched.** Renders, but not as the ref's 5-step checklist (Secure connection → Loading data → Setting up organisation → Preparing features → Finalising)                                                                |
| login               | `/login`                              | `design/signin.png`                  | Matched (#27)                                                                                                                                                                                                                 |
| signup              | `/signup`                             | `design/signup.png`                  | Matched — standalone route, carries an invite token through                                                                                                                                                                   |
| onboarding-org      | `/onboarding-preview?step=1`          | `design/Organisation-Onboarding.png` | Matched                                                                                                                                                                                                                       |
| onboarding-about    | `/onboarding-preview?step=2`          | `design/Organisation-about.png`      | Matched                                                                                                                                                                                                                       |
| onboarding-team     | `/onboarding-preview?step=3`          | `design/Team-onboarding.png`         | Matched (#26)                                                                                                                                                                                                                 |
| onboarding-plan     | `/onboarding-preview?step=4`          | `design/Plan-Selection.png`          | Matched (#28)                                                                                                                                                                                                                 |
| onboarding-complete | `/onboarding-preview?step=5`          | `design/Onboarding-Complete.png`     | Matched — swaps two dead mockup links for real ones                                                                                                                                                                           |
| dashboard           | `/dashboard-preview`                  | `design/Workforce-Dashboard.png`     | Matched (#31)                                                                                                                                                                                                                 |
| rotabuilder         | `/rota-builder-preview`               | `design/Rota-Builder.png`            | Matched (#33, #40)                                                                                                                                                                                                            |
| schedule            | `/schedule-preview`                   | `design/Schedule-dashboard.png`      | Matched (#42)                                                                                                                                                                                                                 |
| schedule-live       | `/schedule-preview` (live state)      | `design/live-schedule.png`           | Matched (#42)                                                                                                                                                                                                                 |
| schedule-published  | `/schedule-preview` (published state) | `design/published-schedule.png`      | Matched (#42)                                                                                                                                                                                                                 |
| timesheets          | `/timesheets-preview`                 | `design/Timesheets-Dashboard.png`    | Matched (#44)                                                                                                                                                                                                                 |
| clockin             | `/app/clock` + `/clockin-preview`     | `design/clockin.png`                 | Matched **and live**. Both routes render the same `ClockInView`. Capture at 1590 wide and scale by **0.80** — the ref is a 1920×1280 design at 80%; see `design/.loop/clockin-log.md`                                          |
| staff               | `/app/staff`                          | `design/staff.png`                   | **In flight** — branch `design-staff-match`. Do not start a second pass on this                                                                                                                                               |
| staff-profile       | `/app/staff/:id`                      | `design/Staff-Profile.png`           | **In flight** — same branch. Needs the `:id` route built, not just styled                                                                                                                                                     |
| availability        | `/app/availability`                   | `design/Availability.png`            | **Not matched** — next up                                                                                                                                                                                                     |
| leave               | `/leave-preview`                      | `design/Leave.png`                   | Matched. Capture at 1656×1300 and scale by `1672/1920`; see `design/.loop/leave-log.md`                                                                                                                                       |
| swaps               | `/swaps-preview`                      | `design/Swap-Request.png`            | Matched — `/app/swaps` renders the same `SwapsView`, minus the Swap Rules card (no policy store). See `design/.loop/swaps-log.md`                                                                                             |
| reports             | `/app/reports`                        | `design/Reports-Dashboard.png`       | **Not matched** — next up                                                                                                                                                                                                     |
| announcements       | `/announcements-preview`              | `design/Announcements-Dashboard.png` | Matched — `design/.loop/announcements-log.md`                                                                                                                                                                                 |
| locations           | `/locations-preview`                  | `design/Locations-Management.png`    | Matched — merged with the Departments screen into one tabbed workspace                                                                                                                                                        |
| locations-depts     | `/locations-preview/departments`      | `design/Location-department.png`     | Matched — second tab of the same workspace. `DepartmentManager` now opens as a dialog                                                                                                                                         |
| settings-org        | `/app/settings`                       | `design/SettingsOrganisation.png`    | **Not matched, and mostly not built** — ref adds ~12 fields, an Industry Pack, org preferences, role labels, sites summary and Platform Support Access                                                                        |
| settings-integr     | `/app/integrations`                   | `design/SettingsIntegrations.png`    | **Not matched.** Built, but as a top-level route; the ref makes it a Settings tab                                                                                                                                             |
| profile             | `/app/account`                        | `design/ProfileSettings.png`         | **Not matched, partly built** — see `docs/SCREENS.md` §4                                                                                                                                                                      |
| profile-prefs       | `/app/account`                        | `design/profileprefrence.png`        | **Not matched, mostly not built** — `app_settings` holds 2 of the ~20 fields specified                                                                                                                                        |
| settings-policy     | —                                     | `design/Settingspolicy.png`          | **Not built.** No route, no component, no table. ~55 policies across 10 categories                                                                                                                                            |
| settings-audit      | —                                     | `design/Settingsaudit.png`           | **Not built.** `audit_logs` exists but only `anonymize_staff_member` writes to it                                                                                                                                             |
| settings-billing    | —                                     | `design/Settingsbilling.png`         | **Not built.** `subscriptions` is an empty seam; no payment provider                                                                                                                                                          |
| settings-notifs     | —                                     | `design/SettingsNotifications.png`   | **Not built.** Template administration — no table. Distinct from `/app/notifications`                                                                                                                                         |
| profile-security    | —                                     | `design/ProfileSecurity.png`         | **Not built.** Needs MFA/TOTP, backup codes, trusted devices, session controls                                                                                                                                                |

**Before starting any "Not built" row**, read `docs/SCREENS.md` §3/§4 — several need
a migration and a tab-bar component that does not exist yet, so a design-match loop
alone cannot finish them.

| tokens only | `design/designsystem.png` |

## Screens with NO design reference

No mockup exists for these; layout is **inferred** from the nearest built/referenced
screen plus the tokens in `design/designsystem.png`. Run the loop against the closest
ref for surface/type/radius fidelity only — do **not** try to make them identical to it.

| `<SCREEN>`    | route                  | closest ref (inferred from)                         |
| ------------- | ---------------------- | --------------------------------------------------- |
| team          | `/app/team`            | `design/staff.png` (table/list + filter bar layout) |
| notifications | `/app/notifications`   | `design/Announcements-Dashboard.png` (feed layout)  |
| notfound      | `*` (bad route)        | `design/designsystem.png` (tokens only)             |
| errorboundary | thrown render          | `design/designsystem.png` (tokens only)             |
| offlinebanner | global, offline        | `design/designsystem.png` (status pill styles)      |
| installprompt | global, installable    | `design/designsystem.png` (card + button styles)    |
| updateprompt  | global, new SW waiting | `design/designsystem.png` (card + button styles)    |

## The prompt

ONE SCREEN AT A TIME.

PICK A SCREEN AND BUILD

Build the **`<SCREEN>`** screen so it visually matches `<REF>` as closely as possible.

### Ground rules (read before writing code)

1. Read `CLAUDE.md` and `docs/RULES.md` — binding. Notably: TypeScript strict, no
   implicit `any`, explicit return types on functions/hooks; import app code with
   `@/…`; keep components small and typed (SDK setup in `src/lib`, data calls in
   `src/services`, reusable logic in `src/hooks`).
2. **Tokens already exist — use them, don't invent.** `tailwind.config.ts` and
   `docs/DESIGN.md` define the full palette, spacing, radii, shadows, and type scale.
   Every value you use must be a token class (`bg-primary`, `text-content`,
   `rounded-2xl`, `shadow`, etc.) — no raw hex, no arbitrary `p-[13px]`, no inline
   `style={{}}`. If the design system PNG needs a value that isn't a token yet, add it
   to `tailwind.config.ts` and note it as inferred in this screen's log.
3. Icons are `lucide-react` only — no ad-hoc SVGs, no second icon set.
4. Reuse/extend primitives in `src/components/ui` (`Button`, `Card`, etc.) instead of
   duplicating styles inline; add a new primitive there if the reference needs one
   that doesn't exist yet.
5. The reference image is light-mode only, but every surface still needs a working
   `dark:` variant per `docs/DESIGN.md` §1 — don't defer dark mode.
6. **You may run the dev server for this task.** Start `npm run dev` in the background
   if it isn't already running and reuse it — do not spawn a second instance.
7. This is a **static PWA build** — no server runtime. Anything server-side (data,
   auth) goes through Supabase per `docs/SCHEMA.md` / `docs/ARCHITECTURE.md`; don't
   invent a backend for a screen that needs real data — wire it to Supabase or use
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
2. `npm run typecheck` and `npm run lint` — both must be clean before you screenshot.
   A type error means the iteration is not done.
3. Screenshot the running dev server:
   - Load the Chrome tools if not already loaded (ToolSearch:
     `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp"`).
   - Navigate to `http://localhost:5042<ROUTE>` and take a screenshot. Save/compare
     iterations under `design/.loop/<SCREEN>-<N>.png` (`<N>` = iteration number,
     starting at 1; create `design/.loop/` if absent).
4. **Read your own screenshot back** with the Read tool, side by side with `<REF>`.
   Do not trust the code — trust the pixels.
5. Write the diffs to `design/.loop/<SCREEN>-log.md`, appending a section per
   iteration: what differed, what you changed, what is still off, what you
   deliberately inferred. Read this log at the start of every iteration so you don't
   re-fix the same thing or oscillate between two wrong values.
6. Repeat.

Be strict. Look for: text baseline and vertical centering, button height and
horizontal padding, gap between stacked elements, corner radius (4 vs 8 vs 12 is
visible), shadow spread and opacity, icon weight and size, image crop and aspect,
exact font weight (500 vs 600 is visible), and color accuracy (sample the hex from
both images, do not eyeball it).

### Stop conditions — stop when ANY of these is true

- The screenshot and the reference are indistinguishable at a glance, and the last
  two iterations produced no new fixable diffs.
- You have completed **8 iterations**.
- The remaining diffs are all things you cannot fix from code (e.g. the reference
  uses an asset you do not have, or a font not in the project).

On stop, output: a short list of what still differs and why, plus every value you
inferred rather than read from the design system. Then run `npm run typecheck` and
`npm run lint` one final time. If you could not reach the dev server, say so plainly —
do not claim the screen renders.
