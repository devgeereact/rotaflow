# Accessibility audit

What accessibility checks have found and what was fixed, dated. The rules and the
public claim are in `docs/ACCESSIBILITY.md`; status is in `docs/SAAS.md`. Created
on 11 October 2026 by collecting the accessibility findings already recorded in
the register, so each entry below cites the row it comes from.

**No specialist audit has ever been carried out.** Everything here is automated
(axe through Playwright) or a developer's own sweep. Screen-reader output and real
assistive technology are `NOT TESTED`.

## Current gate result

`e2e/marketing.spec.ts` and `e2e/app-surface.spec.ts` run in CI's `e2e` job on every
pull request and require zero WCAG 2 A and AA violations on 14 public routes and 26
signed-in screens, with colour contrast counted in light and dark on the signed-in
screens. `e2e` is a required check on `main`. Its latest result is whatever the
last CI run says; this file does not restate it.

## Findings, oldest first

| Date        | Source                     | Found                                                                                                                                                                                        | Outcome                                                                                |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 30 Aug 2026 | GAP-030, axe in light mode | 172 colour-contrast nodes across the signed-in app. Four causes, chiefly status colours used as text and `Callout` forcing muted grey onto tinted panels (60 of the 172)                     | 0 in light mode; contrast gated at zero from then on                                   |
| 30 Aug 2026 | GAP-032, axe in dark mode  | 195 contrast nodes, invisible until dark mode was first scanned. `dark:text-{tone}` used a fill colour as text, and unpaired `-ink` classes carried the light ink into dark mode at 2.5:1    | 0 in dark mode; `{tone}.ink-dark` tokens added and the dark scan made part of the gate |
| 5 Sep 2026  | Developer sweep            | 68 uses of a bare fill token as text inside dialogs, onboarding steps and error branches the scan never opens                                                                                | Swept; recorded in `docs/ACCESSIBILITY.md` as the reason to check a new modal by hand  |
| 10 Sep 2026 | BUG-101, full UX pass      | Controls below the 44px target (or 36px where the rule allows it) on nineteen routes: sidebar collapse, password reveal, rota steppers, chart toggles, sortable headers, tab strips and more | Closed; sizes now stated per primitive in `docs/ACCESSIBILITY.md`                      |

The public statement (`src/lib/legalFacts.ts`) says the contrast gate "found and
fixed 367 real failures", which is the 172 and 195 above.

## Not yet audited

- Keyboard-only journeys through the rota builder, timesheets and onboarding, end
  to end. `e2e/a11y-fixes.spec.ts` and `e2e/rota-grid.spec.ts` cover parts.
- Screen-reader announcements for toasts, the offline banner and sync status.
- Anything behind a dialog or an error branch that no scan opens.
