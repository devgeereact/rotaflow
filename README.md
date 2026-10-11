<p align="center">
  <img src="public/icons/pwa-512.png" alt="RotaFlow logo" width="120" />
</p>

# RotaFlow

A **multi-tenant, offline-first workforce scheduling PWA**. Organisations build and
communicate staff rotas; staff view shifts, clock in, request leave and swap shifts
from any device. The shell and three write queues work offline; most workspace data
needs a connection ([what works offline](docs/ARCHITECTURE.md#offline-and-pwa)). It
runs as a static bundle on cPanel hosting, with all server work offloaded to Supabase
and other managed services. Tenants share one database, isolated by `org_id` and Row
Level Security.

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
  offline, plus plain-English drafting through OpenRouter from a Supabase Edge
  Function. Nothing is written until the manager applies it
  ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §9).
- **Notifications and announcements**: in-app, email and web push, written to an
  outbox in the same transaction as the event
  ([`docs/NOTIFICATIONS-SPEC.md`](docs/NOTIFICATIONS-SPEC.md)). SMS is not built.
- **Reports and CSV export**.
- **Billing**: Stripe Checkout and Billing Portal with a signature-verified webhook.
  No live charge has completed end to end yet.
- **Roles**: Super Admin, Organisation Owner, Manager and Staff, enforced by RLS.

What is deliberately later is the Phase 2 list in [`CLAUDE.md`](CLAUDE.md), "Scope
discipline".

## Tech stack

| Layer           | Choice                            | Notes                                                                                                        |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Framework       | React 18 and Vite 6               |                                                                                                              |
| Language        | TypeScript (strict)               | Enforced in CI                                                                                               |
| Styling         | Tailwind CSS 4                    | Tokens in the `@theme` block of `src/index.css`; there is no `tailwind.config.ts`                            |
| PWA             | `vite-plugin-pwa` (Workbox)       | Precached app shell, runtime caching, web push via `public/push-sw.js`                                       |
| Auth and DB     | Supabase (PostgreSQL and RLS)     |                                                                                                              |
| Server compute  | Supabase Edge Functions           | The only server runtime; contracts in [`docs/API-SPEC.md`](docs/API-SPEC.md)                                 |
| AI              | OpenRouter, from an Edge Function | The only AI provider; the key never reaches the client                                                       |
| Background jobs | `pg_cron` and `pg_net`            | Five jobs, listed in [`docs/NOTIFICATIONS-SPEC.md`](docs/NOTIFICATIONS-SPEC.md). Inngest is retired (`0087`) |
| Payments        | Stripe, from Edge Functions       | Secrets never reach the client                                                                               |
| Monitoring      | Sentry                            |                                                                                                              |
| Hosting         | cPanel, static `dist/`            | No server runtime on the origin                                                                              |

## Quick start

### 1. Prerequisites

- Node.js **>= 22** (`package.json` engines; CI runs Node 22)
- npm
- [Supabase CLI](https://supabase.com/docs/guides/cli), needed to deploy the Edge
  Functions, to run `supabase db push`, and to run the `db-tests` and
  `e2e-authenticated` gates locally (both also need Docker)

### 2. Install and configure

```bash
git clone <your-repo> my-app && cd my-app
npm install
cp .env.example .env      # then fill in your keys
```

The build must also succeed with no `.env` at all: CI has none, and a missing
`VITE_*` variable degrades rather than throws.

### 3. Set up the database

**Run every file in `supabase/migrations/`, in numeric order** — there are 152, and they
are additive. Stopping early leaves a database that looks like it works and fails at the
first RLS check. Easier: `supabase db push`, which applies the whole ledger.

Don't hand-count this list: `ls supabase/migrations/*.sql | wc -l` is the answer, and
`npm run check:docs` fails when the figure above drifts.

### 4. Deploy the AI rota assistant (optional)

```bash
supabase functions deploy ai-rota-assistant --project-ref <your-project-ref>
supabase secrets set OPENROUTER_API_KEY=... --project-ref <your-project-ref>
```

Without it, the Ask AI tab says it is not configured and nothing else is affected.
The weekly plan-drift audit also calls OpenRouter, so it needs `OPENROUTER_API_KEY`
as a **GitHub Actions** secret too: same name, a different store. Edge Functions do
not deploy on merge; see [`docs/API-SPEC.md`](docs/API-SPEC.md).

### 5. Develop

```bash
npm run dev        # http://localhost:5042  (strictPort: fails loudly if taken)
```

### 6. Verify before shipping

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
npm run build && npm run check:bundle
```

The full list of CI jobs and scheduled workflows, and what each one blocks, is one
table in [`qa/README.md`](qa/README.md).

### 7. Deploy

Build locally and ship only `dist/` plus the repo-root `.htaccess` to
`https://rotaflow.space`. The live `.htaccess` has a Cloudflare origin-lock block
prepended on the server, so deploying the repo file alone reopens the origin. Read
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before any deploy: it has the safe
playbook, the `--keep` flags, rollback and recovery.

## Available scripts

| Script                     | Does                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`              | Vite dev server on port 5042                                                                                                                                                                                                                                                                                       |
| `npm run build`            | Type-check, then build the static PWA to `dist/`                                                                                                                                                                                                                                                                   |
| `npm run preview`          | Serve the production build locally                                                                                                                                                                                                                                                                                 |
| `npm run typecheck`        | `tsc --noEmit`                                                                                                                                                                                                                                                                                                     |
| `npm run lint`             | ESLint, zero warnings (also enforces explicit return types)                                                                                                                                                                                                                                                        |
| `npm run lint:fix`         | ESLint with `--fix`                                                                                                                                                                                                                                                                                                |
| `npm run format`           | Prettier write over `src/**` and `docs/**/*.md`                                                                                                                                                                                                                                                                    |
| `npm run format:check`     | Prettier check over `src/**` only. Documentation formatting is not gated in CI                                                                                                                                                                                                                                     |
| `npm test`                 | Vitest unit suite, pinned to `Europe/London`                                                                                                                                                                                                                                                                       |
| `npm run test:watch`       | The same, on watch                                                                                                                                                                                                                                                                                                 |
| `npm run test:coverage`    | Vitest with coverage                                                                                                                                                                                                                                                                                               |
| `npm run check:bundle`     | Size budgets, and that no DEV preview page shipped                                                                                                                                                                                                                                                                 |
| `npm run check:migrations` | Destructive SQL with no `-- SAFETY(...)` declaration                                                                                                                                                                                                                                                               |
| `npm run check:docs`       | Counts and toolchain facts in prose against the tree, the register summary against its rows, and every relative link or `docs/` and `qa/` path resolves                                                                                                                                                            |
| `npm run check:export`     | Every table with an `org_id` is in the organisation export, or excluded with a reason                                                                                                                                                                                                                              |
| `npm run og:image`         | Regenerates `public/og-image.png`, the 1200x630 link-preview card, with Playwright. No arguments. Run it by hand when the card's words or tokens change; the output is committed                                                                                                                                   |
| `npm run load:test`        | Seeds 20 sites, 250 staff, 10,000 shifts and 50,000 clock events into a **local** stack and times the workforce reads. Needs `API_URL` and `SERVICE_ROLE_KEY` from `supabase status -o env`; refuses any host but `127.0.0.1`, `localhost` or `::1`. Results: [`qa/PERFORMANCE-AUDIT.md`](qa/PERFORMANCE-AUDIT.md) |

Two more run against live services rather than as npm scripts:
`npx playwright test` (42 screens rendered and scanned for WCAG A and AA) and
`supabase test db` (pgTAP, the only gate that can catch an RLS regression).

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
├── scripts/             # CI checks, load test, og-image generator
├── supabase/
│   ├── migrations/      # SQL schema and RLS, applied in order
│   ├── functions/       # Edge Functions (Deno)
│   └── tests/database/  # pgTAP
├── e2e/                 # Playwright
└── src/
    ├── components/  context/  hooks/  lib/  pages/  services/  types/
```

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

MIT. Do whatever you want; no warranty.
