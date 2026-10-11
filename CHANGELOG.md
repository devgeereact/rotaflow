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
