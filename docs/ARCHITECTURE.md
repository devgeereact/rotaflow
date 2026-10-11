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
│  Supabase  │  │  ImageKit  │  │   Sentry   │  │      Stripe        │
│ Auth + DB  │  │  media CDN │  │ monitoring │  │ Checkout · Portal  │
│  + RLS     │  │ transforms │  │            │  │ signed webhook     │
└─────┬──────┘  └────────────┘  └────────────┘  └─────────┬──────────┘
      │                                                    │
      ▼                                                    ▼
 PostgreSQL  ·  Edge Functions                  A signature-verified
 (row-level security)  ·  pg_cron               Edge Function (NOT cPanel)
```

**Inngest is no longer in this picture.** It was the notification dispatch path
until `0087`: the browser posted an event, Inngest called an Edge Function, and
anything that failed after the write had already committed was simply lost. Every
notification is now enqueued by the database in the same transaction as the event
that owes it and drained by `pg_cron` (`0069`, `0083`, `0087`). Nothing of it is
left: the `inngest` Edge Function is gone from this repository **and** from the
project — the eight functions deployed on 2026-08-31 are `ai-rota-assistant`,
`send-notification`, `test-smtp`, `create-checkout-session`,
`create-portal-session`, `stripe-webhook`, `send-invite` and `calendar-feed` —
and the event key was removed from `.env`/`.env.example` the same day. This
paragraph said "still exists and is deployed" until it was read against the
project; a function list is one API call away and was worth not guessing at.
See `docs/SAAS.md` GAP-026.

The static bundle talks to each managed service directly over HTTPS. cPanel only
serves files. It never runs application logic.

## 2. Directory layout

```text
src/
├── assets/        # images/svgs imported by code — EMPTY today (`.gitkeep` only)
├── components/    # presentational + wiring components
│   └── ui/        # design-system primitives (Button, Card…)
├── context/       # AuthProvider, ThemeProvider (React Context)
├── hooks/         # reusable logic (see docs/ARCHITECTURE.md#hook-contracts)
├── lib/           # third-party SDK clients + env access
│   ├── env.ts       # validated, typed import.meta.env
│   ├── supabase.ts  # typed Supabase client
│   ├── sentry.ts    # Sentry init
│   └── utils.ts     # cn() and small helpers
├── pages/         # route-level views
├── services/      # typed data access over Supabase
├── types/         # shared + generated DB types
├── App.tsx        # providers + router
├── main.tsx       # bootstrap: Sentry, SW registration, render
└── index.css      # Tailwind layers + base styles
```

**Dependency direction:** `pages → services → lib`. Components consume `hooks`
and `context`. `lib` should import nothing from `pages`/`components`. Four files
currently break that with type-only imports — `clockinDemo`, `reportsDemo`,
`settingsTabs`, `swapRows` (a fifth, `workspaceTabs`, was deleted on 11 October 2026) — a convention that is not lint-enforced and not tracked in the register:

```bash
grep -ln "from '@/pages\|from '@/components" src/lib/*.ts
```

**RotaFlow services** (typed Supabase data access, all `org_id`-scoped):
`orgService`, `staffService`, `locationService`, `rotaService`, `shiftService`,
`availabilityService`, `leaveService`, `swapService`, `clockService`,
`timesheetService`, `announcementService`, `notificationService`,
`reportsService`, `orgLifecycleService`, `syncQueue` (offline outbox).
Membership access lives in `orgService` and `platformUserService`; there is no
`membershipService`, and the reports service is `reportsService.ts`, not
`reportService.ts`. Contexts:
`AuthProvider`, `OrgProvider` (active tenant + role), `ThemeProvider`.

## 3. Rendering & routing

- Single-page app; routing via **React Router** (`createBrowserRouter`).
- Client-side navigation only. Deep links work because `.htaccess` rewrites any
  unknown path to `index.html`, and Workbox's `navigateFallback` does the same
  offline.
- `ProtectedRoute` gates authenticated views on Supabase session state.

### Information architecture / routes (RotaFlow)

Routes are organisation-scoped once a tenant is selected. Everything below is
**built and routed**. There are no disabled "Soon" nav items left.

`src/lib/navigationTargets.test.ts` parses this route table out of `App.tsx` and
asserts that every Settings tab, Profile tab, marketing nav link, footer link and
global-search entry resolves to a real `<Route>`. That test exists because the
Settings tab bar once shipped with fourteen routes, none of which had been added
to `App.tsx`; every one rendered the 404 page while all five gates stayed green.

```text
PUBLIC. Marketing
/                         landing: hero, product shot, benefits, sectors, stats, CTA
/features /solutions /pricing /resources /about /contact
                          copy lives in src/lib/marketing.ts (see its header for
                          the no-invented-traction rule)

PUBLIC. Auth
/login /signup /forgot-password /reset-password /splash
/invite/:token            public on purpose, an invitee has no account yet
/onboarding               create an organisation (auth required)

TENANT SHELL, /app (requires membership, else redirects to /onboarding)
  /app/dashboard          today's coverage, queues, activity
  /app/rota               rota builder. Drag-drop, AI auto-fill, publish   [manager]
  /app/schedule           published schedule. Day/week/month/agenda, an ICS
                          download and a subscription feed (calendar-feed, §10)
  /app/clock              GPS clock in/out with an offline queue
  /app/team               staff directory                                   [manager]
  /app/team/:staffId      staff profile                                     [manager]
  /app/locations          locations & departments                           [manager]
  /app/availability       my availability / team availability
  /app/leave              leave requests + approvals
  /app/swaps              shift swaps + approvals
  /app/open-shifts        uncovered shifts anybody can take
  /app/approvals          leave, swaps and overtime in one queue           [manager]
  /app/timesheets         hours from clock events, approvals, payroll export
  /app/announcements      communication centre
  /app/notifications      inbox (reached via the bell, not the sidebar)
  /app/reports            coverage/hours/absence/overtime + CSV             [manager]
  /app/settings           layout route + tab bar                            [manager]
    organisation · permissions · roles · policies
    notifications · integrations · billing · audit
  /app/overtime           overtime requests + approvals
  /app/help               help & support; opens a support case, reads its thread
                          and replies into it
  /app/account            layout route + tab bar (every role)
    profile · preferences · security · accounts · sessions · tokens · activity
  /app/staff              → redirects to /app/team
  /app/integrations       → redirects to /app/settings/integrations

  /legal/privacy · /legal/terms · /legal/cookies · /legal/accessibility
  /legal/trust            sub-processors, AI notice, security disclosure
  /auth/callback          OAuth return
  /admin/*                platform console, 19 screens (RequirePlatformAdmin)
                          `is_platform_admin()` requires an aal2 session when
                          `platform_settings.require_mfa` is on (0102)
  *-preview               ~30 DEV-only design-loop routes, dropped from the build
```

**A `[manager]` route is also reachable by a delegate.** Since `0106`,
`has_org_role` returns true for somebody holding live cover — which means a
temporary deputy sees the managerial routes without anybody editing their
membership, and stops seeing them when the cover expires. Nothing in this
table changes; the predicate underneath it does.

`[manager]` = gated by `RequireRole` on the `<Route>`, rendering
`PermissionDenied` (area, role held, role required, way back) rather than
silently redirecting. **This is presentation only. RLS is the real boundary**,
and it holds whether or not the gate renders. The gate exists so an honest wrong
turn produces an explanation instead of a screen of controls that fail silently.

Role determines which nav items and routes render; the server enforces access via
RLS. Shift-type management has no dedicated route. It is a modal opened from the
rota builder's toolbar, since it is tightly coupled to rota-building.

### App shell

| Piece                     | Module                                    | Note                                                                                                                                                                           |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidebar                   | `layout/Sidebar`                          | Role-resolved items; collapse persisted in `localStorage`, read during initial `useState` so the page does not jump on load                                                    |
| Org identity + switcher   | `layout/SidebarOrgSwitcher`               | Always shows the org name; interactive only with >1 membership                                                                                                                 |
| Profile / help / collapse | `layout/SidebarFooter`                    |                                                                                                                                                                                |
| Global search             | `layout/GlobalSearch`, `lib/globalSearch` | `⌘K`. Searches **screens and actions, not records**, a per-keystroke `ilike` fan-out across a dozen tables is a query storm at real tenant size. Role-filtered before matching |
| Mobile tab bar            | `layout/MobileTabBar`                     | Home · Schedule · Clock in · Leave · More; `More` opens the sidebar drawer, whose open state is owned by `AppShell` so both controls share it                                  |

## 4. State management

- **Server/auth state:** Supabase session lives in `AuthProvider` (Context).
  Data is fetched per-view through `services/*`; cache/retry handled by the SW
  and Supabase client. (Swap in TanStack Query later if you need richer caching.)
- **Tenant state:** an `OrgProvider` (Context) holds the active organisation + the
  caller's role/membership, resolved after auth. Every service call passes `org_id`;
  the org switcher (`switchOrg`, persisted to `localStorage`) updates this context.
  `usePermissions()` derives UI capability flags from the active role. Cosmetic
  gating only, RLS is the real enforcement (see `docs/ARCHITECTURE.md#hook-contracts` §6-7).
- **UI/theme state:** `ThemeProvider` (Context), **light by default** (see
  `docs/DESIGN-SYSTEM.md` §1; a deliberate brand choice, not `prefers-color-scheme`),
  with a user override persisted to `localStorage`.
- **Offline write queue:** clock-ins, leave requests and swap _requests_ made offline are
  written to an IndexedDB outbox (`services/syncQueue`), replayed on reconnect via
  `useOnlineStatus`. Swap and leave _responses_ are review actions and are not queued —
  this line said "swap responses" until 4 September 2026, which no code supported.
  Reads use the SW's `NetworkFirst` Supabase cache, which is 50 entries for 5 minutes
  and guarantees nothing in particular; `docs/ARCHITECTURE.md#offline-and-pwa` classifies every feature.
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
  - Self-hosted webfonts (`/fonts/`) → `CacheFirst`, excluded from the precache. They were Google Fonts on `StaleWhileRevalidate` until 2026-09-03; see `public/fonts/README.md`.
- **Updates:** `registerType: 'prompt'` + `skipWaiting: false`. A new SW waits;
  the app shows a "Reload to update" prompt so users are never interrupted.
- `public/offline.html` is precached but **never served**. It is in `includeAssets`
  It was removed 5 September 2026 — it had been precached but was never served,
  since `navigateFallback` is `index.html` and no route or handler referenced it.
  Precaching an unreachable page meant every visitor downloaded a page no route served.

## 6. Data flow example (publish a rota → notify staff)

```
RotaBuilderPage (manager, org-scoped)
  → rotaService.publishRota(rotaId)
    → supabase.rpc('publish_rota', { p_rota_id })                // SECURITY DEFINER, owner/manager only
        • archives the rota this one supersedes, then publishes, in one transaction
        • a raw PATCH of rotas.status is REFUSED by rotas_guard_status_change (0061)
        • a raw write to a published rota's shifts is REFUSED by shifts_guard_immutable_rota
        • enqueue_rota_published_notification writes the notification into
          notification_outbox IN THE SAME TRANSACTION (0069), so a closed tab
          cannot lose it — GAP-026. For an amendment it writes ONE ROW PER
          AFFECTED PERSON, listing what changed for them (0083), rather than
          paging the whole roster.
  → on error: Sentry.captureException + toast; local draft preserved

dispatch_notification_outbox(), on a pg_cron schedule (0069)
  → posts each pending row to the send-notification Edge Function, which:
      • reads the org's notification matrix and each recipient's own
        switch, and drops anyone who has opted out           // BUG-048
      • inserts notifications rows (unless the org has muted in-app)
      • sends Web Push (VAPID) + email via SMTP        // secrets stay server-side
      • the push is displayed by public/push-sw.js, imported into the
        generated service worker via workbox.importScripts   // BUG-050
      • (sms channel reserved, not delivered in V1)

Offline example (staff clock-in with no signal)
  → clockService.clockIn(orgId, staffProfileId, geo)
    → offline? enqueue to IndexedDB outbox (services/syncQueue)
    → online?  insert clock_events row directly
  → on reconnect (useOnlineStatus): outbox replays inserts, marks synced=true
```

## 7. Build & deploy pipeline

The server has **no Node/npm**. The build runs locally (or in CI) and only the static
artifacts are shipped. Full playbook + safety rules: **`docs/DEPLOYMENT.md`**.

1. `npm run build` → `tsc --noEmit` (gate) → Vite build → `dist/` (+ `sw.js`, manifest, source maps).
2. Deploy `dist/*` and root `.htaccess` into **this app's own docroot** (e.g.
   `~/<domain>/` or `public_html/<app>/`) via rsync-over-SSH, cPanel Git, or FTP.
   **Never** target a shared docroot, and dry-run any mirror-with-delete first.
3. Upload source maps to Sentry (but don't serve `*.map` publicly); exclude runtime/
   secret paths (`uploads/`, `.env`, `config.php`, backups) from any delete.

## 8. Security posture

- Only browser-safe keys ship: Supabase **anon** (RLS-guarded) and ImageKit
  **public**. The Inngest write-only event key shipped alongside them, unused,
  from `0087` until 2026-08-31, when it was deleted from `.env`. Deleting its
  last reader in code was not enough — Vite emits `import.meta.env` as a whole
  object, so every `VITE_*` variable is inlined whether anything reads it or
  not. **A key is out of the bundle when `grep` says so, not when the code that
  used it is gone.**
- `service_role`, Stripe's secret and webhook secrets, the VAPID private key, SMTP
  credentials, `OPENROUTER_API_KEY` and DB credentials never touch the client. They
  are Supabase Edge Function secrets, and the notification shared secret is not even
  that: it is generated inside Postgres and lives only in `vault` (`0091`).
- `.htaccess` adds HTTPS redirect + `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`.

## 9. Rota assistant

Surfaced as the rota builder's "AI assistant" action (`RotaAssistantPanel`), not a
standalone page. Three tabs, in the order a manager works:

| Tab           | What it does                                                  | Needs a network? |
| ------------- | ------------------------------------------------------------- | ---------------- |
| **Review**    | Every problem the visible rota is about to cause, worst first | No               |
| **Fill gaps** | Ranked cover for each open shift, with the reasoning shown    | No               |
| **Ask AI**    | Free-text drafting via OpenRouter                             | Yes              |

### 9a. The deterministic half, `src/lib/rotaInsights.ts`

Review and Fill gaps are **pure functions over rows the org already has**, so they
work offline, with no API key, and cannot invent a name or a date. They are the
assistant's judgement; the model is only ever allowed to phrase things.

`computeRotaInsights` flags: unfilled shifts (escalating inside a week), staff
rostered inside approved leave, staff rostered against declared unavailability,
overlapping shifts, rest gaps under the WTR's 11 hours, weeks scheduled over
contracted hours, and documents expiring while their holder is still on the rota.

`suggestCoverForShift` ranks who could work an open shift. Approved leave, an
overlapping shift and a declared unavailability are **hard blockers**. They remove
a candidate rather than costing points, because no amount of good fit makes it
legal to roster someone who is on holiday. Contract overrun and a tight rest gap
stay visible instead, so a manager can take the decision knowingly.

There is no required-skills column on `shifts`, so "right skills" means overlapping
with the people who already work that pattern at that site, an observation, not an
invented rule. Both functions take `now` as a parameter so every rule agrees on one
instant and the tests can pin it (`src/lib/rotaInsights.test.ts`).

### 9b. The language-model half (OpenRouter)

A first slice of NL scheduling (PRD §5, pulled forward from V2). One Edge Function
serves two tasks, because both need the same grounding query and the same
RLS-scoped client: `task: 'rota'` returns shift suggestions, `task: 'announcement'`
returns a draft announcement for the composer. Without `OPENROUTER_API_KEY` set as
a project secret it returns a 503 naming the missing secret, and the two
deterministic tabs carry on working.

```
RotaBuilderPage → RotaAssistantPanel (owner/manager, org-scoped)
  → aiRotaService.generateRotaSuggestions(orgId, prompt, periodStart, periodEnd)
    → supabase.functions.invoke('ai-rota-assistant', { body })
        // Authorization header = the calling user's JWT, forwarded automatically.
      → Edge Function `supabase/functions/ai-rota-assistant`:
          • creates its Supabase client with that JWT (anon key). RLS scopes every
            query to the caller's org; no service-role key is used or needed
          • checks has_org_role(org, ['owner','manager'])-403s otherwise
          • reads staff_profiles, shift_types, locations, existing and open
            shifts, approved leave and declared unavailability for the period,
            plus hours already scheduled per person
          • calls OpenRouter (POST /chat/completions, JSON mode) with that
            context + the manager's prompt; OPENROUTER_API_KEY is a Supabase
            project secret, never in the client bundle
          • validates every suggestion's staffProfileId/shiftTypeId against the
            org's real rows before returning (never trusts the model's ids)
  → nothing is written yet. Suggestions preview as dashed chips on the live grid
  → manager clicks "Apply": shiftService.createShifts writes into the rota
    *already open in the builder* (via rotaService.getOrCreateDraftRota), not a
    disconnected new draft. RLS: has_org_role(org,['owner','manager']), same as
    any other rota-builder write
```

Model defaults to `openai/gpt-4o-mini`, overridable via the `OPENROUTER_MODEL`
project secret. Deploy/redeploy with the Supabase MCP `deploy_edge_function` tool
(or `supabase functions deploy ai-rota-assistant`); set the key with
`supabase secrets set OPENROUTER_API_KEY=...` or via the dashboard.

### 9c. Billing (Stripe)

Three Edge Functions, added with migration `0050`, share `supabase/functions/_shared/stripe.ts`:

- **`create-checkout-session`** — org owner picks a plan on Settings > Billing;
  runs as the calling user (JWT forwarded, RLS-scoped, owner-role checked
  against `memberships` directly) and returns a hosted Stripe Checkout URL for
  a full-page redirect. No Stripe.js on the client.
- **`create-portal-session`** — same auth pattern, returns a Stripe Billing
  Portal URL so an owner can manage payment methods / cancel without a
  custom UI.
- **`stripe-webhook`** — the one function in this feature that runs as
  `service_role` (deployed `--no-verify-jwt`), since Stripe calls it directly
  with no end-user session; authenticated instead by Stripe's own request
  signature (`STRIPE_WEBHOOK_SECRET`). Handles
  `checkout.session.completed`, `customer.subscription.updated/deleted`,
  `invoice.paid`, `invoice.payment_failed` — upserts `subscriptions`
  (keyed on `org_id`/`(org_id, provider_ref)` since Stripe delivery is
  at-least-once), writes `invoices` as a second, automated writer alongside
  the manual platform-finance path, and calls `set_org_status()` (via its
  `0051` service-role exception, see `DATA-MODEL.md` §6) to suspend an org once
  Stripe's dunning is exhausted.

Deploy: `supabase functions deploy <name>` (webhook needs `--no-verify-jwt`).
Secrets: `STRIPE_SECRET_KEY` (shared by all three), `STRIPE_WEBHOOK_SECRET`
(webhook only, from the Stripe dashboard's endpoint config). After deploying
the webhook, register its URL in the Stripe dashboard against the five events
above.

---

## 10. Edge Functions — the whole list

Sections 6 and 9 each describe one of these in the context of the feature it
serves. This is the inventory, because the set has grown to eight and nothing
else in the repository lists them in one place.

**`supabase/functions/**` is the only server compute in the product, is Deno,
and is excluded from `npm run typecheck` and `npm run lint`** (`eslint.config.js`).
No automated check stands in for reading these by hand.

**They do not deploy on merge.** Migrations do — the Supabase GitHub integration
applies them, with a lag. Functions are a separate manual
`supabase functions deploy <name>`. A merged function that nobody deployed is
the most common way this repository's documentation goes stale, so the deployed
version of each is recorded in `docs/SAAS.md` §2 with the date it was read.

| Function                  | JWT verified | What it is                                                                                                                                        |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-rota-assistant`       | yes          | OpenRouter, called with the caller's forwarded JWT so RLS scopes it (§9)                                                                          |
| `send-notification`       | yes          | Drains `notification_outbox`; email via SMTP, web push via VAPID (§6)                                                                             |
| `send-invite`             | yes          | The invitation email. Separate from the outbox: an invitee has no account                                                                         |
| `create-checkout-session` | yes          | Stripe Checkout (§9c)                                                                                                                             |
| `create-portal-session`   | yes          | Stripe Billing Portal (§9c)                                                                                                                       |
| `stripe-webhook`          | **no**       | Verifies a Stripe signature instead — a webhook carries no JWT (§9c)                                                                              |
| `calendar-feed`           | **no**       | A calendar client cannot present a header; the token in the URL is checked by `calendar_feed_shifts`, granted to `service_role` alone             |
| `test-smtp`               | yes          | Sends one message through an organisation's own SMTP settings, so a wrong password fails on the settings screen rather than silently at send time |

The two with `verify_jwt: false` are deliberate and each has its own boundary
above. Neither is a gap: Supabase's gateway check would reject the only callers
those two have.

### The rule about which key they use

A function acting on a user's behalf builds its Supabase client with the
**caller's forwarded JWT**, so RLS scopes every query for free. `service_role`
is for genuinely cross-tenant work — a billing webhook, a scheduled drain, a
feed with no session — and is the exception.

`ai-rota-assistant` is the worked example: the JWT for everything, and
`service_role` for the single `audit_write` call that `authenticated` is
deliberately not allowed to make.

## Offline and PWA

What RotaFlow actually does without a network, feature by feature. §5 above is the strategy; this section is the per-feature truth, and it is narrower than "offline-first" implies. Merged from `docs/OFFLINE-SPEC.md` on 11 October 2026; written 4 September 2026 by reading the code, and line numbers it cites are from that date.

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

### The honest one-paragraph version

The **app shell** is genuinely offline: 166 precached entries, every lazy route
chunk included, so the application loads and navigates with no network. **Three
writes** are genuinely offline: clocking in or out, requesting leave, and
offering a swap, all queued in IndexedDB with idempotency keys and replayed on
reconnect. **Everything else needs the network.** There is no durable offline
copy of any domain data. What looks like offline reading is a five-minute,
fifty-entry service-worker cache that nothing guarantees will hold the thing you
are looking at.

### Classification

GEE OS classes are `offline read`, `offline write`, `offline queue`,
`offline processing`, `network required` and `never cache`.

| Feature area                              | Class             | Evidence                                                                               |
| ----------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| App shell, boot, install, update prompt   | offline read      | 166 precache entries, `vite.config.ts:111`; `src/App.tsx:84`                           |
| Marketing pages, legal pages              | offline read      | static React, precached chunks, `navigateFallback: index.html` `vite.config.ts:113`    |
| Clock in / clock out, including GPS       | **offline queue** | `src/pages/app/ClockInPage.tsx:339-368`, replay `src/services/syncQueue.ts:38`         |
| Leave request (staff submitting)          | **offline queue** | `src/pages/app/LeavePage.tsx:339-344`                                                  |
| Shift swap request or offer (staff)       | **offline queue** | `src/pages/app/SwapsPage.tsx:217-221`                                                  |
| Rota view, my shifts, clock history       | network required  | no application cache; only the shared 5 minute SW cache, `vite.config.ts:128-138`      |
| Rota builder and publish                  | network required  | `publish_rota` is an RPC and is not queued, `src/components/FailedWritesNotice.tsx:16` |
| Leave, swap and overtime approvals        | network required  | no `enqueue` on any review path, `src/pages/app/LeavePage.tsx:379,408`                 |
| Announcements                             | network required  | direct service reads, nothing cached or queued                                         |
| Notifications list, web push subscription | network required  | `src/hooks/useWebPush.ts:76,108`                                                       |
| Reports, timesheets, CSV export           | network required  | generated from live reads                                                              |
| Admin and platform console                | network required  | every `platform*Service` read                                                          |
| Sign in, magic link, password reset       | network required  | `/auth/v1/` matches no runtime cache rule, `vite.config.ts:130`                        |
| An existing session                       | offline read      | supabase-js persists it in `localStorage`, so a signed-in user boots offline           |
| Conflict resolution while offline         | **none**          | server-side rejection only, see below                                                  |

### The write queue, which is the strong part

`src/lib/offlineOutbox.ts` is raw IndexedDB, database `rotaflow-outbox` at
version 2, with `queued_writes` and `dead_letters` stores and a v1 to v2
migration. `src/services/syncQueue.ts` replays it.

- **Idempotency is real.** Every queued write carries a `client_event_id`
  minted before the first online attempt, and a same-key `23505` on replay is
  treated as success rather than a duplicate insert
  (`src/services/syncQueue.ts:143-160`). The database side is
  `supabase/migrations/0081_outbox_idempotency.sql`, which adds the column and a
  partial unique index per table. This is the design the PWA engine asks for.
- **Failure is classified, not retried blindly.** Permanent failures dead-letter
  and let the queue continue; transient ones stop the flush and wait for the next
  reconnect; five attempts exhausts a write. SQLSTATE classes `08/40/53/57/58`,
  HTTP 408/425/429 and 5xx are transient.
  Since `0152` a leave request booked offline over days the person already has
  off comes back as `23P01`, which is class `23` and therefore permanent — so it
  dead-letters into the notice below with the sentence
  `src/services/leaveService.ts` gives it, rather than being replayed forever or
  landing as a second booking. That is the one conflict this queue can now
  detect: the write is refused by a constraint, not merged.
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

### What the reading story really is

There is one runtime cache for domain data:

```text
https://*.supabase.co/rest/v1/*   NetworkFirst
  networkTimeoutSeconds: 5
  maxEntries: 50
  maxAgeSeconds: 300
```

That is opportunistic, shared across every screen, and evicted by an LRU. Whether
a given rota is readable offline is genuinely **unknown** without measuring it on
a real device, and nothing measures it. Note what the pattern does not cover:
`/auth/v1/`, `/functions/v1/`, `/storage/v1/` and Realtime WebSockets are all
uncached, which is correct for authentication and edge functions but is an
exclusion by omission rather than by decision.

There is no react-query, SWR or TanStack cache; data loading is `useEffect` plus
a service call. IndexedDB is write-only. `localStorage` holds preferences
(active org, theme, sidebar, report options) and the Supabase session, and that
list is audited by `src/lib/legalFacts.ts`.

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
   drains, it arrives as an ordinary insert; Realtime wakes the board and the
   whole window is re-derived from `clock_events`. A late-arriving clock-in
   for a shift already marked `not_recorded` therefore corrects itself, and a
   correction that lands inside an approved period flags that timesheet
   (`0128`) rather than moving a signed total.

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

Generated by `vite-plugin-pwa` in `generateSW` mode (`vite.config.ts:135-267`).
Registered from `src/components/UpdatePrompt.tsx:49`, not from `main.tsx`, with
`injectRegister: null` so there is exactly one registration site. Updates use
`registerType: 'prompt'` with `skipWaiting: false`, so a user is never thrown off
a page mid-task; `cleanupOutdatedCaches` removes old caches. Push handlers are
added through `workbox.importScripts: ['/push-sw.js']`, which is the documented
way to get custom code into a `generateSW` worker.

The manifest is inline in `vite.config.ts:151-170`: `standalone`, portrait,
scope and start URL `/`, three icons (192, 512, and a 512 maskable), and `id: '/'`
(added so browser identity is independent of start URL). It has no `screenshots`
and no `shortcuts`, neither of which are required for installation.

`.htaccess:78-80` serves `sw.js`, `workbox-*.js`, `manifest.webmanifest` and
`index.html` with `no-cache, no-store, must-revalidate`, while hashed assets are
immutable for a year. That is the correct pairing and worth not breaking.

## Hook contracts

Contracts for every reusable hook in `src/hooks`. Merged from `docs/HOOKS.md` on 11 October 2026. Section numbers below (§1 to §18) are the hook numbers other files cite, as in "Hook contracts §8".

Contracts for every reusable hook in `src/hooks`. Signatures here are the source
of truth. Implementations must match.

**Two sections describe hooks that no longer exist**, marked `— REMOVED` with the
date and the reason: `useInngestDispatch` (§5, deleted by `0087`) and
`useOptimizedImage` (§4, deleted 2026-08-31 because nothing imported it). They are
kept deliberately. A hook that was documented as an approved contract and then
vanished invites someone to reintroduce it, and the useful thing to record is not
its signature but why it went. Do not read them as stale entries, and do not
delete them to make this file line up with a directory listing — the check that
matters is that every file in `src/hooks` has a section, which it does.

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

### 3. `useSupabaseAuth`

`src/hooks/useSupabaseAuth.ts`
Thin consumer of `AuthContext`. The single source of session truth. The provider
(`src/context/AuthContext.tsx`) owns the listener; this hook exposes it.

```ts
interface UseSupabaseAuth {
  user: User | null;
  session: Session | null;
  loading: boolean; // initial session resolve in flight
  signOut: () => Promise<void>;
}
export function useSupabaseAuth(): UseSupabaseAuth;
```

### 4. `useOptimizedImage` — REMOVED (2026-08-31)

Deleted. It memoised `buildImageKitUrl` and **nothing ever called it**. The
builder it wrapped, `src/lib/imagekit.ts`, turned out to have no caller either and
was deleted on 11 October 2026 (`b123d1d`).
A documented "approved hook contract" that no component consumes reads as a
rule about how images must be loaded, when it was only an unused wrapper.

Nothing in `src/` builds a transformed ImageKit URL today. `env.imagekitUrlEndpoint`
stays, because the platform health check reads it.

### 5. `useInngestDispatch` — REMOVED (0087)

Deleted. Every notification the product owes is now enqueued by the database
in the same transaction as the event that owes it — rota publication (0069),
leave and swap decisions and announcements (0087) — and drained by pg_cron.

Nothing in the app dispatches a notification any more, so there is no hook to
call, and there is no longer a service behind it either:
`src/services/notificationDispatchService.ts` is deleted. This section said it
survived to carry `postInngestEvent` for old queued items; the replay path it
described lives in `src/services/syncQueue.ts` instead, where the `notify`
handler resolves without sending. An item queued by an older install therefore
**drains away** on the next reconnect rather than retrying against a host that
is gone and then sitting in the dead-letter list — the work is not lost, it is
no longer owed, because whatever owed it now enqueues its own row.

See `docs/SAAS.md` GAP-026 for why browser-initiated dispatch was lossy.

### RotaFlow-specific hooks

#### 6. `useOrg`

`src/hooks/useOrg.ts`
Consumer of `OrgContext`. The active tenant and the caller's role within it.

```ts
type OrgRole = 'owner' | 'manager' | 'staff';
interface UseOrg {
  orgId: string | null;
  orgName: string | null;
  role: OrgRole | null;
  memberships: { orgId: string; orgName: string; role: OrgRole }[];
  isPlatformAdmin: boolean;
  switchOrg: (orgId: string) => void;
  loading: boolean;
  // Whether the memberships query failed. See the rule below.
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
> whenever the app was offline past the 5-minute API cache window, where they
> could create a duplicate organisation. `AppShell` and `OnboardingPage` both
> check `loadFailed && memberships.length === 0` and offer a retry instead.

#### 7. `usePermissions`

`src/hooks/usePermissions.ts`
Derives UI capabilities from the active role (client-side gating only; RLS is the
real enforcement).

```ts
interface Permissions {
  canBuildRota: boolean; // owner | manager
  canApprove: boolean; // leave/overtime/swaps
  canManageStaff: boolean; // owner | manager
  canManageOrg: boolean; // owner
  canManagePlatform: boolean; // super admin
}
export function usePermissions(): Permissions;
```

#### 8. `useSyncQueue`

`src/hooks/useSyncQueue.ts`
Manages the IndexedDB offline outbox; replays queued writes when back online.

```ts
interface QueuedItem {
  id: string;
  kind: 'clock' | 'leave' | 'swap';
  payload: unknown;
  queuedAt: string;
}
interface UseSyncQueue {
  pending: QueuedItem[];
  /** Writes that will never send themselves. These need a human. */
  deadLettered: DeadLetterRecord[];
  enqueue: (kind: QueuedItem['kind'], payload: unknown) => Promise<void>;
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
Subscribes to Supabase Realtime `postgres_changes` and calls back (debounced)
when data behind the current screen changes, so a published rota or an approved
request appears without a manual reload.

```ts
type RealtimeTable =
  | 'shifts'
  | 'rotas'
  | 'leave_requests'
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
  value: string | null; // null disables the subscription
}
interface UseRealtimeRefreshOptions {
  tables: RealtimeTable[];
  scope: RealtimeScope;
  onChange: () => void;
  enabled?: boolean;
}
interface UseRealtimeRefresh {
  connected: boolean;
}
export function useRealtimeRefresh(o: UseRealtimeRefreshOptions): UseRealtimeRefresh;
```

> **Rule: treat an event as a signal, never as data.** The payload is
> deliberately ignored; `onChange` re-queries through the screen's normal
> RLS-protected path. Realtime does apply RLS to `postgres_changes`, but DELETE
> payloads carry only the primary key and cannot be filtered the way
> INSERT/UPDATE are, so rendering a payload is the one way a row the viewer
> could not otherwise read could reach the screen. Re-querying means the data
> always arrives through a query the database has already authorised.

> **Rule: live updates are an enhancement, never a dependency.** If the socket
> never connects, every screen still loads and refetches exactly as before.
> `connected` is exposed for diagnostics; no screen gates its rendering on it.

Tables must also be in the `supabase_realtime` publication, `0012_realtime.sql`. Adding a table to `RealtimeTable` without adding it there
silently produces a subscription that never fires.

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

Both counts come back pre-scoped by RLS: a manager gets the org's pending
queue, a staff member gets only their own still-pending requests. No role
branching in the hook. Polls every 60s rather than subscribing to Realtime —
this mounts on every `/app/*` page via `Sidebar`, and a live channel per tab
for two numbers is more infrastructure than the badge is worth. It would also
collide with `useRealtimeRefresh` channels already open on `LeavePage`/
`SwapsPage` for the same tables.

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
`my_feature_access` per org load rather than a round trip per gate.

```ts
interface FeatureAccess {
  loading: boolean; // gates read false while true
  has: (feature: string) => boolean;
  sourceOf: (feature: string) => 'plan' | 'flag' | null;
  refresh: () => void;
}
export function useFeatureAccess(): FeatureAccess;
```

> **Rule: fails closed.** If the RPC errors, the granted set is empty and
> every gate reads false — deliberately silent, not reported to Sentry (would
> bury real errors on every page load). A gate that renders on a failed check
> is worse than one that stays hidden.

#### 16. `useWebPush`

`src/hooks/useWebPush.ts`
Subscribes this device to Web Push, storing the subscription in
`push_subscriptions` for the `send-notification` Edge Function to read.
Requires `VITE_VAPID_PUBLIC_KEY`. The receiving side is `public/push-sw.js`,
imported into the generated service worker (`workbox.importScripts`) — before
2026-08-29 no handler existed and every push the sender signed was silently
discarded by the browser. Delivery has still never been observed on a real
device; see `docs/SAAS.md` ❓-007.

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
  noindex?: boolean; // the 404 only — the SPA fallback answers it 200
}
export function usePageMetadata(overrides?: PageMetadata): void;
```

Callers: `MarketingLayout`, `AuthSplitLayout`, `ForgotPasswordPage`,
`ResetPasswordPage`. Only the title is restored on unmount; the tags are
overwritten by whichever route mounts next.

### Conventions

- Every hook is fully typed with an explicit return interface.
- Hooks never read `import.meta.env` directly. They import from `@/lib/env`.
- Side-effectful hooks clean up their listeners in the `useEffect` return.
