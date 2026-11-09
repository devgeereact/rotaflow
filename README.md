<p align="center">
  <img src="public/icons/pwa-512.png" alt="RotaFlow logo" width="120" />
</p>

# RotaFlow

A **multi-tenant, offline-first workforce scheduling PWA**. Organisations build and
communicate staff rotas; staff view shifts, clock in, request leave and swap shifts
from any device. The shell and three write queues work offline; most workspace data
needs a connection ([what works offline](docs/ARCHITECTURE.md#offline-and-pwa)). The
front end is a static bundle; the server side is a PHP 8.4 JSON API
(`backend/src/Api.php`) over a MariaDB database, with Clerk email-code sign-in. Both
run on cPanel hosting. Tenants share one database, isolated by `org_id` in the API
(`backend/src/Scope.php`). It is live at `https://rotaflow.space`
(`release.json`). The earlier Supabase version is retired.

**Every document is indexed in [`docs/README.md`](docs/README.md)**, which names the
one document that owns each fact. What is actually built is
[`docs/SAAS.md`](docs/SAAS.md), the capability register. Limitations a customer can
see today are in [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md); what changed recently is in
[`CHANGELOG.md`](CHANGELOG.md). Agents start at [`AGENTS.md`](AGENTS.md).

## What it does

- **Rota builder**: drag-and-drop grid, reusable shift types, copy and repeat weeks,
  conflict detection, labour cost, and a server-enforced draft, publish and amend
  lifecycle.
- **Staff app**: installable rota view with a calendar feed; clock, leave and swap
  writes can queue offline.
- **Availability, leave, overtime and shift swaps**: staff submit, managers approve.
- **GPS clock in and out**, timesheets and team attendance.
- **AI rota assistant**: deterministic review and cover suggestions that work
  offline, plus plain-English drafting through OpenRouter from the API
  (`backend/src/Mod/AiAssistant.php`). Nothing is written until the manager applies it
  ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §9).
- **Notifications and announcements**: in-app, email and web push, queued in an
  outbox and delivered by a cron job (`backend/src/Dispatcher.php`,
  [`docs/NOTIFICATIONS-SPEC.md`](docs/NOTIFICATIONS-SPEC.md)). SMS is not built.
- **Reports and CSV export**.
- **Billing**: Stripe Checkout and Billing Portal with a signature-verified webhook.
  No live charge has completed end to end yet.
- **Roles**: Super Admin, Organisation Owner, Manager and Staff, enforced by the API.

What is deliberately later is the product phase 2 list in [`CLAUDE.md`](CLAUDE.md),
"Scope discipline".

## Tech stack

| Layer            | Choice                            | Notes                                                                                                                                 |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Framework        | React 19 and Vite 8               |                                                                                                                                       |
| Language         | TypeScript (strict)               | Enforced in CI                                                                                                                        |
| Styling          | Tailwind CSS 4                    | Tokens in the `@theme` block of `src/index.css`; there is no `tailwind.config.ts`                                                     |
| Marketing motion | GSAP and Lenis                    | Public pages only, loaded after first paint and never under reduced motion; rules in [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) |
| PWA              | `vite-plugin-pwa` (Workbox)       | Precached app shell, runtime caching, web push via `public/push-sw.js`                                                                |
| Auth             | Clerk (email code)                | Session tokens are verified by `backend/src/Jwt.php`                                                                                  |
| Database         | MariaDB                           | 19 migrations in `backend/migrations`, applied by `backend/bin/migrate.php`; contracts in [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)  |
| Server compute   | PHP 8.4 JSON API                  | `backend/src/Api.php` and `backend/src/Mod/*.php`; routes in [`docs/API-SPEC.md`](docs/API-SPEC.md)                                  |
| AI               | OpenRouter, from the API          | `backend/src/Mod/AiAssistant.php`; the only AI provider; the key never reaches the client                                             |
| Background jobs  | cPanel cron                       | `backend/bin/cron.php` runs every five minutes live; the outbox is drained by `Dispatcher`                                            |
| Payments         | Stripe, from the API              | `backend/src/StripeClient.php`; secrets never reach the client                                                                        |
| Files            | The host's own file store         | `backend/src/FileStore.php`, outside every web root; retired ImageKit is no longer used                                              |
| Mail and push    | SMTP and Web Push                 | `backend/src/SmtpMailer.php`, `backend/src/WebPushSender.php`                                                                         |
| Monitoring       | Sentry                            | Browser only (`src/lib/sentry.ts`)                                                                                                    |
| Hosting          | cPanel                            | Static `dist/` plus the PHP API; released with `pnpm release` (`scripts/release.mjs`)                                                 |

## Quick start

### 1. Prerequisites

- Node.js **>= 24** (`package.json` engines; CI runs the exact version in `.node-version`)
- pnpm (`packageManager` in `package.json`)
- For the PHP suites only: `php` (8.4 or newer, `backend/bin/doctor.php`) and a MariaDB
  server (`mariadbd`) on the PATH. `scripts/test-db.sh` starts a throwaway instance on
  127.0.0.1 and keeps its data under `.local-test/`.

### 2. Install and configure

```bash
git clone <your-repo> my-app && cd my-app
pnpm install
cp .env.example .env      # then fill in your keys
```

The build must also succeed with no `.env` at all: CI has none, and a missing
`VITE_*` variable degrades rather than throws (`src/lib/env.ts`). Only the sign-in key
`VITE_CLERK_PUBLISHABLE_KEY` is required to run the dev server.

### 3. The database

The live schema is the 19 files in `backend/migrations/` (numbered 001 to 020; there is
no 012), applied in order with `php backend/bin/migrate.php` on the host. A release
only uploads them; it does not apply them (`scripts/release.mjs`, `release.json`).

The retired Supabase schema is **every file in `supabase/migrations/`, in numeric order** — there are 164, kept
only as the source of the data move and removed in a later phase. Don't hand-count that
legacy list: `ls supabase/migrations/*.sql | wc -l` is the answer, and
`pnpm run check:docs` fails when the figure above drifts.

### 4. The AI rota assistant (optional)

It is configured on the server, not in the browser: the `openrouter_api_key` entry in
the private config (`backend/private/config.example.php` lists the names, placeholders
only). Without it, the Ask AI tab says it is not configured and nothing else is
affected. The weekly plan-drift audit also calls OpenRouter, so it needs
`OPENROUTER_API_KEY` as a **GitHub Actions** secret too (`scripts/plan-drift-audit.mjs`).

### 5. Develop

```bash
pnpm run dev        # http://localhost:5042  (strictPort: fails loudly if taken)
```

To run the PHP API and a local database against it, `scripts/walk.sh` has the
local-live commands (`db`, `api`, `web`); its header explains each.

### 6. Verify before shipping

```bash
pnpm run check      # the one gate; see the table below
```

Without a MariaDB the last step, `check:php`, cannot run. The full list of CI jobs and
scheduled workflows, and what each one blocks, is one table in
[`qa/README.md`](qa/README.md). `ci.yml` runs six jobs; `edge-types`,
`e2e-authenticated` and `db-tests` still target the retired Supabase stack, and no
`ci.yml` job runs the PHP suites.

### 7. Release

`pnpm release` is a dry run of a release to `https://rotaflow.space`; `pnpm release --go`
ships it. The live `.htaccess` has a Cloudflare origin-lock block prepended on the
server, so it is composed and pushed by `pnpm htaccess`, never shipped with the build.
Read [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before any release: it has the
procedure, rollback and recovery.

## Available scripts

| Script                     | Does                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run dev`              | Vite dev server on port 5042                                                                                                                                                                                                                                                                                       |
| `pnpm run build`            | Type-check, build the static PWA to `dist/`, then run `scripts/prerender.mjs`                                                                                                                                                                                                                                      |
| `pnpm run preview`          | Serve the production build locally                                                                                                                                                                                                                                                                                 |
| `pnpm run typecheck`        | `tsc --noEmit`                                                                                                                                                                                                                                                                                                     |
| `pnpm run lint`             | ESLint, zero warnings (also enforces explicit return types)                                                                                                                                                                                                                                                        |
| `pnpm run lint:fix`         | ESLint with `--fix`                                                                                                                                                                                                                                                                                                |
| `pnpm run format`           | Biome formatter, write, over the repository (Markdown is not formatted)                                                                                                                                                                                                                                            |
| `pnpm run format:check`     | Biome formatter, check only                                                                                                                                                                                                                                                                                        |
| `pnpm test`                 | Vitest unit suite, pinned to `Europe/London`                                                                                                                                                                                                                                                                       |
| `pnpm run test:watch`       | The same, on watch                                                                                                                                                                                                                                                                                                 |
| `pnpm run test:coverage`    | Vitest with coverage                                                                                                                                                                                                                                                                                               |
| `pnpm run test:php`         | Starts the scratch MariaDB (`scripts/test-db.sh up`), then runs the PHP suites in `backend/tests/suites/` (42), each on a fresh database                                                                                                                                                                           |
| `pnpm run check:php`        | `php -l` on every PHP file under `backend/`, then `test:php`                                                                                                                                                                                                                                                       |
| `pnpm run check:bundle`     | Size budgets, and that no DEV preview page shipped                                                                                                                                                                                                                                                                 |
| `pnpm run check:migrations` | Destructive SQL with no `-- SAFETY(...)` declaration, in the legacy `supabase/migrations` tree only                                                                                                                                                                                                                |
| `pnpm run check:docs`       | Counts and toolchain facts in prose against the tree, the register summary against its rows, and every relative link or `docs/` and `qa/` path resolves. Its migration and Edge Function counts still count the legacy `supabase/` tree                                                                              |
| `pnpm run check:docs-impact` | Fails when behaviour-bearing paths changed without a documentation change (`scripts/check-docs-impact.mjs`; it does not yet list `backend/`)                                                                                                                                                                      |
| `pnpm run check:export`     | Every table with an `org_id` in the legacy `supabase/migrations` tree is in the organisation export, or excluded with a reason                                                                                                                                                                                      |
| `pnpm run check`            | The one gate: lint, format check, typecheck, tests, build, `check:bundle`, `check:migrations`, `check:docs`, `check:export`, then `check:php`. Playwright runs separately                                                                                                                                           |
| `pnpm run og:image`         | Regenerates `public/og-image.png`, the 1200x630 link-preview card, with Playwright. No arguments. Run it by hand when the card's words or tokens change; the output is committed                                                                                                                                   |
| `pnpm run load:test`        | `scripts/load-test-workforce.mjs`, written for the retired local Supabase stack (service-role seed, GoTrue sign-in); it does not exercise the PHP API. Results: [`qa/PERFORMANCE-AUDIT.md`](qa/PERFORMANCE-AUDIT.md)                                                                                              |
| `pnpm release`              | Dry run of a release to the host (`scripts/release.mjs`); `pnpm release --go` ships it                                                                                                                                                                                                                             |
| `pnpm verify`               | The release checks, build and upload guard only, on uncommitted work; never contacts the host                                                                                                                                                                                                                      |
| `pnpm htaccess`             | Compose, diff or push the live root `.htaccess` (`scripts/htaccess.mjs`)                                                                                                                                                                                                                                           |
| `pnpm run e2e:walk`         | The local-live Playwright walk (`e2e/walk`); needs `scripts/walk.sh db`, `api` and `web` running                                                                                                                                                                                                                  |

`pnpm exec playwright test` runs the Playwright specs in `e2e/` (`playwright.config.ts`
starts the servers it needs). Six files there are shaped for the retired stack and
still mention `E2E_LIVE_SUPABASE` or `supabase start` (legacy). The API's access checks are
exercised by the PHP suites, above all `backend/tests/suites/099-access-sweep.php`.

## Project layout

```
rotaflow/
├── AGENTS.md            # agent entry point, every harness
├── CLAUDE.md            # project constraints and commands
├── CODEX.md             # Codex mapping
├── CHANGELOG.md         # one entry per merged pull request
├── KNOWN-ISSUES.md      # limitations a customer can see
├── .agent/              # GEE OS routing, MCP profile, task-contract template
├── docs/                # the Standard profile documents; index in docs/README.md
├── qa/                  # audits, CI table, launch checklist
├── public/              # icons, fonts, push service worker, robots.txt, og-image.png
├── scripts/             # release, htaccess, CI checks, test database, og-image generator
├── backend/
│   ├── public/api/      # the web entry point, shipped into the web root
│   ├── src/  src/Mod/   # the PHP API: router, shared classes, one module per area
│   ├── bin/             # migrate, cron, backup and other command-line tools
│   ├── migrations/      # MariaDB schema, applied in order
│   └── tests/suites/    # PHP suites
├── release.json         # what a release ships, and the smoke checks
├── supabase/            # legacy: the retired Supabase source, removed in a later phase
├── e2e/                 # Playwright
└── src/
    ├── components/  context/  hooks/  lib/  pages/  services/  types/
```

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

MIT. Do whatever you want; no warranty.
