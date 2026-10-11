# Accessibility

This file owns the accessibility rules every screen follows, and the facts behind
what RotaFlow publicly claims about accessibility. The rules were §5 of the design
guide until 11 October 2026 and moved here unchanged; `docs/DESIGN-SYSTEM.md` §5
now points here. Evidence from audits lives in `qa/ACCESSIBILITY-AUDIT.md`.

## What the product claims

The public statement is `/legal/accessibility` (`src/pages/legal/AccessibilityPage.tsx`,
CAP-060). Its text comes from `ACCESSIBILITY_FACTS` in `src/lib/legalFacts.ts`,
reviewed by a person on the date in `LEGAL_FACTS_REVIEWED` (4 September 2026 at the
time of writing). It says:

- RotaFlow **aims at WCAG 2.1 AA** and has **not** been through a formal audit by
  an accessibility specialist, so the page describes what is verified rather than
  claiming conformance.
- Colour contrast is scanned automatically on every push, in light and dark mode,
  and the build fails on any violation.
- Keyboard-only journeys, screen-reader announcements and focus order are checked
  by hand as screens are built, not by a specialist.
- Status is never carried by colour alone, controls are keyboard-reachable,
  dialogs trap focus and close on Escape, and icon-only buttons are named.
- Barriers are reported by email to the contact address in `src/lib/marketing.ts`.

Anything added to that page must be true of the code first. Change
`ACCESSIBILITY_FACTS` and this section in the same pull request.

## How it is checked

| Check                                   | What it covers                                                                                                                                                                                                        | Where                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| axe, WCAG 2 A and AA, public pages      | 14 public routes, every A and AA rule, light theme                                                                                                                                                                    | `e2e/marketing.spec.ts`             |
| axe, WCAG 2 A and AA, signed-in screens | 26 screens (11 product previews and 15 platform console previews). Every non-contrast rule must be zero; colour contrast is counted in light and again in dark by toggling the `dark` class, and must be zero in both | `e2e/app-surface.spec.ts`           |
| Responsive and reduced motion           | Layout at phone widths, and that motion respects `prefers-reduced-motion`                                                                                                                                             | `e2e/responsive-and-motion.spec.ts` |
| Specific fixes                          | Regressions for defects already fixed                                                                                                                                                                                 | `e2e/a11y-fixes.spec.ts`            |

All of these run in CI's `e2e` job (see the table in `qa/README.md`). What they do
not cover: anything inside a dialog, onboarding branch or error state the scan does
not open, screen-reader output, and real assistive technology. The rules below say
where that has already bitten.

## Rules

- Contrast ≥ **4.5:1** for text (AA), **verified and gated at zero in both themes**
  across the 26 authenticated screens, and in light mode across the 14 public pages
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
  `ui/IconButton` (44×44 by default); its `sm` size is 36px.

  **36px is allowed in exactly two places**, and nowhere else. A control inside a
  dense table row, where 44 changes the row height and therefore the screen; and
  a control in a dense horizontal group where 44 would push the group onto a
  second line — a tab strip (`ui/PanelTabs`), a segmented period switcher, a row
  of filter chips, a sortable column header. Never a page action, a dialog
  action, or anything a person is expected to hit while walking.

  This second case was written down on 2026-09-10, after a sweep measured every
  control in the product and found tab strips at 34px, chips at 30, sortable
  headers at 17 and a mobile navigation trigger at 32. None of those numbers
  came from a rule; they were each decided once, locally, and nothing said what
  the floor was. They are 36 now.

  **Where the visible shape must stay small, expand the hit area rather than the
  control.** An absolutely-positioned `::after` (`after:absolute after:-inset-*
after:content-['']`) enlarges what a finger can hit without moving a pixel.
  `ui/Toggle` uses it to be 44 tall while still looking like a 24px switch, and
  the rota chip's delete × uses it to reach 32 without covering a quarter of the
  chip it sits on — which a 44px target genuinely would, and it would delete
  shifts people meant to open. That chip is the one place in the product under
  36, and it is under it deliberately: the shift editor carries a full-size
  **Remove** for anyone who wants the unhurried path.

  **Inline text links in prose or a footer list are exempt**, as WCAG's own
  target-size criterion exempts them. A 44px-tall "Privacy" in a footer column
  of ten links would be a worse page, not a better one.

- **A horizontally scrolling area must be reachable and must say it scrolls.**
  `overflow-x-auto` on a bare `div` is draggable with a pointer and completely
  unreachable with a keyboard, and it gives no sign that anything is off screen.
  Use `ui/ScrollRegion`: a labelled `role="region"` with `tabIndex={0}`, plus an
  edge fade and a line naming the gesture, both shown only while the content
  actually overflows. **`ui/DataTable` renders through `ScrollRegion`** — it
  hand-rolled the `role="region"` and the `tabIndex` and skipped the cue until
  2026-09-10, so nine platform-console tables scrolled in complete silence
  while this line claimed otherwise. One scroller, one contract.
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
