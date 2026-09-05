# Design System & Visual Guidelines. RotaFlow

> Source of truth: `docs/design/designsystem.png`, `docs/design/rotaflowui.png`,
> `docs/design/signin.png`, `docs/design/splash-screen.png`. This document and
> `tailwind.config.ts` are the enforced, code-level expression of those
> references. **Every future screen, component, or asset must match this
> document, never invent a colour, size, or radius outside it.**
>
> A rejected alternative is kept at `docs/DESIGN_EXPLORATION.md` — a 2026-08-13
> proposal that was **not** adopted. It is linked here so it stops being an
> orphan nobody can place: read it as a record of a decision taken, not as a
> direction to follow. This document stays the enforced one.
>
> An external design review dated 2026-09-05 proposed the mobile page-title
> size, the named motion durations, the responsive header contract and the
> state vocabulary now in §4, §7 and §8. Those are **adopted and written down
> here**, which is the point: a review document that keeps its own copy of the
> rules becomes a second source of truth and then drifts. There is one canonical
> design guide in this repository and it is this file, paired with
> `tailwind.config.ts`.

## 1. Aesthetic direction

**Clean & professional**, a trusted-tool feel in the spirit of Linear, Notion and
Stripe. Crisp, calm, and neutral, with dense-where-it-needs-to-be layouts (the rota
grid) and generous breathing room everywhere else. Motion supports meaning (a shift
snapping into place, a sync completing) and never decorates for its own sake. The
product must feel dependable to a care-home manager and effortless to frontline staff.

**Theme: light-first.** RotaFlow ships **light by default**. Every reference
screen (auth, splash, dashboard, rota grid) is light. Dark remains a fully
supported, deliberate user choice (see the mode switch in `rotaflowui.png`), not
the default. `ThemeContext` defaults to `'light'` for first-time visitors and
persists an explicit user choice; it never silently forces dark from
`prefers-color-scheme` the way the old (pre-design-system) build did. Every
surface must still read correctly in both modes. Build dark variants
alongside light ones, don't defer them.

## 2. Design tokens

These are the tokens this document defines. `tailwind.config.ts` is the runtime source
of truth and currently carries more than are listed here — `primary.ink`, `success.ink`,
`warning.ink`, `danger.ink`, `brand.*`, `ink.*`, `clock.*`, `avail.*`, `shift-tint.*`,
`leave.*`, `shift-deep.*`, plus wordmark type and lockup spacing. Read the config when
the two disagree, and treat an undocumented token as legal if the config defines it. **Always use the token class, never a raw
hex.** Token values below are the **light** (base, default) palette. Pair every
one with a `dark:` variant using the dark column, e.g.
`bg-background dark:bg-background-dark`.

### Colour. Brand & neutrals

| Token               | Tailwind class                                              | Light hex | Dark hex  | Use                                                                                    |
| ------------------- | ----------------------------------------------------------- | --------- | --------- | -------------------------------------------------------------------------------------- |
| Background (canvas) | `bg-background` / `dark:bg-background-dark`                 | `#F5F7FA` | `#0B1220` | App canvas, behind cards                                                               |
| Surface (default)   | `bg-surface` / `dark:bg-surface-dark`                       | `#FFFFFF` | `#111A2E` | Cards, sheets, panels, rota cells                                                      |
| Surface subtle      | `bg-surface-subtle` / `dark:bg-surface-subtle-dark`         | `#FAFBFC` | `#15203A` | Nested panels, hover fills, sidebar                                                    |
| Surface rail        | `bg-surface-rail` / `dark:bg-surface-rail-dark`             | `#FAFBFC` | `#0E1729` | Navigation rail. Light matches `surface-subtle`; dark deliberately does not. See below |
| Surface border      | `border-surface-border` / `dark:border-surface-border-dark` | `#E3E6EA` | `#22304D` | Card/control outlines                                                                  |
| Divider             | `border-divider` / `dark:border-divider-dark`               | `#F2F4F6` | `#1B2740` | Subtle in-list separators (lighter than border)                                        |
| Primary             | `bg-primary` / `text-primary`                               | `#3B6FE0` | `#3B6FE0` | Brand, CTAs, active state, links                                                       |
| Primary foreground  | `text-primary-fg`                                           | `#FFFFFF` | `#FFFFFF` | Text/icons on a solid primary fill                                                     |
| Primary wash        | `bg-primary-wash` / `dark:bg-primary-wash-dark`             | `#EEF3FD` | `#182848` | Hovered/selected rows and nav items, **not** `primary/10`, see below                   |
| Secondary           | `text-secondary`                                            | `#6B7280` | `#94A3B8` | Secondary icons/labels (same value as content-muted; kept as a distinct semantic name) |
| Text primary        | `text-content` / `dark:text-content-dark`                   | `#16191F` | `#F8FAFC` | Headings, body                                                                         |
| Text muted          | `text-content-muted` / `dark:text-content-muted-dark`       | `#6B7280` | `#94A3B8` | Captions, hints, secondary text                                                        |

### Colour. Semantic (operational status)

| Token    | Tailwind class                | Hex       | Use                                              |
| -------- | ----------------------------- | --------- | ------------------------------------------------ |
| Valid    | `bg-success` / `text-success` | `#1EA06B` | Published, valid, confirmed, available, on-shift |
| Warning  | `bg-warning` / `text-warning` | `#E0A030` | Pending, needs attention, expiring soon          |
| Conflict | `bg-danger` / `text-danger`   | `#D94A3A` | Conflict, rejected, absent, error                |
| Info     | `bg-info` / `text-info`       | `#388FD4` | Informational note, neutral status               |

Same hex in both themes. These need to stay recognisable regardless of mode.
Status colours encode rota state, **always pair them with an icon or text
label**, never colour alone (accessibility + colour blindness).

#### Washes. The surface a status sits on

| Token        | Tailwind class                                  | Light     | Dark      |
| ------------ | ----------------------------------------------- | --------- | --------- |
| Valid wash   | `bg-success-wash` / `dark:bg-success-wash-dark` | `#E7F5EE` | `#102A21` |
| Warning wash | `bg-warning-wash` / `dark:bg-warning-wash-dark` | `#FBF2E1` | `#2C2416` |
| Danger wash  | `bg-danger-wash` / `dark:bg-danger-wash-dark`   | `#FAEAE7` | `#2E1A17` |
| Info wash    | `bg-info-wash` / `dark:bg-info-wash-dark`       | `#E8F2FA` | `#12253A` |

**Use these, never `success/10`.** An alpha of the solid hue lands on a
different colour over `surface` than it does over `background`, so a status pill
drifted every time it moved between a card and the canvas, and the same pill in
a table row, a callout and a feed read as three shades. The washes are opaque,
so a pill is identical wherever it is placed. The dark values are separate
sampled colours, not inversions: a light wash over `surface-dark` blows out.

Pair a wash with its solid token as the ink (`bg-danger-wash text-danger`), and
add `ring-1 ring-inset ring-<token>/30` where the chip needs an edge.

Both these and `surface-rail` / `primary-wash` above come from the platform
console reference, `docs/PLATFORM_CONSOLE.html`. The interactive artifact the
`/admin/*` rebuild is being matched against, screen by screen.

### Colour. Shift type palette (8)

Used for shift-type chips in the rota grid (`LD`, `WN`, `TW`, `SPL`, `EAR`, `OFF`,
`TRN`, `ANN` and similar org-defined codes. See `shift_types.colour` in
`docs/SCHEMA.md`). Same in both themes.

| Token          | Tailwind class    | Hex       |
| -------------- | ----------------- | --------- |
| `shift-clay`   | `bg-shift-clay`   | `#E28273` |
| `shift-amber`  | `bg-shift-amber`  | `#C69A45` |
| `shift-moss`   | `bg-shift-moss`   | `#86AC6A` |
| `shift-teal`   | `bg-shift-teal`   | `#4FB39A` |
| `shift-sky`    | `bg-shift-sky`    | `#56AACD` |
| `shift-indigo` | `bg-shift-indigo` | `#6CA0EB` |
| `shift-violet` | `bg-shift-violet` | `#C48FD6` |
| `shift-rose`   | `bg-shift-rose`   | `#E888AB` |

An org's `shift_types.colour` should be seeded from this palette (stored as a hex
string, per `SCHEMA.md`) so every tenant's rota stays visually consistent with the
system even though colours are per-org-configurable.

### Typography

| Role            | Size / line-height | Weight    | Tailwind class                       |
| --------------- | ------------------ | --------- | ------------------------------------ |
| Page title      | 32 / 40            | Semibold  | `text-page-title font-semibold`      |
| Section heading | 24 / 32            | Semibold  | `text-section-heading font-semibold` |
| Card heading    | 16 / 24            | Semibold  | `text-card-heading font-semibold`    |
| Body            | 16 / 24            | Regular   | `text-base`                          |
| Small           | 14 / 20            | Regular   | `text-sm`                            |
| Caption         | 12 / 16            | Regular   | `text-xs`                            |
| Code / meta     | 12 / 16            | Monospace | `text-xs font-mono`                  |

Font family: **Inter Variable** throughout (`font-sans` / `font-display`, one
face, no separate display typeface). `font-mono` is **JetBrains Mono**, used for
times, hours, and payroll figures so columns align.

### Spacing & radius

- Base unit = 4px (Tailwind default: `4px·8px·12px·16px·24px·32px·48px·64px` =
  `1·2·3·4·6·8·12·16`). Prefer `gap-*` / `space-y-*`.
- Radii: **one value for the whole product, `0.5rem` (8px)** (owner's decision,
  2026-08-05). Every named size token resolves to it, so `rounded-sm`,
  `rounded-lg` and `rounded-2xl` are interchangeable; **prefer `rounded-lg`** in
  new code. The aliases exist only so the ~350 existing usages did not have to be
  rewritten to say the same thing. Do not add arbitrary radii
  (`rounded-[10px]`). There were four, and they have been folded in.
  `rounded-full` is **not** covered by this: it is a shape, not a radius. Avatars,
  status dots and pills stay round.
- Lean on `border-surface-border` + subtle surface contrast over heavy shadows.

### Shadows (elevation)

`shadow-sm` / `shadow` / `shadow-lg` are overridden in `tailwind.config.ts` to
match the reference exactly. Use the stock Tailwind class names, don't invent
new ones.

| Level | Tailwind class     | Spec                          |
| ----- | ------------------ | ----------------------------- |
| 1     | `shadow-sm`        | `0 1px 2px rgba(0,0,0,0.05)`  |
| 2     | `shadow` (default) | `0 4px 12px rgba(0,0,0,0.08)` |
| 3     | `shadow-lg`        | `0 8px 24px rgba(0,0,0,0.12)` |

## 3. Iconography

**Lucide** (Feather-style, outline), via the `lucide-react` package, never
inline ad-hoc SVGs, never a second icon set. Standard sizes: `16px` (`size={16}`
/ `w-4 h-4`) inline with text, `20px` default UI icon, `24px` (`w-6 h-6`)
featured/empty-state icons. Icon-only controls require `aria-label`.

## 4. Motion

**Durations are named, not typed.** `tailwind.config.ts` carries four, and a new
control picks the role rather than a number:

| Token               | Value | For                                                  |
| ------------------- | ----- | ---------------------------------------------------- |
| `duration-press`    | 100ms | a button's own press/hover transform                 |
| `duration-control`  | 140ms | hover/focus colour on any control, row, link or tile |
| `duration-overlay`  | 180ms | a menu, popover, dropdown or dialog appearing        |
| `duration-entrance` | 300ms | the `animate-fade-up` entrance                       |

| Interaction       | Spec                                                          |
| ----------------- | ------------------------------------------------------------- |
| Hover (buttons)   | `scale: 1.02`, `duration-control`, `easeInOut`                |
| Tap               | `scale: 0.98`                                                 |
| Shift drag/drop   | ghost preview while dragging; stable drop target              |
| Page/section in   | `animate-fade-up` — an _entrance_, never replayed on refetch  |
| Sync/save confirm | brief, non-blocking, and only after the write actually landed |
| Reduced motion    | see below — durations **and** transforms                      |

**Never `transition-all`.** Name the properties that change. There are none in
the tree today and the count should stay at zero: `transition-all` animates
`height`, `width` and `top` as a side effect and produces the layout jitter that
reads as a rendering bug.

`Button` exports `CONTROL_MOTION`, the shared property list plus its
reduced-motion handling. Use it on a new control rather than composing a
transition by hand.

**Reduced motion is two separate jobs.** `src/index.css` collapses every
_duration_ to ~0 under `prefers-reduced-motion`, which is necessary and not
sufficient: a `scale(1.02)` with no transition still scales, instantly. The
transform has to be removed as well, with
`motion-reduce:hover:scale-100 motion-reduce:active:scale-100` (or
`motion-reduce:transform-none`), and every entrance carries
`motion-reduce:animate-none`. `e2e/responsive-and-motion.spec.ts` asserts both
halves by measuring the rendered box, and asserts the transform is still there
when motion _is_ allowed — otherwise the test would pass equally well if the
effect had simply been deleted.

Do not animate table rows, animate counters, or replay a page entrance after a
filter or a refetch. Preserve scroll, focus, filters and selection through a
save. `animate-fade-up` is the only animation mechanism in the product; Framer
Motion was a dependency until 2026-08-31 and was never imported by anything.

## 5. Accessibility (frontline-critical)

- Contrast ≥ **4.5:1** for text (AA), **verified and gated at zero in both themes**
  across the 13 public pages and the 26 authenticated screens
  (`e2e/app-surface.spec.ts`). This line used to claim as much on no evidence:
  nothing had ever scanned dark mode, and when something did it held ~200
  violations — more than light mode carried. Both were cleared on 2026-08-30
  (`docs/SAAS.md` GAP-030, GAP-032).
- **A status colour becomes text through its ink pair:
  `text-{tone}-ink dark:text-{tone}-ink-dark`.** Both halves, every time. This
  covers a form error, a menu item, a chip's label and a link — anywhere the
  colour is on _words_. It does not cover an icon, which is not text.

  The axe gate reads 0 in both themes and that is not the same as the rule being
  kept: the gate scans what it can _open_, and 68 uses of a bare fill token as
  text survived inside dialogs, onboarding steps and error branches that no
  scan reaches. They were swept on 2026-09-05. When you add a modal, check its
  error text by hand; nothing automated will. The
  `DEFAULT` is a FILL — it runs 2.02–4.29:1 as small text on white and 3.15–4.47:1
  on a dark surface, so neither `text-warning` nor `dark:text-warning` is a text
  colour. And an `-ink` with no dark pairing is worse than none: the light ink
  carries into dark mode at 2.5:1, so fixing one theme breaks the other.

- **Muted grey does not go on a tinted panel.** `content-muted` is designed against
  white and lands 4.23–4.49:1 on the washes — under the line, and a hundredth under
  is under. Use `text-content` there; the semibold heading above it is what carries
  the hierarchy.
- Interactive targets ≥ **44×44px**. Staff use this one-handed on phones. This is
  a stronger product rule than WCAG 2.2 AA's 24px minimum, which has exceptions
  this product does not want to rely on. Icon-only controls use
  `ui/IconButton` (44×44 by default); its `sm` size is 36px and is for a control
  inside a dense table row only, never for a page or dialog action.
- **A horizontally scrolling area must be reachable and must say it scrolls.**
  `overflow-x-auto` on a bare `div` is draggable with a pointer and completely
  unreachable with a keyboard, and it gives no sign that anything is off screen.
  Use `ui/ScrollRegion`: a labelled `role="region"` with `tabIndex={0}`, plus an
  edge fade and a line naming the gesture, both shown only while the content
  actually overflows. `ui/DataTable` carries the same treatment internally.
- **A dialog has exactly one control called Close.** The backdrop is a pointer
  affordance, `aria-hidden` and not focusable; Escape and the Close button are
  the accessible ways out. A dialog also locks background scrolling, takes its
  accessible name from the rendered heading via `aria-labelledby`, and returns
  focus to whatever opened it.
- Every focusable element shows a ring: `focus-visible:ring-2 focus-visible:ring-primary`.
- Images require `alt`; icon-only buttons require `aria-label`.
- Never convey shift/leave/clock state by colour alone. Pair with icon + text.
- **Every drag has a keyboard equivalent that addresses the same thing the drag
  does.** On the rota grid that is `M` on a focused shift, then the arrow keys
  to choose a person and a day, `Enter` to commit and `Escape` to cancel — the
  landing cell is ringed, the target is announced through a polite live region,
  and focus returns to the chip after the move.

  dnd-kit's `KeyboardSensor` was registered and was worse than nothing: it
  translates by a fixed pixel step that addresses no particular cell, and its
  Enter/Space activation fired alongside the chip's own click, so pressing
  Enter both opened the editor and started an unaimable drag. A sensor that
  technically responds to a key is not a keyboard alternative. Both paths
  commit through one `moveShiftTo`, so they cannot disagree about clash
  checking or timezones.

- **Announce a shortcut in two places or it does not exist**: `aria-keyshortcuts`
  on the control for assistive technology, and a line of visible text for
  everyone else.

## 6. Component conventions

- Build from small primitives in `src/components/ui` (`Button`, `Card`, `Badge`,
  and rota primitives like `ShiftChip`, `RotaCell` as they're added).
- A `cn()` helper (clsx + tailwind-merge) resolves conditional class conflicts.
- Variants are prop-driven class maps, not a new component per style.
- Buttons: **primary** = solid `bg-primary` fill, white text. **secondary** =
  `bg-surface` + `border-surface-border`, `text-content` (a bordered neutral
  button. This is what earlier drafts of this doc called "ghost"). **ghost** =
  transparent, `text-primary-ink dark:text-primary-ink-dark`, no border — the
  ink pair, both halves, because on a `ghost` control the colour _is_ the label
  and `text-primary` measures 4.08:1. Also **success**, **warning**, **danger**,
  **danger-outline**, and **clock** — the attendance CTA, the one place the
  `clock` green is a button fill, kept as a variant so the exception stays
  countable instead of being hand-rolled on each screen.
- **Extend the existing components; do not add a second UI library.** A new
  abstraction needs two real consumers before it exists.
- Density matters: the rota builder is information-dense by design; keep chrome
  quiet so the schedule itself is the focus.

### The shared primitives, and what each one owns

| Component                | Owns                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ui/HeaderBar`           | The title/action row and the responsive stack. `PageHeader` and `WorkspaceHeader` both use it                                |
| `ui/Button`              | Every variant, size, loading and disabled treatment, focus ring, and `CONTROL_MOTION`                                        |
| `ui/IconButton`          | An icon-only control with a real 44×44 hit area and a required `label`                                                       |
| `ui/Field`               | Label, hint, inline error, required and disabled-reason — with `aria-describedby` and `aria-invalid` wired, in a fixed order |
| `ui/Modal`               | Focus trap and return, scroll lock, `aria-labelledby`, an unsaved-changes guard                                              |
| `ui/ScrollRegion`        | A labelled, keyboard-reachable horizontal scroller with a measured overflow cue                                              |
| `ui/MobileDisclosure`    | A `<details>` on a phone, a plain section on a desktop                                                                       |
| `ui/EmptyState`          | The four empty situations, with the caller choosing which                                                                    |
| `ui/StatTile`            | A metric tile, `compact` for the phone-tightened variant                                                                     |
| `rota/PublicationStatus` | Rota state as a neutral chip, separately from what blocks publication                                                        |
| `ui/PreviewCanvas`       | Standalone page padding for a `*PreviewPage`, suppressed inside `AppShell`                                                   |

A **field's order is fixed**: label, control, hint, error. The hint stays
visible when an error appears — "must be at least 8 characters" is what explains
"Password is too short".

- **Sidebar nav, active item:** solid fill, `bg-primary text-primary-fg`, per
  `docs/ORGANISATION_WORKSPACE.html`'s `.nav a[aria-current="page"]`
  (2026-08-06), the organisation workspace shell reference. Superseded the
  earlier soft-tint idiom (`bg-primary/10 text-primary`, same `bg-X/10 text-X`
  treatment as status badges), which itself had replaced a white pill and a
  left-border accent (2026-07-31). `src/components/layout/Sidebar.tsx`'s
  `LINK_ACTIVE` is the single source of truth; don't reintroduce a different
  active-state treatment there without updating this note.

## 7. Layout and responsive behaviour

**A page is: title and one-line purpose; one dominant action with restrained
secondary ones; optional tabs; a search/filter toolbar; the working content;
then contextual help or history.** In that order.

### The header contract

`ui/PageHeader` and `layout/WorkspaceHeader` both render `ui/HeaderBar`, which
owns the title/action row. They stay separate components — one carries an entity
avatar and a meta row, the other a route-backed tab bar — but neither sets its
own spacing or title type any more, which is how they drifted apart before.

Below `sm` (640px) the title block takes the full width and the actions stack
beneath it. Above it they share a line, actions pinned right and `shrink-0`.

This is a **breakpoint, not a `flex-wrap`**, and that distinction is the whole
bug. The title block used to be `min-w-0 flex-1`, so it could shrink to nothing
and the flex line therefore never overflowed: whether a header wrapped depended
on how wide its buttons happened to be. The same Team header wrapped inside
`AppShell` and did not on a preview page with less padding, and the title
rendered as `Tea`.

`primaryAction` is a separate slot from `actions`. It renders **first on phones**
and last on desktop, so the one thing the page is for is under a thumb without
scrolling past Export and Import.

### Widths and spacing

- 4px grid. Page padding 16px on a phone, 24px on a tablet, 32px on a desktop —
  which is what `AppShell` already supplies, so a page adds none of its own.
- 24px between major sections, 16px inside a group. Data-dense cells may use
  8–12px deliberately.
- Cards: 24px desktop, 16px mobile. `Panel flush` for a full-bleed table so its
  padding is not doubled.
- Ordinary content pages cap at about 1,280px. The rota grid and comparison
  tables use the available workspace width; do not force a data grid into a
  marketing container.

### Grid items need `min-w-0`

A CSS grid item defaults to `min-width: auto`, so it refuses to shrink below its
widest cell and pushes the whole row past the page instead. Every horizontal
overflow found in this pass — the clock-in hero, the dashboard tiles — was this.
Put `min-w-0` on a grid or flex child that contains text.

### Pinned columns in a data grid

The rota grid pins its date row to the top and its staff-name column to the
left. Three things have to be true together or it silently does nothing:

1. **The grid needs its own bounded viewport.** `position: sticky` resolves
   against the nearest scrollport. Without a `max-h` on the `ScrollRegion`, that
   scrollport is the page, and a `sticky top-0` header pins to the top of the
   window and floats over the toolbar instead.
2. **The pinned cell needs an opaque background.** A transparent sticky cell
   pins correctly and lets the content slide visibly underneath it.
3. **It has to cover the grid gap.** A `gap-*` leaves a transparent channel
   beside the pinned cell that content scrolls through. `-mr-1.5 pr-1.5` widens
   the painted area without moving the text; the right border then lands in
   that channel and is the only thing telling a reader the column is pinned.

`ROTA_STICKY_STAFF_COL` in `rota/RotaGridRow.tsx` carries all three, and the
header, the rows and the totals footer share it so the three bands cannot drift
out of alignment.

### Tables on a phone

Seven columns do not fit 390px. Either draw labelled person/record rows instead
(`TeamRowsTable` is the worked example: the row below `md`, the table above it),
or keep the table inside a `ScrollRegion` so the overflow is visible and
reachable. Do not clip a table and hope.

### A dense toolbar has three levels

Page identity; then period and publication state; then the optional filters.
Filters collapse behind one chip when the column is too narrow for the row —
`MobileDisclosure` takes a `breakpoint` (`md`, `lg` or `xl`) and an `inline`
variant for exactly this. The chip **always carries the applied count**: a
filter you cannot see and cannot count is a filter you forget you applied, and
then the grid is lying to you about the week.

`xl` is the right breakpoint for content inside the workspace column rather
than the viewport — the rail takes 256px, so a 1,280px window is a ~950px
column.

### Secondary content

`ui/MobileDisclosure` collapses a section behind a `<details>` summary on a
phone and renders it plainly on a desktop. For genuinely useful context that is
not what the screen is for: the clock-in screen's weekly summary, attendance
trend, activity log and help links, which between them put `Clock In Now`
1,370px down a 390px page.

Never put an offline notice, a failed-write notice, or an error behind a
disclosure.

## 8. State language

One vocabulary, so "saved", "published" and "delivered" stay three different
claims:

| State                | Wording                                                          |
| -------------------- | ---------------------------------------------------------------- |
| Editing              | Unsaved changes                                                  |
| Request active       | Saving…                                                          |
| Durable save         | Changes saved                                                    |
| Offline queue        | Saved on this device. Waiting to sync.                           |
| Failed replay        | Clock-in has not synced. Retry.                                  |
| Draft                | Draft · not visible to staff                                     |
| Publication blocked  | 2 issues block publication · Review issues                       |
| Published            | Published · staff can view this version                          |
| Invite made, no mail | Invitation created. Email could not be sent. Copy link or retry. |
| No search results    | No staff match these filters · Clear filters                     |

**Draft is neutral.** Red is for something that is actually blocking. The rota
builder drew "Draft, not visible to staff" as a red panel with the blocking
count as its body, so the normal condition of a week under construction and two
real conflicts wore the same colour. `rota/PublicationStatus` splits them: a
quiet status chip that is always present, and a red block that appears only when
something blocks, carrying the count and a link to it.

**Never show a success state before the backend result exists.** A toast is not
a record: anything that failed or is queued must remain visible on the screen
after the toast has gone.

**An empty list has at least four different meanings** — no records yet, no
results for this query, no permission, and failed to load — and they have
different next actions. `ui/EmptyState` takes the copy and the action; the
caller decides which case it is. "Nobody matches these filters" was being shown
to brand-new organisations that had never added anybody and had no filter
applied.

## 9. Reference assets

`docs/design/` holds the source references. Treat them as read-only design intent,
not files to edit:

- `designsystem.png`. The canonical token sheet (colour, type, spacing, icons,
  shadows, buttons, form controls, status pills, cards, table, rota grid,
  notifications).
- `rotaflowui.png`. Full product screen showing the design system applied
  (dashboard, rota grid, sidebar nav, mobile views, light/dark mode switch).
- `signin.png`. Sign-in screen (split layout, marketing panel + form).
- `splash-screen.png`. App loading/splash screen.

### The mark

The logo is a rounded-square `brand` (`#0C60F8`) tile carrying a stylised white
"R". Bar, bowl and diagonal leg, with a `brand-light` accent tile tucked under
the leg and a 2×2 shift grid at the foot.

**There is exactly one implementation: `src/components/ui/BrandMark.tsx`.**
Every surface uses it. App sidebar and header, marketing nav and footer, auth,
onboarding, splash, app boot, the invitation screen and the platform console.
Never inline the paths again, and never reintroduce a raster export: the old
`src/assets/logo.png` was a glow-on-dark-blue render that could not sit on a
light canvas, and six surfaces shipped it against light backgrounds before it
was retired (2026-08-04).

`public/favicon.svg` and the three `public/icons/*.png` are generated from the
same geometry, so the browser tab, the installed app and the in-app mark cannot
drift apart. See `public/icons/README.md` before changing any of them.
