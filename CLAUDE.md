# Claude Code — Project Context

**RotaFlow** — a multi-tenant, offline-first **workforce scheduling PWA**. Organisations
build and share staff rotas; staff view shifts, clock in (GPS), request leave and swap
shifts, online or offline. One Supabase database, tenants isolated by `org_id` + RLS.
Roles: Super Admin · Organisation Owner · Manager · Staff.

You are working inside a **static, offline-first PWA** deployed to cPanel.
Treat the constraints below as ground truth for every response.

## Load these first

| Need                      | File                   |
| ------------------------- | ---------------------- |
| Coding standards          | `docs/RULES.md`        |
| Folder layout & data flow | `docs/ARCHITECTURE.md` |
| DB tables, types, RLS     | `docs/SCHEMA.md`       |
| Approved hook contracts   | `docs/HOOKS.md`        |
| Visual/design tokens      | `docs/DESIGN.md`       |
| Product scope & metrics   | `docs/PRD.md`          |
| Deploy process & safety   | `docs/DEPLOYMENT.md`   |
| What is built vs missing  | `docs/SAAS.md`         |

`docs/SAAS.md` is the capability register and the single plan of record. Check a
capability's row there before assuming a feature exists — several documents in this
repo have claimed features that do not, and vice versa. Any PR that changes a
capability's status updates its row in the same PR.

## Also in `docs/`, when the task touches it

| Need                                    | File                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Is this screen built, partial or absent  | `docs/SCREENS.md` — every design mapped against the real route table in `src/App.tsx`         |
| Does the built screen match its design   | `docs/LOOP.md` — the `/loop` design-match prompt, driven against `localhost:5042`             |
| The design references themselves         | `docs/design/*.png` — 1920-wide designs exported at ~87%; measure the scale before resizing type |
| Organisation section reference           | `docs/ORGANISATION_WORKSPACE.html` — the sole reference for the Organisation workspace         |
| Platform (Super Admin) console reference | `docs/PLATFORM_CONSOLE.html`                                                                  |
| Positioning, tone, naming                | `docs/BRAND.md`                                                                               |
| Retention, erasure, GDPR, subprocessors  | `docs/DATA_LIFECYCLE.md` — technical record, not the published Privacy Notice                 |
| Metrics and the event taxonomy           | `docs/OBSERVABILITY.md` — what computes each success metric, and whether that data exists yet  |
| How a full QA audit is run               | `docs/Working-Agent.md` — the spec behind the `rotaflow-qa-auditor` agent                     |
| What the last full audit found           | `docs/QA-AUDIT-REPORT.md` — a dated snapshot (14 Aug 2026), not current state; `docs/SAAS.md` is |
| What actually works without a network    | `docs/OFFLINE-SPEC.md` — per feature, and it is narrower than "offline-first" implies          |
| Release evidence before a deploy         | `docs/PWA-RELEASE-GATES.md` — recorded statuses, not a checklist to tick from memory           |

`docs/DESIGN_EXPLORATION.md` is a **rejected** proposal kept as a record of the
decision. `docs/DESIGN.md` is the enforced source of truth; do not implement from
the exploration.

There is also a `docs/ACCOUNTS.md`. It is **gitignored on purpose** — it holds a
real, live production credential and this repository is public. Never cite it,
copy from it, or add it to a tracked file.

## How work is routed here

This project adopted **GEE OS** on 4 September 2026. `.agent/PROJECT.yml` is the
adoption and the routing contract; `docs/GEE-OS.md` explains what it changes,
what it deliberately leaves out, and how it settles the fact that four different
systems installed on this machine all describe how to sequence work.

**The entry point is `AGENTS.md`, not this file.** That is deliberate: it is the
one document every harness reads, and it routes to this one for the facts. Claude
Code loads `CLAUDE.md` automatically, Codex is pointed here by `CODEX.md`, and
neither holds a rule the other does not. Before starting work that changes
anything, copy `.agent/CURRENT-TASK.template.md` to `.agent/CURRENT-TASK.md` and
fill it in; that file is gitignored, because a contract that outlives its task is
just stale documentation.

Three things apply to every task, and they are the whole of what an agent needs
to hold in mind:

- **Default mode is Existing Application.** Improve a live system without losing
  behaviour that already works. Prefer the focused repair to the rewrite.
- **Write the task contract before changing anything**: outcome, scope, authority,
  evidence. Authority does not widen because the task turned out to be hard, and
  being asked to review or diagnose is not being asked to edit.
- **`NOT TESTED` is a valid result and the required one** when a check was not
  run. A completion report that omits what was not verified will be read as
  though everything was.

`.agent/PROJECT.yml` also records the MCP position: reads are permitted, every mutation
is authorised per task, and no session applies a migration to production —
migrations reach it by merging a PR, which is a slower path on purpose.

## Commands

| Task                | Command                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev server          | `npm run dev` — port **5042**, `strictPort`. The port is duplicated into `playwright.config.ts`, the Supabase redirect allowlist and the Edge Function CORS list, so changing it is never a one-file edit                       |
| Build               | `npm run build` (`tsc --noEmit`, then `vite build`). It must succeed with **no `.env`** — CI has none, and a missing `VITE_*` var has to degrade, not throw                                                                     |
| One test file       | `npx vitest run src/lib/hours.test.ts`                                                                                                                                                                                       |
| One test by name    | `npx vitest run -t 'overnight'`                                                                                                                                                                                              |
| Watch tests         | `npm run test:watch`                                                                                                                                                                                                         |
| One e2e spec        | `npx playwright test e2e/marketing.spec.ts` — Playwright starts `npm run dev` itself, against dev (not `dist/`) because the `-preview` routes it uses are `import.meta.env.DEV`-only                                           |
| Lint one path       | `npx eslint src/pages/Rota.tsx`                                                                                                                                                                                              |
| pgTAP               | `supabase start && supabase test db && supabase stop` — **needs Docker**. Without it this gate cannot run locally at all, so an RLS regression reaches CI unseen                                                               |

**Two timezones, deliberately.** `vitest.config.ts` pins `TZ=Europe/London` (DST
exists, and a day-arithmetic bug on a clock-change date is invisible in UTC);
`.github/workflows/ci.yml` pins `TZ=UTC` for the build. Neither zone covers the
other's bug class — do not "unify" them. CI runs **Node 20**, so anything that
constructs a Supabase client at module scope dies on the missing native
`WebSocket`; keep pure logic in `src/lib`, not `src/services`, and unit tests
never import a service.

## Hard constraints

- **Static build only.** Output is `dist/`, deployed by rsync over SSH with
  `cpanel-deploy` (see `docs/DEPLOYMENT.md` for the `--keep` flags and the
  `.htaccess` composition). No server runtime of any kind on the origin.
- **TypeScript strict.** No implicit `any`; explicit return types on functions
  and hooks.
- **Styling:** NativeWind / Tailwind classes, tokens from `tailwind.config.ts`.
- **Offloaded systems:** Supabase (Auth/DB + RLS + Edge Functions — the only
  server compute, see `supabase/functions/`), ImageKit (media), Sentry
  (monitoring), OpenRouter (AI, called only from an Edge Function — key never
  reaches the client), **Stripe** (billing: Checkout, Billing Portal and a
  signature-verified webhook, all three Edge Functions; secret and webhook
  secret never reach the client). Background work is `pg_cron` + `pg_net`
  inside Postgres — **four** jobs, verified running on 2026-08-31: the
  notification outbox drain (every minute), nightly retention (02:15), the
  health probe (every 5 minutes) and scheduled alerts (`0093`, every 15
  minutes, leave expiry and missed clock-in). This list said three until the
  fourth was found by reading `cron.job` rather than the docs. **Inngest is fully retired** (`0087`, completed 2026-08-31):
  nothing dispatches to it, its Edge Function is gone from the repository and
  from the project, and its write-only key is out of `.env` and out of the
  bundle. Do not reintroduce a `VITE_*` variable for a service nothing calls —
  Vite inlines every one of them whether code reads it or not.
- **OpenRouter is the only AI provider.** Nothing in this project calls
  Anthropic, OpenAI or any other vendor directly. Two callers, both
  server-side: `supabase/functions/ai-rota-assistant` (product AI, keyed by
  the `OPENROUTER_API_KEY` Supabase secret) and
  `scripts/plan-drift-audit.mjs`, run by CI (keyed by the
  `OPENROUTER_API_KEY` **GitHub Actions** secret — same name, different
  store). Model defaults to `openai/gpt-4o-mini`, overridable via
  `OPENROUTER_MODEL`. If you add AI anywhere, it goes through OpenRouter.
- **Path alias:** import app code with `@/…` (maps to `src/`).

## Multi-tenancy guardrails

These were in `AGENTS.md` until 30 August 2026, when the two files were merged —
they are the rules most expensive to get wrong, and they belong where the agent
actually reads them.

- Every domain table carries `org_id`, and every query is scoped to the active
  org. Never write a cross-tenant query from the client.
- A new table enables RLS with membership-scoped policies (`is_org_member`,
  `has_org_role`) **before** it is used. See `docs/SCHEMA.md` §5. Since
  2026-08-31 this is checked rather than trusted:
  `supabase/tests/database/rls_invariants.test.sql` fails the build on a table
  with no RLS, a readable table with no policy, or any grant to `anon`.
- UI role checks (`usePermissions`) are cosmetic. **RLS is the guard, and so is
  the database function behind an RPC** — a control whose only enforcement is a
  disabled button is not a control. That sentence has been earned repeatedly:
  plan limits (`0070`), the AI entitlement (`0074`) and minimum cover (`0080`)
  were all enforced only in the browser until someone checked.
- Server-only secrets — SMTP, Stripe, the VAPID private key — live in Supabase
  Edge Function secrets. Never a `VITE_` variable, which is compiled into the
  bundle every visitor downloads. The notification shared secret is stricter
  still: `0091` generates it inside Postgres and it lives only in `vault`, so
  no human ever handles it and there is no second copy to keep in step. That
  is not fastidiousness — the copy-in-two-places design is exactly why the
  notification queue delivered nothing for a month.
- `anon` holds nothing in `public` beyond schema usage and one function grant
  (`0075`). If you find yourself granting to `anon`, that is a decision to argue
  for in the PR, and CI will ask you to write down why.

## Data access

- All Supabase reads and writes go through `src/services/*` or
  `src/lib/supabase.ts`. No component calls `supabase.from(...)` directly.
- An Edge Function acting on a user's behalf builds its client with the
  **caller's forwarded JWT**, so RLS scopes every query for free. `service_role`
  is for genuinely cross-tenant work — billing webhooks, scheduled jobs — and is
  the exception, never the default. `ai-rota-assistant` is the worked example:
  JWT for everything, `service_role` for the single `audit_write` call that
  `authenticated` is deliberately not allowed to make.

## Quality gates

Every one of these runs in CI and blocks a merge:

| Gate                       | What it catches                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | implicit `any`, missing return types                                                                                                                                              |
| `npm run lint`             | zero warnings tolerated (`--max-warnings 0`)                                                                                                                                      |
| `npm run format:check`     | a separate gate from lint; green tsc/eslint does not imply it                                                                                                                     |
| `npm test`                 | pure-logic unit suite over `src/lib`, `src/services`, any pure module extracted out of an Edge Function, and component tests that opt into jsdom with `@vitest-environment jsdom` |
| `npm run check:bundle`     | size budgets, and that no DEV preview page shipped                                                                                                                                |
| `npm run check:migrations` | destructive SQL without a `-- SAFETY(...)` declaration                                                                                                                            |
| `npm run check:docs`       | counts written into prose that no longer match the tree                                                                                                                           |
| `npm run check:export`     | a tenant table added to the schema but left out of the organisation data export                                                                                                   |
| `npx playwright test`      | 40 screens rendered and scanned for WCAG basics                                                                                                                                   |
| `supabase test db`         | pgTAP, the only gate that can catch an RLS regression                                                                                                                             |

`ci.yml` runs these as **six** jobs, not one: `verify` (everything up to
`check:export`, plus `npm audit --audit-level=high`), `e2e`, `e2e-authenticated`
(boots a local Supabase stack and signs a real user up), `db-tests` (the pgTAP
run), `edge-types` (a pinned Deno 2.9.5 typecheck of all eight Edge entry
points, added 2026-09-05) and `scheduled-checks` (which reads whether
`backup.yml` and `auth-config.yml` have ever succeeded and annotates the pull
request). The two Supabase jobs need Docker and the Supabase CLI, so a green
local `verify` is a partial signal — a merge can still go red on a job you
cannot run here.

Two checks run on a schedule rather than on a merge, because they read live
state no pull request can change: `.github/workflows/backup.yml` (a nightly
encrypted dump) and `.github/workflows/auth-config.yml` (Supabase Auth settings
against the baseline in `scripts/check-auth-config.mjs`). Both fail loudly when
their secrets are missing, which is the point — a check that passes when it
cannot see anything is worse than none, because it is believed.

⚠️ **Both are failing right now, and have never succeeded** (GAP-036, verified
2026-08-31). The repository holds one secret, `OPENROUTER_API_KEY`; `backup.yml`
needs `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`, `auth-config.yml` needs
`SUPABASE_ACCESS_TOKEN`. So there is **no backup of production**, and nothing is
watching the Auth settings. Failing loudly was not enough: **a scheduled
workflow fails where nobody is standing.** It blocks no merge, marks no pull
request red, and appears on no screen anyone opens — unlike the gates in the
table above, which are seen whether or not you go looking. Before trusting
either of these, check the Actions tab:
`gh run list --workflow=backup.yml --limit 3`. The runbook for configuring all
three secrets — where each comes from, and what a green run does and does not
prove — is `docs/DEPLOYMENT.md` § "Recovery".

`supabase/functions/**` is Deno and is excluded from `npm run typecheck` and
`npm run lint`. Since 2026-09-05 the `edge-types` job typechecks all eight entry
points with a pinned Deno and a committed `deno.lock`, so "it compiles" is no
longer an open question — but that is the cheapest class of defect there is, and
**reading those files is still the only check on what they do**. RF-04 and RF-05
were both replay and namespace bugs in the billing webhook, and both typechecked
perfectly.

The part that can be tested is the part that decides something. A module with no
Deno globals in it runs unchanged under vitest: `ai-rota-assistant/grounding.ts`
and `stripe-webhook/reconcile.ts` are the two worked examples, and extracting the
decision-making part of a handler that way is preferred to leaving it untested
inside one.

## Scope discipline

Do not invent top-level folders. If a file does not fit `docs/ARCHITECTURE.md`,
say so in the PR rather than creating an ad-hoc directory.

Phase 2, unless a decision says otherwise: SSO/SCIM, a public API, outbound
webhooks, payroll integrations, per-tenant branding. SMS is a reserved seam.
**Billing is not Phase 2 any more** — Stripe Checkout, the Billing Portal and a
signature-verified webhook all ship, and the platform billing console is built.
`AGENTS.md` said otherwise until this merge, which is the kind of drift the
register exists to catch.

## Working style

- Prefer editing an existing file over creating a new one.
- Keep components small and typed; put SDK setup in `src/lib`, data calls in
  `src/services`, reusable logic in `src/hooks`.
- When unsure about the DB shape, re-read `docs/SCHEMA.md` rather than guessing.
- Edge Functions acting on a user's behalf should forward the caller's JWT into
  their Supabase client (see `supabase/functions/ai-rota-assistant`) so RLS
  scopes queries — not the `service_role` key. `supabase/functions/**` is Deno
  and excluded from `npm run typecheck`/`lint`; review it by hand.

# Tooling that is not part of this repository

The gstack skills, GSD commands and the GEE OS package are installed on the
owner's machine, not here, and their inventories are described in the machine's
own `~/.claude/CLAUDE.md`. This file used to carry a copy of the gstack skill
list, which had already fallen ten skills behind the real one — a list nobody
here can maintain is a list that lies, and this repository is public, so the
copy also published a machine layout for no benefit.

What the project genuinely depends on is recorded where it is enforced:
`.agent/PROJECT.yml` names the specialists it routes to, and `CODEX.md` says
what to do when one of them is not available in the harness you are running.
