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
and `context`. `lib` should import nothing from `pages`/`components`; six files
currently break that with type-only imports (`clockinDemo`, `swapRows`,
`workspaceTabs`, `settingsTabs`, `reportsDemo`) — tracked in `docs/SAAS.md`.

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
  /app/help               help & support; opens a support case
  /app/account            layout route + tab bar (every role)
    profile · preferences · security · accounts · sessions · tokens · activity
  /app/staff              → redirects to /app/team
  /app/integrations       → redirects to /app/settings/integrations

  /legal/privacy · /legal/terms · /legal/cookies · /legal/accessibility
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
  gating only, RLS is the real enforcement (see `docs/HOOKS.md` §6-7).
- **UI/theme state:** `ThemeProvider` (Context), **light by default** (see
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
  `0051` service-role exception, see `SCHEMA.md` §6) to suspend an org once
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
