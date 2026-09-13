# Design review. Whole product, 9–11 September 2026

A dated snapshot, not current state. It records what the application looked like at
`07156ea` (`origin/main`), what was wrong with it, what was fixed in the same pass,
and what was deliberately left. `docs/SAAS.md` remains the plan of record; the
defects closed here have rows there (BUG-088 to BUG-105 and GAP-124; BUG-104 was dropped as a duplicate of the verification pass's GAP-118).

- **Reviewed:** every route in `src/App.tsx` except the ones listed under
  "What was not covered", driven in a real browser at 390px, 834px and 1440px, in
  both themes on the changed screens
- **Environment:** an isolated worktree, an isolated local Supabase stack on ports
  55521/55522, and a synthetic organisation (25 staff, 126 shifts across two sites,
  seven leave requests, deliberately long names). No production system was reached
  at any point, which was verified rather than assumed: every account the pass
  created was found in the local database afterwards.
- **Roles exercised:** owner, manager, staff, platform owner. Each signed in for
  real; none was simulated through a preview route.
- **Evidence:** `2026-09-10-rota-opens-on-anchor-week.png`,
  `2026-09-10-rota-no-site-empty-state.png`,
  `2026-09-10-onboarding-invite-step.png`, in this directory

## Why the pass ran in a worktree, again

Same reason as the 6 September review, and the hazard is now routine rather than
notable: another session held the main checkout, twice stopped the shared local
Supabase stack mid-run, and committed three changes to its local `main` while this
was in flight. The pass therefore ran on its own branch, against its own Supabase
stack on its own ports, and touched nothing in the main checkout.

One consequence is recorded honestly below: a blocker was found in a file that
session was actively editing, and it was left alone rather than fixed twice.

## What the product gets right

Worth stating, because most of this document is defects. The design system is real
and it is enforced: tokens rather than hex, one radius, `IconButton`, `EmptyState`,
`ScrollRegion`, `Field` and `Modal` genuinely owning their contracts. The modal
contract was spot-checked end to end and needed nothing — labelled by its heading,
scroll-locked, focus trapped, one control called Close, Escape working, focus
returned to the trigger chip.

The defects that follow are almost never styling. They are screens that opened on
the wrong data, empty states that blamed the reader, and copy that claimed things
the backend does not do.

## Fixed

### The rota builder opened on the previous week

The canvas is three weeks wide with the anchor week in the middle (`rotaCanvas.ts`)
and a scrolling element starts at `scrollLeft: 0`, so the builder opened showing
_last_ week. Measured: `scrollLeft` 0, the anchor week's first column at x=1221 in
a 1062px viewport. "Publish (126 changes)" and "1 issue blocks publication" both
described a week that was off the right-hand edge, and on a new organisation that
is a screen of empty cells.

`RotaBuilderPage` now aligns the viewport to the anchor week's own header cell when
the grid appears and whenever the week changes, subtracting the pinned staff column
so Monday is not underneath it. Aligned by geometry, not by column arithmetic, so it
survives a change to `WEEKS_BEFORE` or the column widths.

### The preview harness had been hiding it

`/app-preview/rota` drew one week, not the canvas, on the stated grounds that three
weeks would squeeze the columns. They do not: `rotaGridTemplate` sizes them
`minmax(6.5rem,1fr)`, so a wider canvas scrolls rather than shrinks. The harness
exists so a reviewer sees the real screen, and with seven columns there was no wrong
week to open on — the defect above could not have been found there. The preview now
draws the same canvas and opens the same way, and `e2e/rota-grid.spec.ts` asserts it
on every pull request rather than only in the live-Supabase job.

### Three empty states that told the reader the wrong thing

- **No site.** A brand-new organisation opening the builder got a bare sentence in a
  card, no page heading, and "See the Locations page" as an instruction rather than a
  link. It now keeps its title and offers **Go to Locations**.
- **No rows in the all-sites view.** The all-sites view lists only people who already
  have a shift somewhere, so a first rota cannot be started from it — and the copy
  blamed "this filter" to an organisation that had set none. Three cases now: nobody
  on the team yet (**Go to Team**), nobody rostered anywhere yet (**Show \<site\>**,
  which selects it), and a genuine filter miss.
- **The dashboard's cover chart.** An empty `coverByDate` rendered the 200px grid with
  no children: a blank box under a heading, indistinguishable from a chart that failed.

### Colour carrying meaning on its own

The cover chart drew "short of the minimum" as a red bar and a red number, with an
unexplained dashed line for the minimum itself. A three-part text legend now names
all three, per §5's rule that a status colour is never the only identifier.

The clock-in ring was green whenever the stage was `ready`, which includes "No shift
scheduled", "Opens at 07:00" and "Shift has ended" — the on-shift green next to words
saying there was nothing to clock in to. The ring now follows whether the window is
actually open.

### Copy that was not true

- `Monday. Sunday`, `Monday. Friday`, `Sunday. Saturday`, `Saturday. Friday`. An
  em-dash purge had eaten four range labels in the onboarding wizard.
- "You can change roles and permissions later from Settings > Team." There is no such
  screen. It is Settings > Permissions.
- Team showed **Rostered 0.0h** for 25 people who had 126 shifts between them, because
  the column counts published rotas only and said so nowhere. The dashboard already
  explained this; Team now does too.
- Reports said **"No shifts in this range"** under a caption reading "Every shift on
  the rota, assigned or still open", while `getShiftReportRows` asks for
  `publishedOnly: true`. A week of draft shifts read as a week with no shifts.
- The rota search box carried a **⌘ K** hint. ⌘K opens the global command palette;
  it has never focused that box.
- Choosing **Professional at £129** and pressing Continue produced no visible change of
  any kind. The choice is an intent — `organisations.plan` is written by the Stripe
  webhook — so the organisation runs on the free Starter tier until billing is set up,
  and the first sign of that was the database refusing a second site several screens
  later. The step now says so.

### Onboarding

The step 3 illustration was drawn over the fourth feature's body text: both panel
illustrations are `absolute bottom-0 w-full` on a 460×240 viewBox, and the longest
panel's content reached into them. The aside now reserves the illustration's own
height as `pb-[52%]`, which resolves against the width exactly as the SVG's height
does.

Industry was asked twice, on step 1 and again on step 2, pre-filled on the second
from the first — so the wizard appeared to have forgotten an answer given one screen
earlier. It is asked once, on step 2, beside the country and timezone it belongs
with. Step 2 also showed a brand-filled **Add location** button beside a primary
location editor that was already open below it; all that button did was add a second
blank row. It now appears only once the first site has a name, reads "Add another
location", and is no longer styled as the step's primary action — which Continue is.

### The platform console

Inspected for the first time in this pass, as a real `platform_owner`.

- `/admin/billing` scrolled the whole page sideways on a phone, 477px against 390.
  The invoices panel is a grid item with no `min-w-0`, so it refused to shrink below
  the table's min-content width and the `ScrollRegion` inside it never got the chance
  to scroll. This is the same defect class as BUG-085, on a route that pass never
  reached.
- The mobile navigation trigger — the only way to reach any other console screen on a
  phone — was a 32px square.
- `/admin/notifications` and `/admin/integrations` logged React duplicate-key warnings
  on every render: a hand-rolled `<colgroup>` keyed by the width class, and two columns
  sharing a width are still two columns.

### One shared component that had been lying

`ui/DataTable` hand-rolled its own scroller: the focusable `role="region"` and the
`tabIndex`, but not the measured overflow cue or the edge fade. So nine platform
console tables scrolled in complete silence, with columns off the right-hand edge and
nothing on the page saying so — while `docs/DESIGN.md` said it "carries the same
treatment internally". It now renders through `ScrollRegion`. One scroller, one
contract, and the documentation is true.

That change also surfaced a latent fragility: `ScrollRegion` constructed a
`ResizeObserver` unguarded, so any component test rendering a table through it threw
before its assertions ran. It is guarded, and falls back to the single measurement it
already takes on mount.

### Hit targets

A sweep measured every control on nineteen routes. Fixed: the sidebar collapse (30px)
and account menu (28), the password reveal on three screens (28), the rota week
steppers (30, and no focus ring), the Publish split-button chevron (31px wide),
report favourite stars (28), the reports filter selects (a 20px select inside a 44px
box that was not itself clickable), both chart "Show figures" toggles (16px, one with
no focus ring at all), sortable column headers (17), tab strips (34), the rota
segmented switcher and filter chips (30–32), admin pagination (30–36), and the mobile
console navigation trigger (32).

Two controls keep a small visible shape and gained an expanded hit area instead:
`ui/Toggle` is 44 tall while still looking like a 24px switch, and the rota chip's
delete × reaches 32 rather than 44 because a 44px target on the corner of a 110×44
chip would cover a quarter of it and delete shifts people meant to open. The shift
editor's full-size **Remove** is the unhurried path.

`docs/DESIGN.md` §5 now states the floor these were measured against, because none of
those numbers came from a rule — each was decided once, locally.

### Long content

`/legal/privacy` and `/legal/terms` scrolled sideways at 390px (398px and 413px) on
unbreakable file paths in the "Checkable in:" lines.

## The one both passes found, and a wrong claim about it

**The staff dashboard crashed to the error boundary.** `TypeError: Cannot read
properties of null (reading 'locations')` at `StaffDashboard.tsx:43`, on three of
three loads at every viewport — the screen a staff member lands on first.

`DashboardPage`'s `finally { setLoading(false) }` was the only write in that function
with no `token !== requestToken.current` guard, so a superseded load — the
organisation changed, or the user did — returned early at its own token check leaving
`overview` null, then cleared `loading` anyway. `overview={overview!}` rendered that
null, and a non-null assertion removes the compiler's objection to a null rather than
the null.

**The other session got there first, and this document said otherwise for two days.**
It was left alone on the 10th because that session was editing the file. On the 11th
this pass checked whether their committed work closed it, looked at `main`, found the
old code, and recorded that it did not. `main` was the wrong ref: their work was on
`fix/verification-pass-2026-09-10`, and `a1ca604` — committed 10 September at 08:10,
before this pass looked — fixes it the same way, with a token-guarded `finally`, a
real null check and the same `timezone` prop. It also carries
`e2e/staff-dashboard.spec.ts`, which seeds a staff account and signs in as one in the
`e2e-authenticated` job. That is better coverage than anything this pass added for it,
and it is the version kept on merge.

The check that produced the wrong claim cost nothing and would have caught it:
compare against the branch, not against `main`, when the question is what another
branch contains.

What survives from this side is the independent reproduction — on a clean stack, as a
real staff member with a real membership, confirming the defect was in the product
rather than in one machine's state — the unit tests below, and one defect the other
pass did not see:

**And one found while verifying it.** The staff dashboard greeted everyone "Good
morning" at every hour of the day, with the date beside it formatted in the browser's
timezone rather than the organisation's. This is a product for people who work
nights. `greeting(now, timezone)` now lives in `dashboardFormat.ts` with unit tests
covering the 22:00 shift start, a cross-timezone instant and a clock-change date.

## Left alone on purpose

- **Inline text links** in prose and footer lists stay at their text height. WCAG's
  own target-size criterion exempts them, and a 44px-tall "Privacy" in a column of ten
  would be a worse page.
- **`Button size="sm"` at 36px** in dense table rows and toolbars. That is the
  documented compact size, now with a written rule behind it.
- **The all-sites rota view listing only rostered people.** It is a summary of what is
  rostered, which is a defensible design; what was wrong was the empty state, and that
  is fixed.

## What was not covered

- **`supabase test db` (pgTAP) and the two Supabase CI jobs.** Not run.
- **Real devices.** Everything was measured in headless Chromium at three viewport
  widths. No iOS or Android hardware, and no real touch input.
- **Screen readers.** The accessible names, roles, focus order and dialog behaviour
  were asserted programmatically. Nobody listened to a screen reader read these
  screens, so no claim is made about how they sound.
- **`/admin/*` detail routes** behind a row — organisation detail, user detail, support
  case detail — were reached only through their list screens, not exercised in full.
- **Email, Stripe checkout, push notifications, and anything that leaves the machine.**
  Not triggered.
