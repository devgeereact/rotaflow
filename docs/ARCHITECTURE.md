# System Architecture

## 1. Topology

```text
┌──────────────────────────────────────────────────────────────────┐
│                     Client Browser / Installed PWA                 │
│      React 18 + Vite + Tailwind  ·  Service Worker (Workbox)        │
│      Served as static files from cPanel (public_html)              │
└──────┬───────────────┬───────────────┬───────────────┬────────────┘
       │               │               │               │
       ▼               ▼               ▼               ▼
┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────┐
│  Supabase  │  │  ImageKit  │  │   Sentry   │  │   Inngest (ingest) │
│ Auth + DB  │  │  media CDN │  │ monitoring │  │  event dispatch    │
│  + RLS     │  │ transforms │  │            │  │                    │
└─────┬──────┘  └────────────┘  └────────────┘  └─────────┬──────────┘
      │                                                    │
      ▼                                                    ▼
 PostgreSQL  ·  Edge Functions                  Inngest invokes a Supabase
 (row-level security)                           Edge Function (NOT cPanel)
```

The static bundle talks to each managed service directly over HTTPS. cPanel only
serves files — it never runs application logic.

## 2. Directory layout

```text
src/
├── assets/        # images/svgs imported by code
├── components/    # presentational + wiring components
│   └── ui/        # design-system primitives (Button, Card…)
├── context/       # AuthProvider, ThemeProvider (React Context)
├── hooks/         # reusable logic (see docs/HOOKS.md)
├── lib/           # third-party SDK clients + env access
│   ├── env.ts       # validated, typed import.meta.env
│   ├── supabase.ts  # typed Supabase client
│   ├── sentry.ts    # Sentry init
│   ├── imagekit.ts  # ImageKit URL builder
│   └── utils.ts     # cn() and small helpers
├── pages/         # route-level views
├── services/      # typed data access over Supabase
├── types/         # shared + generated DB types
├── App.tsx        # providers + router
├── main.tsx       # bootstrap: Sentry, SW registration, render
└── index.css      # Tailwind layers + base styles
```

**Dependency direction:** `pages → services → lib`. Components consume `hooks`
and `context`. Nothing in `lib` imports from `pages`/`components` (no cycles).

**RotaFlow services** (typed Supabase data access, all `org_id`-scoped):
`orgService`, `membershipService`, `staffService`, `locationService`,
`rotaService`, `shiftService`, `availabilityService`, `leaveService`,
`swapService`, `clockService`, `timesheetService`, `announcementService`,
`notificationService`, `reportService`, `syncQueue` (offline outbox). Contexts:
`AuthProvider`, `OrgProvider` (active tenant + role), `ThemeProvider`.

## 3. Rendering & routing

- Single-page app; routing via **React Router** (`createBrowserRouter`).
- Client-side navigation only. Deep links work because `.htaccess` rewrites any
  unknown path to `index.html`, and Workbox's `navigateFallback` does the same
  offline.
- `ProtectedRoute` gates authenticated views on Supabase session state.

### Information architecture / routes (RotaFlow)

Routes are organisation-scoped once a tenant is selected. `[Built]` = live
today; everything else is a real `Sidebar` nav item rendered disabled ("Soon")
rather than a route, so the IA is visible without shipping dead links.

```text
/                         [Built] marketing / redirect to app or login
/login                    [Built] auth (Supabase) — /signup is a toggle within it, not a separate route
/onboarding               [Built] create an organisation (no "join" flow yet — no invites table)
/app                      [Built] tenant shell (requires membership, redirects to /onboarding otherwise) — org switcher in header
  /app/dashboard          [Built, stub] profile/notifications only — not yet the full "today's shifts" spec
  /app/rota               [Built] rota builder (owner/manager) — drag-drop + click-to-assign grid, AI auto-fill, publish
  /app/staff              [Built] staff directory + profiles (read: any member; write: owner/manager)
  /app/locations          [Built] locations & departments (read/write: owner/manager — see SCHEMA.md RLS, not owner-only)
  /app/schedule           my rota (staff) — month/week/day + ICS subscribe
  /app/availability       my availability (staff) / team availability (manager)
  /app/leave              leave requests + approvals
  /app/swaps              shift swap requests + approvals
  /app/timesheets         clock events, hours, exports
  /app/announcements      communication centre
  /app/reports            hours/absence/overtime + payroll export (manager/owner)
  /app/settings           org settings, roles, subscription (owner)
/admin                    Super Admin console (is_platform_admin) — later phase
```

Role determines which nav items and routes render; the server enforces access via RLS.
Shift-type management has no dedicated route — it's a modal opened from the
rota builder's toolbar, since it's tightly coupled to rota-building.

## 4. State management

- **Server/auth state:** Supabase session lives in `AuthProvider` (Context).
  Data is fetched per-view through `services/*`; cache/retry handled by the SW
  and Supabase client. (Swap in TanStack Query later if you need richer caching.)
- **Tenant state:** an `OrgProvider` (Context) holds the active organisation + the
  caller's role/membership, resolved after auth. Every service call passes `org_id`;
  the org switcher (`switchOrg`, persisted to `localStorage`) updates this context.
  `usePermissions()` derives UI capability flags from the active role — cosmetic
  gating only, RLS is the real enforcement (see `docs/HOOKS.md` §6–7).
- **UI/theme state:** `ThemeProvider` (Context) — **light by default** (see
  `docs/DESIGN.md` §1; a deliberate brand choice, not `prefers-color-scheme`),
  with a user override persisted to `localStorage`.
- **Offline write queue:** clock-ins, leave requests and swap responses made offline are
  written to an IndexedDB outbox (`services/syncQueue`), replayed on reconnect via
  `useOnlineStatus`. Reads use the SW's `NetworkFirst` Supabase cache.
- **Local component state:** `useState`/`useReducer`. The rota builder's drag-drop
  working copy is local until published (no global store needed for V1).

## 5. PWA & offline strategy

- `vite-plugin-pwa` (Workbox, `generateSW`) precaches the hashed app shell
  (`js/css/html/icons/fonts`).
- **Navigation:** `navigateFallback: index.html` → the SPA boots offline and its
  own UI (e.g. `OfflineBanner`) communicates connectivity.
- **Runtime caching:**
  - ImageKit → `CacheFirst` (30-day, 200 entries).
  - Supabase REST → `NetworkFirst` (5s timeout, 5-min fallback).
  - Google Fonts → `StaleWhileRevalidate`.
- **Updates:** `registerType: 'prompt'` + `skipWaiting: false`. A new SW waits;
  the app shows a "Reload to update" prompt so users are never interrupted.
- `public/offline.html` ships as a last-resort static fallback.

## 6. Data flow example (publish a rota → notify staff)

```
RotaBuilderPage (manager, org-scoped)
  → rotaService.publish(orgId, rotaId)
    → supabase.from('shifts').update({ status:'assigned' })...   // RLS: has_org_role(org,['owner','manager'])
    → supabase.from('rotas').update({ status:'published', published_at })
  → on error: Sentry.captureException + toast; local draft preserved
  → useInngestDispatch().send('rota/published', { orgId, rotaId })
      → POST https://inn.gs/e/<VITE_INNGEST_EVENT_KEY>   // write-only event key
      → Inngest invokes a Supabase Edge Function which:
          • inserts notifications rows (channel: push/email)
          • sends Web Push (VAPID) + email via SMTP        // secrets stay server-side
          • (sms channel reserved — not delivered in V1)

Offline example (staff clock-in with no signal)
  → clockService.clockIn(orgId, staffProfileId, geo)
    → offline? enqueue to IndexedDB outbox (services/syncQueue)
    → online?  insert clock_events row directly
  → on reconnect (useOnlineStatus): outbox replays inserts, marks synced=true
```

## 7. Build & deploy pipeline

The server has **no Node/npm** — the build runs locally (or in CI) and only the static
artifacts are shipped. Full playbook + safety rules: **`docs/DEPLOYMENT.md`**.

1. `npm run build` → `tsc --noEmit` (gate) → Vite build → `dist/` (+ `sw.js`, manifest, source maps).
2. Deploy `dist/*` and root `.htaccess` into **this app's own docroot** (e.g.
   `~/<domain>/` or `public_html/<app>/`) via rsync-over-SSH, cPanel Git, or FTP.
   **Never** target a shared docroot, and dry-run any mirror-with-delete first.
3. Upload source maps to Sentry (but don't serve `*.map` publicly); exclude runtime/
   secret paths (`uploads/`, `.env`, `config.php`, backups) from any delete.

## 8. Security posture

- Only browser-safe keys ship: Supabase **anon** (RLS-guarded), ImageKit **public**,
  Inngest **write-only event** key.
- `service_role`, Inngest **signing** key, and DB credentials never touch the client.
- `.htaccess` adds HTTPS redirect + `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`.

## 9. AI rota assistant (OpenRouter)

A first slice of NL scheduling (PRD §5, pulled forward from V2): a manager describes
staffing needs in plain English and gets shift suggestions grounded in real data.

Surfaced as the rota builder's "Auto Fill" action (`AutoFillPanel`), not a
standalone page — it needs an open rota to apply into.

```
RotaBuilderPage → AutoFillPanel (owner/manager, org-scoped, current rota open)
  → aiRotaService.generateRotaSuggestions(orgId, prompt, periodStart, periodEnd)
    → supabase.functions.invoke('ai-rota-assistant', { body })
        // Authorization header = the calling user's JWT, forwarded automatically.
      → Edge Function `supabase/functions/ai-rota-assistant`:
          • creates its Supabase client with that JWT (anon key) — RLS scopes every
            query to the caller's org; no service-role key is used or needed
          • checks has_org_role(org, ['owner','manager']) — 403s otherwise
          • reads staff_profiles, shift_types, existing shifts, approved leave
            for the period
          • calls OpenRouter (POST /chat/completions, JSON mode) with that
            context + the manager's prompt; OPENROUTER_API_KEY is a Supabase
            project secret, never in the client bundle
          • validates every suggestion's staffProfileId/shiftTypeId against the
            org's real rows before returning (never trusts the model's ids)
  → nothing is written yet — suggestions preview as dashed chips on the live grid
  → manager clicks "Apply": shiftService.createShifts writes into the rota
    *already open in the builder* (via rotaService.getOrCreateDraftRota), not a
    disconnected new draft — RLS: has_org_role(org,['owner','manager']), same as
    any other rota-builder write
```

Model defaults to `openai/gpt-4o-mini`, overridable via the `OPENROUTER_MODEL`
project secret. Deploy/redeploy with the Supabase MCP `deploy_edge_function` tool
(or `supabase functions deploy ai-rota-assistant`); set the key with
`supabase secrets set OPENROUTER_API_KEY=...` or via the dashboard.
