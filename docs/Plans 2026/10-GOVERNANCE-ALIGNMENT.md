# 10. Governance alignment and retiring this folder

The owner wants every instruction, rule, agent, hook, memory, README and CI workflow to agree, so nothing drifts or breaks the build. This file says what is inconsistent today, the target shape, and the exact order to reshape it once the plan is approved.

## 1. Inventory (VERIFIED, 10 Oct 2026)

| Item                                                                              | State                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                                       | Entry point and pointer. Holds harness-neutral rules                                                                                        |
| `CLAUDE.md`                                                                       | Canonical project directives. Long, with some facts duplicated elsewhere                                                                    |
| `CODEX.md`                                                                        | Codex mapping                                                                                                                               |
| `.agent/PROJECT.yml`, `.agent/MCP-PROFILE.yml`, `.agent/CURRENT-TASK.template.md` | GEE OS routing. MCP position moved to `MCP-PROFILE.yml` on 7 Oct                                                                            |
| `docs/00-foundation/RULES.md`, `GEE-OS.md`                                        | Coding standards, GEE OS explanation                                                                                                        |
| `.claude/settings.json`                                                           | Denies reading `.env` files. **No hooks**                                                                                                   |
| `.claude/agents/gee-os.md`                                                        | Routing agent                                                                                                                               |
| `.claude/agents/testing/rotaflow-qa-auditor.md`                                   | QA agent. Frontmatter in a non-Claude-Code format, no `tools:` key, so it inherits every tool                                               |
| Claude project memory                                                             | **Empty**. No `MEMORY.md`                                                                                                                   |
| Nested READMEs                                                                    | `docs/0*/README.md`, `qa/README.md`, this folder                                                                                            |
| CI                                                                                | `ci.yml` (6 jobs), `backup.yml` (green), `auth-config.yml` (red since 14 Sep), `plan-drift-audit.yml` (red), `codeql.yml`, `dependabot.yml` |

## 2. Contradictions to resolve

| #   | Statement                                                                                             | Conflicts with                                               | Severity                     |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| 1   | `.claude/agents/gee-os.md:65` "CI runs four jobs"                                                     | `ci.yml` has six                                             | High                         |
| 2   | `README.md:70` "Node.js >= 20"                                                                        | `package.json` engines `>=22.0.0`                            | High                         |
| 3   | `CLAUDE.md:222` names two scheduled checks                                                            | Four exist; two are red now                                  | High                         |
| 4   | `CLAUDE.md:229` "never succeeded"                                                                     | Backup green since 5 Sep; auth-config red since 14 Sep       | High                         |
| 5   | `CLAUDE.md:86`, `AGENTS.md:50`, `CODEX.md:76,95`, `GEE-OS.md:190`: PROJECT.yml holds the MCP position | Moved to `MCP-PROFILE.yml`                                   | Medium                       |
| 6   | `gee-os.md:52` "Never grant to anon"                                                                  | `CLAUDE.md:181` allows it if argued in the PR                | Medium                       |
| 7   | `CLAUDE.md:197` "every gate blocks a merge"                                                           | `scheduled-checks` only warns; branch protection not checked | Medium                       |
| 8   | `PRD.md:104` billing is Phase 2; `README.md:38` and `CLAUDE.md:261` give different Phase 2 lists      | Billing shipped; one list needed                             | Medium                       |
| 9   | `RULES.md:3,72`, `README.md:61`: CodeRabbit enforces RULES.md                                         | No CodeRabbit config in the repo                             | Medium                       |
| 10  | `SAAS.md:3` "Do not start a sixth" plan                                                               | This folder is a parallel plan                               | Medium (temporary by design) |
| 11  | `CLAUDE.md:129`, `RULES.md:43`, `README.md:52`: NativeWind                                            | Not in `package.json`                                        | Low                          |
| 12  | `CLAUDE.md:201`: typecheck catches missing return types                                               | That is ESLint (`eslint.config.js:73`)                       | Low                          |
| 13  | `RULES.md:44` "No `.css`"                                                                             | `src/index.css` is the Tailwind entry                        | Low                          |
| 14  | `README.md:183` Prettier covers docs                                                                  | `format:check` covers `src/**` only                          | Low                          |
| 15  | `RULES.md:20-23` import direction not enforced                                                        | `moduleBoundaries.test.ts` enforces lib-to-services          | Low                          |
| 16  | `CLAUDE.md:63` "four systems"; `GEE-OS.md:145` "three"                                                | Pick one                                                     | Low                          |
| 17  | `gee-os.md` loop omits LEARN; uses `N/A`                                                              | `GEE-OS.md:43` includes LEARN; `NOT APPLICABLE`              | Low                          |
| 18  | Screen counts: 13+26, 14 public, "40 screens"                                                         | Not checked by `check:docs`                                  | Low                          |
| 19  | `plan-drift-audit.yml:22` says `contents: read` only                                                  | `:79` also grants `id-token: write`                          | Low                          |
| 20  | `CLAUDE.md:136` fourth cron job covers "leave expiry"                                                 | `0093` covers document expiry                                | Low                          |

Stale references to fix: `CLAUDE.md:100` example `src/pages/Rota.tsx` (now `src/pages/app/RotaBuilderPage.tsx`); `ci.yml:72` cites deleted `useOptimizedImage.ts`; a sentence quoted as from CLAUDE.md in `ci.yml:144`, `vitest.config.ts:54` and `grounding.test.ts:13` no longer exists there; `docs/03-design/design-review/team-mobile.png` is cited in three components but missing; `LOOP.md:58` cites `.gitignore:47` (now 50 to 52); `GEE-OS.md:242` says "below" for a section above.

## 3. Target shape: one home per fact

| Fact                                                                        | Single home                                                                   | Everything else                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Read order, harness-neutral rules                                           | `AGENTS.md`                                                                   | Links only                                                   |
| Project constraints, commands, hard rules summary                           | `CLAUDE.md`                                                                   | Shorter: summaries plus links, no restated counts            |
| Coding, tenancy and secret rules in full                                    | `RULES.md`                                                                    | `CLAUDE.md` and agents cite section numbers                  |
| CI jobs, gates, Node, time zones, Deno pin, scheduled workflows with owners | One table in `docs/06-quality/TEST-STRATEGY.md` (new, closes part of GAP-118) | `CLAUDE.md`, `README.md` and agents link to it               |
| MCP position                                                                | `.agent/MCP-PROFILE.yml`                                                      | Others say "see MCP-PROFILE.yml"                             |
| Document index                                                              | `.agent/PROJECT.yml` `sources_of_truth` and `SAAS.md` §0                      | README points at them                                        |
| Capability status                                                           | `SAAS.md`                                                                     | Nowhere else states status                                   |
| Phase 2 list                                                                | `SAAS.md` §9                                                                  | Others link                                                  |
| Edge Function count, cron jobs                                              | `ARCHITECTURE.md` §10, `SCHEMA.md` §6                                         | Others link                                                  |
| Design rules                                                                | `DESIGN.md`                                                                   | This pack's [04](04-DESIGN-AND-EXPERIENCE.md) merges into it |
| Brand voice and claims                                                      | `BRAND.md`                                                                    | `brand.ts` mirrors it in code                                |
| Content model and social operations                                         | A short `docs/01-product/CONTENT.md` (new, only if D9 and D11 are approved)   |                                                              |

## 4. Making it stay consistent

Documents drift because nothing checks them. Add checks only for concrete invariants:

1. Extend `check:docs` to assert the CI job count from `ci.yml`, the Edge Function count from `supabase/functions/*/index.ts`, and the Node version from `package.json` wherever they are written in prose.
2. Fix `plan-drift-audit.yml` and keep it running weekly. Its drift log is the human review of what scripts cannot check.
3. Turn on GitHub email notifications for failed scheduled workflows (already in [05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S7).
4. Give `rotaflow-qa-auditor.md` valid Claude Code frontmatter with an explicit `tools:` list, and mark it read-only against production.
5. Make `gee-os.md` reference `GEE-OS.md` for the loop and `TEST-STRATEGY.md` for CI, instead of restating either.
6. Optional hook: a `PreToolUse` warning in `.claude/settings.json` when an Edit or Write runs without `.agent/CURRENT-TASK.md`. Claude Code only; `AGENTS.md` keeps the same rule in words for Codex.
7. Project memory: keep it empty or near-empty. Facts belong in the repository. Use memory only for owner preferences that are not project facts. Machine-wide rules in `~/.claude` are outside this repository and need their own approval.

## 5. Order of reshaping (after approval)

1. Record each decision in the README approval table.
2. Update `SAAS.md` first: reopen GAP-036, close BUG-014 and GAP-112, correct GAP-037, 050 and 080 and CAP-036, 044, 049 and 074, add approved plan items as planned rows.
3. Write `TEST-STRATEGY.md`. Then shorten `CLAUDE.md`, `README.md` and `gee-os.md` to link to it.
4. Merge [04](04-DESIGN-AND-EXPERIENCE.md) into `DESIGN.md`. Update `BRAND.md` with the positioning and claims in [06](06-WEBSITE-AND-CONTENT.md) §3.
5. Update `PRD.md` (Phase 2 list, offline scope), `OFFLINE-SPEC.md` (line references, public promise), `SCREENS.md` (`/app/setup`), `DEPLOYMENT.md` (recovery, alert owners), `PWA-RELEASE-GATES.md` (gate 28), `DATA_LIFECYCLE.md`.
6. Fix the contradictions and stale references in §2.
7. Fix the two agents and, if approved, add the hook.
8. Run `npm run check:docs`, `npm run format:check` and a link check over `docs/`. Inspect the diff.
9. One pull request for the document reshaping, separate from any code.

## 6. Retiring this folder

1. Every approved decision has a destination recorded in the README table.
2. A search for `Plans 2026` across the repository finds no remaining links.
3. The owner reviews the reshaping pull request.
4. The owner approves deleting `docs/Plans 2026/` by name.
5. Delete it in the same pull request. No archive copy in the tree. The folder is untracked today, so commit it once (with the owner's approval) before deleting it, otherwise git history will not keep it.

Until step 4, the folder stays exactly where it is.
