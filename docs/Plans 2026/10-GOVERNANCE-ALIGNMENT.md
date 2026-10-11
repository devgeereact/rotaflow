# 10. Governance alignment and retiring this folder

The owner wants every instruction, rule, agent, hook, memory, README and CI workflow to agree, so nothing drifts or breaks the build. This file says what is inconsistent today, the target shape, and the exact order to reshape it once the plan is approved.

Re-verified on 11 Oct 2026 against `chore/docs-standard-layout` (main at 78f3a4d plus this pack). The first review read the `docs/gee-os-blueprint-layout` branch (`d82a2ef`), which carried governance edits main never received. Where that changes a finding, the row says so.

## 0. Owner decisions taken on 10 October 2026

### 0.1 GEE OS Standard profile adopted

The documentation follows the **GEE OS Standard profile**: a flat `docs/` folder with one file per concern, plus a `qa/` folder and two root files. The numbered layout on `docs/gee-os-blueprint-layout` (`d82a2ef`, numbered folders from `00-foundation` to `09-release`) is **superseded and will not be merged**. Its useful content is carried across by hand where it is still true on main; nothing is merged from it wholesale.

| Standard file                            | Takes over (files on main today)                                      |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `docs/README.md`                         | Document index (new)                                                  |
| `docs/SAAS.md`                           | `docs/SAAS.md` (unchanged, still the plan of record)                  |
| `docs/RULES.md`                          | `docs/RULES.md`                                                       |
| `docs/PRODUCT-SPEC.md`                   | `docs/PRD.md`, `docs/OBSERVABILITY.md`                                |
| `docs/ARCHITECTURE.md`                   | `docs/ARCHITECTURE.md`, `docs/OFFLINE-SPEC.md`, `docs/HOOKS.md`       |
| `docs/DATA-MODEL.md`                     | `docs/SCHEMA.md`                                                      |
| `docs/API-SPEC.md`                       | New: RPCs and Edge Functions as a contract                            |
| `docs/SECURITY.md`                       | `docs/DATA_LIFECYCLE.md`, `docs/PRIVACY-DATA-MAP.md`                  |
| `docs/DESIGN-SYSTEM.md`                  | `docs/DESIGN.md`, `docs/BRAND.md`                                     |
| `docs/UX-SPEC.md`                        | `docs/SCREENS.md`, `docs/LOOP.md`                                     |
| `docs/ACCESSIBILITY.md`                  | New, from the accessibility sections of the design guide              |
| `docs/NOTIFICATIONS-SPEC.md`             | New: outbox, channels, templates                                      |
| `docs/DEPLOYMENT.md`                     | `docs/DEPLOYMENT.md`                                                  |
| `qa/README.md`                           | `docs/Working-Agent.md` (how a full QA audit is run)                  |
| `qa/FUNCTIONAL-AUDIT.md`                 | `docs/QA-AUDIT-REPORT.md` and the two platform console repair records |
| `qa/SECURITY-AUDIT.md`                   | New                                                                   |
| `qa/LAUNCH-CHECKLIST.md`                 | `docs/PWA-RELEASE-GATES.md`                                           |
| `CHANGELOG.md`, `KNOWN-ISSUES.md` (root) | New                                                                   |

The restructure is in progress on a separate branch. Until it merges, line references in this pack cite the files as they exist on main (for example `PRD.md:104`), and destinations are named by their Standard path.

### 0.2 The docs-sync rule

A change that makes a document untrue updates that document in the same pull request. Five mechanisms hold the rule, each covering what the others cannot:

1. **`AGENTS.md` rule.** One sentence every harness reads: when code changes behaviour, a count, a path or a capability status, update the owning Standard document in the same change.
2. **Claude Code `Stop` hook.** In `.claude/settings.json`, a hook that, when a session ends with changed files under `src/`, `supabase/` or `.github/` and no change under `docs/`, `qa/` or the root documents, prints a reminder naming the likely owning document. It warns; it never blocks. Codex has no equivalent hook, so for Codex the `AGENTS.md` rule is the whole of it.
3. **CI `check-docs-impact`.** A new step in the `verify` job that maps changed paths to owning documents (for example `supabase/migrations/**` to `docs/DATA-MODEL.md`, `src/App.tsx` routes to `docs/UX-SPEC.md`) and fails when an owning document is untouched, unless the pull request body carries an explicit `docs-impact: none` line with a reason.
4. **Extended `check:docs`.** `scripts/check-doc-counts.mjs` gains the checks in §4 item 1 (CI job count, Edge Function count, Node version, screen counts).
5. **Plan-drift pull requests.** `plan-drift-audit.yml`, once fixed, opens a pull request with its findings rather than only writing a log, so drift arrives where someone reviews it.

## 1. Inventory (re-verified 11 Oct 2026 on main)

| Item                                                    | State                                                                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                             | Entry point and pointer. Holds harness-neutral rules                                                                                                                                                |
| `CLAUDE.md`                                             | Canonical project directives. Long, with some facts duplicated elsewhere                                                                                                                            |
| `CODEX.md`                                              | Codex mapping                                                                                                                                                                                       |
| `.agent/PROJECT.yml`, `.agent/CURRENT-TASK.template.md` | GEE OS routing. On main the MCP position is the `mcp_profile` block in `PROJECT.yml` (`:65`). The split into `.agent/MCP-PROFILE.yml` existed only on the superseded branch                         |
| `docs/RULES.md`, `docs/GEE-OS.md`                       | Coding standards, GEE OS explanation. `GEE-OS.md` has no Standard destination listed; decide in the restructure whether it folds into `docs/README.md` or stays                                     |
| `.claude/settings.json`                                 | Denies reading `.env` files. **No hooks**                                                                                                                                                           |
| `.claude/agents/gee-os.md`                              | Routing agent                                                                                                                                                                                       |
| `.claude/agents/testing/rotaflow-qa-auditor.md`         | QA agent. Frontmatter in a non-Claude-Code format, no `tools:` key, so it inherits every tool                                                                                                       |
| Claude project memory                                   | **Empty**. No `MEMORY.md`                                                                                                                                                                           |
| Nested READMEs                                          | None on main besides this folder's. `qa/` does not exist yet; the restructure creates `qa/README.md`                                                                                                |
| CI                                                      | `ci.yml` (6 jobs), `backup.yml` (green, latest 10 Oct), `auth-config.yml` (red since 14 Sep, latest run 5 Oct), `plan-drift-audit.yml` (red, latest run 5 Oct), `codeql.yml`, plus `dependabot.yml` |

## 2. Contradictions to resolve

| #   | Statement                                                                                                               | Conflicts with                                                                                                     | Severity                     |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | `.claude/agents/gee-os.md:65` "CI runs four jobs"                                                                       | `ci.yml` has six                                                                                                   | High                         |
| 2   | `README.md:70` "Node.js >= 20"                                                                                          | `package.json` engines `>=22.0.0`                                                                                  | High                         |
| 3   | `CLAUDE.md:227` names two scheduled checks                                                                              | Four exist; two are red now                                                                                        | High                         |
| 4   | `CLAUDE.md:234` "never succeeded"                                                                                       | Backup green since 5 Sep; auth-config red since 14 Sep                                                             | High                         |
| 5   | ~~PROJECT.yml holds the MCP position, but it moved to `MCP-PROFILE.yml`~~                                               | **Not a contradiction on main.** The move happened only on the superseded branch                                   | Withdrawn                    |
| 6   | `gee-os.md:52` "Never grant to `anon`"                                                                                  | `CLAUDE.md:182-184` allows it if argued in the PR                                                                  | Medium                       |
| 7   | `CLAUDE.md:199` "every gate blocks a merge"                                                                             | `scheduled-checks` only warns; branch protection not checked                                                       | Medium                       |
| 8   | `PRD.md:104` billing is Phase 2; `README.md:38` and `CLAUDE.md:266` give different Phase 2 lists                        | Billing shipped; one list needed                                                                                   | Medium                       |
| 9   | `RULES.md:3,72`, `README.md:61`: CodeRabbit enforces RULES.md                                                           | No CodeRabbit config in the repo                                                                                   | Medium                       |
| 10  | `SAAS.md:6` "Do not start a sixth" plan                                                                                 | This folder is a parallel plan                                                                                     | Medium (temporary by design) |
| 11  | `CLAUDE.md:129`, `RULES.md:43`, `README.md:52`: NativeWind                                                              | Not in `package.json`                                                                                              | Low                          |
| 12  | `CLAUDE.md:203`: typecheck catches missing return types                                                                 | That is ESLint (`eslint.config.js:73`)                                                                             | Low                          |
| 13  | `RULES.md:44` "No `.css`"                                                                                               | `src/index.css` is the Tailwind entry, and since #330 it also holds every token in `@theme`                        | Low                          |
| 14  | `README.md:183-184`: `format` covers docs, and `format:check` is listed as the gate                                     | `format:check` covers `src/**` only (`package.json:18`), so docs formatting is never gated                         | Low                          |
| 15  | `RULES.md:20-23` import direction not enforced                                                                          | `moduleBoundaries.test.ts` enforces lib-to-services                                                                | Low                          |
| 16  | `CLAUDE.md:63` "four systems"; `GEE-OS.md:145` "three"                                                                  | Pick one                                                                                                           | Low                          |
| 17  | `gee-os.md:72` uses `N/A`                                                                                               | `GEE-OS.md:102` uses `NOT APPLICABLE`. (The loop itself now includes LEARN, `gee-os.md:19`, so that half is fixed) | Low                          |
| 18  | Screen counts: 13 public plus 26 authenticated (`DESIGN.md:259-260`), "42 screens" (`CLAUDE.md:211`, was 40 until #317) | Not checked by `check:docs`                                                                                        | Low                          |
| 19  | `plan-drift-audit.yml:23` says `contents: read` only                                                                    | `:79` also grants `id-token: write`                                                                                | Low                          |
| 20  | `CLAUDE.md:141` fourth cron job covers "leave expiry"                                                                   | `0093` covers document expiry                                                                                      | Low                          |

Stale references to fix: `CLAUDE.md:100` example `src/pages/Rota.tsx` (now `src/pages/app/RotaBuilderPage.tsx`); `ci.yml:72` cites deleted `useOptimizedImage.ts`; a sentence quoted as from CLAUDE.md in `ci.yml:144`, `vitest.config.ts:54` and `grounding.test.ts:13` no longer exists there; `docs/design-review/team-mobile.png` is cited in three components (`TeamDirectoryView.tsx:51`, `ScrollRegion.tsx:45`, `HeaderBar.tsx:10`) but missing; `LOOP.md:58` cites `.gitignore:47` (now 49 to 51). The first review's `GEE-OS.md:242` item applied only to the superseded branch and is dropped.

**Numbering clash.** The first review cited GAP-118 as "five blueprint topics have no document". That row exists only on the superseded branch. On main, GAP-118 is the staff dashboard crash, closed by #317. The documentation gap needs the next free number on main (GAP-125) when it is recorded, and most of it is closed by the Standard files themselves.

## 3. Target shape: one home per fact

| Fact                                                                        | Single home                                                                                                        | Everything else                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Read order, harness-neutral rules, the docs-sync rule                       | `AGENTS.md`                                                                                                        | Links only                                                                                  |
| Project constraints, commands, hard rules summary                           | `CLAUDE.md`                                                                                                        | Shorter: summaries plus links, no restated counts                                           |
| Coding, tenancy and secret rules in full                                    | `docs/RULES.md`                                                                                                    | `CLAUDE.md` and agents cite section numbers                                                 |
| CI jobs, gates, Node, time zones, Deno pin, scheduled workflows with owners | One table in `qa/README.md`, beside how a QA audit is run (the Standard layout has no separate test-strategy file) | `CLAUDE.md`, `README.md` and agents link to it                                              |
| MCP position                                                                | `.agent/PROJECT.yml` `mcp_profile` (as on main). Split it out only if the restructure decides to                   | Others say where it is                                                                      |
| Document index                                                              | `docs/README.md`, with `.agent/PROJECT.yml` `sources_of_truth` pointing at it                                      | The root `README.md` points at it                                                           |
| Capability status                                                           | `docs/SAAS.md`                                                                                                     | Nowhere else states status                                                                  |
| Known defects a customer might meet                                         | `KNOWN-ISSUES.md`, generated from or linked to open `docs/SAAS.md` rows                                            | No second register                                                                          |
| Phase 2 list                                                                | `docs/SAAS.md` §9                                                                                                  | Others link                                                                                 |
| Edge Function count, cron jobs                                              | `docs/ARCHITECTURE.md` §10, `docs/DATA-MODEL.md` (today `SCHEMA.md` §6)                                            | Others link                                                                                 |
| Design rules, tokens, brand voice and claims                                | `docs/DESIGN-SYSTEM.md` (tokens in code: `src/index.css` `@theme`)                                                 | This pack's [04](04-DESIGN-AND-EXPERIENCE.md) merges into it; `brand.ts` mirrors the claims |
| Release evidence                                                            | `qa/LAUNCH-CHECKLIST.md`                                                                                           | Others link                                                                                 |
| Content model and social operations                                         | A section of `docs/PRODUCT-SPEC.md` (no new file), only if D9 and D11 are approved                                 |                                                                                             |

## 4. Making it stay consistent

Documents drift because nothing checks them. Add checks only for concrete invariants:

1. Extend `check:docs` to assert the CI job count from `ci.yml`, the Edge Function count from `supabase/functions/*/index.ts`, the Node version from `package.json`, and the screen counts, wherever they are written in prose.
2. Fix `plan-drift-audit.yml` and keep it running weekly, opening a pull request with its findings (§0.2). Its drift log is the human review of what scripts cannot check.
3. Turn on GitHub email notifications for failed scheduled workflows (already in [05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S7).
4. Give `rotaflow-qa-auditor.md` valid Claude Code frontmatter with an explicit `tools:` list, and mark it read-only against production.
5. Make `gee-os.md` reference `GEE-OS.md` for the loop and `qa/README.md` for CI, instead of restating either.
6. Hooks: the `Stop` docs-sync reminder (§0.2) and, optionally, a `PreToolUse` warning when an Edit or Write runs without `.agent/CURRENT-TASK.md`. Claude Code only; `AGENTS.md` keeps the same rules in words for Codex.
7. Add `check-docs-impact` to the `verify` job (§0.2) and widen `format:check` to `docs/**/*.md` so contradiction 14 closes.
8. Project memory: keep it empty or near-empty. Facts belong in the repository. Use memory only for owner preferences that are not project facts. Machine-wide rules in `~/.claude` are outside this repository and need their own approval.

## 5. Order of reshaping (after approval)

1. Record each decision in the README approval table.
2. Land the Standard restructure (§0.1) as its own pull request: moves and merges only, no new claims, every internal link updated.
3. Update `docs/SAAS.md`: reopen GAP-036, close BUG-014 and GAP-112, correct GAP-037, 050 and 080 and CAP-036, 044, 049 and 074, record the documentation gap as GAP-125, add approved plan items as planned rows.
4. Write the CI and gates table in `qa/README.md`. Then shorten `CLAUDE.md`, `README.md` and `gee-os.md` to link to it.
5. Merge [04](04-DESIGN-AND-EXPERIENCE.md) into `docs/DESIGN-SYSTEM.md`, including the visual language decision (D10). Add the positioning and claims in [06](06-WEBSITE-AND-CONTENT.md) §3 to its brand section.
6. Update `docs/PRODUCT-SPEC.md` (Phase 2 list, offline scope), `docs/ARCHITECTURE.md` (offline line references, public promise), `docs/UX-SPEC.md` (`/app/setup`), `docs/DEPLOYMENT.md` (recovery, alert owners), `qa/LAUNCH-CHECKLIST.md` (gate 28), `docs/SECURITY.md`.
7. Fix the contradictions and stale references in §2.
8. Fix the two agents, add the docs-sync rule to `AGENTS.md`, the `Stop` hook, `check-docs-impact` and the extended `check:docs`.
9. Run `npm run check:docs`, `npm run format:check` and a link check over `docs/` and `qa/`. Inspect the diff.
10. Document pull requests stay separate from any code.

## 6. Retiring this folder

1. Every approved decision has a destination recorded in the README table.
2. A search for `Plans 2026` across the repository finds no remaining links.
3. The owner reviews the reshaping pull requests.
4. The owner approves deleting `docs/Plans 2026/` by name.
5. Delete it in the same pull request. No archive copy in the tree. The folder is now committed (`4633e87`), so git history keeps it after deletion.

Until step 4, the folder stays exactly where it is.
