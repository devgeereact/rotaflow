# Screen-building loop prompt

A reusable, fill-in-the-blanks prompt for building or refining a RotaFlow screen
against its `../design` reference image, iterating with real browser screenshots
until it's visually near-identical. This project is a web PWA (Vite + React
Router) — there's no mobile simulator, so the loop drives an actual Chrome tab
against the dev server instead.

## How to use it

1. Copy the template below.
2. Fill in the four placeholders: `{SCREEN_NAME}`, `{ROUTE}`, `{DESIGN_FILE}`,
   `{TARGET_FILE}`.
3. Paste it in, or hand it to `/loop` for repeated passes on the same screen.

Ready-made fill-ins for the three real screens are at the bottom — copy one of
those directly instead of filling the template by hand.

---

## Template

```
Build/refine the {SCREEN_NAME} screen by closely recreating the UI from
@design/{DESIGN_FILE}.

Your goal is to match the reference design as accurately as possible, including:
* Layout and spacing
* Typography, font sizes, and font weights
* Colors and gradients
* Button styles
* Input fields
* Border radius
* Shadows and depth
* Icons and imagery
* Alignment and padding
* Overall visual hierarchy

Ground rules — this project has an enforced design system, don't invent outside it:
* Use token classes only (`bg-primary`, `text-content`, `rounded-2xl`, `shadow`,
  etc.) from `tailwind.config.ts` / `docs/DESIGN.md`. Never raw hex values and
  never inline `style={{}}`.
* Icons are `lucide-react` only — no ad-hoc SVGs, no second icon set.
* Reuse/extend primitives in `src/components/ui` (`Button`, `Card`) instead of
  duplicating styles inline; add a new primitive there if the reference needs
  one that doesn't exist yet.
* `docs/DESIGN.md` is the tie-breaker for anything ambiguous in the image —
  re-read it rather than guessing.
* The reference image is light-mode only, but every surface still needs a
  working `dark:` variant per `docs/DESIGN.md` §1 — don't defer dark mode.
* Main implementation file: `{TARGET_FILE}` (plus any child components it
  composes).

Do not redesign or improvise unless something is genuinely missing from the
reference.

After implementing the first version, run it and take a screenshot:
1. Make sure `npm run dev` is running (start it in the background if not).
2. Load the Chrome tools if not already loaded (ToolSearch:
   "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp").
3. Navigate to `http://localhost:5173{ROUTE}` in a tab and take a screenshot.
4. Compare that screenshot against @design/{DESIGN_FILE}.

Then iterate:
1. Identify all visual differences.
2. Update the implementation.
3. Take another screenshot.
4. Compare again.
5. Repeat until the implemented screen is visually as close to the reference
   as possible.

Be strict with the comparison. Pay attention to small details: spacing, text
positioning, input/button height, shadow depth, icon choice and size, color
accuracy, and border radius.

Do not stop after the first implementation. Keep refining until the screenshot
and the reference design look nearly identical. When done, run
`npm run typecheck` and `npm run lint` and fix anything they flag before
considering the task complete.
```

---

## Ready-made fill-ins

### 1. Auth / Login — refine pass
Already implemented; this is a visual-accuracy pass, not a build from scratch.

```
{SCREEN_NAME} = Login
{ROUTE}       = /login
{DESIGN_FILE} = authscreen.png
{TARGET_FILE} = src/pages/LoginPage.tsx
```

### 2. Splash / loading screen — new
`splashscreen.png` has no route or component yet. Before running the loop,
decide (and tell Claude) which of these it should be:
- a real route (e.g. `/splash`) for manual preview only, or
- an app-boot overlay shown from `../src/main.tsx` while the app initializes, or
- a component composed into `App.tsx`'s existing loading/suspense state.

```
{SCREEN_NAME} = Splash / app loading screen
{ROUTE}       = <decide first — see note above>
{DESIGN_FILE} = splashscreen.png
{TARGET_FILE} = <new file, e.g. src/components/SplashScreen.tsx>
```

### 3. Dashboard / Rota grid — largest scope
`../src/pages/DashboardPage.tsx` is currently a bare profile/settings stub — this
is a full build, not a tweak, and `rotaflowui.png` depicts more than one
screen's worth of UI at once. **Scope the loop to the main dashboard/rota-grid
region only** (sidebar nav + header + rota grid + right-hand panels) — ignore
the small phone mockups and the "DESIGN SYSTEM" strip along the top of the
image, those aren't part of the routed page. Expect to run this loop multiple
times, narrowing scope each pass (e.g. shell + sidebar first, then the grid
table, then the coverage/warnings/publish panels).

```
{SCREEN_NAME} = Dashboard (rota grid view)
{ROUTE}       = /dashboard
{DESIGN_FILE} = rotaflowui.png
{TARGET_FILE} = src/pages/DashboardPage.tsx
```
