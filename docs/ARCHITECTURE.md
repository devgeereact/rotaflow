# System Architecture

## 1. Topology

```text
┌──────────────────────────────────────────────────────────────────┐
│                  Client browser / installed PWA                  │
│   React 19 + Vite + Tailwind  ·  service worker (vite-plugin-pwa) │
│   static files from dist/  ·  Clerk sign-in  ·  IndexedDB outbox  │
└───────────────┬───────────────────────────────┬──────────────────┘
                │ HTTPS                         │ HTTPS (Clerk, Sentry)
                ▼                               ▼
        ┌───────────────┐              ┌────────────────────┐
        │  Cloudflare   │              │  Clerk · Sentry    │
        │ DNS · TLS     │              │  (third parties)   │
        └───────┬───────┘              └────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│ cPanel host (Apache)                                             │
│   web root:  dist/ (static)  +  api/index.php (PHP front door)   │
│   /api/*  →  api/index.php  (rewrite in .htaccess)               │
│   private root, outside every web root:                          │
│     app/ (backend/src, bin, migrations) · config · cache · logs │
│     uploads/  ·  cron entry: app/bin/cron.php                    │
└───────┬──────────────────────────────────────────┬───────────────┘
        ▼                                          ▼
   MariaDB (backend/migrations)        Outbound from PHP: Stripe, OpenRouter,
                                       SMTP, web push services
```

The path of a request:

1. The browser loads the static bundle from `dist/` (the host serves it, `.htaccess` rewrites an unknown path to `index.html`, the service worker does the same offline).
2. Every data call is a same-origin request to `/api/...` (`API_BASE_URL = '/api'` in `src/lib/api.ts`), carrying the Clerk session token as a Bearer token (`src/lib/apiClient.ts`).
3. `.htaccess` sends every `/api` path to the one PHP front controller, `backend/public/api/index.php`, and passes the `Authorization` header through. Only GET and POST are accepted; `GET /api/health` answers before any config is read.
4. The front controller reads the private config (`backend/src/Bootstrap.php`), opens MariaDB (`backend/src/Db.php`), builds the Clerk token verifier (`backend/src/Jwt.php`) and hands the request to `Api::handle` (`backend/src/Api.php`).
5. `Api` checks the token, applies the rate limit (`backend/src/RateLimiter.php`), matches the path against the route table that every module contributes (`backend/src/Modules.php`, one `routes()` method per file in `backend/src/Mod/`) and calls the handler. A handler returns `[status, payload]`; every error is `{"error":{"code","message"}}` (`backend/src/HttpError.php`).
6. Background work is not a server process: one cPanel cron entry runs `backend/bin/cron.php`, which calls each module's `cron()` job (section 6).

Counts of routes, modules, tables and migrations belong to `docs/API-SPEC.md` and `docs/DATA-MODEL.md`; they are not repeated here.

**Outbound services**, each reached from PHP and never from the browser, except Clerk and Sentry:

| Service | Used for | Where |
| --- | --- | --- |
| Clerk | Sign-in (email code and the other methods enabled in Clerk). The browser holds the session; the API verifies its token | `backend/src/Jwt.php`, `src/context/AuthContext.tsx` |
| Stripe | Checkout, the billing portal and a signature-verified webhook | `backend/src/StripeClient.php`, `backend/src/Mod/Billing.php`, `backend/src/Mod/StripeWebhook.php` |
| OpenRouter | The language-model half of the rota assistant | `backend/src/Mod/AiAssistant.php` |
| SMTP | Email (an organisation's own account, else the platform's) | `backend/src/Mail.php`, `backend/src/SmtpMailer.php` |
| Web push | Notifications to installed devices | `backend/src/WebPushSender.php` |
| Sentry | Browser error monitoring, only after the visitor agrees to diagnostics. There is no Sentry call in `backend/src` | `src/lib/sentry.ts` |

Cloudflare sits in front of the host for DNS, TLS and proxying (`src/lib/subprocessors.ts` lists it). The live Cloudflare settings, headers and DNS are `NOT VERIFIED` from the repository. The live `.htaccess` is this repository's file with a Cloudflare origin-lock block prepended, which is why it is shipped by `pnpm htaccess push` and never by `pnpm release` (`scripts/htaccess.mjs`, header).

**Retired services.** Supabase (database, sign-in, row-level security, realtime, storage), the Supabase Edge Functions, ImageKit and Inngest are not part of the live system. Supabase ended on 1 November 2026 (the cutover, `docs/CUTOVER.md`). Files now live in the private root (`backend/src/FileStore.php`), images are served by the API (`backend/src/Mod/Photos.php`), and notifications are an outbox drained by cron. **Legacy:** the previous version of this document, which describes that stack, is available with `git show live-supabase-2026-11-01:docs/ARCHITECTURE.md`.

## 2. Directory layout

The tracked tree, one level deep (from `git ls-files`):

```text
.agent/            # project contract for agents: PROJECT.yml, MCP-PROFILE.yml, CURRENT-TASK.template.md
.claude/           # agents/ and settings.json
.githooks/         # pre-commit: gitleaks (blocks a commit that holds a secret)
.github/           # workflows/, dependabot.yml, pull_request_template.md
backend/           # the PHP API (section 9d)
  bin/             # backup, cron, datamove, doctor, grant-platform-owner, migrate, seed-demo
  migrations/      # numbered NNN-name.sql files for MariaDB
  private/         # config.example.php (names of the private settings; no values)
  public/api/      # index.php, the only web-reachable PHP file
  src/             # one class per file; Mod/ holds the route modules
  tests/           # run.php, suite.php, lib.php, suites/, datamove/
docs/              # the documents indexed in docs/README.md; design/ holds screenshots
e2e/               # Playwright specs (walk/ and support/ hold the local-live walk)
public/            # copied into dist/ as is: fonts/, icons/, push-sw.js, .well-known/, robots.txt
qa/                # dated audits and the release gates (qa/README.md)
scripts/           # release.mjs, htaccess.mjs, check-*.mjs, prerender.mjs, test-db.sh, walk.sh, cutover/
src/               # the React app (below)
supabase/          # LEGACY source tree, kept until a later phase (functions/, migrations/, tests/, config.toml)
deno.lock          # LEGACY, belongs to supabase/functions
.htaccess          # Apache rules for the web root (composed with the origin lock by pnpm htaccess)
release.json       # what pnpm release uploads, builds and smoke-tests
vite.config.ts  vitest.config.ts  playwright.config.ts  eslint.config.js  biome.json  tsconfig.json
package.json  pnpm-lock.yaml  pnpm-workspace.yaml  .node-version  bundle-budget.json
CLAUDE.md  AGENTS.md  CODEX.md  README.md  CHANGELOG.md  KNOWN-ISSUES.md  LICENSE
```

```text
src/
├── components/    # presentational + wiring components, grouped by area (layout/, rota/, staff/, ui/ ...)
├── context/       # AuthContext, OrgContext, ThemeContext, ToastContext, ConfirmContext, ConsentContext, WorkModeContext
├── hooks/         # reusable logic (see docs/ARCHITECTURE.md#hook-contracts)
├── lib/           # pure logic plus the API client
│   ├── api.ts, apiClient.ts, apiDates.ts   # the only network client (same-origin /api)
│   ├── env.ts       # the six VITE_* names the bundle may carry
│   ├── sentry.ts    # Sentry init (consent-gated)
│   └── offlineOutbox.ts   # raw IndexedDB wrapper for the write outbox
├── pages/         # route-level views (app/ and admin/ hold the signed-in screens)
├── services/      # typed data access over the API client
├── types/         # shared types; database.types.ts is a frozen legacy row-shape file
├── test/          # test stubs
├── App.tsx        # providers + router
├── main.tsx       # bootstrap: Sentry, SW registration, render
├── entry-prerender.tsx  # Node entry used by scripts/prerender.mjs
└── index.css      # Tailwind 4 entry: the @theme tokens and base styles
```

The legacy Supabase client module and the ImageKit helper under `src/lib` no longer exist. Phase 4 of the documentation-truth work owns the leftover Supabase wording in `src` comments and in `src/types/database.types.ts`; this document does not describe it as live behaviour.

**Dependency direction:** `pages → services → lib`. Components consume `hooks` and `context`. `lib` should import nothing from `pages` or `components`. Six files currently break that with type-only imports: `clockinDemo`, `reportsDemo`, `requestSections`, `settingsTabs`, `staffForm` and `swapRows`. A convention that is not lint-enforced and not tracked in the register:

```bash
grep -ln "from '@/pages\|from '@/components" src/lib/*.ts
```

`src/lib/moduleBoundaries.test.ts` separately fails when a module under `src/lib` takes a runtime import from `src/services`, from `@/lib/api` (the API client) or from `@clerk/*`, with one allowlisted file (tracked as GAP-114 in `CLAUDE.md`).

**Formatting lives in `src/lib/format.ts`** (2026-10-21): `formatDate` for a `YYYY-MM-DD` value (read as components and printed in UTC, so the stored day is the day shown in every zone), `formatDateTime`, `formatTime` and `formatCount`, all in the product locale `APP_LOCALE` (`en-GB`, because every string is still an English literal). New screens use it; an inline `toLocaleString('en-GB')` moves to it when its screen is touched.

**Services** (`src/services`, every call goes through `api` from `src/lib/api.ts`; the list is the tracked folder, not repeated here: `git ls-files src/services`). Membership access lives in `orgService` and `platformUserService`; there is no `membershipService`, and the reports service is `reportsService.ts`. The offline outbox replayer is `syncQueue.ts`. **Contexts:** `AuthProvider` (Clerk session and `GET /me`), `OrgProvider` (active tenant and role), `ThemeProvider`.

## 3. Rendering & routing

- Single-page app; routing via **React Router** (`BrowserRouter` with `<Routes>`, `src/App.tsx`).
- Client-side navigation only. Deep links work because `.htaccess` rewrites a path that is not a file to the app, and the service worker's `navigateFallback` does the same offline (section 5).
- `ProtectedRoute` (`src/components/ProtectedRoute.tsx`) gates authenticated views on the Clerk session and on `GET /me` answering: signed out goes to `/login`; signed in but `GET /me` failing shows a retry card, never "signed out". A second factor, when the account has one, is asked for by Clerk during sign-in; nothing in the app holds it. The console gate is `ProtectedRoute` → `RequirePlatformAdmin` → the admin shell (`src/App.tsx`).

### Information architecture / routes (RotaFlow)

Routes are organisation-scoped once a tenant is selected. The route table is `src/App.tsx`, and the list below was checked against it on 9 November 2026. The number of screens belongs to `docs/UX-SPEC.md`.

`src/lib/navigationTargets.test.ts` parses this route table out of `App.tsx` and asserts that every Settings tab, Profile tab, marketing nav link, footer link and global-search entry resolves to a real `<Route>`. That test exists because the Settings tab bar once shipped with fourteen routes, none of which had been added to `App.tsx`; every one rendered the 404 page while all five gates stayed green.

```text
PUBLIC. Marketing
/                         landing: hero, product shot, benefits, sectors, stats, CTA
/features /solutions /pricing /resources /about /contact
                          copy lives in src/lib/marketing.ts (see its header for
                          the no-invented-traction rule)

PUBLIC. Auth
/login /signup            Clerk's own forms, mounted at /login/* and /signup/*
/forgot-password /reset-password   → redirect to /login
/splash
/invite/:token            public on purpose, an invitee has no account yet
/onboarding               create an organisation (auth required)
/auth/callback            return from a Clerk redirect

TENANT SHELL, /app (requires membership, else redirects to /onboarding)
  /app/dashboard          today's coverage, queues, activity
  /app/rota               rota builder. Drag-drop, AI assistant, publish    [manager]
  /app/setup              organisation setup checklist                      [manager]
  /app/schedule           published schedule. Day/week/month/agenda, an ICS
                          download and a subscription feed (Mod/CalendarFeed.php)
  /app/attendance         the team attendance record                        [manager]
  /app/clock              GPS clock in/out with an offline queue
  /app/clock-in           → redirects to /app/clock
  /app/team               staff directory                                   [manager]
  /app/team/:staffId      staff profile                                     [manager]
  /app/locations          locations & departments                           [manager]
  /app/availability       my availability / team availability
  /app/leave              leave requests + approvals
  /app/swaps              shift swaps + approvals
  /app/overtime           overtime requests + approvals
  /app/open-shifts        uncovered shifts anybody can take
  /app/compliance         staff documents (every member; managers also review)
  /app/cover              absence reports, cover requests and the cover board
                          (behind the cover_tools flag)
  /app/approvals          leave, swaps and overtime in one queue           [manager]
  /app/timesheets         hours from clock events, approvals, payroll export
  /app/announcements      communication centre
  /app/notifications      inbox (reached via the bell, not the sidebar)
  /app/reports            coverage/hours/absence/overtime + CSV             [manager]
  /app/settings           layout route + tab bar                            [manager]
    organisation · permissions · roles · policies · document-types
    notifications · integrations · billing · audit
  /app/help               help & support; opens a support case, reads its thread
                          and replies into it
  /app/account            layout route + tab bar (every role)
    profile · preferences · security · tokens · activity · data
    (accounts and sessions redirect to security)
  /app/staff              → redirects to /app/team
  /app/integrations       → redirects to /app/settings/integrations

  /legal/privacy · /legal/terms · /legal/cookies · /legal/accessibility
  /legal/trust            sub-processors, AI notice, security disclosure
  /admin/*                platform console (RequirePlatformAdmin); some screens
                          add RequirePlatformRole
  *-preview               DEV-only design-loop routes, dropped from the build
```

**A `[manager]` route is also reachable by a delegate.** Somebody holding a live delegation has the effective role of manager (`backend/src/Scope.php`, `membership()`), so a temporary deputy sees the managerial routes without anybody editing their membership, and stops seeing them when the delegation expires. Nothing in this table changes; the check underneath it does.

`[manager]` = gated by `RequireRole` on the `<Route>`, rendering `PermissionDenied` (area, role held, role required, way back) rather than silently redirecting. **This is presentation only. The API is the real boundary** (`backend/src/Scope.php`), and it holds whether or not the gate renders. The gate exists so an honest wrong turn produces an explanation instead of a screen of controls that fail silently.

Role determines which nav items and routes render; the server enforces access in PHP. Shift-type management has no dedicated route. It is a modal opened from the rota builder's toolbar, since it is tightly coupled to rota-building.

### App shell

| Piece                     | Module                                    | Note                                                                                                                                                                           |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidebar                   | `layout/Sidebar`                          | Role-resolved items; collapse persisted in `localStorage`, read during initial `useState` so the page does not jump on load                                                    |
| Org identity + switcher   | `layout/SidebarOrgSwitcher`               | Always shows the org name; interactive only with >1 membership                                                                                                                 |
| Profile / help / collapse | `layout/SidebarFooter`                    |                                                                                                                                                                                |
| Global search             | `layout/GlobalSearch`, `lib/globalSearch` | `⌘K`. Searches **screens and actions, not records**: a per-keystroke search fan-out across a dozen tables is a query storm at real tenant size. Role-filtered before matching |
| Mobile tab bar            | `layout/MobileTabBar`                     | Home · Schedule · Clock in · Leave · More; `More` opens the sidebar drawer, whose open state is owned by `AppShell` so both controls share it                                  |

## 4. State management

- **Server and auth state:** the Clerk session lives in `ClerkProvider`, mounted by `AuthProvider` (`src/context/AuthContext.tsx`), which reads `GET /me` once per session: the user id the app uses is the API's, and the memberships and the platform role come with it. Once Clerk has loaded, `AuthProvider` wires the token source into the API client (`setApiAuth`); any 401 signs the user out (`src/lib/api.ts`). Data is fetched per view through `services/*`; there is no data cache library (swap in TanStack Query later if you need richer caching).
- **Tenant state:** an `OrgProvider` (Context) holds the active organisation + the caller's role/membership, resolved after auth. Every service call passes the organisation id in the URL (`/orgs/{o}/...`); the org switcher (`switchOrg`, persisted to `localStorage`) updates this context. `usePermissions()` derives UI capability flags from the active role. Cosmetic gating only: the API enforces access (`backend/src/Scope.php`; see `docs/ARCHITECTURE.md#hook-contracts` §6-7).
- **UI/theme state:** `ThemeProvider` (Context), **light by default** (see `docs/DESIGN-SYSTEM.md` §1; a deliberate brand choice, not `prefers-color-scheme`), with a user override persisted to `localStorage`.
- **Offline write queue:** clock-ins, leave requests and swap _requests_ made offline are written to an IndexedDB outbox (`src/lib/offlineOutbox.ts`, `src/services/syncQueue.ts`: the replayers are `clock`, `leave` and `swap`) and replayed against the API on reconnect via `useSyncQueue`. Swap and leave _responses_ are review actions and are not queued. A permanently rejected write moves to a dead-letter store.
- **Reads while offline:** the service worker caches no API response (`vite.config.ts`: the one runtime caching rule is for fonts), so there is no cached read story; `docs/ARCHITECTURE.md#offline-and-pwa` classifies every feature.
- **Live refresh:** there is no WebSocket or server-sent event channel in `src` (a search for them finds only comments). Screens that used the legacy realtime feed poll instead, through `useRealtimeRefresh` (`src/hooks/useRealtimeRefresh.ts`, hook 11 in `docs/ARCHITECTURE.md#hook-contracts`), and the notification bell and navigation badges poll (`src/hooks/useNavBadgeCounts.ts`).
- **Local component state:** `useState`/`useReducer`. The rota builder's drag-drop working copy is local until published (no global store needed for V1).

## 5. PWA & offline strategy

All of this is `vite.config.ts` (vite-plugin-pwa, Workbox `generateSW`).

- **Precache:** the hashed app shell (js, css, html, icons), minus the marketing-only chunks and `prerendered/**` that the config excludes.
- **Navigation:** `navigateFallback: 'index.html'` → the SPA boots offline and its own UI (e.g. `OfflineBanner`) communicates connectivity. A denylist keeps `/sitemap.xml`, `/robots.txt`, `/.well-known/`, `/assets/`, `/icons/` and `/fonts/` out of the fallback, because those are real files.
- **Runtime caching:** exactly one rule: same-origin `/fonts/` → `CacheFirst` (cache `rotaflow-fonts`, 8 entries, one year). There is deliberately **no rule for `/api/*`**: API responses are tenant data behind a bearer token, so the service worker never caches them and nothing one person read can be served to the next person on a shared device. The old REST and image-CDN caches are legacy and gone.
- **Updates:** `registerType: 'prompt'` + `skipWaiting: false`. A new SW waits; the app shows a "Reload to update" prompt so users are never interrupted.
- **Push:** `importScripts: ['/push-sw.js']` pulls `public/push-sw.js` into the generated worker; it displays the notification.
- There is no `public/offline.html`. One was removed on 5 September 2026 (GAP-051): it had been precached but was never served, since `navigateFallback` is `index.html` and no route or handler referenced it.

## 6. Data flow example (publish a rota → notify staff)

```
RotaBuilderPage (manager, org-scoped)
  → rotaService.publishRota(id)                          // src/services/rotaService.ts
    → api.post('/orgs/{o}/rotas/{r}/publish')            // same-origin /api, Bearer token
      → Api::handle → Mod\Rotas::publish                 // backend/src/Mod/Rotas.php
          • Scope: the caller must be an owner or manager of {o}; a non-member gets 404
          • one transaction: lock the draft rota, refuse if it is not a draft,
            refuse a double-booked person (scheduling module on) or a day below
            the minimum cover, archive the rota it supersedes (amendments),
            set status 'published', write the audit row, queue the notice, commit
          • Mod\Rotas::notifyPublished calls Notify::enqueue INSIDE that transaction
            (backend/src/Notify.php), so the outbox row commits with the publish
            or not at all: a closed tab cannot lose it. A first publish queues one
            row for everyone with a shift; an amendment queues ONE ROW PER AFFECTED
            PERSON, listing what changed for them (backend/src/RotaDiff.php)
          • the row is written to notification_outbox (backend/migrations/007-communication.sql)
  → on error: Sentry.captureException + toast; local draft preserved

cron: backend/bin/cron.php runs Mod\Notifications::cron, which calls
Dispatcher::drain (backend/src/Dispatcher.php) on the pending rows:
      • drops recipients who are no longer active members
      • the organisation's notification matrix decides which channels an event
        may use, including in-app; a person's own switch mutes email and push only
      • inserts the in-app inbox rows into `notifications`
      • sends email (Mail::forOrg, backend/src/SmtpMailer.php) and web push
        (backend/src/WebPushSender.php), and records every attempt per channel
        in notification_deliveries
      • a failing row backs off and is abandoned after five attempts
  → the app reads the inbox with GET /orgs/{o}/notifications
    (src/services/notificationService.ts, the notifications screen and bell)
  → a device shows a push through public/push-sw.js
  (the sms channel is a reserved seam: backend/src has no SMS code)

Offline example (staff clock-in with no signal)
  → the clock-in page sends the write through sendOrQueue (src/lib/queuedWrite.ts)
    → offline, or a transient failure? append to the IndexedDB outbox (enqueueWrite in
      src/services/syncQueue.ts)
    → online?  clockService.recordClockEvent posts it to the API
      (a replayed client_event_id is answered with the stored event, so a replay is safe)
  → on reconnect (useSyncQueue): the outbox replays in order against the API;
    an item that lands is removed, a permanently rejected one moves to dead letters
```

How cron, the outbox and the channels work in full is `docs/NOTIFICATIONS-SPEC.md`.

## 7. Build & deploy pipeline

The server has **no Node/npm**. The build runs on the developer's machine and only the artifacts are shipped. Full playbook + safety rules: **`docs/DEPLOYMENT.md`**.

1. `pnpm run build` → `tsc --noEmit` (gate) → Vite build → `dist/` (+ `sw.js`, manifest, source maps) → `scripts/prerender.mjs`, which renders the sitemap pages and a not-found page with the real component tree (`src/entry-prerender.tsx`, built for Node and discarded) into `dist/prerendered/`. `src/main.tsx` hydrates a prerendered page when its `data-prerendered` marker matches the path, and renders from empty otherwise. `pnpm run check:bundle` (`scripts/check-bundle-size.mjs`) enforces `bundle-budget.json`.
2. `pnpm release` (`scripts/release.mjs`, settings in `release.json`) is a dry run; `pnpm release --go` ships over SSH with rsync. Preflight needs the branch to be `main`, clean and equal to origin; then the `checks` (`pnpm run check`) and the `build` command in `release.json`, which rebuilds `dist/` with the public Clerk key set inline and fails if the bundle holds a retired service host or a secret-key shape or if `dist/.htaccess` exists. `pnpm verify` runs those checks and the upload guard only, never contacts the host.
3. Three parts are uploaded, in order (`release.json`): `backend` to the private app folder (excluding `tests/`, `public/`, `private/` and markdown; `.sql` allowed), `backend/public/api` to the web root's `api/`, and `dist` to the web root (no `*.map`). The entry files `index.html`, `sw.js` and `manifest.webmanifest` go last. Nothing is deleted on the server and protected names (`config.php`, `.htaccess`, `.env*`, dumps) are never sent.
4. Before uploading, every server file about to change is copied to a dated folder under `~/backups/rotaflow/releases/` (the newest three are kept). Six smoke checks must pass (`/`, `/api/health`, `/api/me` is 401, `/app/dashboard`, a 404 page, `/assets/` is 403) or the snapshot is restored automatically. `pnpm release --rollback` restores the newest snapshot.
5. The release does **not** apply database migrations: `php bin/migrate.php` is a separate step on the host (`backend/bin/migrate.php`, header).
6. The web-root `.htaccess` is never part of a release. `pnpm htaccess` (`scripts/htaccess.mjs`) composes it with the Cloudflare origin lock and pushes it with a backup and a smoke check.
7. Source maps: `vite.config.ts` loads the Sentry plugin only when `SENTRY_AUTH_TOKEN` is set in the build environment, and `*.map` is never uploaded to the host. Whether the live build uploads maps is `NOT VERIFIED`.

## 8. Security posture

- Only browser-safe values ship. The bundle may carry exactly the six names in `src/lib/env.ts` (`VITE_APP_NAME`, `VITE_APP_URL`, `VITE_SENTRY_DSN`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_TURNSTILE_SITE_KEY`), all public by design, and `scripts/check-bundle-size.mjs` fails the build if any other `VITE_*` name appears in `dist/`. Vite inlines every `VITE_*` variable whether or not code reads it, so a key is out of the bundle when a search of `dist/` says so, not when the code that used it is gone.
- Stripe's secret and webhook secrets, the VAPID private key, SMTP credentials, the OpenRouter key, the Clerk secret key and the database credentials never touch the client. They live in the private config outside every web root (`backend/private/config.example.php` names them without values; `backend/src/Bootstrap.php` reads them).
- **Tenancy is enforced in PHP.** Every organisation-scoped handler starts with `Scope::membership()` (`backend/src/Scope.php`): the organisation id comes from the URL and is checked as a UUID but never trusted, the role is read from the database, and a non-member gets 404. `backend/src/Ctx.php` hands each module its database handle, rate limiter and config.
- **Sign-in:** `backend/src/Jwt.php` verifies the Clerk session token (RS256 against the issuer's published keys, issuer, expiry and authorised party), and `backend/src/Users.php` maps it to a user.
- **Rate limits:** 600 requests a minute per signed-in user and 300 a minute per address on public routes (`backend/src/Api.php`), counted in the database (`backend/src/RateLimiter.php`). JSON bodies are capped at 256 KB, with larger caps for picture and document uploads.
- `.htaccess` redirects to HTTPS and sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS, a `Permissions-Policy` and a Content-Security-Policy that names only the app's own origin, Clerk, Cloudflare's challenge and Sentry. It drops `X-Powered-By`, and `backend/public/api/index.php` removes it too. These are repository settings; what the live site sends is `NOT VERIFIED` here.

The full model, the data-protection table and the incident record are `docs/SECURITY.md`.

## 9. Rota assistant

Surfaced as the rota builder's "AI assistant" action (`RotaAssistantPanel`), not a standalone page. Three tabs, in the order a manager works:

| Tab           | What it does                                                  | Needs a network? |
| ------------- | ------------------------------------------------------------- | ---------------- |
| **Review**    | Every problem the visible rota is about to cause, worst first | No               |
| **Fill gaps** | Ranked cover for each open shift, with the reasoning shown    | No               |
| **Ask AI**    | Free-text drafting via OpenRouter                             | Yes              |

### 9a. The deterministic half, `src/lib/rotaInsights.ts`

Review and Fill gaps are **pure functions over rows the org already has**, so they work offline, with no API key, and cannot invent a name or a date. They are the assistant's judgement; the model is only ever allowed to phrase things.

`computeRotaInsights` flags: unfilled shifts (escalating inside a week), staff rostered inside approved leave, staff rostered against declared unavailability, overlapping shifts, rest gaps under the WTR's 11 hours, weeks scheduled over contracted hours, and documents expiring while their holder is still on the rota.

`suggestCoverForShift` ranks who could work an open shift. Approved leave, an overlapping shift and a declared unavailability are **hard blockers**. They remove a candidate rather than costing points, because no amount of good fit makes it legal to roster someone who is on holiday. Contract overrun and a tight rest gap stay visible instead, so a manager can take the decision knowingly.

There is no required-skills column on `shifts`, so "right skills" means overlapping with the people who already work that pattern at that site, an observation, not an invented rule. Both functions take `now` as a parameter so every rule agrees on one instant and the tests can pin it (`src/lib/rotaInsights.test.ts`).

### 9b. The language-model half (OpenRouter)

A first slice of NL scheduling (PRD §5, pulled forward from V2). One PHP module serves two tasks, because both need the same grounding query: `POST /orgs/{o}/ai/rota` returns shift suggestions and `POST /orgs/{o}/ai/announcement` returns a draft announcement for the composer (`backend/src/Mod/AiAssistant.php`, header). Without an OpenRouter key in the private config it refuses with 503 `ai_unavailable`, and the two deterministic tabs carry on working.

```
RotaBuilderPage → RotaAssistantPanel (owner/manager, org-scoped)
  → aiRotaService.generateRotaSuggestions(orgId, prompt, periodStart, periodEnd)
    → api.post('/orgs/{o}/ai/rota', ...)               // src/services/aiRotaService.ts
      → Mod\AiAssistant (backend/src/Mod/AiAssistant.php). Refusals are made in this
        order, each before any outside call, and each fails closed:
          1. the caller is an owner or manager (never a support session)
          2. the plan includes `ai_rota_assistant`
          3. the `ai_rota_assistant` feature flag is on (the platform's kill switch)
          4. the server holds an OpenRouter key
          5. 30 requests an hour for the person, 200 an hour for the organisation
        then it reads the period's staff, shift types, locations, shifts, approved
        leave and declared unavailability, sends them to OpenRouter as aliases
        (S1, S2...) without names and leave as dates only (AiStaffAliases), and
        checks the reply before returning it: ids matched to real rows, times snapped
        to the shift type's hours, overlaps and leave days dropped, and an
        announcement refused if it states a date in neither the period nor the
        manager's own words (backend/src/AiGrounding.php)
  → nothing is written yet. Suggestions preview as dashed chips on the live grid
  → manager clicks "Apply": shiftService.createShifts (src/components/rota/RotaAssistantPanel.tsx)
    writes into the rota already open in the builder, through the same shift
    routes as any other rota-builder write
```

Model defaults to `openai/gpt-4o-mini`, overridable by the `openrouter_model` private setting; a second model can be configured as a fallback. The key is set in the private config on the host, never in the client bundle. The contract is `docs/API-SPEC.md`.

### 9c. Billing (Stripe)

Billing is `backend/src/Mod/Billing.php` (organisation-facing routes: state, account, checkout, portal), `backend/src/StripeClient.php` (a cURL client with an explicit test or live mode; a key of the other mode is refused), `backend/src/Mod/StripeWebhook.php` (the public, raw `POST /stripe/webhook`, whose signature is checked by `BillingRules::verifySignature` and whose events are recorded once per mode) and `backend/src/BillingRules.php` (the pure decisions). Plan limits and the read-only rule are `backend/src/Billing.php`. Stripe runs in test mode until the owner switches it; the live mode is `NOT VERIFIED` (server config). The contract is `docs/API-SPEC.md`.

---

## 9d. The PHP API (`backend/`)

The product runs on this API since the 1 November 2026 cutover (`docs/CUTOVER.md`, `docs/MERGE-TARGET.md`). `backend/` is the one top-level folder the merge added.

| Part                          | What it is                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/public/api/index.php` | The only web-reachable file. Health first, then config, Clerk token check, router. GET and POST only; every error is `{"error":{"code","message"}}`      |
| `backend/src/Api.php`         | The router: the sign-in gate, the rate limits, the body caps and the one error shape. Routes come from every module in `backend/src/Mod/`            |
| `backend/src/Mod/*.php`       | One module per area. A module implements `Module` (`routes()`), may add a static `cron()` job, and begins every organisation-scoped handler with `Scope::membership()` |
| `backend/src/` (shared)       | `Ctx` (database handle, limiter, config), `Scope` (tenancy), `Jwt` and `Users` (Clerk), `Db`, `RateLimiter`, `HttpError`, `Input` (strict request-field reading), `Notify` and `Dispatcher` (outbox), `Mail`, `SmtpMailer`, `WebPushSender`, `FileStore`, `Flags`, the pure rule files (`SchedulingRules`, `TimesheetRules`, `CoverRules`, `ComplianceRules`, `MinimumCover`, `BillingRules`, `SupportRules`), `Audit`, `Retention`, `Backup` |
| `backend/bin/migrate.php`     | Numbered `NNN-name.sql` files, a checksum per applied file (a changed file aborts the run), run as the migration identity                                |
| `backend/bin/cron.php`        | One cPanel cron entry; runs each module's `cron()` job under a lock. Live runs it every five minutes. No long-running worker exists on the host        |
| `backend/bin/backup.php`      | Writes a gzipped, checksummed database dump and can load it into a scratch database to prove it restores (`docs/DEPLOYMENT.md`, "Database backups")     |
| `backend/bin/grant-platform-owner.php` | Creates the first Super Admin from an email address. Run once on the server; there is deliberately no endpoint for it |
| Private root                  | A folder beside the web root on the host, outside every web root: `config/`, `cache/` (Clerk keys, the cron lock), `logs/`, `uploads/` and the uploaded `app/`. Located by `ROTAFLOW_PRIVATE_ROOT`, never by the request |
| `backend/bin/doctor.php`      | Run before every release and after any hosting change: checks the PHP version (8.4 or newer) and the extensions the API needs (`pdo_mysql`, `openssl`, `curl`, `json`, `ctype`, `iconv`, `pcre`). The API deliberately calls no `mb_*`, `sodium_*`, `gmp_*` or `bc*` function (a test enforces it), because the host's PHP has shipped without them |
| Tests                         | `backend/tests/`, run with `pnpm run test:php` against a throwaway MariaDB on `127.0.0.1:3308` (`scripts/test-db.sh up`), never against live data         |

The mapping from the retired database policies to PHP checks is `docs/RLS-TO-PHP.md` (a finished plan); the access checks as built are `backend/src/Scope.php`, with the access sweep in `backend/tests/suites/099-access-sweep.php`.

### The browser on the API

`AuthProvider` (`src/context/AuthContext.tsx`) wraps Clerk's `ClerkProvider` (key `VITE_CLERK_PUBLISHABLE_KEY`) and reads `GET /me` once per session: the user id the app uses is the API's, and memberships and the platform role come with it. `src/lib/api.ts` is the only network client: same-origin `/api`, the Clerk session token as Bearer, SQL timestamps read as UTC, and `activeOrgPath()` for the services whose callers pass only a row id. Sign-in, sign-up, two-step verification, connected accounts and sessions are Clerk's own screens. Live refresh is polling (`useRealtimeRefresh`). The service worker caches no API response.

## 10. Edge Functions (legacy)

The Supabase Edge Functions were the only server compute before the 1 November 2026 cutover; the product no longer runs any of them. The folder `supabase/functions` is kept in the repository as a legacy source tree until a later phase removes it (it holds 12 Edge Functions plus `_shared`). Each was replaced by a PHP module in `backend/src/Mod/`; all 12 were confirmed by reading the module:

| Legacy function | Replaced by |
| --- | --- |
| `ai-rota-assistant` | `Mod/AiAssistant.php`: `POST /orgs/{o}/ai/rota` and `POST /orgs/{o}/ai/announcement` |
| `billing-account` | `Mod/Billing.php`: `GET /orgs/{o}/billing` |
| `calendar-feed` | `Mod/CalendarFeed.php`: public `GET /ics`, plus the issue and revoke routes |
| `create-checkout-session` | `Mod/Billing.php`: `POST /orgs/{o}/billing/checkout` |
| `create-portal-session` | `Mod/Billing.php`: `POST /orgs/{o}/billing/portal` |
| `delete-account` | `Mod/Gdpr.php`: a request enters through `POST /me/data-requests` and a closed erasure case; `Gdpr::cron` drains `account_deletions` and deletes the Clerk user |
| `public-enquiry` | `Mod/Enquiries.php`: public `POST /enquiries` |
| `purge-storage` | `Mod/Lifecycle.php`: `Lifecycle::cron` drains `storage_deletions` |
| `send-invite` | `Mod/Invites.php`: `POST /orgs/{o}/invites` and `/invites/{i}/resend`, sending through `Mail::forOrg` |
| `send-notification` | `Dispatcher::drain`, run by `Notifications::cron` (`backend/src/Dispatcher.php`, header) |
| `stripe-webhook` | `Mod/StripeWebhook.php`: public raw `POST /stripe/webhook` |
| `test-smtp` | `Mod/OrgSettings.php`: `POST /orgs/{o}/smtp/test` |

**Legacy:** the previous text of this section, and the rule about which key each function used, are available with `git show live-supabase-2026-11-01:docs/ARCHITECTURE.md`. The routes and their contracts are `docs/API-SPEC.md`.

## Offline and PWA

What RotaFlow actually does without a network, feature by feature. §5 above is the strategy; this section is the per-feature truth, and it is narrower than "offline-first" implies. Merged from the deleted `docs/OFFLINE-SPEC.md` on 11 October 2026; written 4 September 2026 by reading the code, and line numbers it cites are from that date.

What RotaFlow actually does without a network, feature by feature, with the
evidence for each. Written 4 September 2026 by reading the code, not the claims.

### Why this file exists

The product describes itself as offline-first in `package.json`, in `CLAUDE.md`,
in `README.md` and on the marketing site. That was never written down as a
per-feature statement, so "offline-first" was doing a lot of work unsupervised.
Reading the code produced a narrower and more interesting answer than either
"it works offline" or "it does not".

GEE OS asks for exactly this classification before a PWA can be called ready
(`~/.agents/gee-os/systems/pwa/PWA-ENGINEERING-OS.md`). Its rule is the one that
matters here: **do not promise generic offline support; state exactly what works
and what does not.**

**The public promise** (decided 10 October 2026 with the 2026 plan pack): "Clock-ins,
leave and swap requests can wait on the phone until the signal returns." Not "works
offline". The conditions that promise has to survive, and what proves each in a
browser as of 21 October 2026:

| Condition                              | Required behaviour                                                       | Proved by                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| First visit with no signal             | Says a connection is needed to sign in. Shows no invented rota           | Partly: `e2e/pwa-offline.spec.ts` opens sign-in from the precache; signing in offline is not asserted       |
| App opened offline with nothing cached | Shell opens with a clear "not available offline" state                   | `e2e/pwa-offline.spec.ts` (shell); `e2e/offline-clock-in.spec.ts` "opened cold" (the clock screen's state)  |
| Clock-in queued                        | "Waiting to send" on the button, with the time it was recorded           | `e2e/offline-clock-in.spec.ts`: "Offline, 1 waiting" and "Saved on this device, not sent yet"               |
| Back online                            | Sends once. Shows "Sent" or the server's reason for refusing             | `e2e/offline-clock-in.spec.ts`: one row, "Synced", no second row on reload. A refusal: `FailedWritesNotice` |
| Session expired while queued           | Asks the same person to sign in, then sends. Never sends as someone else | `e2e/offline-clock-in.spec.ts`: held through a colleague's session, sent when its owner signs back in       |
| Two tabs or two phones                 | No duplicate clock events                                                | Not in a browser: the Web Lock and the `client_event_id` key (`backend/migrations/006-time-and-requests.sql`), unit-tested only |
| App update while items are queued      | Queue survives the update                                                | Not asserted: the update path is (`e2e/pwa-offline.spec.ts`), a queue across it is not                      |
| Membership revoked                     | Queued writes are refused by the server, and the person is told          | Not in a browser: server-side refusal plus `FailedWritesNotice`                                             |

**Re-checked against the PHP API and Clerk, 9 November 2026.** The table above is the 21 October 2026 evidence and its cells are left as written. Two things changed under it. `e2e/offline-clock-in.spec.ts` still needs a local Supabase stack (`E2E_LIVE_SUPABASE`, a service-role key and REST inserts into `clock_events`), so it cannot run against the PHP API and is `NOT VERIFIED` as proof today; `e2e/pwa-offline.spec.ts` needs no backend. And sign-in is now Clerk: a signed-in start needs Clerk's script and `GET /me` (`src/context/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`) before any `/app` screen renders, and neither has a cached copy, so the rows "App opened offline with nothing cached" and "Session expired while queued" are `NOT VERIFIED` for the Clerk and PHP stack until someone runs them in a browser.

### The honest one-paragraph version

The **app shell** is precached, every lazy route chunk included (166 entries
when counted on 4 September 2026, not recounted since: `NOT VERIFIED`), so the
static application can load with no network; whether a signed-in start gets past
Clerk and `GET /me` offline is `NOT VERIFIED` (note above). **Three writes** are
genuinely offline: clocking in or out, requesting leave, and offering a swap,
all queued in IndexedDB with idempotency keys and replayed on reconnect.
**Everything else needs the network.** There is no durable offline copy of any
domain data, and since the cutover the service worker caches no API response at
all (`vite.config.ts`), so nothing is readable offline except the static pages.

### Classification

GEE OS classes are `offline read`, `offline write`, `offline queue`,
`offline processing`, `network required` and `never cache`.

| Feature area                              | Class             | Evidence                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell, boot, install, update prompt   | offline read      | the precache and `navigateFallback` in `vite.config.ts`; `src/App.tsx`. A signed-in start also needs Clerk and `GET /me`: `NOT VERIFIED` offline (note above)                                                                                                                                  |
| Marketing pages, legal pages              | offline read      | static React, precached chunks, `navigateFallback: 'index.html'` in `vite.config.ts`                                                                                                                                                                                                           |
| Clock in / clock out, including GPS       | **offline queue** | `src/pages/app/ClockInPage.tsx` (`enqueue('clock', ...)` and `sendOrQueue`), replay `src/services/syncQueue.ts` (`REPLAYERS.clock`)                                                                                                                                                            |
| Leave request (staff submitting)          | **offline queue** | `src/pages/app/LeavePage.tsx` (`sendOrQueue`, `enqueue('leave', ...)`)                                                                                                                                                                                                                         |
| Shift swap request or offer (staff)       | **offline queue** | `src/pages/app/SwapsPage.tsx` (`sendOrQueue`, `enqueue('swap', ...)`)                                                                                                                                                                                                                          |
| Rota view, my shifts, clock history       | network required  | no application cache and no service-worker cache of API responses (`vite.config.ts`: the only runtime caching rule is for fonts)                                                                                                                                                               |
| Rota builder and publish                  | network required  | publishing is `POST /orgs/{o}/rotas/{r}/publish` (`backend/src/Mod/Rotas.php`) and is not queued: the outbox kinds are `clock`, `leave`, `swap` and a retired `notify` (`src/lib/offlineOutbox.ts`)                                                                                            |
| Leave, swap and overtime approvals        | network required  | `enqueue` is called only from the clock, leave-request and swap-request paths (`src/pages/app/ClockInPage.tsx`, `LeavePage.tsx`, `SwapsPage.tsx`); no review path queues                                                                                                                       |
| Announcements                             | network required  | reads through the API client (`src/services/announcementService.ts`), nothing cached or queued                                                                                                                                                                                                |
| Notifications list, web push subscription | network required  | `src/services/notificationService.ts` (`GET /orgs/{o}/notifications`), `src/hooks/useWebPush.ts` (`POST /me/push-subscriptions`)                                                                                                                                                               |
| Reports, timesheets, CSV export           | network required  | generated from live reads                                                                                                                                                                                                                                                                      |
| Admin and platform console                | network required  | every `platform*Service` read                                                                                                                                                                                                                                                                  |
| Sign in (Clerk)                           | network required  | Clerk's script and API are served from Clerk's host, and no runtime cache rule covers it (`vite.config.ts`; the origins are in the CSP in `.htaccess`)                                                                                                                                         |
| An existing session                       | offline read (`NOT VERIFIED`) | the old claim was that the legacy Supabase client kept the session in `localStorage`. Clerk keeps its own cookies and local storage (`src/lib/legalFacts.ts`), but `AuthProvider` reads `GET /me` on every start and `ProtectedRoute` shows a retry card when it fails (`src/components/ProtectedRoute.tsx`): by the code, a signed-in cold start offline does not reach an `/app` screen unless Clerk's script is in the browser's own HTTP cache. Not tested in a browser |
| Conflict resolution while offline         | **none**          | server-side rejection only (`leave_overlap`, `backend/src/Mod/Leave.php`), see below                                                                                                                                                                                                           |

### The write queue, which is the strong part

`src/lib/offlineOutbox.ts` is raw IndexedDB, database `rotaflow-outbox` at
version 2, with `queued_writes` and `dead_letters` stores and a v1 to v2
migration. `src/services/syncQueue.ts` replays it.

- **Idempotency is real.** Every queued write carries a `client_event_id`
  minted before the first online attempt (`crypto.randomUUID()` in
  `src/pages/app/ClockInPage.tsx`; `withIdempotencyKey` in
  `src/services/syncQueue.ts` adds one at enqueue when a caller did not). The
  API answers a replay of a stored key with `200` and `already_applied: true`
  (`backend/src/Mod/Clock.php`, `Leave.php`, `Swaps.php`), so a replay is simply
  a success (`isAlreadyApplied` in `src/services/syncQueue.ts`, which still
  recognises the legacy database's `23505` collision for items queued by an
  older build). The database side is a unique key on `client_event_id` in
  `clock_events`, `leave_requests` and `shift_swaps`
  (`backend/migrations/006-time-and-requests.sql`). This is the design the PWA
  engine asks for.
- **Failure is classified, not retried blindly.** Permanent failures dead-letter
  and let the queue continue; transient ones stop the flush and wait for the next
  reconnect; five attempts (`MAX_ATTEMPTS`) exhausts a write. `classifyFailure`
  (`src/services/syncQueue.ts`) treats a dropped connection, HTTP 401 (a Clerk
  token that aged out; the next attempt carries a fresh one), 408, 425, 429 and
  5xx as transient, and any other 4xx as the server refusing that payload. The
  legacy database's SQLSTATE classes `08/40/53/57/58` stay classified for items
  queued by an older build.
  A leave request booked offline over days the person already has off comes
  back from the API as `409 leave_overlap` (`backend/src/Mod/Leave.php`), which
  is a 4xx and therefore permanent — so it dead-letters into the notice below
  with the sentence `src/services/leaveService.ts` gives it, rather than being
  replayed forever or landing as a second booking. That is the one conflict
  this queue can detect: the write is refused, not merged.
- **Nothing is silently discarded.** A dead-lettered write surfaces in
  `src/components/FailedWritesNotice.tsx` with Retry and Discard, on all three
  screens that can queue. This satisfies the engine's hardest rule, that user
  work is never silently lost.
- **Queued is not reported as saved.** The clock screen says "saved offline, will
  sync automatically" and shows queue depth; the leave and swap modals carry the
  same notice.
- **Replay is a property of being signed in, since 2026-09-05 (BUG-077).**
  `OfflineQueueDrain` mounts `useSyncQueue` once inside `AppShell`, and the hook
  flushes on reconnect, **on mount when already online with work waiting**, and
  on returning to the foreground. Only the first of those existed before, and it
  is the one that fires least often: the `online` event reaches a mounted
  listener, so a phone that queued a clock-in with no signal, was closed, and was
  reopened somewhere with signal flushed nothing at all. The write was visible in
  the pending list the whole time. The hook also lived only on the three screens
  that can queue, so simply navigating to the dashboard stranded it.
- **Two tabs do not burn one retry budget.** `flushQueuedWrites` takes a Web Lock
  (`rotaflow:sync-queue`). Nothing was ever written twice — the idempotency keys
  above cover that — but both tabs spent an attempt on every transient failure,
  so a queue that should survive five retries died in two or three, and the
  difference lands as a dead-lettered clock-in. Where Web Locks is unavailable the
  flush proceeds unguarded, which is what shipped before; refusing to send
  somebody's work because a browser API is missing would be worse.
- **A write belongs to the person who queued it, and a write with no owner
  belongs to nobody (plan S4, 2026-10-11).** Every record carries `userId`
  (GAP-042), and `flushQueuedWrites`, `listQueuedWrites`,
  `listDeadLetteredWrites` and `retryDeadLetteredWrite` match only the signed-in
  user. A record with no `userId`, or an empty one, was queued before that field
  existed. It used to be claimable by whoever signed in next, which on a shared
  phone meant replaying a colleague's GPS clock-in under your own token. It is
  now quarantined in place: kept in IndexedDB untouched, never replayed, never
  listed and never retried, so the evidence survives and nobody acts on work
  that is not theirs. Removing such a record is a separate, deliberate step that
  does not exist yet (see `KNOWN-ISSUES.md`). The plan's 7-day expiry of dead
  letters is not built.
- **Sign-out releases this browser's push subscription (plan S4).**
  `releasePushSubscription` in `src/lib/session.ts` runs before Clerk's
  `signOut` in the one sign-out path (`AuthContext.signOut`,
  `src/context/AuthContext.tsx`): it deletes the push subscription row through
  `deletePushSubscription` (`POST /me/push-subscriptions/delete`) while the
  session can still authorise the call, then unsubscribes the browser either way. It never throws and gives up after
  3 seconds, so signing out offline or with no service worker still works. A
  session that ends any other way (an expired token, a revocation from another
  device) does not run it: the browser stays subscribed and the row stays until
  the next subscribe on that device replaces it (`backend/src/Mod/Notifications.php`
  upserts by endpoint).

### What the reading story really is

There is **no runtime cache for domain data**. Before the cutover one rule cached
the legacy REST API (`NetworkFirst`, a 5 second timeout, 50 entries, 5 minutes).
`vite.config.ts` now has exactly one runtime caching rule, for fonts, and says why
no rule covers `/api/*`: the responses are tenant data behind a bearer token, and a
cached copy could be served to the next person on a shared device. Builds before
S9 wrote two response caches; `src/lib/session.ts` deletes them on sign-out and
nothing writes them any more.

So the app cannot show a rota, a shift list or clock history offline. Whether a
screen opens offline at all depends on the static shell and on a signed-in start
getting past Clerk and `GET /me` (note under the classification table), which is
`NOT VERIFIED` in a browser. The banner copy (`src/components/OfflineBanner.tsx`)
says "Some saved screens may still open"; the three strings quoted under "Known
defects" below no longer exist in `src`, but which screens that sentence is true
for is not measured anywhere.

There is no react-query, SWR or TanStack cache; data loading is `useEffect` plus
a service call. IndexedDB is write-only. `localStorage` holds preferences
(active org, theme, sidebar, report options) and Clerk's own browser storage
(`src/lib/legalFacts.ts` lists what the app and Clerk keep, with their sources).

### What a manager can and cannot see, which follows from all of the above

Added 2026-09-06, with the attendance workspace, because the consequence had
never been written down and the product was about to start asserting things
about it.

**A queued clock-in exists only on the device that made it.** It is a row in
that browser's IndexedDB outbox until the queue drains. Nothing on the server
knows about it, so nothing a manager opens can know about it either — not the
dashboard, not Team Attendance, not a report, not an export.

Three rules follow, and every one of them is implemented rather than intended:

1. **The absence of a clock event is `not_recorded`, never "absent".**
   `src/lib/attendance.ts` names the state that way and
   `ATTENDANCE_STATUS_META` spells out why on every screen that counts it: an
   unsynchronised offline clock-in is indistinguishable, from here, from one
   that never happened. `attendanceRows.ts` writes the same thing into the
   row's issue sentence, and `attendanceRows.test.ts` asserts the word
   "absent" does not appear in it.
2. **No screen invents a "pending sync" figure for somebody else.** The person
   whose device holds the queue sees their own depth
   (`syncStatusLabel`); a manager is told the board reflects what has reached
   the server and is given the time of the last successful read. Reporting a
   number the server cannot observe would be a fabrication dressed as
   reassurance.
3. **Reconciliation is by re-read, not by patching.** When a queued event
   drains, it arrives as an ordinary API write; the board's next poll
   (`useRealtimeRefresh`) re-reads the window and re-derives it from the clock
   events. A late-arriving clock-in for a shift already marked `not_recorded`
   therefore corrects itself on the next poll. A manager's correction that
   lands inside an approved or exported period flags that timesheet
   (`recalculation_required_at`, `backend/src/Mod/Clock.php`) rather than moving
   a signed total; whether a late replayed clock-in flags one is `NOT VERIFIED`.

**What is still NOT TESTED here** is the same thing GAP-050 has said since
2026-09-04: no browser test drives the offline path. Nothing above has been
watched happening; it is the shape of the code and the wording on the screen.

### Known defects this classification found

1. **The offline copy overclaims.** `src/components/OfflineBanner.tsx:14` says
   "Showing cached content", `SplashScreen.tsx:82` says "Showing your cached
   rota", `AppBootScreen.tsx:149` says "RotaFlow will use what it has cached".
   All three are backed only by the five-minute cache above, so each can be shown
   on a screen with nothing cached at all. Honest network states are a stated
   requirement of the PWA engine, and telling a user their rota is cached when it
   may not be is the failure mode it names.
2. **`public/offline.html` was removed on 5 September 2026.** It had been
   precached but never served — `navigateFallback` is `index.html`, and no route,
   handler or `.htaccess` rule ever referenced it. Precaching an unreachable page
   meant every visitor downloaded a page no route served. Deleted rather than wired
   up, since a second offline page for a shell that already handles offline is
   unnecessary.

   Related, and fixed in the same pass: `navigateFallback` had no
   `navigateFallbackDenylist`, so once the service worker controlled the page
   _every_ navigation resolved to the app shell — `/sitemap.xml`, `/robots.txt`
   and `/.well-known/security.txt` included. `.htaccess` guards that at the
   Apache layer and the service worker never sees `.htaccess`. Verified against
   the deployed build with a live service worker: those three now return
   `application/xml` and `text/plain`.

3. **A cold offline load of the clock screen shows a failure state** even though
   its write path would have worked (`src/pages/app/ClockInPage.tsx:189-192`).
   The one screen most likely to be opened without signal is the one that reports
   itself broken there.
4. **`docs/ARCHITECTURE.md` said swap _responses_ queue.** Only
   `requestShiftSwap` queues; responding to a swap is a review action and needs
   the network. Corrected in the same change as this file.
5. **No test exercises any of this end to end.** `src/services/syncQueue.test.ts`
   is genuinely good at the module level, including a restored-network case, and
   `fake-indexeddb` backs the outbox tests. But `e2e/` contains no offline, slow,
   intermittent or restored-network specification at all, and nothing tests the
   service worker, the manifest, installation or the update prompt.

None of these are fixed by this file. They are recorded here and in
`qa/LAUNCH-CHECKLIST.md` so that the next release decision has to look at
them.

**Re-checked 2026-09-05, and defect 1 above is still true at `main`.** The
delivery audit of that date noted in passing that the working copy had "already
improved some offline wording", and on that basis did not raise it again. It has
not: `OfflineBanner.tsx:14`, `SplashScreen.tsx:82` and `AppBootScreen.tsx:149`
all still promise cached content that the five-minute LRU above may not hold.
Whatever the audit saw was in an uncommitted state that did not survive to
`main`. Recorded because a defect that two documents each believe the other is
tracking is a defect nobody is tracking.

### The nine conditions, and which have been tested

The PWA engine asks for critical journeys under nine network conditions. Status
uses the GEE evidence vocabulary.

| Condition                              | Status     | Note                                                                                                                                                                                                                                    |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full connection                        | PASS       | covered by e2e and by daily use                                                                                                                                                                                                         |
| Slow connection                        | NOT TESTED | no throttled run exists                                                                                                                                                                                                                 |
| Intermittent connection                | NOT TESTED | unit tests simulate it; no browser has                                                                                                                                                                                                  |
| Offline                                | PARTIAL    | queue logic unit-tested; no browser offline run                                                                                                                                                                                         |
| Network loss during an operation       | PARTIAL    | the "looked online but was not" path is handled and tested at unit level (`ClockInPage.tsx:372-384`)                                                                                                                                    |
| Network restoration                    | PARTIAL    | `syncQueue.test.ts:282` covers delivery on return, in isolation. The **restart-while-already-online** case was reproduced as broken by the 2026-09-05 audit and fixed (BUG-077); the fix is reasoned and reviewed, not browser-verified |
| Expired authentication during recovery | NOT TESTED | a queued write replayed after the session expires is unproved                                                                                                                                                                           |
| New version available                  | NOT TESTED | `registerType: 'prompt'` with a Reload button, never exercised in a test                                                                                                                                                                |
| Relaunch after installation            | NOT TESTED | installation itself is untested                                                                                                                                                                                                         |

The gap that would close most of this at once is a Playwright specification using
`context.setOffline(true)`. That is not written yet, and this file does not
pretend it is.

### Service worker and manifest facts

Generated by `vite-plugin-pwa` in `generateSW` mode (the `VitePWA` block of
`vite.config.ts`). Registered from `src/components/UpdatePrompt.tsx` (it imports
`registerSW`), not from `main.tsx`, with `injectRegister: null` so there is
exactly one registration site. Updates use `registerType: 'prompt'` with
`skipWaiting: false`, so a user is never thrown off a page mid-task;
`cleanupOutdatedCaches` removes old caches. Push handlers are added through
`workbox.importScripts: ['/push-sw.js']`, which is the documented way to get
custom code into a `generateSW` worker.

The manifest is inline in `vite.config.ts`: `display: 'standalone'` (with a
`display_override` list), portrait, scope and start URL `/`, three icons (192, 512,
and a 512 maskable), and `id: '/'` (added so browser identity is independent of
start URL). It has no `screenshots` and no `shortcuts`, neither of which are
required for installation.

`.htaccess` serves `sw.js`, `push-sw.js`, `workbox-*.js`, `manifest.webmanifest` and every
`.html` file with `no-cache, no-store, must-revalidate`, while hashed assets are
`immutable` for a year. That is the correct pairing and worth not breaking.

## Hook contracts

Contracts for every reusable hook in `src/hooks`. Merged from the deleted `docs/HOOKS.md` on 11 October 2026. Section numbers below (§1 to §18) are the hook numbers other files cite, as in "Hook contracts §8".

Contracts for every reusable hook in `src/hooks`. Signatures here are the source
of truth. Implementations must match.

**Two sections describe hooks that no longer exist**, marked `— REMOVED` with the
reason: `useInngestDispatch` (§5, removed before the cutover) and
`useOptimizedImage` (§4, deleted 2026-08-31 because nothing imported it). They are
kept deliberately. A hook that was documented as an approved contract and then
vanished invites someone to reintroduce it, and the useful thing to record is not
its signature but why it went. Do not read them as stale entries, and do not
delete them to make this file line up with a directory listing. Every other
hook file in `src/hooks` has a section: numbered 1 to 19, or listed under "Hooks
without a numbered section" at the end (checked against `git ls-files -- src/hooks`
on 9 November 2026).

### 1. `usePWAInstall`

`src/hooks/usePWAInstall.ts`
Captures the deferred `beforeinstallprompt` event and drives the install UI.

```ts
interface UsePWAInstall {
  isInstallable: boolean; // a prompt is available
  isInstalled: boolean; // running in standalone / already installed
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}
export function usePWAInstall(): UsePWAInstall;
```

### 2. `useOnlineStatus`

`src/hooks/useOnlineStatus.ts`
Reactive network connectivity based on `online`/`offline` window events.

```ts
export function useOnlineStatus(): boolean; // true when online
```

> **Offline queue and the PHP API.** The queue's idempotency does not depend on a database error naming an index:
> the API answers a replayed write `200 already_applied`, so a replay is simply a success. `classifyFailure` understands
> `ApiError` (`src/lib/apiClient.ts`): a dropped connection (status 0) and an expired session (401) are kept and retried, any other
> 4xx is the server rejecting that payload and is dead-lettered with its stable `code`. The legacy database's error branches stay in
> `src/services/syncQueue.ts` for items queued by an older build.

### 3. `useAuth`

`src/hooks/useAuth.ts`
Thin consumer of `AuthContext`. The single source of session truth. The provider
(`src/context/AuthContext.tsx`) wraps Clerk's `ClerkProvider`, wires the Clerk
token into the API client, and reads `GET /me` once per session; this hook exposes
the result. It replaced the legacy Supabase session hook at the cutover and keeps
its number.

```ts
interface AuthContextValue {
  user: AuthUser | null; // the API's user: { id, email, fullName, avatarUrl }; null signed out or while /me failed
  loading: boolean; // Clerk loading, or the first GET /me of a session in flight
  signedIn: boolean; // Clerk's verdict: there is a session in this browser
  me: MePayload | null; // { user, memberships, platform_role } as GET /me returns it
  meFailed: boolean; // signed in, but the API could not say who this is: a retry card, never "signed out"
  refreshMe: () => Promise<MePayload | null>;
  signOut: () => Promise<void>;
}
export function useAuth(): AuthContextValue;
```

### 4. `useOptimizedImage` — REMOVED (2026-08-31)

Deleted (it wrapped the legacy ImageKit URL builder). It memoised that builder and **nothing ever called it**. The
builder itself, a helper under `src/lib`, turned out to have no caller either and
was deleted on 11 October 2026.
A documented "approved hook contract" that no component consumes reads as a
rule about how images must be loaded, when it was only an unused wrapper.

Nothing in `src/` builds a transformed image URL, and `src/lib/env.ts` reads no
image-CDN variable. Images are served by the API (`backend/src/Mod/Photos.php`).

### 5. `useInngestDispatch` — REMOVED (before the cutover)

Deleted in the Supabase era (legacy migration `0087`). Every notification the
product owes is now queued in the same database transaction as the event that owes
it (`Notify::enqueue`, `backend/src/Notify.php`) and delivered by cron
(`backend/src/Dispatcher.php`; `docs/NOTIFICATIONS-SPEC.md`).

Nothing in the app dispatches a notification any more, so there is no hook to
call, and there is no dispatch service behind it either. An item of kind `notify`
queued by an older install **drains away** on the next reconnect: the replayer in
`src/services/syncQueue.ts` resolves without sending, so it neither retries against
a host that is gone nor sits in the dead-letter list. The work is not lost, it is
no longer owed, because whatever owed it now queues its own row.

See `docs/SAAS.md` GAP-026 for why browser-initiated dispatch was lossy.

### RotaFlow-specific hooks

#### 6. `useOrg`

`src/hooks/useOrg.ts`
Consumer of `OrgContext`. The active tenant and the caller's role within it.

```ts
type MembershipRole = 'owner' | 'manager' | 'staff'; // src/types/index.ts
interface UseOrg {
  orgId: string | null;
  orgName: string | null;
  role: MembershipRole | null;
  memberships: { orgId: string; orgName: string; role: MembershipRole }[];
  isPlatformAdmin: boolean;
  // Which kind of platform administrator, or null for none. isPlatformAdmin says
  // "may act at platform level"; this says "as what" and gates screens inside the console.
  platformRole: PlatformRole | null;
  switchOrg: (orgId: string) => void;
  loading: boolean;
  // Whether reading the memberships (GET /me) failed. See the rule below.
  loadFailed: boolean;
  // Additive beyond the original spec. Used by OnboardingPage and anywhere
  // that needs to force a re-fetch (e.g. after an invite is accepted).
  createOrg: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}
export function useOrg(): UseOrg;
```

> **Rule: never treat `memberships: []` as "this user has no organisation"
> without checking `loadFailed` first.** A failed query produces an empty list
> too. Reading one as the other is what sent an existing owner to `/onboarding`
> whenever the read of `GET /me` failed on a dropped connection, where they
> could create a duplicate organisation. `AppShell` and `OnboardingPage` both
> check `loadFailed && memberships.length === 0` and offer a retry instead.

#### 7. `usePermissions`

`src/hooks/usePermissions.ts`
Derives UI capabilities from the active role (client-side gating only; the API,
`backend/src/Scope.php`, is the real enforcement).

```ts
interface Permissions {
  canBuildRota: boolean; // owner | manager
  canApprove: boolean; // leave/overtime/swaps
  canManageStaff: boolean; // owner | manager
  canManageOrg: boolean; // owner
  canManagePlatform: boolean; // any platform administrator
  // The platform capabilities read platformRole, not isPlatformAdmin:
  canManagePlatformBilling: boolean; // owner, admin, finance
  canManagePlatformConfig: boolean; // feature flags, incidents, settings: owner, admin
  canManagePlatformAdmins: boolean; // grant and revoke platform roles: owner
  canManageSupportCases: boolean; // owner, admin, support
  canReadTenantOperations: boolean; // memberships, audit, support, incidents: owner, admin, support
}
export function usePermissions(): Permissions;
```

#### 8. `useSyncQueue`

`src/hooks/useSyncQueue.ts`
Manages the IndexedDB offline outbox; replays queued writes when back online.

```ts
// src/lib/offlineOutbox.ts
type OutboxKind = 'clock' | 'leave' | 'swap' | 'notify'; // 'notify' is retired and drains away
interface OutboxRecord {
  id: string;
  kind: OutboxKind;
  payload: unknown;
  queuedAt: string;
  attempts: number; // replay attempts so far
  lastError?: string;
  userId?: string; // who queued it; a record with none belongs to nobody
}
type QueuedItem = OutboxRecord;
interface UseSyncQueue {
  pending: QueuedItem[];
  /** Writes that will never send themselves. These need a human. */
  deadLettered: DeadLetterRecord[];
  enqueue: (kind: OutboxKind, payload: unknown) => Promise<void>;
  flush: () => Promise<{ synced: number; failed: number; deadLettered: number }>;
  discard: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  syncing: boolean;
}
export function useSyncQueue(): UseSyncQueue;
```

**When it flushes on its own**, which changed on 2026-09-05 (BUG-077):

1. on reconnect, an offline-to-online transition while mounted;
2. **on mount, when it is already online and the queue is not empty**;
3. on `visibilitychange` back to visible.

Only the first of those existed before, and it is the one that fires least
often. The `online` event only reaches a mounted listener, so the ordinary
case — clock in on a ward with no signal, close the app, walk somewhere with
signal, open it again — flushed nothing at all: the event happened while the
app was closed. The pending list was loaded and rendered, so the person could
_see_ their clock-in sitting there, and nothing sent it.

**Mount it once at app scope, not per screen.** `OfflineQueueDrain` does this
inside `AppShell`, so replay is a property of being signed in rather than of
which page is open — the hook used to live only on the clock, leave and swap
screens, and navigating away was enough to strand a write. Feature screens
still call it for `enqueue` and the failed-writes list; the duplicate flush is
harmless, guarded within a tab by an in-flight ref and across tabs by a Web
Lock (`rotaflow:sync-queue`). Without that lock two tabs reconnecting together
each burn an attempt on every transient failure, and a queue that should
survive five retries dies in two.

**It never clears the outbox on sign-out.** That is `lib/session.ts`'s
deliberate omission: the queue holds the only copy of work that has not
reached the server, and signing out is not a statement that you did not clock
in. Ownership answers the shared-device problem instead — every record carries
the id of the user who queued it.

#### 9. `useGeolocation`

`src/hooks/useGeolocation.ts`
One-shot device position for GPS clock-in (with permission + accuracy handling).

```ts
interface GeoResult {
  latitude: number;
  longitude: number;
  accuracy: number;
}
interface UseGeolocation {
  request: () => Promise<GeoResult | null>; // null if denied/unavailable
  status: 'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';
}
export function useGeolocation(): UseGeolocation;
```

#### 10. `useToast`

`src/hooks/useToast.ts`
Transient user-facing feedback, rendered by `ToastProvider` (`src/context/ToastContext.tsx`).

```ts
type ToastVariant = 'success' | 'error' | 'info';
interface UseToast {
  toasts: { id: number; variant: ToastVariant; message: string }[];
  showToast: (variant: ToastVariant, message: string) => number; // returns id
  showError: (message: string) => number;
  showSuccess: (message: string) => number;
  dismissToast: (id: number) => void;
}
export function useToast(): UseToast;
```

> **Rule: every user-initiated write reports its failure to the user, not just
> to Sentry.** `reportError` alone leaves the user believing the action worked, > the rota builder silently dropped drag-and-drop shift assignments that way.
> Errors render with `role="alert"` and an 8s dwell; success uses `role="status"`.

#### 11. `useRealtimeRefresh`

`src/hooks/useRealtimeRefresh.ts`
Calls back on a timer while the screen is open, so a published rota or an approved
request appears without a manual reload. **Changed 2026-10-30 (merge slice S4):**
it polled nothing before; it listened to the legacy Supabase Realtime feed. The PHP host has no
long-lived socket, so the hook now polls (15 s for clock events up to 120 s for
locations, the fastest of the tables asked for), only while the tab is visible and
the browser online, and once more when the tab returns or the network comes back.
It never fires on mount. The signature and the meaning of `onChange` are unchanged,
so no caller changed. A later optimisation is a "what changed" stamp endpoint so
a poll only refetches when something did.

```ts
type RealtimeTable =
  | 'shifts'
  | 'rotas'
  | 'leave_requests'
  | 'overtime_requests'
  | 'shift_swaps'
  | 'notifications'
  | 'announcements'
  | 'clock_events'
  | 'availability'
  | 'staff_profiles'
  | 'invites'
  | 'locations'
  | 'departments'
  | 'shift_types';
interface RealtimeScope {
  column: 'org_id' | 'user_id';
  value: string | null; // null disables the refresh
}
interface UseRealtimeRefreshOptions {
  tables: RealtimeTable[];
  scope: RealtimeScope;
  onChange: () => void;
  enabled?: boolean;
}
interface UseRealtimeRefresh {
  connected: boolean; // true while the screen is being refreshed on a timer
}
export function useRealtimeRefresh(o: UseRealtimeRefreshOptions): UseRealtimeRefresh;
```

> **Rule: treat a tick as a signal, never as data.** `onChange` re-queries through
> the screen's normal authorised path (the API checks membership and role on every
> request). Nothing from the timer is ever rendered, so there is no route by which a
> row the viewer could not otherwise read could reach the screen.

> **Rule: live updates are an enhancement, never a dependency.** If a poll
> fails, every screen still loads and refetches exactly as before.
> `connected` is exposed for diagnostics; no screen gates its rendering on it.

Every table in `RealtimeTable` needs an interval in `POLL_MS` (the type is a
`Record<RealtimeTable, number>`), so adding a table without one fails the type check.

#### 12. `useNavBadgeCounts`

`src/hooks/useNavBadgeCounts.ts`
Pending-count badges for the sidebar's Leave and Shift Swaps rows.

```ts
interface NavBadgeCounts {
  leave: number;
  swaps: number;
}
export function useNavBadgeCounts(orgId: string | null): NavBadgeCounts;
```

Both counts come from `GET /orgs/{o}/attention` (`backend/src/Mod/Leave.php`,
`attention()`), which the API scopes by role: a manager gets the org's pending
queue, a staff member gets only their own still-pending requests. No role
branching in the hook. It polls every 60s (`POLL_MS`) — this mounts on every
`/app/*` page via `Sidebar`, and a separate timer per tab for two numbers is
what the badge is worth.

#### 13. `useConfirm`

`src/hooks/useConfirm.ts`
Promise-based confirmation dialog. Must be used inside `ConfirmProvider`
(`src/context/ConfirmContext.tsx`); throws if the provider is missing.

```ts
export function useConfirm(): ConfirmContextValue;
```

#### 14. `useFocusTrap`

`src/hooks/useFocusTrap.ts`
Traps focus inside an open drawer or dialog, closes it on Escape, hides the
page behind it from assistive technology (`aria-hidden`), and restores focus
on close. Shared by `Sidebar`'s mobile drawer and the platform console shell
so both get identical, correct behaviour instead of two subtly-different
copies.

```ts
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  containerSelector?: string, // defaults to 'main'
): void;
```

#### 15. `useFeatureAccess`

`src/hooks/useFeatureAccess.ts`
What the active organisation may use, and why — one call to
`GET /orgs/{o}/features` (`backend/src/Mod/FeatureFlags.php`) per org load rather
than a round trip per gate.

```ts
interface FeatureAccess {
  loading: boolean; // gates read false while true
  has: (feature: string) => boolean;
  sourceOf: (feature: string) => 'plan' | 'flag' | null;
  refresh: () => void;
}
export function useFeatureAccess(): FeatureAccess;
```

> **Rule: fails closed.** If the request errors, the granted set is empty and
> every gate reads false — deliberately silent, not reported to Sentry (would
> bury real errors on every page load). A gate that renders on a failed check
> is worse than one that stays hidden.

#### 16. `useWebPush`

`src/hooks/useWebPush.ts`
Subscribes this device to Web Push, storing the subscription through
`POST /me/push-subscriptions` (`src/services/pushSubscriptionService.ts`) for
`Dispatcher` to send to (`backend/src/WebPushSender.php`). Requires
`VITE_VAPID_PUBLIC_KEY`. The receiving side is `public/push-sw.js`, imported into
the generated service worker (`workbox.importScripts`) — before 2026-08-29 no
handler existed and every push the sender signed was silently discarded by the
browser. As of that date delivery had never been observed on a real device (see
`docs/SAAS.md` ❓-007); whether it has been since is `NOT VERIFIED`.

```ts
type WebPushStatus = 'unsupported' | 'default' | 'granted' | 'denied';
interface UseWebPush {
  status: WebPushStatus;
  subscribing: boolean;
  subscribe: (userId: string) => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}
export function useWebPush(): UseWebPush;
```

#### 17. `useConsoleRefresh`

`src/hooks/useConsoleRefresh.ts`
How the platform console's topbar Refresh button reaches the screen under it.
A screen _registers_ its refetch via `useRegisterConsoleRefresh`; the shell
renders the button only while something is registered, instead of a dead
button wired to `location.reload()` that would discard filters/tab/scroll
state.

```ts
interface ConsoleRefreshValue {
  refresh: (() => void) | null;
  register: (fn: (() => void) | null) => void;
}
export function useConsoleRefresh(): ConsoleRefreshValue;
export function useRegisterConsoleRefresh(fn: () => void): void; // for screens
```

#### 18. `usePageMetadata`

`src/hooks/usePageMetadata.ts`
Everything a browser tab, a search result and a link preview show, for one
public route. Reads the path from the router and looks it up in
`src/lib/publicRoutes.ts`, so a page cannot forget its own description the way
a prop can be forgotten.

Before it, `MarketingLayout` set `document.title` and nothing else: one
`<meta description>` served all sixteen public pages, there was no
`<link rel="canonical">`, no Open Graph and no Twitter card anywhere in the
repository, and the four auth routes and the 404 set no title at all.

```ts
interface PageMetadata {
  title?: string; // overrides the route's own
  description?: string; // overrides the route's own
  noindex?: boolean; // ask crawlers not to index this page; used by the 404
}
export function usePageMetadata(overrides?: PageMetadata): void;
```

Callers: `MarketingLayout`, `AuthSplitLayout`. Only the title is restored on unmount; the tags are
overwritten by whichever route mounts next.

#### 19. `useOrgBillingState`

`src/hooks/useOrgBillingState.ts`
The active organisation's trial and read-only state, from
`GET /orgs/{o}/billing/state` (`backend/src/Mod/Billing.php`) through
`getOrgBillingState` in `src/services/subscriptionService.ts`. Any member may read
it, unlike the billing account (owner only), because a manager is who the
read-only banner is for. Re-read on
an organisation switch and every ten minutes, so a trial that ends while the app
is open shows the banner without a reload.

```ts
interface OrgBillingStateResult {
  snapshot: OrgBillingSnapshot | null; // { state, trialEndsAt, readOnly }
  refresh: () => void;
}
export function useOrgBillingState(): OrgBillingStateResult;
```

Fails open: a failed read renders nothing. That is safe because the API,
not this hook, refuses a read-only organisation's writes (the API, with 402
`billing_read_only`: `Billing::requireNotReadOnly`, `backend/src/Billing.php`). Callers: `ReadOnlyBanner` in `AppShell`.

#### Hooks without a numbered section

Six more files in `src/hooks` exist; their contracts are the signatures in the files
(numbered sections are cited by number elsewhere, so these are not numbered):

| Hook | File | What it is |
| --- | --- | --- |
| `useFilterState(options)` | `src/hooks/useFilterState.ts` | Filter, sort and page state held in the URL, one contract for every filterable table (`src/lib/filters.ts`). Sensitive dimensions such as the person search are kept out of the URL |
| `useMediaQuery(query): boolean`, `useIsPhone()` | `src/hooks/useMediaQuery.ts` | A media query from JavaScript, for the one case a CSS class cannot express: rendering a different element at different widths |
| `useOperationalDate(timezone): string` | `src/hooks/useOperationalDate.ts` | The current local date in a timezone, rolling over at the next local midnight on its own |
| `usePersonalPreferences()` | `src/hooks/usePersonalPreferences.ts` | The signed-in person's own preferences, defaults first so a slow read changes nothing; `rememberPersonalPreferences` primes it after a save |
| `useStoredPhoto(source): string \| null` | `src/hooks/useStoredPhoto.ts` | The address to show a photo at: a legacy link as is, a stored photo as a signed link from the API, null until it resolves |
| `useWorkMode()` | `src/hooks/useWorkMode.ts` | Whether the person is looking at the organisation or at their own work, and whether they have a staff profile; the management default outside `WorkModeProvider` |

### Conventions

- Every hook is fully typed with an explicit return type: `tsconfig.json` is `strict` with `noUncheckedIndexedAccess`, and `eslint.config.js` warns on a missing return type (`@typescript-eslint/explicit-function-return-type`), which `--max-warnings 0` turns into a failure.
- Hooks never read `import.meta.env` directly. They import from `@/lib/env` (checked on 9 November 2026: no file in `src/hooks` reads it).
- Side-effectful hooks clean up their listeners in the `useEffect` return.
