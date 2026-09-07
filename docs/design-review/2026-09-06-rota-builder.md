# Design review. Rota builder, 6 September 2026

A dated snapshot, not current state. It records what the rota grid looked like on
`design/responsive-motion-and-rota-keyboard` at `bd88b15`, what was wrong with it,
and which of those things were fixed in the same pass. `docs/SAAS.md` remains the
plan of record; nothing here changes a capability's status.

- **Reviewed:** `http://localhost:5042/rota-builder-preview`, the DEV preview harness
- **Scope:** the branch's headline work. The rota grid, its keyboard path, its
  responsive behaviour. The `SetupPage` work uncommitted at the time was excluded.
- **Fixes:** four commits on `design/review-fixes`, branched from `bd88b15`
- **Evidence:** `rota-builder-before.png`, `rota-builder-after.png`,
  `rota-builder-mobile.png`, in this directory

## Why the review ran in a worktree

The main checkout was being written concurrently by another agent: the changed-file
count went from 13 to 20 between two consecutive `git status` calls, and
`docs/SAAS.md` had been touched ten seconds before it was read. Committing there
would have captured unfinished work belonging to that session, so the review ran
against a clean worktree at the branch's HEAD and the main checkout was left alone.

This is the shared-working-directory hazard the repo has hit before. Check
`git status` twice, a few seconds apart, before assuming a dirty tree is yours.

## First impression

The grid reads as a dense, calm operations tool rather than a dashboard, which is
what `docs/DESIGN.md` §1 asks for. Hierarchy is honest: the eye goes to the week
axis, then the shift chips, then Publish. The staff column pins, the header pins,
and the multi-week axis carries a `w/c` grouping label, which is what makes
twenty-one date columns navigable rather than countable.

The keyboard work is careful and its reasoning is written down. `KeyboardSensor`
was removed from dnd-kit with a stated reason (25px increments that address no
cell, and a fight with the chip's own Enter handler), the `M` shortcut is exposed
through `aria-keyshortcuts` and also stated in visible text, and the move is
narrated through an `aria-live` region naming both the person and the day.

What let it down was smaller and more literal: an empty cell drew the wrong
character, and the fixture every reviewer judges this screen against computed
impossible numbers.

## Findings

### F1. Every empty cell drew a comma. HIGH. Fixed

`src/components/rota/RotaGridCell.tsx`

The block's own comment reads "An empty cell shows a muted en-dash rather than
blank space, matching docs/design/Rota-Builder.png". The code rendered
`<span aria-hidden="true">, </span>`. Twenty-five cells on the preview week each
drew a stray comma. The intent was recorded; only the glyph was wrong.

### F2. Night shifts computed as 0h. HIGH. Fixed

`src/pages/RotaBuilderPreviewPage.tsx`

`mkShift` stamped `starts_at` and `ends_at` on the same date, so a `23:00-07:00`
shift ended eight hours before it began. `shiftNetMinutes` clamps a negative
elapsed time to zero, so the grid showed Daniel Lee and Olivia Garcia as `0h`
against a `37.5h` contract while drawing their two and four night shifts in the
same row. They now read `15h` and `30h`, being 7.5 net hours each after the
30-minute break.

The keyboard move handler had the same shape and would have collapsed a correct
overnight shift the moment it was moved. That path is the reason this branch
exists. It now carries the shift's own duration to the target day rather than
rebuilding both ends on it.

**The broken fixture was suppressing a real rule.** With `ends_at` in the past,
the unfilled Sunday night shift fell out of the `upcoming` filter, so
`open_shift` in `src/lib/rotaInsights.ts` never fired. With correct timestamps
the screen shows "1 issue blocks publication" and rings that chip. Confirmed by
reverting the file (banner absent), reloading, and restoring it (banner returns).
The warning is right: an unfilled night shift starting within the week is a
critical blocker by design.

The general lesson is worth keeping. A broken preview fixture does not only look
wrong. It silently disables the production rule engine running on top of it, and
the screen still looks plausible.

### F3. The empty cell's affordance failed every contrast threshold. HIGH. Fixed

`src/components/rota/RotaGridCell.tsx`

`text-content-muted/50` composites to `rgb(181,185,192)` on the white cell, which
is **1.97:1**. That is below the 4.5:1 text threshold and below the 3:1 non-text
threshold. The cell carries `border-transparent` until hover, so that dash was
the whole visual signal that a 148x50 target could be clicked. Dropping the
opacity modifier and keeping the token gives **4.83:1**.

Measured composited, not declared. Reading `rgba(107, 114, 128, 0.5)` as though
it were opaque gives 4.83:1 and would have passed the finding by. Any contrast
check on a Tailwind opacity modifier has to composite over the effective
background first.

### F4. The grid announced the move but never the position. MEDIUM. Fixed

`src/components/rota/ShiftChip.tsx`, `RotaGridCell.tsx`, `RotaGridRow.tsx`

The move flow was well covered; the resting state was not. The date header
carries `aria-hidden="true"` and the staff column is a sibling of the cells
rather than an ancestor, so neither reaches a chip through the accessibility
tree. Tabbing the grid read twenty-five shifts all called "07:00-15:00 Morning"
and twenty-five buttons all called "Add shift". On a screen whose stated purpose
is working without a mouse, you could move a shift without knowing which one you
were on.

Each cell now derives its position once and hands it to both. A chip reads
"Sarah Johnson, Mon 31 Aug, 07:00 to 15:00, Morning"; an empty cell reads "Add a
shift. Sarah Johnson, Thu 3 Sep". Overnight shifts pick up "the next day" from
the existing `describeTimeRange`, matching the `+1` the chip already draws.

### F7. Every chip state ring was invisible in dark mode. HIGH. Fixed

`src/components/rota/ShiftChip.tsx`

Found by the `/qa` pass on 7 September, not by the design review, because the
review only looked at light. Four states lost their colour in dark: the live
edge, selection, the moving ring, and the conflict ring that the grid legend and
the publication banner both point at. A rota could say "1 issue blocks
publication" while the offending chip looked identical to its neighbours.

`paletteTintForColour` returns a class string ending in
`dark:ring-shift-<hue>/25`. `cn` is tailwind-merge, so it correctly drops the
tint's _plain_ ring in favour of the state's. A `dark:` ring is a different merge
group, so it survives, and then outranks a plain ring under `.dark` on
specificity. None of the four state rings carried a `dark:` variant, so there was
nothing to outrank the tint. Each now repeats itself as a `dark:` variant.

Measured on the conflicted chip: `rgba(108,160,235,0.25)`, the Night tint,
before; `rgb(217,74,58)`, `danger.DEFAULT`, after. Selection now paints
`rgb(59,111,224)`. Light mode measured before and after and unchanged.

`jobTitlePalette` is the only other tint carrying `dark:ring-*`. `JobTitleBadge`
layers no state ring over it and `JobTitlesSection`'s swatch already pairs
`ring-content dark:ring-content-dark`, so `ShiftChip` was the only instance.

**The general rule.** Any state ring layered over a palette tint has to repeat
itself as a `dark:` variant, and the only way to check is to read
`getComputedStyle(el).boxShadow` in both themes. Reading the class list tells you
nothing, because the class that loses is still in it.

## Open. Not fixed

### F5. The keyboard hint sits below the fold. MEDIUM

`src/components/rota/RotaGrid.tsx`

The hint "select one and press M to move it with the arrow keys" renders at
y=1046 on a 900px viewport, below the entire grid. Its own comment reads "A
keyboard shortcut nobody is told about is a keyboard shortcut nobody has", and
then places it where a user has to scroll past every row to find it.
`aria-keyshortcuts` covers assistive tech. Sighted keyboard users are who this
text is for, and they are the ones who will not see it.

Worth trying: beside the grid toolbar, or surfaced on chip focus.

### F6. Every staff name truncates on mobile. MEDIUM

At 375px the pinned staff column cuts "Sarah Jo...", "Michael ...", "Emily
Da...", "James ...", "Olivia G...", and every job title to "Senior Nur..." or
"Care Assis...". Two people sharing a forename cannot be told apart. The
horizontal-scroll hint and the sticky column are both right; the column is simply
too narrow for what it pins.

Left alone deliberately: the pinned width interacts with `rotaGridTemplate` and
the sticky offsets at every breakpoint, which is a layout change with real
regression risk rather than a styling one.

Also at 375px, roughly 430px of the 812px viewport is chrome before the first row
of data: search, date nav, view switcher, Publish, draft badge, Filters,
Auto-assign, Actions.

### F8. Reports scrolls the page sideways on a phone. MEDIUM

`src/components/reports/ReportsView.tsx:171`

Also from the `/qa` pass. At 375px `/reports-preview` gives a
`documentElement.scrollWidth` of 377 against a 375 client width. Every other
route measured 0 overflow. The leak is a `div.flex items-center gap-5 pb-2.5`
whose min-content is 353 inside a 327 grid track: a grid item defaults to
`min-width: auto`, so it refuses to shrink below its content and pushes the body.

The candidates are `flex-wrap` on that row or `min-w-0` on the track, and the
choice changes the layout at every breakpoint on a screen neither pass otherwise
reviewed.

## Corrected during the review

An early reading flagged the hour totals as carrying a stray space, "37. 5h".
That was wrong. The text content is exactly `37.5h`; the gap is JetBrains Mono's
advance width on the period, which is what a monospace figure column is for.
Recorded because the finding was nearly filed.

## Evidence

| Check                                                                  | Result                     |
| ---------------------------------------------------------------------- | -------------------------- |
| `npx tsc --noEmit`                                                     | PASS                       |
| `npx eslint` on the four changed files, `--max-warnings 0`             | PASS                       |
| `npx prettier --check` on the four changed files                       | PASS                       |
| `npm test`                                                             | PASS. 1115 tests, 65 files |
| Contrast, measured in-browser with alpha compositing, before and after | PASS                       |
| Accessible names read back from the live DOM, before and after         | PASS                       |

## Not verified

- `supabase test db` (pgTAP). Needs Docker. NOT TESTED
- `npx playwright test`. NOT TESTED
- `npm run check:bundle`, `check:docs`, `check:export`. NOT TESTED
- Dark mode. Every fix uses paired `dark:` tokens, but no dark screenshot was
  taken. NOT TESTED
- Real assistive technology. The accessible names were read from the DOM, which
  is not the same as hearing them announced. NOT TESTED
- Every screen other than the rota builder. NOT TESTED
