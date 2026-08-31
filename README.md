<p align="center">
  <img src="public/icons/pwa-512.png" alt="RotaFlow logo" width="120" />
</p>

# RotaFlow

A **multi-tenant, offline-first workforce scheduling PWA**. Organisations build and
communicate staff rotas in minutes; staff view shifts, clock in, request leave and swap
shifts from any device — online or offline. Runs as a static bundle on **cheap static
hosting** (Namecheap cPanel / Stellar Plus) with all heavy lifting offloaded to Supabase
and other managed services. Tenants share one database, isolated by `org_id` + Row Level
Security.

## What it does

- **Rota builder** — weekly/fortnightly/monthly drag-and-drop grid, shift templates,
  copy-previous-week, conflict detection, colour coding.
- **Staff app** — installable, offline-first rota view with an ICS calendar download.
- **Availability, leave & overtime** — staff submit, managers approve.
- **Shift swaps** — request → colleague → manager approval → rota updates.
- **GPS clock in/out** — GPS + manual, timesheets, hours dashboard. (QR is deferred.)
- **AI rota assistant** — a manager describes staffing needs in plain English and gets
  shift suggestions grounded in real staff, skills, availability and existing shifts
  (OpenRouter, called from a Supabase Edge Function — nothing is invented or written
  until the manager applies it). See [`docs/ARCHITECTURE.md` §9](docs/ARCHITECTURE.md).
- **Notifications & announcements** — Web Push + email (SMTP); org/location/department
  broadcasts. Every notification is written to an outbox **in the same transaction as
  the event that owes it**, so closing the tab cannot lose one, and drained by
  `pg_cron`. _(SMS seam reserved, not wired in V1.)_
- **Reports & payroll export** — hours, absence, overtime; CSV.
- **Billing** — Stripe Checkout and Billing Portal, with a signature-verified webhook.
  Four plan tiers. No live charge has been completed end to end yet.
- **Roles** — Super Admin · Organisation Owner · Manager · Staff, enforced by RLS.
- **Phase 2** — full AI auto-scheduling (demand forecasting, burnout detection),
  payroll integrations, analytics and SSO.

See [`docs/PRD.md`](docs/PRD.md) for scope, and **[`docs/SAAS.md`](docs/SAAS.md) for what
is actually built** — the capability register is the honest, per-feature status.

---

## Tech stack

| Layer           | Choice                           | Why                                                                                                                                            |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | React 18 + Vite 6                | Fast HMR, tiny hashed bundles                                                                                                                  |
| Language        | TypeScript (strict)              | Safety enforced in CI                                                                                                                          |
| Styling         | Tailwind CSS (NativeWind-ready)  | Utility-first, portable to Expo later                                                                                                          |
| PWA             | `vite-plugin-pwa` (Workbox)      | Precached app shell + runtime caching                                                                                                          |
| Auth + DB       | Supabase (PostgreSQL + RLS)      | Managed Postgres, row-level security                                                                                                           |
| Server compute  | Supabase Edge Functions          | The only server runtime — RLS-scoped by forwarding the caller's JWT, not a service-role bypass                                                 |
| AI              | OpenRouter (via Edge Function)   | Rota suggestions grounded in real data; key never touches the client                                                                           |
| Media           | ImageKit                         | Real-time image resize/compress over a CDN                                                                                                     |
| Background jobs | `pg_cron` + `pg_net` in Postgres | Notification outbox drain, nightly retention, health probe. Inngest is retired as a dispatch path (`0087`) — its key still ships and is unused |
| Payments        | Stripe (via Edge Functions)      | Checkout + Billing Portal; secrets never reach the client                                                                                      |
| Monitoring      | Sentry                           | Error + performance tracking with source maps                                                                                                  |
| Motion          | Framer Motion                    | Micro-interactions & page transitions                                                                                                          |
| AI code review  | CodeRabbit                       | PR checks against `docs/RULES.md`                                                                                                              |
| Hosting         | cPanel (static `dist/`)          | Low cost, no server runtime                                                                                                                    |

---

## Quick start

### 1. Prerequisites

- Node.js **>= 18**
- npm (or pnpm)
- [Supabase CLI](https://supabase.com/docs/guides/cli) — only needed to deploy the
  `ai-rota-assistant` Edge Function (step 4); everything else works without it

### 2. Install & configure

```bash
git clone <your-repo> my-app && cd my-app
npm install
cp .env.example .env      # then fill in your keys
```

### 3. Set up the database

In the Supabase SQL editor, run the migrations **in order**:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_rotaflow.sql
…
supabase/migrations/0099_calendar_feed_tokens.sql
```

**Run every file in `supabase/migrations/`, in numeric order** — there are 108, and they
are additive. Stopping early leaves a database that looks like it works and fails at the
first RLS check. Easier: use the Supabase CLI (`supabase db push`), which applies the
whole ledger.

Don't hand-count this list: the number above has been wrong twice, because a README
is the last thing anyone updates. `ls supabase/migrations/*.sql | wc -l` is the answer.

### 4. Deploy the AI rota assistant (optional)

The natural-language rota assistant runs as a Supabase Edge Function so its OpenRouter
key never reaches the browser:

```bash
supabase functions deploy ai-rota-assistant --project-ref <your-project-ref>
supabase secrets set OPENROUTER_API_KEY=... --project-ref <your-project-ref>
```

Without this, the feature degrades to a clean "not configured yet" message — nothing
else in the app depends on it.

**OpenRouter is the only AI provider this project uses.** The weekly plan-drift audit
(`.github/workflows/plan-drift-audit.yml`) goes through it too, so it needs
`OPENROUTER_API_KEY` as a **GitHub Actions** secret as well — same variable name, a
different store from the Supabase secret above. Optionally set an `OPENROUTER_MODEL`
Actions _variable_ to override the `openai/gpt-4o-mini` default. Without the Actions
secret the audit does not fail silently; it records a dated `FAILED:` entry in the plan
doc and turns the run red.

### 5. Develop

```bash
npm run dev        # http://localhost:5042  (strictPort — fails loudly if taken)
```

### 6. Verify before shipping

```bash
npm run typecheck
npm run lint
npm run format:check   # a separate CI gate — green tsc + eslint does not imply this passes
npm test               # 636 unit tests, pinned to Europe/London
npm run build          # emits ./dist
npm run preview        # smoke-test the production bundle
```

CI additionally runs a Playwright + axe `e2e` job and a pgTAP `db-tests` job. Neither has
an npm script; both run from `.github/workflows/ci.yml`.

### 7. Deploy to cPanel

The server has **no Node** — build locally, ship only the artifacts.

**Target: `https://rotaflow.space`**, its own docroot at `~/rotaflow.space/` on the
same cPanel account. (RotaFlow ran on a subdomain of a personal domain until
2026-08-29; that subdomain, its docroot and its DNS have all been removed.)

1. Run `npm run build` (emits `./dist`).
2. Upload **everything inside `dist/`** plus the repo-root **`.htaccess`** into
   `~/rotaflow.space/`. The `.htaccess` handles HTTPS, SPA routing, MIME types, and
   cache/security headers.
3. Load the site over HTTPS and confirm the install prompt appears.

> ⚠️ The **live** `.htaccess` is the repo file with a Cloudflare origin-lock block
> prepended on the server. Deploying the repo file alone silently removes that lock
> and reopens the origin to direct-to-IP requests — see `docs/DEPLOYMENT.md`.

> `VITE_APP_URL` is baked into the bundle at build time and is the auth redirect
> target, so it must match Supabase → Authentication → URL Configuration (Site URL
> `https://rotaflow.space`, Redirect URLs `https://rotaflow.space/**`). Rebuild
> after changing it.

> ⚠️ **Never deploy into a shared docroot** (one that also serves other sites or holds
> loose `api.php` / `config.php`), and **never mirror-with-delete** without a dry-run
> first — see **`docs/DEPLOYMENT.md`** for the full, safe playbook (rsync/CI options,
> exclude lists, backups-outside-the-webroot, and source-map handling).

---

## Available scripts

| Script                     | Does                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`              | Start Vite dev server with HMR                                                 |
| `npm run build`            | Type-check, then build the static PWA to `dist/`                               |
| `npm run preview`          | Serve the production build locally                                             |
| `npm run typecheck`        | `tsc --noEmit` strict check                                                    |
| `npm run lint`             | ESLint (zero-warning policy)                                                   |
| `npm run format`           | Prettier write (covers `docs/**/*.md` too)                                     |
| `npm run format:check`     | Prettier check — its own CI gate                                               |
| `npm test`                 | Vitest unit suite (`src/**` plus pure modules extracted out of Edge Functions) |
| `npm run test:watch`       | The same suite, on watch                                                       |
| `npm run test:coverage`    | Vitest with coverage                                                           |
| `npm run lint:fix`         | ESLint with `--fix`                                                            |
| `npm run check:bundle`     | Size budgets, and that no DEV preview page shipped                             |
| `npm run check:migrations` | Destructive SQL with no `-- SAFETY(...)` declaration                           |
| `npm run check:docs`       | Counts in prose against the tree, and `docs/SAAS.md`'s summary against its rows |

Two more run against live state and so are not npm scripts:
`npx playwright test` (40 screens, WCAG, light and dark) and `supabase test db`
(pgTAP — the only gate that can catch an RLS regression).

The test count is deliberately not printed here. It was "636" for long enough to
be wrong, and a number in a README that nothing checks is a number that drifts.

---

## Project layout

```
rotaflow/
├── .env.example          # required env vars (copy to .env)
├── .htaccess             # cPanel: HTTPS, SPA routing, caching
├── AGENTS.md / CLAUDE.md # AI agent context
├── index.html            # app entry + font preconnect
├── vite.config.ts        # build + PWA/Workbox config
├── tailwind.config.ts    # design tokens (see docs/DESIGN.md)
├── docs/                 # SAAS (the register), PRD, DESIGN, ARCHITECTURE, SCHEMA, RULES, HOOKS
├── public/               # manifest icons, offline.html, robots.txt
├── supabase/
│   ├── migrations/       # SQL schema + RLS policies
│   └── functions/        # Edge Functions (Deno) — e.g. ai-rota-assistant
└── src/
    ├── assets/           # static assets imported by code
    ├── components/       # UI (ErrorBoundary, InstallPrompt, ...)
    ├── context/          # Auth / Theme / Org providers
    ├── hooks/            # usePWAInstall, useOnlineStatus, useOrg, ...
    ├── lib/              # SDK clients (supabase, sentry, imagekit, env)
    ├── pages/            # route views
    ├── services/         # typed Supabase data access
    └── types/            # shared + generated DB types
```

Full details live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Documentation index

- [`docs/SAAS.md`](docs/SAAS.md) — **the capability register: what is built, partial, broken or missing.** Start here
- [`docs/PRD.md`](docs/PRD.md) — scope, MVP features, success metrics
- [`docs/DESIGN.md`](docs/DESIGN.md) — visual language & tokens
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system + folder design
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — Postgres tables & RLS
- [`docs/RULES.md`](docs/RULES.md) — coding standards
- [`docs/HOOKS.md`](docs/HOOKS.md) — custom hook contracts
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the deploy playbook, and the traps that have bitten
- [`docs/DATA_LIFECYCLE.md`](docs/DATA_LIFECYCLE.md) — retention, erasure, residency
- [`docs/SCREENS.md`](docs/SCREENS.md) — every screen, against its design reference
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — the success-metric taxonomy and what computes each
- [`docs/QA-AUDIT-REPORT.md`](docs/QA-AUDIT-REPORT.md) — dated evidence of the last full audit

## License

MIT — do whatever you want, no warranty.
