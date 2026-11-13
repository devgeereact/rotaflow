# Claude Code project context

**RotaFlow**: a multi-tenant, offline-first **workforce scheduling PWA**. Organisations
build and share staff rotas; staff view shifts, clock in (GPS), request leave and swap
shifts. Tenants are isolated by `org_id`, enforced in PHP by `backend/src/Scope.php`
and `backend/src/Ctx.php`. Roles: Super Admin, Organisation Owner, Manager, Staff.

The stack: a static React 19 PWA built to `dist/`, a PHP 8.4 JSON API under `backend/`
(router `backend/src/Api.php`, one module per area in `backend/src/Mod/*.php`), a
MariaDB database (migrations in `backend/migrations`), and Clerk email-code sign-in
(tokens verified by `backend/src/Jwt.php`). It is live at `https://rotaflow.space`
(`release.json`). The earlier Supabase version of the product is retired.

This file holds the
constraints, commands and guardrails Claude Code loads on every session. Everything
else has one owning document, listed in **`docs/README.md`** ("Fact | Owning
document"). Read the owner rather than trusting a copy of a fact anywhere else,
including here.

## Where to look

| Need                                         | Owner                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| What is built, partial or missing            | `docs/SAAS.md`, the capability register and the only place status is set                            |
| What to work on next                         | The work queue at the top of `docs/SAAS.md`, the one list of open work and owner actions            |
| Coding, tenancy and secret rules in full     | `docs/RULES.md`                                                                                     |
| Folder layout, data flow, offline, hooks     | `docs/ARCHITECTURE.md`                                                                              |
| Tables, access checks, migration policy      | `docs/DATA-MODEL.md`                                                                                |
| API routes and contracts                     | `docs/API-SPEC.md`                                                                                  |
| Notifications: outbox, Dispatcher, cron      | `docs/NOTIFICATIONS-SPEC.md`                                                                        |
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
| Dev server       | `pnpm run dev`, port **5042**, `strictPort` (`vite.config.ts`, in both `server` and `preview`). The port is duplicated into `playwright.config.ts` (`E2E_PORT` overrides it) and `scripts/walk.sh`, so changing it is never a one-file edit: run `git grep -n 5042` first |
| Build            | `pnpm run build` (`tsc --noEmit`, `vite build`, then `scripts/prerender.mjs`). It must succeed with **no `.env`**: the `verify` job in `.github/workflows/ci.yml` builds without one, and a missing `VITE_*` var has to degrade, not throw (`src/lib/env.ts`) |
| One test file    | `pnpm exec vitest run src/lib/hours.test.ts`                                                                                                                                                                           |
| One test by name | `pnpm exec vitest run -t 'overnight'`                                                                                                                                                                                  |
| Watch tests      | `pnpm run test:watch`                                                                                                                                                                                             |
| PHP suites       | `pnpm run test:php` (`scripts/test-db.sh up`, then `php backend/tests/run.php`, which runs each file in `backend/tests/suites/` in its own process on a fresh database; 42 suites). It needs a throwaway local MariaDB: `mariadbd` and `php` on the PATH, listening on 127.0.0.1 port 3308 with data under `.local-test/`. `pnpm run check:php` lints every `backend` PHP file with `php -l`, then runs the same suites |
| One e2e spec     | `pnpm exec playwright test e2e/marketing.spec.ts`. Playwright starts `pnpm run dev` itself, against dev (not `dist/`) because the `-preview` routes it uses are `import.meta.env.DEV`-only (`playwright.config.ts`). 6 files in `e2e/` still mention `E2E_LIVE_SUPABASE` or `supabase start` (`git grep -lE 'E2E_LIVE_SUPABASE\|supabase start' -- e2e`) and are shaped for the retired stack |
| Lint one path    | `pnpm exec eslint src/pages/app/RotaBuilderPage.tsx`                                                                                                                                                                   |
| Load test        | `pnpm run load:test` runs `scripts/load-test-workforce.mjs`, which is written for the retired local Supabase stack (service-role seed, GoTrue sign-in); it does not exercise the PHP API                                  |

**Gates.** `pnpm run check` is the one gate: `lint` (zero warnings; it is ESLint, not
`tsc`, that requires explicit return types), `format:check`, `typecheck`, `test`,
`build`, `check:bundle`, `check:migrations`, `check:docs`, `check:export` and
`check:php` (`package.json`). `check:migrations` and `check:export` still read the legacy `supabase/migrations`
(`scripts/check-migration-safety.mjs`, `scripts/check-export-coverage.mjs`), not
`backend/migrations`. In CI, `ci.yml` runs
**six** jobs; which of them a merge requires, and the scheduled workflows with their
current state and owners, are the table in `qa/README.md`. Three of the six jobs
(`edge-types`, `e2e-authenticated`, `db-tests`) and the workflow `auth-config.yml` still target
the retired Supabase stack and are repaired in a later phase. `backup.yml` was removed on 13 Nov 2026.
Whether GitHub Actions runs for the owner's account is `NOT VERIFIED` (owner action O14 in
`docs/SAAS.md`). A scheduled workflow fails where nobody is standing: check
`gh run list --workflow=<name> --limit 3` before trusting what it protects. The PHP
suites need a MariaDB, so a green local run without one is a partial signal.

**Two timezones, deliberately.** `vitest.config.ts` pins `TZ=Europe/London` (DST
exists, and a day-arithmetic bug on a clock-change date is invisible in UTC);
`ci.yml` pins `TZ=UTC` for the build. Neither covers the other's bug class; do not
unify them. CI and local development run **Node 24** (`.node-version`, and
`engines.node` in `package.json`).

**Pure logic stays in `src/lib`, and a test says so.** `src/lib/moduleBoundaries.test.ts`
fails when a module under `src/lib` takes a _runtime_ import from `src/services`,
`@/lib/api` or `@clerk/*`. Type-only imports are fine. One file is allowlisted and
tracked as GAP-114 (`lib/reportsCatalogue.ts`).

## Hard constraints

- **The front end is static; the API is PHP.** The browser app is built to `dist/`
  and served as files. The API is PHP under `backend/`, run by the cPanel host out of
  a private app root outside the web root, with only `backend/public/api` inside the
  web root (`release.json`, `parts`). It is released with `pnpm release`
  (`scripts/release.mjs`; a dry run unless `--go`); `pnpm verify` runs the checks, the
  build and the upload guard without contacting the host. The
  live root `.htaccess` is composed by `pnpm htaccess` (`scripts/htaccess.mjs`), never
  released with the build. `docs/DEPLOYMENT.md` holds the procedure.
- **TypeScript strict.** No implicit `any`; explicit return types on functions and
  hooks (`tsconfig.json`).
- **Styling:** Tailwind 4 utility classes, tokens from the `@theme` block in
  `src/index.css` (since 2026-10-09; there is no `tailwind.config.ts`, and
  NativeWind is not used).
- **External services:** Clerk (sign-in), Stripe (Checkout, Billing Portal and a
  signature-verified webhook: `backend/src/StripeClient.php`, `backend/src/Mod/Billing.php`,
  `backend/src/Mod/StripeWebhook.php`; secrets stay server-side), Sentry (front end
  only, `src/lib/sentry.ts`; there is no PHP-side Sentry), OpenRouter (AI), SMTP and
  web push (`backend/src/SmtpMailer.php`, `backend/src/WebPushSender.php`), and the
  host's own file store (`backend/src/FileStore.php`, outside every web root). Background
  work is cPanel cron: `backend/bin/cron.php` runs every five minutes live and calls the
  `cron()` of the seven modules that define one; `Notifications::cron` drains the
  notification outbox through `backend/src/Dispatcher.php`. Missed clock-in alerts are
  raised in `backend/src/Mod/Notifications.php` and expiring-document reminders in
  `backend/src/Mod/Compliance.php`. The database backup is `backend/bin/backup.php`,
  installed on the live host with a six-hourly cron line and proven by a restore check
  on 2026-11-08 (recorded in `docs/AUDIT.md` and `docs/DEPLOYMENT.md`); its off-site
  copy, failure alert and scheduled restore drill are still open (`docs/DEPLOYMENT.md`).
  Do not reintroduce a `VITE_*` variable for a service nothing calls: Vite inlines every
  one of them whether code reads it or not.
- **Retired:** Supabase. The project is archived read-only (owner decision of 8
  November 2026, `NOT VERIFIED` from the repository); the tag
  `live-supabase-2026-11-01` holds the old `main`; and the `supabase/` folder is a
  legacy source that stays in the tree until a later phase (`biome.json` and
  `eslint.config.js` exclude `supabase/functions`). Inngest and ImageKit are retired
  too: nothing under `backend/` mentions either. Some `src` comments and user-facing
  strings still name them; that is Phase 4 work.
- **OpenRouter is the only AI provider.** Two callers, both server-side:
  `backend/src/Mod/AiAssistant.php` (keyed by the `openrouter_api_key` entry in the
  private config) and `scripts/plan-drift-audit.mjs` in CI (keyed by the
  `OPENROUTER_API_KEY` **GitHub Actions** secret). The model defaults to
  `openai/gpt-4o-mini`, overridable by the `openrouter_model` config entry.
- **Path alias:** import app code with `@/…` (maps to `src/`).

## Multi-tenancy guardrails

The rules most expensive to get wrong. `docs/RULES.md` §5 and `docs/DATA-MODEL.md`
§5 hold the detail.

- Every domain table carries `org_id`, and every org-scoped handler resolves the
  organisation through `Scope::membership()` (`backend/src/Scope.php`). The id comes
  from the URL and is never trusted; the role is read from the database; a non-member
  gets 404, not 403. Never write a cross-tenant query.
- UI role checks (`usePermissions`) are cosmetic. **The API is the guard**: a control
  whose only enforcement is a disabled button is not a control.
- The access sweep suite (`backend/tests/suites/099-access-sweep.php`) reads the
  route table from the modules and calls every route as nobody, as a stranger and as
  a user with no organisation, so a new route is covered without a new test.
  `docs/RLS-TO-PHP.md`, a finished plan kept as history, records how each retired
  row-level policy became a PHP check.
- Server-only secrets (SMTP, Stripe, the VAPID private key, the Clerk secret) live in
  private config outside the web root (`backend/private/config.example.php` shows the
  names, placeholders only), never a `VITE_` variable.

## Data access

- No component calls `fetch` directly. The browser reaches the API through the
  client in `src/lib/api.ts` (same origin, `/api`, Bearer token from Clerk), and the
  functions in `src/services/*` call that client. A few components import only
  `ApiError` from it, to read an error.
- An API route reads the caller from the Clerk token (`backend/src/Jwt.php`,
  `backend/src/Users.php`) and the organisation from the URL (`Scope`).
  Cross-organisation work (billing webhook, scheduled drains, calendar feed) is the
  exception, and it is public or cron-driven by design.
- `supabase/functions/**` is the legacy Deno source of the old Edge Functions,
  excluded from `pnpm run typecheck` and `lint` (`eslint.config.js`, `biome.json`).
  Each of the twelve now has a PHP replacement under `backend/src/Mod/` (for example
  `Mod/AiAssistant.php` and `Mod/StripeWebhook.php`).
- The part that decides something can be tested: PHP modules with no I/O are tested
  directly. `backend/src/AiGrounding.php` and `backend/src/BillingRules.php` are the
  worked examples.

## Scope discipline

Do not invent top-level folders. If a file does not fit `docs/ARCHITECTURE.md`, say
so in the pull request rather than creating an ad-hoc directory.

**Later (product phase 2), unless a decision says otherwise** (this is the one list;
each item has a ⚫ row in `docs/SAAS.md`): SSO/SCIM, a public API, outbound webhooks, payroll
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
