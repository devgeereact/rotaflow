# Design System & Visual Guidelines — RotaFlow

## 1. Aesthetic direction
**Clean & professional** — a trusted-tool feel in the spirit of Linear, Notion and
Stripe. Crisp, calm, and neutral, with dense-where-it-needs-to-be layouts (the rota
grid) and generous breathing room everywhere else. Motion supports meaning (a shift
snapping into place, a sync completing) and never decorates for its own sake. The
product must feel dependable to a care-home manager and effortless to frontline staff.

**Theme:** the app supports both light and dark and **follows the device
`prefers-color-scheme` by default** (via `ThemeContext`); users can override. Never
assume a single mode — every surface must read in both.

## 2. Design tokens
These map 1:1 to `tailwind.config.ts`. **Always use the token class, never a raw hex.**
Single-value tokens describe the dark canvas; express light mode with Tailwind `dark:`
variants (e.g. `bg-white dark:bg-surface`), driven by the theme class on `<html>`.

### Colour
| Token              | Tailwind class                | Hex       | Use                              |
| ------------------ | ----------------------------- | --------- | -------------------------------- |
| Background         | `bg-background`               | `#0b1220` | App canvas (dark)                |
| Surface            | `bg-surface`                  | `#111a2e` | Cards, sheets, rota cells (dark) |
| Surface border     | `border-surface-border`       | `#22304d` | Dividers, cell/card outlines     |
| Primary accent     | `bg-primary` / `text-primary` | `#2563eb` | Brand, CTAs, active state        |
| Primary foreground | `text-primary-fg`             | `#eff6ff` | Text on primary                  |
| Secondary accent   | `bg-secondary`                | `#3b82f6` | Links, secondary CTA, dark accent|
| Success            | `bg-success` / `text-success` | `#16a34a` | Confirmed / available / on-shift |
| Warning            | `bg-warning` / `text-warning` | `#d97706` | Pending / needs attention        |
| Danger             | `bg-danger` / `text-danger`   | `#dc2626` | Conflict / rejected / absent     |
| Text primary       | `text-content`                | `#f8fafc` | Headings, body                   |
| Text secondary     | `text-content-muted`          | `#94a3b8` | Captions, hints                  |

Status colours encode rota state (available, pending, conflict, absent) — **always
pair them with an icon or text label**, never colour alone (accessibility + colour
blindness).

### Typography
| Role     | Family          | Tailwind class |
| -------- | --------------- | -------------- |
| Body     | Inter / system  | `font-sans`    |
| Display  | Inter / system  | `font-display` |
| Mono     | JetBrains Mono  | `font-mono`    |

Inter throughout keeps the tool feeling professional and neutral. Scale: `text-sm`
captions · `text-base` body · `text-xl`/`text-2xl` section titles · `text-3xl`+ page
headers. Use `font-mono` for times, hours, and payroll figures so columns align.

### Spacing & radius
- Base unit = 4px (Tailwind default). Prefer `gap-*` / `space-y-*`.
- Radii: cards `rounded-2xl`, controls `rounded-xl`, pills/avatars `rounded-full`.
- Rota cells stay tighter (`rounded-lg`) for density. Lean on borders + subtle surface
  contrast over heavy shadows.

## 3. Motion
| Interaction         | Spec                                                   |
| ------------------- | ------------------------------------------------------ |
| Hover (buttons)     | `scale: 1.02`, `duration: 0.15s`, `easeInOut`          |
| Tap                 | `scale: 0.98`                                          |
| Shift drag/drop     | snap with a short spring; ghost preview while dragging |
| Page/section in     | `opacity 0→1`, `y 10→0`, `duration 0.3s`, `ease-out`   |
| Sync/save confirm   | brief, non-blocking success cue                        |
| Reduced motion      | Respect `prefers-reduced-motion`; disable transforms   |

The `animate-fade-up` utility (in `tailwind.config.ts`) is the CSS-only entrance
fallback when Framer Motion isn't warranted.

## 4. Accessibility (frontline-critical)
- Contrast ≥ **4.5:1** for text (AA), verified in **both** light and dark.
- Interactive targets ≥ **44×44px** — staff use this one-handed on phones.
- Every focusable element shows a ring: `focus-visible:ring-2 focus-visible:ring-primary`.
- Images require `alt`; icon-only buttons require `aria-label`.
- Never convey shift/leave/clock state by colour alone — pair with icon + text.
- Rota grid is keyboard-navigable; drag-drop has a keyboard/assistive alternative.

## 5. Component conventions
- Build from small primitives in `src/components/ui` (`Button`, `Card`, and rota
  primitives like `ShiftChip`, `RotaCell`, `StatusBadge` as they're added).
- A `cn()` helper (clsx + tailwind-merge) resolves conditional class conflicts.
- Variants are prop-driven class maps, not a new component per style.
- Density matters: the rota builder is information-dense by design; keep chrome quiet
  so the schedule itself is the focus.
