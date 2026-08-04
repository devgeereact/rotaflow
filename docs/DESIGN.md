# Design System & Visual Guidelines — RotaFlow

> Source of truth: `design/designsystem.png`, `design/rotaflowui.png`,
> `design/authscreen.png`, `design/splashscreen.png`. This document and
> `tailwind.config.ts` are the enforced, code-level expression of those
> references. **Every future screen, component, or asset must match this
> document — never invent a colour, size, or radius outside it.**

## 1. Aesthetic direction

**Clean & professional** — a trusted-tool feel in the spirit of Linear, Notion and
Stripe. Crisp, calm, and neutral, with dense-where-it-needs-to-be layouts (the rota
grid) and generous breathing room everywhere else. Motion supports meaning (a shift
snapping into place, a sync completing) and never decorates for its own sake. The
product must feel dependable to a care-home manager and effortless to frontline staff.

**"Ink Navy" re-skin (2026-08-04).** Brand primary moved from a mid-blue
(`#3B6FE0`) to a deeper cobalt (`#0369A1`); a second `graphite` token
(`#0F172A`) carries solid buttons and the tenant app's sidebar, which is now a
permanently-dark surface independent of the light/dark theme toggle — see
`Sidebar.tsx`. Headings and the wordmark moved to Plus Jakarta Sans
(`font-display`); body copy and dense data stay on Inter. Radii and shadows
were tightened for a crisper edge. `AdminShell` (the platform console)
deliberately keeps its own `danger`-red accent and light chrome unchanged —
see its own doc comment for why that distinction is load-bearing, not
cosmetic. Status colours (success/warning/danger/info) and the shift/leave/
avail palettes are untouched.

**Theme: light-first.** RotaFlow ships **light by default** — every reference
screen (auth, splash, dashboard, rota grid) is light. Dark remains a fully
supported, deliberate user choice (see the mode switch in `rotaflowui.png`), not
the default. `ThemeContext` defaults to `'light'` for first-time visitors and
persists an explicit user choice; it never silently forces dark from
`prefers-color-scheme` the way the old (pre-design-system) build did. Every
surface must still read correctly in both modes — build dark variants
alongside light ones, don't defer them.

## 2. Design tokens

These map 1:1 to `tailwind.config.ts`. **Always use the token class, never a raw
hex.** Token values below are the **light** (base, default) palette — pair every
one with a `dark:` variant using the dark column, e.g.
`bg-background dark:bg-background-dark`.

### Colour — brand & neutrals

| Token               | Tailwind class                                              | Light hex | Dark hex  | Use                                                                                    |
| ------------------- | ----------------------------------------------------------- | --------- | --------- | -------------------------------------------------------------------------------------- |
| Background (canvas) | `bg-background` / `dark:bg-background-dark`                 | `#F5F7FA` | `#0B1220` | App canvas, behind cards                                                               |
| Surface (default)   | `bg-surface` / `dark:bg-surface-dark`                       | `#FFFFFF` | `#111A2E` | Cards, sheets, panels, rota cells                                                      |
| Surface subtle      | `bg-surface-subtle` / `dark:bg-surface-subtle-dark`         | `#FAFBFC` | `#15203A` | Nested panels, hover fills, sidebar                                                    |
| Surface border      | `border-surface-border` / `dark:border-surface-border-dark` | `#E3E6EA` | `#22304D` | Card/control outlines                                                                  |
| Divider             | `border-divider` / `dark:border-divider-dark`               | `#F2F4F6` | `#1B2740` | Subtle in-list separators (lighter than border)                                        |
| Primary             | `bg-primary` / `text-primary`                               | `#0369A1` | `#0369A1` | Brand, links, active state, focus rings — CTAs use `graphite` (below)                  |
| Primary foreground  | `text-primary-fg`                                           | `#FFFFFF` | `#FFFFFF` | Text/icons on a solid primary fill                                                     |
| Graphite            | `bg-graphite` / `text-graphite`                             | `#0F172A` | `#0F172A` | Solid buttons (`Button`'s `primary` variant) and the tenant app's `Sidebar`            |
| Graphite foreground | `text-graphite-fg`                                          | `#FFFFFF` | `#FFFFFF` | Text/icons on a solid graphite fill                                                    |
| Secondary           | `text-secondary`                                            | `#6B7280` | `#94A3B8` | Secondary icons/labels (same value as content-muted; kept as a distinct semantic name) |
| Text primary        | `text-content` / `dark:text-content-dark`                   | `#16191F` | `#F8FAFC` | Headings, body                                                                         |
| Text muted          | `text-content-muted` / `dark:text-content-muted-dark`       | `#6B7280` | `#94A3B8` | Captions, hints, secondary text                                                        |

### Colour — semantic (operational status)

| Token    | Tailwind class                | Hex       | Use                                              |
| -------- | ----------------------------- | --------- | ------------------------------------------------ |
| Valid    | `bg-success` / `text-success` | `#1EA06B` | Published, valid, confirmed, available, on-shift |
| Warning  | `bg-warning` / `text-warning` | `#E0A030` | Pending, needs attention, expiring soon          |
| Conflict | `bg-danger` / `text-danger`   | `#D94A3A` | Conflict, rejected, absent, error                |
| Info     | `bg-info` / `text-info`       | `#388FD4` | Informational note, neutral status               |

Same hex in both themes — these need to stay recognisable regardless of mode.
Status colours encode rota state — **always pair them with an icon or text
label**, never colour alone (accessibility + colour blindness).

### Colour — shift type palette (8)

Used for shift-type chips in the rota grid (`LD`, `WN`, `TW`, `SPL`, `EAR`, `OFF`,
`TRN`, `ANN` and similar org-defined codes — see `shift_types.colour` in
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

Font family: **Inter Variable** for body/dense-data (`font-sans`) and
**Plus Jakarta Sans** for headings and the wordmark (`font-display`) — set once
in `tailwind.config.ts`, so every screen through `PageHeader`/`Sidebar`/
`AdminShell` picks it up automatically. `font-mono` is **JetBrains Mono**, used
for times, hours, and payroll figures so columns align.

### Spacing & radius

- Base unit = 4px (Tailwind default: `4px·8px·12px·16px·24px·32px·48px·64px` =
  `1·2·3·4·6·8·12·16`). Prefer `gap-*` / `space-y-*`.
- Radii: cards `rounded-2xl` (`1.125rem`), controls `rounded-xl` (`0.75rem`),
  pills/status badges/avatars `rounded-full`. Rota cells stay tighter
  (`rounded-lg`) for density. Both `xl`/`2xl` are overridden in
  `tailwind.config.ts` — tightened for the Ink Navy re-skin from their original
  `1rem`/`1.5rem`.
- Lean on `border-surface-border` + subtle surface contrast over heavy shadows.

### Shadows (elevation)

`shadow-sm` / `shadow` / `shadow-lg` are overridden in `tailwind.config.ts` to
match the reference exactly — use the stock Tailwind class names, don't invent
new ones.

| Level | Tailwind class     | Spec                            |
| ----- | ------------------ | -------------------------------- |
| 1     | `shadow-sm`        | `0 1px 2px rgba(15,23,42,0.06)`  |
| 2     | `shadow` (default) | `0 2px 8px rgba(15,23,42,0.10)`  |
| 3     | `shadow-lg`        | `0 6px 16px rgba(15,23,42,0.14)` |

## 3. Iconography

**Lucide** (Feather-style, outline), via the `lucide-react` package — never
inline ad-hoc SVGs, never a second icon set. Standard sizes: `16px` (`size={16}`
/ `w-4 h-4`) inline with text, `20px` default UI icon, `24px` (`w-6 h-6`)
featured/empty-state icons. Icon-only controls require `aria-label`.

## 4. Motion

| Interaction       | Spec                                                   |
| ----------------- | ------------------------------------------------------ |
| Hover (buttons)   | `scale: 1.02`, `duration: 0.15s`, `easeInOut`          |
| Tap               | `scale: 0.98`                                          |
| Shift drag/drop   | snap with a short spring; ghost preview while dragging |
| Page/section in   | `opacity 0→1`, `y 10→0`, `duration 0.3s`, `ease-out`   |
| Sync/save confirm | brief, non-blocking success cue                        |
| Reduced motion    | Respect `prefers-reduced-motion`; disable transforms   |

The `animate-fade-up` utility (in `tailwind.config.ts`) is the CSS-only entrance
fallback when Framer Motion isn't warranted.

## 5. Accessibility (frontline-critical)

- Contrast ≥ **4.5:1** for text (AA), verified in **both** light and dark.
- Interactive targets ≥ **44×44px** — staff use this one-handed on phones.
- Every focusable element shows a ring: `focus-visible:ring-2 focus-visible:ring-primary`.
- Images require `alt`; icon-only buttons require `aria-label`.
- Never convey shift/leave/clock state by colour alone — pair with icon + text.
- Rota grid is keyboard-navigable; drag-drop has a keyboard/assistive alternative.

## 6. Component conventions

- Build from small primitives in `src/components/ui` (`Button`, `Card`, `Badge`,
  and rota primitives like `ShiftChip`, `RotaCell` as they're added).
- A `cn()` helper (clsx + tailwind-merge) resolves conditional class conflicts.
- Variants are prop-driven class maps, not a new component per style.
- Buttons: **primary** = solid `bg-primary` fill, white text. **secondary** =
  `bg-surface` + `border-surface-border`, `text-content` (a bordered neutral
  button — this is what earlier drafts of this doc called "ghost"). **ghost** =
  transparent, `text-primary`, no border — text-only affordance.
- Density matters: the rota builder is information-dense by design; keep chrome
  quiet so the schedule itself is the focus.
- **Sidebar nav, active item:** soft-tint highlight — `bg-primary/20 text-white`
  against the sidebar's own permanently-dark `graphite` fill (not a
  theme-dependent light/dark pair any more, since the Ink Navy re-skin made
  the sidebar a fixed-dark surface — see `docs/DESIGN.md` §1). Same `bg-X/N
  text-X` idiom already used for status badges (`AvailabilityPage`,
  `LeavePage`, `SwapsPage`), just tuned for a dark fill instead of a light
  one. Not a white pill and not a left-border accent — both were tried
  earlier and replaced (2026-07-31) for reading as one-off rather than "this
  app's highlight colour." `src/components/layout/Sidebar.tsx`'s
  `LINK_ACTIVE` is the single source of truth; don't reintroduce a different
  active-state treatment there without updating this note.

## 7. Reference assets

`design/` holds the source references — treat them as read-only design intent,
not files to edit:

- `designsystem.png` — the canonical token sheet (colour, type, spacing, icons,
  shadows, buttons, form controls, status pills, cards, table, rota grid,
  notifications).
- `rotaflowui.png` — full product screen showing the design system applied
  (dashboard, rota grid, sidebar nav, mobile views, light/dark mode switch).
- `authscreen.png` — sign-in screen (split layout, marketing panel + form).
- `splashscreen.png` — app loading/splash screen.

### The mark

The logo is a rounded-square `brand` (`#0C60F8`) tile carrying a stylised white
"R" — bar, bowl and diagonal leg — with a `brand-light` accent tile tucked under
the leg and a 2×2 shift grid at the foot.

**There is exactly one implementation: `src/components/ui/BrandMark.tsx`.**
Every surface uses it — app sidebar and header, marketing nav and footer, auth,
onboarding, splash, app boot, the invitation screen and the platform console.
Never inline the paths again, and never reintroduce a raster export: the old
`src/assets/logo.png` was a glow-on-dark-blue render that could not sit on a
light canvas, and six surfaces shipped it against light backgrounds before it
was retired (2026-08-04).

`public/favicon.svg` and the three `public/icons/*.png` are generated from the
same geometry, so the browser tab, the installed app and the in-app mark cannot
drift apart. See `public/icons/README.md` before changing any of them.
