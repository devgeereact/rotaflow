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
- **Staff app** — installable, offline-first rota view with calendar (ICS) subscription.
- **Availability, leave & overtime** — staff submit, managers approve.
- **Shift swaps** — request → colleague → manager approval → rota updates.
- **GPS clock in/out** — QR + GPS + manual, timesheets, hours dashboard.
- **AI rota assistant** — a manager describes staffing needs in plain English and gets
  shift suggestions grounded in real staff, skills, availability and existing shifts
  (OpenRouter, called from a Supabase Edge Function — nothing is invented or written
  until the manager applies it). See [`docs/ARCHITECTURE.md` §9](docs/ARCHITECTURE.md).
- **Notifications & announcements** — Web Push + email (SMTP); org/location/department
  broadcasts. *(SMS seam reserved, not wired in V1.)*
- **Reports & payroll export** — hours, absence, overtime; CSV/Excel.
- **Roles** — Super Admin · Organisation Owner · Manager · Staff, enforced by RLS.
- **Phase 2** — full AI auto-scheduling (demand forecasting, burnout detection),
  payroll integrations, analytics, SSO, and subscription billing (Apple Pay / Google
  Pay / PayPal via a pluggable provider). Architected in, built last.

See [`docs/PRD.md`](docs/PRD.md) for the full scope and phasing.

---

## Tech stack

| Layer            | Choice                          | Why                                            |
| ---------------- | ------------------------------- | ---------------------------------------------- |
| Framework        | React 18 + Vite 6               | Fast HMR, tiny hashed bundles                  |
| Language         | TypeScript (strict)             | Safety enforced in CI                          |
| Styling          | Tailwind CSS (NativeWind-ready) | Utility-first, portable to Expo later          |
| PWA              | `vite-plugin-pwa` (Workbox)     | Precached app shell + runtime caching          |
| Auth + DB        | Supabase (PostgreSQL + RLS)     | Managed Postgres, row-level security           |
| Server compute   | Supabase Edge Functions         | The only server runtime — RLS-scoped by forwarding the caller's JWT, not a service-role bypass |
| AI               | OpenRouter (via Edge Function)  | Rota suggestions grounded in real data; key never touches the client |
| Media            | ImageKit                        | Real-time image resize/compress over a CDN     |
| Background jobs  | Inngest                         | Event-driven workflows, cron, retries          |
| Monitoring       | Sentry                          | Error + performance tracking with source maps  |
| Motion           | Framer Motion                   | Micro-interactions & page transitions          |
| AI code review   | CodeRabbit                      | PR checks against `docs/RULES.md`              |
| Hosting          | cPanel (static `dist/`)         | Low cost, no server runtime                    |

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
supabase/migrations/0003_fix_organisations_select_rls.sql
supabase/migrations/0004_rotas_draft_unique.sql
supabase/migrations/0005_narrow_organisations_select_rls.sql
```
(Or use the Supabase CLI: `supabase db push`.)

### 4. Deploy the AI rota assistant (optional)
The natural-language rota assistant runs as a Supabase Edge Function so its OpenRouter
key never reaches the browser:
```bash
supabase functions deploy ai-rota-assistant --project-ref <your-project-ref>
supabase secrets set OPENROUTER_API_KEY=... --project-ref <your-project-ref>
```
Without this, the feature degrades to a clean "not configured yet" message — nothing
else in the app depends on it.

### 5. Develop
```bash
npm run dev        # http://localhost:5173
```

### 6. Verify before shipping
```bash
npm run typecheck
npm run lint
npm run build      # emits ./dist
npm run preview    # smoke-test the production bundle
```

### 7. Deploy to cPanel
The server has **no Node** — build locally, ship only the artifacts.
1. Run `npm run build` (emits `./dist`).
2. Upload **everything inside `dist/`** plus the repo-root **`.htaccess`** into **this
   app's own document root** — e.g. `~/<domain>/` for an addon domain or
   `public_html/<app>/` for a subpath. The `.htaccess` handles HTTPS, SPA routing,
   MIME types, and cache/security headers.
3. Load the site over HTTPS and confirm the install prompt appears.

> ⚠️ **Never deploy into a shared docroot** (one that also serves other sites or holds
> loose `api.php` / `config.php`), and **never mirror-with-delete** without a dry-run
> first — see **`docs/DEPLOYMENT.md`** for the full, safe playbook (rsync/CI options,
> exclude lists, backups-outside-the-webroot, and source-map handling).

---

## Available scripts

| Script                 | Does                                             |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Start Vite dev server with HMR                   |
| `npm run build`        | Type-check, then build the static PWA to `dist/` |
| `npm run preview`      | Serve the production build locally               |
| `npm run typecheck`    | `tsc --noEmit` strict check                      |
| `npm run lint`         | ESLint (zero-warning policy)                     |
| `npm run format`       | Prettier write                                   |

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
├── docs/                 # PRD, DESIGN, ARCHITECTURE, SCHEMA, RULES, HOOKS
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

- [`docs/PRD.md`](docs/PRD.md) — scope, MVP features, success metrics
- [`docs/DESIGN.md`](docs/DESIGN.md) — visual language & tokens
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system + folder design
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — Postgres tables & RLS
- [`docs/RULES.md`](docs/RULES.md) — coding standards
- [`docs/HOOKS.md`](docs/HOOKS.md) — custom hook contracts

## License
MIT — do whatever you want, no warranty.
