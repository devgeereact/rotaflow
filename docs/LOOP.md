# RotaFlow — Design-Match Loop Prompt

Paste the block under **"The prompt"** into `/loop`. Swap `<SCREEN>` and `<REF>` per
screen using the tables below.

**This is a web PWA, not a mobile app** — there's no simulator. The loop drives a real
Chrome tab against the local Vite dev server (`http://localhost:5173`) and screenshots
that, not `xcrun simctl`.

## Screens with a design reference

| `<SCREEN>`          | route                             | `<REF>`                              | notes                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| splash              | `/splash`                         | `design/splashscreen.png`            | Built (`src/components/SplashScreen.tsx`) — refine pass                                                                                                                                                                                                                                                                                        |
| appboot             | `/splash` (2nd state)             | `design/appboot.png`                 | Not built. Second visual state of the same route — the org-provisioning checklist (Secure connection → Loading data → Setting up organisation → Preparing features → Finalising) shown after auth resolves, before splashscreen's plain logo view hands off to `/app/dashboard`. Confirm the exact trigger/transition while building this one. |
| login               | `/login`                          | `design/signin.png`                  | Built (`src/pages/LoginPage.tsx`) — refine pass                                                                                                                                                                                                                                                                                                |
| signup              | `/signup`                         | `design/signup.png`                  | Gap — today it's a toggle inside `LoginPage.tsx`, not a standalone route. Build the route.                                                                                                                                                                                                                                                     |
| onboarding-org      | `/onboarding` step 1/5            | `design/Organisation-Onboarding.png` | Gap — `OnboardingPage.tsx` is a single-step stub today; this is the first step of a 5-step wizard                                                                                                                                                                                                                                              |
| onboarding-about    | `/onboarding` step 2/5            | `design/Organisation-about.png`      | Gap                                                                                                                                                                                                                                                                                                                                            |
| onboarding-team     | `/onboarding` step 3/5            | `design/Team-onboarding.png`         | Gap                                                                                                                                                                                                                                                                                                                                            |
| onboarding-plan     | `/onboarding` step 4/5            | `design/Plan-Selection.png`          | Gap                                                                                                                                                                                                                                                                                                                                            |
| onboarding-complete | `/onboarding` step 5/5            | `design/Onboarding-Complete.png`     | Gap                                                                                                                                                                                                                                                                                                                                            |
| dashboard           | `/app/dashboard`                  | `design/Workforce-Dashboard.png`     | Built (`src/pages/app/DashboardPage.tsx`) — refine pass                                                                                                                                                                                                                                                                                        |
| staff               | `/app/staff`                      | `design/staff.png`                   | Built (`src/pages/app/StaffPage.tsx`) — refine pass                                                                                                                                                                                                                                                                                            |
| rotabuilder         | `/app/rota`                       | `design/Rota-Builder.png`            | Built (`src/pages/app/RotaBuilderPage.tsx`) — refine pass                                                                                                                                                                                                                                                                                      |
| schedule            | `/app/schedule` (default)         | `design/Schedule-dashboard.png`      | Gap — new route (per `docs/SCREENS.md` §4/§5). Manager's default view/manage-published-rotas state.                                                                                                                                                                                                                                            |
| schedule-live       | `/app/schedule` (live state)      | `design/live-schedule.png`           | Same route as `schedule` — the staff-facing "Live" state with the green live badge and open-requests panel                                                                                                                                                                                                                                     |
| schedule-published  | `/app/schedule` (published state) | `design/published-schedule.png`      | Same route as `schedule` — post-publish confirmation state (unpublish action, publish history)                                                                                                                                                                                                                                                 |

| tokens only | `design/designsystem.png` |

## Screens with NO design reference

No mockup exists for these; layout is **inferred** from the nearest built/referenced
screen plus the tokens in `design/designsystem.png`. Run the loop against the closest
ref for surface/type/radius fidelity only — do **not** try to make them identical to it.

| `<SCREEN>`    | route                  | closest ref (inferred from)                         |
| ------------- | ---------------------- | --------------------------------------------------- |
| home          | `/`                    | `design/signin.png` (marketing panel/left column)   |
| locations     | `/app/locations`       | `design/staff.png` (table/list + filter bar layout) |
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
   - Navigate to `http://localhost:5173<ROUTE>` and take a screenshot. Save/compare
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
