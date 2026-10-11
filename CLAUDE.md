# Claude Code project context

**RotaFlow**: a multi-tenant, offline-first **workforce scheduling PWA**. Organisations
build and share staff rotas; staff view shifts, clock in (GPS), request leave and swap
shifts. One Supabase database, tenants isolated by `org_id` and RLS. Roles: Super Admin,
Organisation Owner, Manager, Staff.

You are working inside a **static PWA** deployed to cPanel. This file holds the
constraints, commands and guardrails Claude Code loads on every session. Everything
else has one owning document, listed in **`docs/README.md`** ("Fact | Owning
document"). Read the owner rather than trusting a copy of a fact anywhere else,
including here.

## Where to look

| Need                                         | Owner                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| What is built, partial or missing            | `docs/SAAS.md`, the capability register and the only place status is set                            |
| Coding, tenancy and secret rules in full     | `docs/RULES.md`                                                                                     |
| Folder layout, data flow, offline, hooks     | `docs/ARCHITECTURE.md`                                                                              |
| Tables, RLS, grants, migration policy        | `docs/DATA-MODEL.md`                                                                                |
| Edge Function and RPC contracts              | `docs/API-SPEC.md`                                                                                  |
| Notifications and the `pg_cron` jobs         | `docs/NOTIFICATIONS-SPEC.md`                                                                        |
| Tokens, components, brand and voice          | `docs/DESIGN-SYSTEM.md`. A 2026-08-13 alternative was rejected; never implement from it             |
| Accessibility rules                          | `docs/ACCESSIBILITY.md`                                                                             |
| Screens, and whether each matches its design | `docs/UX-SPEC.md` (the `/loop` prompt is its last section); references in `docs/design/`            |
| Retention, erasure, backup, privacy map      | `docs/SECURITY.md`                                                                                  |
| Deploy, rollback, recovery, alert owners     | `docs/DEPLOYMENT.md`                                                                                |
| CI jobs and scheduled workflows              | `qa/README.md`, one table                                                                           |
| Dated audits and the release gates           | `qa/`                                                                                               |
| Who is actually working right now            | `src/lib/attendance.ts`. Roster arithmetic is not attendance; read its header before adding a count |
| One filter, one contract                     | `src/lib/filters.ts` and `src/hooks/useFilterState.ts`; a new filterable table adopts these         |

`docs/ACCOUNTS.md` is **gitignored on purpose**: it holds a real, live production
credential and this repository is public. Never cite it, copy from it, or add it to a
tracked file.

## How work is routed here

The entry point is **`AGENTS.md`**, which every harness reads; it routes here for
the facts. GEE OS was adopted on 4 September 2026 and its Standard documentation
profile on 10 October 2026. `.agent/PROJECT.yml` is the routing contract,
`.agent/MCP-PROFILE.yml` the MCP position (reads permitted, each mutation authorised
per task, no migration applied to production from a session), and `docs/README.md`
explains both. Four systems (GSD, gstack, the superpowers skills and GEE OS)
describe how to sequence work; in this repository GEE OS routes.

- **Default mode is Existing Application.** Improve a live system without losing
  behaviour that already works. Prefer the focused repair to the rewrite.
- **Write the task contract first** (`.agent/CURRENT-TASK.template.md` copied to
  the gitignored `.agent/CURRENT-TASK.md`): outcome, scope, authority, evidence.
  Being asked to review or diagnose is not being asked to edit.
- **Documentation stays current.** A change to behaviour updates the owning
  document in the same change, or records `Docs: no impact (the reason, in words)`.
  The rule and what enforces it are in `AGENTS.md`.
- **`NOT TESTED` is a valid result and the required one** when a check was not run.

## Commands

| Task             | Command                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev server       | `npm run dev`, port **5042**, `strictPort`. The port is duplicated into `playwright.config.ts`, the Supabase redirect allowlist and the Edge Function CORS list, so changing it is never a one-file edit         |
| Build            | `npm run build` (`tsc --noEmit`, then `vite build`). It must succeed with **no `.env`**: CI has none, and a missing `VITE_*` var has to degrade, not throw                                                       |
| One test file    | `npx vitest run src/lib/hours.test.ts`                                                                                                                                                                           |
| One test by name | `npx vitest run -t 'overnight'`                                                                                                                                                                                  |
| Watch tests      | `npm run test:watch`                                                                                                                                                                                             |
| One e2e spec     | `npx playwright test e2e/marketing.spec.ts`. Playwright starts `npm run dev` itself, against dev (not `dist/`) because the `-preview` routes it uses are `import.meta.env.DEV`-only                              |
| Lint one path    | `npx eslint src/pages/app/RotaBuilderPage.tsx`                                                                                                                                                                   |
| pgTAP            | `supabase start && supabase db reset && supabase test db && supabase stop`. **Needs Docker.** Reset first: the suite is not idempotent, and rows left by an e2e run fail assertions that count over whole tables |
| Load test        | `npm run load:test`, against a **local** stack only; see `qa/PERFORMANCE-AUDIT.md`                                                                                                                               |

**Gates.** `npm run typecheck`, `lint` (zero warnings; it is ESLint, not `tsc`, that
requires explicit return types), `format:check`, `test`, `check:bundle`,
`check:migrations`, `check:docs`, `check:export`, then Playwright and pgTAP. In CI,
`ci.yml` runs them as **six** jobs; which of them a merge requires, and the four
scheduled workflows with their current state and owners, are the table in
`qa/README.md`. Two of the jobs need Docker, so a green local run is a partial
signal. A scheduled workflow fails where nobody is standing: check
`gh run list --workflow=<name> --limit 3` before trusting what it protects.

**Two timezones, deliberately.** `vitest.config.ts` pins `TZ=Europe/London` (DST
exists, and a day-arithmetic bug on a clock-change date is invisible in UTC);
`ci.yml` pins `TZ=UTC` for the build. Neither covers the other's bug class; do not
unify them. CI runs **Node 22** (Node 20 is end-of-life, and jsdom 30 requires
`^22.22.2 || ^24.15.0 || >=26.0.0`).

**Pure logic stays in `src/lib`, and a test says so.** `src/lib/moduleBoundaries.test.ts`
fails when a module under `src/lib` takes a _runtime_ import from `src/services` or
`@/lib/supabase`. Type-only imports are fine. One file is allowlisted and tracked as
GAP-114 (`lib/reportsCatalogue.ts`).

## Hard constraints

- **Static build only.** Output is `dist/`, deployed by rsync over SSH with
  `cpanel-deploy` (`docs/DEPLOYMENT.md` for the `--keep` flags and the `.htaccess`
  composition). No server runtime of any kind on the origin.
- **TypeScript strict.** No implicit `any`; explicit return types on functions and
  hooks.
- **Styling:** Tailwind 4 utility classes, tokens from the `@theme` block in
  `src/index.css` (since 2026-10-09; there is no `tailwind.config.ts`, and
  NativeWind is not used).
- **Offloaded systems:** Supabase (Auth, DB and RLS, and Edge Functions, the only
  server compute), ImageKit (media), Sentry (monitoring), OpenRouter (AI, only from
  an Edge Function), Stripe (Checkout, Billing Portal and a signature-verified
  webhook, all Edge Functions; secrets never reach the client). Background work is
  `pg_cron` and `pg_net` inside Postgres: five jobs are defined in the migrations,
  listed in `docs/NOTIFICATIONS-SPEC.md`. `0093`'s scheduled alerts cover missed
  clock-ins and **expiring documents**, not leave. **Inngest is fully retired**
  (`0087`). Do not reintroduce a `VITE_*` variable for a service nothing calls:
  Vite inlines every one of them whether code reads it or not.
- **OpenRouter is the only AI provider.** Two callers, both server-side:
  `supabase/functions/ai-rota-assistant` (keyed by the `OPENROUTER_API_KEY`
  Supabase secret) and `scripts/plan-drift-audit.mjs` in CI (keyed by the
  `OPENROUTER_API_KEY` **GitHub Actions** secret: same name, different store).
  Model defaults to `openai/gpt-4o-mini`, overridable via `OPENROUTER_MODEL`.
- **Path alias:** import app code with `@/…` (maps to `src/`).

## Multi-tenancy guardrails

The rules most expensive to get wrong. `docs/RULES.md` §5 and `docs/DATA-MODEL.md`
§5 hold the detail.

- Every domain table carries `org_id`, and every query is scoped to the active org.
  Never write a cross-tenant query from the client.
- A new table enables RLS with membership-scoped policies (`is_org_member`,
  `has_org_role`) **before** it is used (`docs/DATA-MODEL.md` §5). This is checked:
  `supabase/tests/database/rls_invariants.test.sql` fails the build on a table with
  no RLS, a readable table with no policy, or any table grant to `anon`.
- UI role checks (`usePermissions`) are cosmetic. **RLS is the guard, and so is the
  database function behind an RPC**: a control whose only enforcement is a disabled
  button is not a control. Plan limits (`0070`), the AI entitlement (`0074`) and
  minimum cover (`0080`) were all browser-only until someone checked. RLS is also
  row-level only: a column a role must not read needs a grant or a view (`0150`).
- Server-only secrets (SMTP, Stripe, the VAPID private key) live in Supabase Edge
  Function secrets, never a `VITE_` variable. The notification shared secret is
  stricter: `0091` generates it inside Postgres and it lives only in `vault`, so
  there is no second copy to drift. The copy-in-two-places design is why the
  notification queue delivered nothing for a month.
- `anon` holds nothing in `public` beyond schema usage and one function grant
  (`0075`). Granting to `anon` is a decision to argue for in the pull request, and
  the pgTAP invariants will fail until the test is changed with that reason.

## Data access

- All Supabase reads and writes go through `src/services/*` or `src/lib/supabase.ts`.
  No component calls `supabase.from(...)` directly.
- An Edge Function acting on a user's behalf builds its client with the **caller's
  forwarded JWT**, so RLS scopes every query. `service_role` is for genuinely
  cross-tenant work (billing webhook, scheduled drain, calendar feed) and is the
  exception. `ai-rota-assistant` is the worked example (`docs/API-SPEC.md`).
- `supabase/functions/**` is Deno, excluded from `npm run typecheck` and `lint`.
  CI's `edge-types` job typechecks all eight entry points with a pinned Deno, which
  proves they compile and nothing more: **read them by hand**. RF-04 and RF-05 were
  replay and namespace bugs in the billing webhook, and both typechecked.
- The part that decides something can be tested: a module with no Deno globals runs
  under vitest. `ai-rota-assistant/grounding.ts` and `stripe-webhook/reconcile.ts`
  are the worked examples.

## Scope discipline

Do not invent top-level folders. If a file does not fit `docs/ARCHITECTURE.md`, say
so in the pull request rather than creating an ad-hoc directory.

**Phase 2, unless a decision says otherwise** (this is the one list; each item has a
⚫ row in `docs/SAAS.md`): SSO/SCIM, a public API, outbound webhooks, payroll
integrations, per-tenant branding. SMS is a reserved seam. **Billing is not Phase 2**:
Stripe Checkout, the Billing Portal, the webhook and the platform billing console
all ship.

## Working style

- Prefer editing an existing file over creating a new one.
- Keep components small and typed; SDK setup in `src/lib`, data calls in
  `src/services`, reusable logic in `src/hooks`.
- When unsure about the database shape, re-read `docs/DATA-MODEL.md` rather than
  guessing.

## Tooling that is not part of this repository

The gstack skills, GSD commands and the GEE OS package are installed on the owner's
machine, not here, and are described in the machine's own `~/.claude/CLAUDE.md`. A
copied inventory fell ten skills behind and published a machine layout in a public
repository, so none is kept here. `.agent/PROJECT.yml` names the specialists this
project routes to, and `CODEX.md` says what to do when one is not available.
