# Changelog

What changed, one entry per merged pull request, newest first. This file owns that
history in brief; the pull request holds the detail and `docs/SAAS.md` holds
capability status. Started on 11 October 2026 with the ten most recently merged
pull requests, read from `gh pr list --state merged`. Earlier history is in
`git log --merges` and the pull requests themselves.

**The rule: one entry per merged pull request**, added in that pull request, under
"Unreleased" until it merges, then dated with its merge date. Dependency bumps from
Dependabot may be grouped into one line per week. The rule sits under
"Documentation stays current" in `AGENTS.md`.

## Unreleased

- **feat(billing): invoices in the app (plan F3, CAP-127).** `0156` adds
  `hosted_invoice_url` and `invoice_pdf` to `invoices`, each constrained to https
  on `invoice.stripe.com` or `pay.stripe.com`. `stripe-webhook` writes them on
  `invoice.paid` and `invoice.payment_failed`, retrieving the invoice when the
  event lacks them. Settings, Billing gains an Invoices section for the owner:
  the last 12, with date, number, amount, status in words, and View and Download
  PDF links. Not deployed; the billing contact is not yet sent to Stripe
  (GAP-128) and stored links expire within 120 days (GAP-129).
- **feat(design): flat, monochrome tokens and primitives (decision D10).** The
  neutral and dark ramps move to true neutrals under the same token names
  (canvas `#F4F4F4`, ink `#171A20`, muted `#5C5E62`; dark canvas `#171A20`).
  Two radii (4px controls, 12px cards), no resting shadows, 330ms colour-only
  transitions on one easing curve. Button, Card, Modal, Input, Select, Badge,
  IconButton and HeaderBar follow; Button no longer scales on hover. Status
  colours, dark mode, 44px targets and dense tables are unchanged. New tests:
  `themeContrast.test.ts` (every text token on every surface, both themes) and
  `designRatchet.test.ts` (alpha status fills, stray hex, hover scale and
  `shadow-lg` may not rise). Page layouts are not restyled here.
- **feat(billing): a 30-day trial, then a plan or read-only (decision D2).**
  `0154` gives every organisation a server-set 30-day trial on Professional
  limits and removes the free Starter fallback. Without a trial, a paid or
  trialing subscription or a grace window, rotas, shifts and invites refuse
  writes with `BILL1`, while clock-in, leave, reads and exports keep working.
  Checkout passes the trial end to Stripe, and the webhook queues "Your trial
  ends in 3 days" and "Payment failed" through the outbox. Settings, Billing
  shows "Trial, N days left", owners and managers of a read-only organisation
  see a banner, and the onboarding plan step and pricing FAQ state the trial
  terms (CAP-125, GAP-126, GAP-127).

- **feat: website enquiries are stored, and the console has an Enquiries inbox
  (CAP-126, Plans 2026 F2).** `/contact` posts to a new public Edge Function,
  `public-enquiry`, instead of opening a `mailto:` link that reached nobody on a
  device with no mail client. The function checks the origin, validates every
  field, ignores a filled honeypot, verifies Cloudflare Turnstile when its secret
  is set, and stores the row through `receive_enquiry` (`0155`), rate-limited per
  hashed address and in total. `anon` holds nothing on the new `enquiries` table;
  operational platform roles triage it at `/admin/enquiries`. Kept 24 months by the
  nightly retention job. "Book a demo" links tick the demo box. Needs
  `supabase functions deploy public-enquiry --no-verify-jwt` before it accepts
  anything (`docs/DEPLOYMENT.md`).
- **fix(billing): Checkout guard, webhook ordering and an honest billing page.**
  Settings > Billing says "No plan yet" instead of "trialing" when there is no
  subscription, shows the entitled plan and formats prices in the plan currency
  (BUG-106). `create-checkout-session` refuses a second Checkout with 409
  `already_subscribed` and the page opens the Billing Portal instead (BUG-107).
  `stripe-webhook` writes the subscription as Stripe holds it now, so an
  out-of-order `customer.subscription.updated` cannot regress it, and a late
  `deleted` cannot suspend a replacement subscription (BUG-108).
- **Settings that saved but did nothing are wired or removed (GAP-116, BUG-011).**
  Minimum rest, maximum weekly hours and maximum consecutive days drive the rota
  warnings; the overtime threshold highlights a staff member's own timesheet.
  Clock rounding, publish lead days, auto-decline clashing leave, working week,
  date format and currency are gone from the screens, with their stored values
  kept. Each Policies setting shows a worked example.
- **docs: restructure to the GEE OS Standard application profile.** Flat `docs/`
  with one file per concern, a new `qa/` folder, `CHANGELOG.md` and
  `KNOWN-ISSUES.md`. Overlapping documents merged; dated records kept as dated
  sections; references rewritten everywhere except applied migrations and the
  plan pack. New: `docs/README.md` (index), `docs/API-SPEC.md`,
  `docs/NOTIFICATIONS-SPEC.md`, `docs/ACCESSIBILITY.md`,
  `qa/ACCESSIBILITY-AUDIT.md`, `qa/PERFORMANCE-AUDIT.md`,
  `qa/REGRESSION-AUDIT.md`, `.agent/MCP-PROFILE.yml`. The path map is below.

### Path map, 11 October 2026

| Old path                                                     | New home                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| docs/PRD.md                                                  | `docs/PRODUCT-SPEC.md`                                                  |
| docs/OBSERVABILITY.md                                        | `docs/PRODUCT-SPEC.md`, "Metrics and events"                            |
| docs/OFFLINE-SPEC.md                                         | `docs/ARCHITECTURE.md`, "Offline and PWA"                               |
| docs/HOOKS.md                                                | `docs/ARCHITECTURE.md`, "Hook contracts"                                |
| docs/ARCHITECTURE.md §9c and §10 (Edge Functions)            | `docs/API-SPEC.md`                                                      |
| docs/SCHEMA.md                                               | `docs/DATA-MODEL.md`                                                    |
| docs/SCHEMA.md §6, client RPC bullets                        | `docs/API-SPEC.md`, "RPC contracts"                                     |
| docs/SCHEMA.md §6, notification bullets                      | `docs/NOTIFICATIONS-SPEC.md`                                            |
| docs/DATA_LIFECYCLE.md                                       | `docs/SECURITY.md`                                                      |
| docs/PRIVACY-DATA-MAP.md                                     | `docs/SECURITY.md`, "Privacy data map"                                  |
| docs/DESIGN.md                                               | `docs/DESIGN-SYSTEM.md`                                                 |
| docs/DESIGN.md §5 (Accessibility)                            | `docs/ACCESSIBILITY.md`                                                 |
| docs/BRAND.md                                                | `docs/DESIGN-SYSTEM.md`, "Brand and voice"                              |
| docs/DESIGN_EXPLORATION.md (rejected)                        | Deleted; recorded in `docs/DESIGN-SYSTEM.md`, "Rejected exploration"    |
| docs/SCREENS.md                                              | `docs/UX-SPEC.md`                                                       |
| docs/LOOP.md                                                 | `docs/UX-SPEC.md`, "Design-match loop"                                  |
| docs/GEE-OS.md                                               | `docs/README.md`, "How GEE OS is applied"                               |
| docs/Working-Agent.md                                        | `qa/README.md`, "Full QA audit method"                                  |
| docs/QA-AUDIT-REPORT.md                                      | `qa/FUNCTIONAL-AUDIT.md`                                                |
| docs/PLATFORM-CONSOLE-REPAIR-2026-09-07.md                   | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/PLATFORM-CONSOLE-REPOLISH-2026-09-07.md                 | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/design-review/2026-09-06-rota-builder.md                | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/design-review/2026-09-10-full-ux-pass.md                | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/design-review/\*.png                                    | `docs/design/review/` (the four unreferenced operations-\*.png deleted) |
| docs/PRIVACY-READINESS-2026-09-04.md                         | `qa/SECURITY-AUDIT.md`, dated section                                   |
| docs/PWA-RELEASE-GATES.md                                    | `qa/LAUNCH-CHECKLIST.md`                                                |
| docs/ORGANISATION_WORKSPACE.html, docs/PLATFORM_CONSOLE.html | `docs/design/`                                                          |
| `.agent/PROJECT.yml` `mcp_profile`                           | `.agent/MCP-PROFILE.yml`                                                |

## 2026-10-10

- **#335** chore(gitignore): ignore demo credentials and loop scratch in any docs
  folder.

## 2026-10-09

- **#334, #333, #332, #326** Dependency bumps: the dev-dependencies group (eight
  updates), `lucide-react` 1.38.0 to 1.50.0, `@supabase/supabase-js` 2.112.4 to
  2.117.2, and `github/codeql-action` 4.37.9 to 4.38.2.
- **#330** chore(tailwind): migrate to Tailwind 4 and tailwind-merge 3. Tokens moved
  from `tailwind.config.ts` to the `@theme` block in `src/index.css`. Removes the
  `braces` advisory chain, so `npm audit` reports no vulnerabilities (GAP-037).
- **#328** fix: exclude local environment variants from Git.
- **#317** fix: a verification pass and a whole-product UX pass, 23 defects. Staff
  sign-in reached an error boundary on the dashboard; an open amendment doubled
  timesheet rows. Recorded as GAP-118 to GAP-123 and BUG-088 to BUG-105; `0152`
  refuses a second booking of the same leave day.

## 2026-09-09

- **#316** fix(export): the organisation export lost its workforce after `0150`
  revoked five `staff_profiles` columns; `0151` repairs the read.

## 2026-09-08

- **#315** fix(privacy): a colleague is not a payroll record. `0150` revokes five
  payroll columns of `staff_profiles` from `authenticated` (GAP-117).
