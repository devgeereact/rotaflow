# Design Exploration — RotaFlow

**Status:** Proposal from `/design-consultation`, 2026-08-13. Not yet applied to
production. `docs/DESIGN.md` remains the enforced source of truth until this
exploration is validated through `/design-shotgun` and `/design-html` and
explicitly promoted.

**Preview:** `~/.gstack/projects/devgeereact-rotaflow/designs/marketing-hero-dashboard-20260813/consultation-artifacts/design-consultation-preview.html`
(self-contained HTML, light/dark toggle) — open it to see fonts, colour, and
mockups rendered. Competitor research screenshots (Deputy, Rotaready) live
alongside it in the same `consultation-artifacts/` directory. These were
originally written to a session scratchpad and have been copied to durable
gstack storage; the session scratchpad itself is ephemeral and will not
persist.

## Product Context
- **What this is:** RotaFlow, a multi-tenant, offline-first workforce scheduling PWA.
- **Who it's for:** UK multi-site, shift-based organisations (care/home-care primary wedge).
- **Space/industry:** Workforce scheduling SaaS, competing with Deputy, Rotaready, Planday.
- **Project type:** Web app (dashboard-heavy) with a marketing shell.
- **Memorable thing:** "This won't let you down when it matters" — dependability
  during failure (offline sync, no-signal clock-in), not growth-SaaS excitement.

## Research findings (Phase 2)
Deputy and Rotaready (screenshots in `consultation-artifacts/`, see Preview
above) both converge
on bubbly-illustration / stat-badge growth-SaaS marketing conventions — 3-col icon
grids, alternating tinted sections, logo walls, playful rounded UI. Neither
commits to an operational-trust register. **Eureka:** RotaFlow's actual
differentiator (dependability under failure) justifies a deliberately calmer,
more instrument-panel register than either competitor.

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian — function-first, data-dense, monospace
  accents, muted confident palette.
- **Decoration level:** Intentional (subtle grid texture nod, no illustration).
- **Mood:** Confident, calm, sturdy — a trusted instrument, not a pitch.
- **Reference sites (category, for contrast, not emulation):** deputy.com,
  rotaready.com.

## Typography
- **Display/Hero:** Inter, 700 — unchanged from `docs/DESIGN.md`.
- **Body:** Inter, 400 — unchanged.
- **UI/Labels:** Inter — same as body.
- **Data/Tables:** JetBrains Mono (tabular-nums) — unchanged.
- **Code:** JetBrains Mono — unchanged.
- **Risk considered and rejected:** replacing Inter (category-overused) for
  distinctiveness. Cost (re-opening already-shipped, accessibility-audited
  production typography) outweighed the gain — see plan-eng-review and the E2E/axe
  CI work referenced this session.

## Color
- **Approach:** Restrained, evolved not replaced.
- **Primary:** `#3B6FE0` — retained (brand equity; Premise 3 in
  `docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md` confirmed no positioning pivot).
- **Primary ink (new):** `#1E3A73` — deeper navy for marketing surfaces and
  higher-confidence UI moments, reducing the pastel-wash-everywhere feel.
- **Neutrals:** unchanged from `docs/DESIGN.md` (`#F5F7FA` background, `#FFFFFF`
  surface, light/dark pairs as documented there).
- **Semantic:** unchanged — success `#1EA06B`, warning `#E0A030`, danger
  `#D94A3A`, info `#388FD4`.
- **Shift-type palette (already shipped):** promoted from an internal app detail
  to a featured marketing/brand signature — an authentic, hard-to-copy visual
  asset neither competitor has, since it's real per-org data density, not
  illustration.
- **Dark mode:** unchanged strategy from `docs/DESIGN.md`.

## Spacing / Layout / Motion
Unchanged from `docs/DESIGN.md` — this exploration is scoped to aesthetic
register and colour/typography emphasis, not the underlying system mechanics.

## Deliberate risks taken
1. **Hero shows the real rota grid + monospace time**, not illustration or
   abstract graphics — differentiates from both researched competitors, who
   neither show their product with this much confidence.
2. **Shift-type colour palette featured as brand signature** in marketing
   surfaces, not just internal app chrome — zero new design cost, authentic
   differentiation.
3. **Empty ("caught up") dashboard state specified explicitly** — a calm
   confirmation, not a blank card or generic "Nothing to do" (matches the
   Pass 2 finding from `/plan-design-review` on the same session).

## Risk rejected
- **Typeface swap** — considered, explicitly declined. See Typography above.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-13 | Design exploration created via `/design-consultation` | Researched Deputy/Rotaready, found a differentiation gap (dependability vs. growth-SaaS excitement), proposed industrial/utilitarian register evolving existing tokens rather than replacing them |
| 2026-08-13 | Shipped as `DESIGN_EXPLORATION.md`, not `DESIGN.md` | User chose not to replace the live enforced design system until validated through `/design-shotgun` and `/design-html` |
