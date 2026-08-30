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

- Contrast ≥ **4.5:1** for text (AA). **Light mode is verified and gated at zero**
  across the 13 public pages and the 26 authenticated screens
  (`e2e/app-surface.spec.ts`). **Dark mode is measured but NOT met** — ~200 nodes as
  of 2026-08-30, capped by a budget so it can only fall, tracked as `docs/SAAS.md`
  GAP-032. This line used to claim both themes were verified; nothing had ever
  scanned dark mode, and it turned out to carry more debt than light did.
- The `-ink` tokens are how a status colour becomes text: `text-{tone}-ink` in light,
  `dark:text-{tone}` in dark. The `DEFAULT` status colours are fills and icons, and
  run 2.02–4.29:1 as small text on their own washes. If you are writing
  `text-warning` on anything a person reads, you want `text-warning-ink`.
- **Muted grey does not go on a tinted panel.** `content-muted` is designed against
  white and lands 4.23–4.49:1 on the washes — under the line, and a hundredth under
  is under. Use `text-content` there; the semibold heading above it is what carries
  the hierarchy.
- Interactive targets ≥ **44×44px**. Staff use this one-handed on phones.
- Every focusable element shows a ring: `focus-visible:ring-2 focus-visible:ring-primary`.
- Images require `alt`; icon-only buttons require `aria-label`.
- Never convey shift/leave/clock state by colour alone. Pair with icon + text.
- Rota grid is keyboard-navigable; drag-drop has a keyboard/assistive alternative.

## 6. Component conventions

- Build from small primitives in `src/components/ui` (`Button`, `Card`, `Badge`,
  and rota primitives like `ShiftChip`, `RotaCell` as they're added).
- A `cn()` helper (clsx + tailwind-merge) resolves conditional class conflicts.
- Variants are prop-driven class maps, not a new component per style.
- Buttons: **primary** = solid `bg-primary` fill, white text. **secondary** =
  `bg-surface` + `border-surface-border`, `text-content` (a bordered neutral
  button. This is what earlier drafts of this doc called "ghost"). **ghost** =
  transparent, `text-primary`, no border. Text-only affordance.
- Density matters: the rota builder is information-dense by design; keep chrome
  quiet so the schedule itself is the focus.
- **Sidebar nav, active item:** solid fill, `bg-primary text-primary-fg`, per
  `docs/ORGANISATION_WORKSPACE.html`'s `.nav a[aria-current="page"]`
  (2026-08-06), the organisation workspace shell reference. Superseded the
  earlier soft-tint idiom (`bg-primary/10 text-primary`, same `bg-X/10 text-X`
  treatment as status badges), which itself had replaced a white pill and a
  left-border accent (2026-07-31). `src/components/layout/Sidebar.tsx`'s
  `LINK_ACTIVE` is the single source of truth; don't reintroduce a different
  active-state treatment there without updating this note.

## 7. Reference assets

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
