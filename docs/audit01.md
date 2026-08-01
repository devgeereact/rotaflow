# RotaFlow — Audit 01

**Date:** 2026-07-31 · **Audited:** `main` @ `d3173cf` · **Shipped as:** `#52` (`314cd13`)
**Live:** https://rota.gakinz.com — rebuilt and redeployed from merged `main` at the end
of this session; `/`, `/login`, `/app/dashboard`, `/sw.js`, `/manifest.webmanifest` all 200.
**Scope:** whole repository — 198 TS/TSX files, 28,241 LOC, 26 tables, 12 migrations,
4 Edge Functions, 40 design references, 52 PRs of history.

> One finding in this report was **wrong and is corrected in place** — the source-map
> leak (§2). It is left visible rather than deleted, because the reason it was wrong
> turned out to matter more than the finding: see **P1-7**.

---

## 1. Verdict

**The product is further along than the process around it.**

The core scheduling loop — build a rota, publish it, staff see it, clock in, swap,
request leave, produce a timesheet — is built, wired to real data, RLS-isolated per
tenant, and live. 24 of 35 design mockups are built and 13 screens have had a
pixel-match pass. Typecheck, lint, format and build are all green with zero warnings
and zero suppressions beyond five justified one-liners. The code is unusually
well-commented: nearly every non-obvious decision carries a comment saying _why_,
including several that honestly document their own limitations. That is rare and it
is worth protecting.

What is missing is not features. It is **evidence**.

There is no automated test of any kind — 28,241 lines, zero test files, no runner in
`package.json`. Every CI gate is a _shape_ gate: they prove the code compiles, is
formatted, and produces a service worker. Not one of them would notice if publishing
a rota silently wrote to the wrong organisation. Two of the four Edge Functions
carry a `NOT VERIFIED END TO END` header written by their own author. The offline
outbox — the feature the product is sold on — has a failure mode that permanently
and silently stops a user's clock-ins from ever syncing.

So: **do not build the remaining 11 screens next.** Two of the three P0s below are
cheap. Clear them, then build, and the next 11 screens land on a floor that can
catch a regression instead of on four gates that only prove the code is well-typed.

**Critical path to launch:** P0-1 (outbox) → P0-2 (test floor) → tab-bar + nav
restructure → Settings and Profile screens → P0-3 (verify the server side) →
billing.

---

## 2. What shipped in this session

### Merged, closed, deployed

| #   | Title                                                    | Action                         |
| --- | -------------------------------------------------------- | ------------------------------ |
| 44  | design: match Timesheets to `Timesheets-Dashboard.png`   | merged (by a parallel session) |
| 12  | CI: stop Dependabot proposing toolchain major migrations | **merged**                     |
| 8   | bump `@supabase/supabase-js` 2.110.9 → 2.111.0           | **merged**                     |
| 5   | bump dev-dependencies group (2 updates)                  | **merged**                     |
| 4   | bump `github/codeql-action` 3 → 4                        | **merged**                     |
| 3   | bump `actions/checkout` 4 → 7                            | **merged**                     |
| 2   | bump `actions/setup-node` 4 → 7                          | **merged**                     |
| 13  | feat(homepage): public demo CTA for rota.gakinz.com      | **closed**                     |
| 45  | bump `tailwind-merge` 2.6.1 → 3.6.0                      | **closed**                     |

**Why #13 was closed, not merged.** It patched HomePage's pwa-forge scaffold copy
("A production-ready starter with auth, offline caching…") — text that no longer
exists, since `/` was rebuilt as a real marketing page in the interim. And its
payload was a prominent "Open rota.gakinz.com" button _on the page served at
rota.gakinz.com_. Everyone who could see it was already there.

**Why #45 was closed, not merged — the most instructive item here.**
`tailwind-merge` majors are coupled to Tailwind's: v2 = Tailwind 3, v3 = Tailwind
4.0–4.3, stated in its own README. RotaFlow is on Tailwind 3.4.19. Merging it would
have passed **typecheck, lint, format check, build and the service-worker
assertion** — v3 exports the same `twMerge` with the same signature. It would simply
resolve conflicting utility classes against a v4 class table, so `cn()` starts
picking the wrong winner in arbitrary places, with no error anywhere. `dependabot.yml`
now ignores its majors with that reasoning inline.

That near-miss is the whole argument of §3 in miniature: **four green gates and a
reviewer are not the same thing as a test.**

### Fixed and deployed (commit `a075208`)

| Fix                           | Before                                          | After                                                                      |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Source maps on production     | not actually exposed — see the correction below | belt-and-braces anyway: not linked from the bundle, refused by `.htaccess` |
| `logo.png` in the precache    | 1024×1024, **1.2 MB**, rendered at 24–56 px     | 256×256, **29 KB**                                                         |
| Total precache                | 2682 KiB                                        | **1495 KiB (−44%)**                                                        |
| Design mockups tracked in git | 22 of 40                                        | **40 of 40**                                                               |
| `.claude/worktrees/`          | 84 MB untracked in the project root             | ignored                                                                    |
| Security headers              | 3                                               | 5 (+ HSTS, Permissions-Policy)                                             |
| `docs/LOOP.md`                | 14 screens, 6 rows factually wrong              | 35 screens, status per screen                                              |
| `docs/SCREENS.md` count       | 34 (violated its own invariant)                 | 35, corrected                                                              |
| Design-preview routes (P1-1)  | 7 answered 200 unauthenticated in production    | `import.meta.env.DEV`-gated and tree-shaken out                            |
| `main` was red (P0-4)         | `npm ci` failed with ERESOLVE                   | pinned; `main` green                                                       |

### Correction — the source-map finding was wrong

This audit originally reported that production was serving source maps, on the
evidence that `https://rota.gakinz.com/assets/index-*.js.map` returned **HTTP 200**.
That conclusion was wrong, and the commit message and PR description for `a075208`
repeat the error.

There are **zero `.map` files on the server** — confirmed by
`find ~/rota.gakinz.com -name "*.map" | wc -l` → `0`. The deploy tooling has always
excluded them. The 200 came from `.htaccess`'s SPA rewrite: any path that is not an
existing file is rewritten to `index.html`, so a request for a map that does not
exist returns `index.html` with a 200. Requesting
`/assets/definitely-not-a-real-file-xyz.js` returns exactly the same thing.

The change shipped in `a075208` is still worth having — `sourcemap: 'hidden'` plus an
`.htaccess` deny means a map can never leak even if the deploy exclusion is changed
or a file is copied up by hand — but it closed a **latent** hole, not an open one.

**And the reason the probe lied is a genuine finding in its own right — see P1-7.**

---

## 3. Findings

Severity is about **consequence**, not effort. P0 = can produce a wrong outcome for
a real person (wrong pay, wrong shift, exposed data) or blocks everything after it.

### P0-1 — The offline outbox deadlocks permanently and silently — **FIXED** (#56)

**`src/services/syncQueue.ts:68-89`, `src/lib/offlineOutbox.ts:16-21`**

`flushQueuedWrites()` replays queued writes oldest-first and **breaks out of the loop
on the first failure**, leaving the item in the outbox. The comment explains the
reasoning, and for a dropped connection it is correct: don't burn a failed attempt on
every item when the network just vanished again.

But it treats a **permanent rejection identically to a transient one**, and there is
no attempt counter, no dead-letter, no error classification, and no ceiling.
`OutboxRecord` is `{ id, kind, payload, queuedAt }` — nowhere to record that
something has failed 400 times.

**Failure scenario.** A carer clocks in offline. Their membership is revoked, or the
shift is deleted, or the payload trips a CHECK constraint. That item now fails with a
4xx on every reconnect, forever. It is never removed. Every clock-in, leave request
and swap they queue **behind** it is never sent either. The UI shows the writes as
accepted, because they were — into IndexedDB. Sentry receives a `syncQueue:flush`
event each time, but nothing surfaces to the user or the manager.

The person works a full week, their attendance never reaches the database, and the
timesheet that drives their pay is silently wrong. This is the worst-consequence bug
in the repository and it lives in the feature the product is sold on.

**Fix (own PR, needs a UX decision):**

1. `OutboxRecord` gains `attempts: number` and `lastError?: string`; bump `DB_VERSION`
   to 2 and default existing rows in `onupgradeneeded`.
2. Classify the failure. A `PostgrestError` with a 4xx / SQLSTATE is **permanent** —
   retrying it a thousand times cannot help. A `TypeError: Failed to fetch` is
   **transient**.
3. Permanent → move to a `dead_letter` store immediately and **continue the loop**.
   Transient → `break`, exactly as today.
4. Transient failures also get a ceiling (5 attempts) so a payload that is subtly
   malformed can't masquerade as a network problem forever.
5. **Surface it.** A dead-lettered clock-in is a payroll dispute, not a log line. The
   user needs a visible "3 entries couldn't be submitted — review" affordance, and a
   manager needs it too. `useSyncQueue` already exposes `failed`; it currently has no
   consumer that renders it.

Not implemented tonight deliberately: it needs a schema migration in IndexedDB and a
real UX decision about what a staff member sees when their clock-in is rejected. That
belongs in a reviewed PR, not an audit sweep.

### P0-2 — Zero automated tests — **FIXED** (#56)

No test files. No runner. No `npm test`. 28,241 lines.

CI runs typecheck → lint → format → build → "did a service worker appear". All are
shape checks. Every one passes on an app that computes overtime wrong, publishes a
rota to the wrong tenant, or double-counts a night shift crossing midnight.

The gap is sharpest exactly where the domain is hardest, and the repo _knows_ it —
`.github/workflows/ci.yml` pins `TZ: UTC` with this comment:

> the predecessor repo shipped a bug that was invisible on a UK machine and only
> appeared under UTC — it built the instant from a date STRING, which parses in the
> system zone.

That is a precise description of a bug class that a three-line unit test would catch
forever, and the mitigation shipped was… running the _build_ in UTC. The build cannot
detect it. Nothing in this repo can.

**Fix — resist the urge to chase coverage.** Add Vitest and write ~30 tests against
the four things that produce a wrong number for a real person:

| Target                                          | Why it's first                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Timesheet hours from clock events               | Drives pay. Night shifts crossing midnight, DST transitions, missing clock-out, double clock-in |
| Location-timezone → shift wall-time             | The documented historical bug class, still untested                                             |
| Leave entitlement / balance arithmetic          | Wrong here = wrongly refused or over-granted leave                                              |
| `syncQueue` replay ordering + P0-1's classifier | Untestable today; write these _with_ the P0-1 fix                                               |

Then one Playwright smoke path — sign in → publish a rota → staff sees the shift —
because it is the sentence the product is sold on, and nothing verifies it.

Wire `npm test` into `ci.yml` between lint and build.

### P0-3 — The server-side half has never been verified end to end — **PARTLY RESOLVED** (#56, #58)

Two Edge Functions carry a self-written disclaimer:

- `supabase/functions/send-notification/index.ts:29` — _"NOT VERIFIED END TO END…
  Confirm real push/email delivery manually after deploying."_
- `supabase/functions/inngest/index.ts:33` — _"NOT VERIFIED END TO END."_

The honesty is excellent; the state is not. The documented flow is
`client → useInngestDispatch → Inngest → send-notification → push/email`. Every hop
is written and typechecked. **No one has observed a notification arrive.** Web push
and SMTP both fail in ways that are invisible from the client: a wrong VAPID subject,
an unset `NOTIFICATION_FUNCTION_SECRET`, an Inngest function pointed at the wrong URL.
All produce exactly the symptom you'd get from a system nobody is using yet.

Note `supabase/functions/**` is excluded from `npm run typecheck` and `npm run lint`
(Deno), so these files have **no automated gate at all**, only manual review.

**Fix:** one manual pass — trigger each of the notification-producing events against
the live project, confirm the row, the push and the email. Record the result in
`docs/ARCHITECTURE.md` and delete the disclaimers, or convert them into a known-issues
list. Until then treat notifications as **unproven**, not shipped.

### P0-4 — `main` was red, and the group filter could not have caught it — FIXED

Found and fixed during this session. Recorded because the _mechanism_ will recur.

PR #5 (`chore(dev-deps): bump the dev-dependencies group`) bumped
`eslint-plugin-react-refresh` **0.4.26 → 0.5.3**, which requires `eslint ^9 || ^10`.
This project is on `eslint 8.57.1`. Every `npm ci` on `main` after it merged failed
with `ERESOLVE` — including the Staff PR (#51). `main` was broken for roughly an hour.

The `dependabot.yml` guard rails were already thoughtful and still missed it:

- The `dev-dependencies` group is scoped `update-types: [minor, patch]`.
- The `eslint-plugin-*` rule ignores **majors**.
- But `eslint-plugin-react-refresh` is **0.x**, where the _minor_ slot carries the
  breaking change. Dependabot classified `0.4 → 0.5` as a minor, the group waved it
  through, and the major rule never applied.

Pinned back to `^0.4.26` with an explicit minor **and** major ignore for that package,
to be lifted in the same PR that moves to ESLint 9.

**The general rule, worth applying across the file:** for any `0.x` dependency, treat
minor as major. `dependabot.yml` currently has one other 0.x runtime dependency in
this position — audit them when adding to the group.

Note what did work: **CI caught this.** It is the one gate that is not a shape check —
`npm ci` verifies the dependency graph actually resolves. That is also why this
audit's P0-2 asks for tests rather than more linting.

### P1-1 — Seven design-preview routes are public in production — FIXED

`/dashboard-preview`, `/rota-builder-preview`, `/schedule-preview`,
`/timesheets-preview`, `/clockin-preview`, `/onboarding-preview`, `/appboot` — all
rendered unauthenticated on rota.gakinz.com, plus `/staff-preview` and
`/staff-preview/:staffId` after #51.

They exist for the design-match loop and render fabricated staff names and metrics
chosen to reproduce the mockups' numbers. No real data, no auth bypass — but a
prospect, a crawler or a client hitting `/dashboard-preview` saw an unbranded page
of invented staff, and every preview page and its mock dataset was carried in the
production bundle.

(Unlike the source-map probe, this one was real: these are client-side routes, so
the SPA fallback in P1-7 is irrelevant — the bundle genuinely contained and rendered
them. Confirmed by finding their strings in `dist/assets/index-*.js` before the fix
and not after.)

**Fix** (one edit, `src/App.tsx`, above the route table):

```tsx
{
  import.meta.env.DEV && (
    <>
      <Route
        path="/appboot"
        element={<AppBootScreen authResolved orgResolved={false} />}
      />
      <Route path="/onboarding-preview" element={<OnboardingPreviewPage />} />
      {/* …the other five… */}
    </>
  );
}
```

Vite statically replaces `import.meta.env.DEV` with `false` in a production build, so
Rollup drops the branch _and_ tree-shakes every preview page and mock module behind
it. The design loop is unaffected — it drives the dev server, where they still exist.

**Applied and deployed.** This was initially deferred: two other agent sessions were
editing `src/App.tsx` live while this audit ran (see §7), one adding two more preview
routes on `design-staff-match`. That branch merged as #51 mid-audit, which freed the
file — so the gate went in and now also covers its two `/staff-preview` routes. Nine
routes gated in total.

Verified against the built output rather than the route table: no preview route
string survives in `dist/assets/index-*.js`, while `app/dashboard` still does. Keep
new preview routes inside that block — there is no lint rule enforcing it, which is a
reasonable thing to add later.

### P1-2 — `react-router-dom` has two open advisories and no fix on 6.x

Installed: **6.30.4** (the last 6.x release — verified against the registry).

| Advisory                                                                        | Severity |
| ------------------------------------------------------------------------------- | -------- |
| Open redirect via backslash in `<Link>` / `useNavigate` (CVE-2025-68470 bypass) | moderate |
| Open redirect leading to XSS — CVSS 6.9                                         | moderate |
| Arbitrary constructor injection via `deserializeErrors()` (SSR hydration)       | moderate |

The third does not apply — RotaFlow is a static SPA with no SSR hydration. The first
two do. Current exposure is **limited**, because a grep of every navigation site shows
no user-controlled redirect target: `redirectTo` is always built from `env.appUrl`
or `window.location.origin` (`LoginPage.tsx:63`, `SignupPage.tsx:83`,
`ForgotPasswordPage.tsx:37`). So this is a latent trap, not a live hole.

But `codeql.yml`'s own header records that this project _has_ shipped a redirect
pointed at a third-party domain once already. The next `useNavigate(userValue)` makes
it real.

**The decision:** the only fix is react-router **7.18.2** — a major migration. Do it
deliberately, in its own PR, on a quiet day, with the P0-2 smoke test in place first.
Do not let Dependabot do it and do not do it in the same week as a screen push.
Until then this is accepted, documented risk with a compensating control: **no
navigation target may come from user input, a query string, or a database field.**

### P1-3 — Demo accounts are live in the production database

Five demo organisations and eight sign-in-able accounts are seeded into the
production Supabase project, all sharing **one password**.

The seed script itself is well built — the password is not committed, and it raises
an exception rather than run with the placeholder. The problem is the resulting
posture: eight accounts across five organisations behind a single shared secret, in
the same database that will hold the first real customer's staff records.

**Fix:** before the first real tenant onboards, either run `demo_teardown.sql`, or
move the demo to a separate Supabase project. A showcase dataset and production
customer data should not share an RLS boundary — RLS is the _only_ thing separating
them, and it is also the thing most likely to be changed while building the remaining
Settings screens.

### P1-4 — No Content-Security-Policy — **FIXED** (#70)

`.htaccess` now sets five headers; CSP is not one of them. For an app that renders
user-supplied content (announcements, staff notes, document links) and holds session
tokens in the browser, CSP is the control that turns an XSS from account takeover
into a blocked console error — and it is the natural mitigation for P1-2.

Not shipped tonight because a wrong `connect-src` breaks Supabase auth on a live site
and I had no way to verify it against production before deploying. Drafted, to be
tested with `npm run preview` first:

```apache
Header set Content-Security-Policy "default-src 'self'; \
  script-src 'self'; \
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
  font-src 'self' https://fonts.gstatic.com; \
  img-src 'self' data: blob: https://ik.imagekit.io; \
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.de.sentry.io https://inn.gs; \
  frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'"
```

**Shipped and verified 2026-08-01.** Derived from the code, then verified by
serving the real production build behind the exact policy and driving a headless
browser over it — twice, because the interesting failure only appears on the
second load.

Two traps, and testing found both:

1. **`worker-src` needs `blob:`.** Sentry's `replayIntegration` compresses
   payloads in a Worker created from a blob URL. Without it every route logs a
   violation.
2. **`connect-src` needs the Google Fonts origins** — even though fonts are a
   _stylesheet_ and `style-src` already allows them. On the first visit the page
   fetches the stylesheet and `style-src` governs it. On every visit after, the
   service worker's `StaleWhileRevalidate` handler fetches it, and a `fetch()`
   is governed by `connect-src`. Miss this and fonts break on the second load
   and every load after — never the first, which is exactly the shape of bug
   nobody manages to reproduce.

The `wss://` trap called out above was real and is covered.

`img-src` allows any `https:` deliberately: staff photos are arbitrary pasted
URLs today (P2-3), so locking it to ImageKit would break real avatars. Images
cannot execute. Tighten when uploads land. `openrouter.ai` is deliberately
absent — the AI key never reaches the browser.

Verified against **production** after deploy: all routes mount, no CSP
violations, no network failures across an SW-controlled second navigation.

### P1-5 — `audit_logs` is provisioned but effectively empty

The table exists, is RLS-enabled, and has exactly one writer in the entire system:
the `anonymize_staff_member` RPC. No login, rota publish, shift edit, role change,
invite, or GDPR export is recorded.

This is not just a missing screen. For a multi-tenant app holding staff PII under UK
GDPR, an audit trail is an accountability control: "who changed this person's shift",
"who exported this staff record", "who granted platform support access". Building the
Audit tab against a table that only ever contains anonymisation events would produce a
screen that looks broken.

**Fix — write the events before building the viewer.** Order: role change, rota
publish/unpublish, GDPR export, invite issued/revoked, login. The mockup also needs
`ip_address`, `severity` and an "area" column the table does not have — one migration,
and it should land before the Audit screen is designed against it.

### P1-6 — No route-level code splitting

`dist/assets/index-*.js` is **802 kB (215 kB gzip)** in a single chunk. Vendor
splitting exists (`react-vendor`, `supabase`, `motion`) but every application route is
in one bundle, so a staff member opening `/app/clock` on hospital wifi downloads the
rota builder's drag-and-drop engine, the reports CSV exporter, and every settings page.

`RotaBuilderPage.tsx` alone is 1,052 lines and pulls in both `@dnd-kit` packages.

**Fix:** `React.lazy()` + `Suspense` on the `/app/*` route elements, starting with
Rota Builder, Reports and Timesheets. `AppShell` already renders a loading state that
can serve as the fallback. Expect the entry chunk to roughly halve. This matters more
than usual here: the target user is on a phone, on ward wifi, opening one screen.

### P1-7 — Every missing file returns HTTP 200 with HTML — **FIXED** (#60)

`.htaccess` rewrites **any** non-existent path to `index.html`:

```apache
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
```

That is correct and necessary for SPA **navigations** — `/app/dashboard` is not a
file and must resolve to the app. It is wrong for **assets**. A request for
`/assets/index-abc123.js` that is missing gets `index.html`, `content-type:
text/html`, and a **200**.

This fooled this audit into reporting a source-map leak that does not exist. It will
fool anything else that probes the site — uptime monitors, link checkers, a CI
smoke test asserting an asset deployed, and any future agent verifying its own
deploy. "200 OK" from this origin does not mean the file is there.

It is also the _exact_ failure mode `vite.config.ts` warns about in its `base: '/'`
comment: a script request that receives HTML back, failing the MIME check and
leaving a blank page. Absolute base paths fixed the cause; this rewrite still hides
the symptom, so the next time it happens it will present as a blank screen with a
200 in the access log and nothing in Sentry.

**Fix** — exclude real asset directories from the fallback so they 404 honestly:

```apache
# Assets are real files. If one is missing that is a broken deploy, and it must
# look like one — not like a page. Only navigations fall through to index.html.
RewriteRule ^(assets|icons)/ - [L]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
```

Also reconsider `ErrorDocument 404 /index.html` at the foot of the file — it makes
genuine 404s serve the app shell, which is reasonable for routes and misleading for
everything else.

**Shipped and verified 2026-08-01.** Deployed on its own, after backing up the
live `.htaccess` to `~/private_backups/`, and checked immediately:

| Check                                                               | Before              | After               |
| ------------------------------------------------------------------- | ------------------- | ------------------- |
| `/assets/does-not-exist.js`                                         | **200** `text/html` | **404**             |
| `/icons/nope.png`                                                   | 200                 | **404**             |
| Real assets (`index-*.js`, `.css`, `.png`, `sw.js`, manifest)       | 200                 | 200, MIME unchanged |
| SPA deep links (`/app/dashboard`, `/invite/:token`, unknown routes) | 200                 | 200                 |
| Source maps                                                         | 403                 | 403                 |
| HSTS, Permissions-Policy, cache rules, HTTP→HTTPS                   | present             | unchanged           |

`ErrorDocument 404 /index.html` was kept. It is now nearly dead code — the SPA
fallback resolves every unknown non-file path before it — so the only thing
reaching it is a miss under `assets/` or `icons/`, where it serves the app shell
as the _body_ of a 404. The status line is what matters, and a browser fetching
a missing chunk sees 404 and fails correctly regardless of the body.

### P2 — worth fixing, no user-visible harm yet

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                 | Where                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| P2-1 | **Settings and Profile were blocked on a component that didn't exist** — 11 of the 11 remaining screens are tabs. `Tabs` (`src/components/ui/Tabs.tsx`) and the tab definitions (`src/lib/settingsTabs.ts`) shipped in #61. The **collapsible sidebar group** is still to build — see §7c.                                                                                              | `docs/SCREENS.md` §3/§4                                                                                                 |
| P2-2 | **Five destructive actions sit behind `window.confirm`** — delete shift type, remove emergency contact, delete document, disconnect SMTP, anonymize staff. Native, unstyled, unthemeable, untestable, and suppressible by the browser in an installed PWA. The last one is a **GDPR-irreversible** action guarded by a dialog Chrome may decline to show. Needs a real `ConfirmDialog`. | `ShiftTypeManagerModal:112`, `EmergencyContactsModal:94`, `DocumentsModal:102`, `IntegrationsPage:170`, `StaffPage:185` |
| P2-3 | **No file storage.** `documents.file_url` is a pasted link — staff DBS/RTW/visa documents live on whatever third-party host someone chose. No avatar upload either. ImageKit is in the stack and unused for this. For PII documents this is a privacy problem, not just a missing feature.                                                                                              | `documentService.ts`                                                                                                    |
| P2-4 | **Roles are a fixed 3-value CHECK** (`owner\|manager\|staff`), but `SettingsOrganisation.png` shows custom roles (Team Leader, Scheduler, HR Advisor). The schema cannot represent the design. Decide before building the Roles tab: a `roles` table + join, or drop custom roles from the design.                                                                                      | `memberships.role`                                                                                                      |
| P2-5 | **Rota Builder is excluded from Realtime** — deliberate and documented (its load path INSERTs, so a naive subscription creates a write→event→refetch cycle). But it is the one screen where two managers editing at once is likely. Needs a mutation-aware guard, not permanent exclusion.                                                                                              | `docs/SCREENS.md` §10                                                                                                   |
| P2-6 | **`RotaBuilderPage.tsx` is 1,052 lines**, `SchedulePage` 631, `DashboardView` 614. Against `CLAUDE.md`'s "keep components small and typed". These are where the next bug will be, and they are the hardest to test.                                                                                                                                                                     | —                                                                                                                       |
| P2-7 | **`overtime_requests` and `shift_templates` have no reader and no writer.** Empty structure with an RLS surface. Either build them or drop them — a table nobody uses is a table nobody maintains the policies on.                                                                                                                                                                      | `0002_rotaflow.sql`                                                                                                     |
| P2-8 | **Onboarding step 3 silently discards data.** Department/location fields stage locally and are never persisted. Self-documented, but the user typed something and it vanished.                                                                                                                                                                                                          | `docs/SCREENS.md` §1                                                                                                    |

### P3 — housekeeping

- `@sentry/react` 8.55 → 10.69, React 18 → 19, Vite 6 → 8, ESLint 8 → 10, TypeScript
  5.9 → 7 all available. All correctly ignored by `dependabot.yml` as planned
  migrations. Schedule them; don't drift indefinitely.
- `brace-expansion` **high** (DoS, GHSA-mh99-v99m-4gvg) — transitive, dev-only, not
  in the browser bundle. Clears on the next dev-dependency bump.
- No Lighthouse, bundle-size or a11y budget in CI. The 1.2 MB logo sat in the
  precache through 45 PRs because nothing measured it. Add a `dist/` size assertion —
  it is five lines of bash and it would have caught this.
- `aria-*` appears in 106 of 133 component files — good, but unmeasured. Add
  `eslint-plugin-jsx-a11y`.

---

## 4. What's actually left to build

35 mockups: **24 built · 6 partial · 5 not built**. The remaining work is not evenly
spread — it is concentrated in three places.

### Tier 1 — design-match only (feature works, never compared to its reference)

`Availability` · `Leave` · `Swap-Request` · `Reports-Dashboard` ·
`Announcements-Dashboard` · `Locations-Management` · `Location-department`

Seven screens, all built and working. Pure `/loop` passes using `docs/LOOP.md`.
**Start here** — highest visible return per hour, no schema work, no new primitives.

> `staff` and `Staff-Profile` are **in flight** on `design-staff-match` (see §7). Do
> not start a second pass on them.

### Tier 2 — blocked on P2-1 (the tab bar)

`SettingsOrganisation` · `SettingsIntegrations` · `ProfileSettings` ·
`profileprefrence` · `ProfileSecurity`

Five screens that are partly built as flat routes and need to become tabs. **Nothing
here can start until the tab-bar primitive and the nav restructure exist.** The nav
restructure is a product decision that is still open: the designs' sidebar has no
Clock in and no Team, but both are built and routed, and Integrations moves from
top-level into Settings. Settle that first — it is one conversation, and it blocks
five screens.

### Tier 3 — need schema and services before any pixel work

| Screen                  | Needs                                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Settingspolicy`        | A whole policy engine — ~55 policies, 10 categories, per-policy scope/status/history, templates, import/export, and live rota validation. **This is a project, not a screen.** Scope it separately.                                                                                           |
| `Settingsaudit`         | P1-5 first — write the events, add `ip_address`/`severity`/area, then build the viewer                                                                                                                                                                                                        |
| `Settingsbilling`       | A payment provider. `subscriptions` is an empty seam; no invoices, payment methods, usage metering or credits exist. Also a business decision, not just an engineering one                                                                                                                    |
| `SettingsNotifications` | Template administration — 28 templates, per-channel routing, delivery analytics. Needs a table, an SMS provider, and delivery tracking. Depends on P0-3                                                                                                                                       |
| `marketting`            | Product shot, "Why Teams Choose", logo row, testimonials, CTA banner, and `/pricing` `/features` `/contact` routes. Blocked on real customers for the social proof — **do not fabricate testimonials or logos**; the current HomePage comment already commits to this and it's the right call |

**Recommended order:** Tier 1 (7 screens) → settle nav + build tab bar → Tier 2 (5
screens) → audit events → billing → policy engine.

---

## 5. What was verified, and what that means

| Check                               | Result                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                 | clean                                                                                                                                                         |
| `npm run lint` (`--max-warnings 0`) | clean                                                                                                                                                         |
| `npm run format:check`              | clean                                                                                                                                                         |
| `npm run build`                     | clean, SW + manifest emitted                                                                                                                                  |
| RLS enabled on all 26 tables        | **yes** — 21 via the loop in `0002`, plus `profiles`/`app_settings` (`0001`), `invites` (`0006`), `push_subscriptions` (`0009`), `org_smtp_settings` (`0010`) |
| Secrets in the tracked tree         | none. Only `MODE`/`PROD` read from `import.meta.env` in `src/`; `.env` is git-ignored and confirmed                                                           |
| `service_role` in client code       | none — server-side only, in 3 Edge Functions                                                                                                                  |
| Caller-JWT forwarding               | correct in `ai-rota-assistant` and `test-smtp`; `send-notification` uses `service_role` + a shared-secret header, deliberately and correctly                  |
| `dangerouslySetInnerHTML`           | 0                                                                                                                                                             |
| `@ts-ignore` / `@ts-expect-error`   | 0                                                                                                                                                             |
| `as any`                            | 2                                                                                                                                                             |
| `console.*` in `src/`               | 2, both in logging infrastructure                                                                                                                             |
| Live site                           | 200; SW, manifest and deep routes all resolving                                                                                                               |
| Source maps on production           | **none present** — `find ~/rota.gakinz.com -name "*.map"` → 0. Now doubly guarded regardless                                                                  |
| Design-preview routes on production | **gone** — verified no preview route string survives in `dist/assets/index-*.js` while real routes do                                                         |
| Post-deploy smoke                   | `/`, `/login`, `/app/dashboard`, `/sw.js`, `/manifest.webmanifest` all 200                                                                                    |

**Read this table carefully.** Everything in it is a _static_ property. Not one line
of it says the app computes a correct timesheet. That is the point of P0-2.

And one line of it was wrong for most of this audit. "Source maps on production"
originally read **200 — exposed**, because that is what `curl` returned. It was the
SPA fallback (P1-7), not a map. The lesson generalises past this repo: **on this
origin, a 200 is not evidence a file exists.** Verify deploys against content, or
against the filesystem over SSH — never against a status code alone.

---

## 6. Risk register

| Risk                                               | Likelihood                                         | Impact                                             | Mitigation                                                                     |
| -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Offline clock-ins silently stop syncing (P0-1)     | **High** — needs only one rejected write           | Wrong pay, lost attendance, disputes               | Fix the outbox before more offline surface is added                            |
| A domain bug ships green (P0-2)                    | **High**                                           | Wrong hours, wrong rota, wrong tenant              | ~30 tests on the four money paths                                              |
| Notifications never actually deliver (P0-3)        | Medium                                             | Staff miss published rotas and swap requests       | One manual end-to-end pass                                                     |
| Stale-base deploy rolls back `main` (§7)           | **High** with 3 concurrent sessions                | Live regression, silent                            | Always `git fetch` + rebase onto `origin/main` before build+deploy             |
| Demo data beside real tenants (P1-3)               | Medium                                             | Cross-tenant confusion, 8 accounts on one password | Tear down or move project before first customer                                |
| Open-redirect trap (P1-2)                          | Low today, High after any `useNavigate(userValue)` | Session theft                                      | No navigation target from user input; plan the v7 migration                    |
| Tenant isolation regressed while building Settings | Medium                                             | **Cross-tenant data exposure**                     | RLS is the only boundary and it has no tests — add them with P0-2              |
| DNSSEC/Cloudflare misstep on `gakinz.com`          | Low                                                | Total outage, site _and_ email                     | Documented in root `CLAUDE.md` §2 — DS record before nameserver change, always |

---

## 7. Process finding — three sessions, one repository

During this audit two other agent sessions were writing to this repository
concurrently: one mid-flight on `design-staff-match` (39 uncommitted files, last write
25 seconds before I looked), another running `vite build` in
`.claude/worktrees/design-timesheets-match`, and the live site's `last-modified`
moved during the audit — someone deployed while I was reading it.

This mostly worked, because of worktree isolation. But it produced three real effects
worth naming:

1. **Local `main` was 19 commits behind `origin/main`** at the start of this session.
   Anything built and deployed from it would have rolled production back through
   eight merged PRs.
2. **P1-1 went unfixed** to avoid a conflict on `src/App.tsx` with an in-flight branch.
3. **84 MB of nested repository checkouts** sat untracked in the project root, one
   `git add -A` from being committed into the repo they are copies of. Now ignored.

**The rules that follow from this, for every session:**

- `git fetch && git rebase origin/main` **before** any build or deploy. Never deploy
  from a local branch you have not just rebased.
- Branch from `origin/main`, never from local `main`.
- Before editing a shared file (`App.tsx`, `Sidebar.tsx`, `tailwind.config.ts`), check
  `git worktree list` and the other worktrees' `git status` for uncommitted work.
- One screen, one branch, one PR. It is what made the parallelism survivable.

---

## 7b. P0 resolution — 2026-08-01 (#56)

All three P0s were taken on directly. What follows is what shipped and, as
importantly, what the work turned up that this audit had not predicted.

### Three real bugs, found by the tests written to look for them

**A schedule that renders empty one day a year.** `resolvePeriod` computed the
end of its query window as local-midnight `+ 86_400_000 ms`. A fall-back day is
25 hours long, so midnight + 24h landed at 23:00 the _same_ day and formatted
back to the same date — `toIso === fromIso`, a zero-length window, and **no
shifts at all** on 25 Oct 2026 in Europe/London. Worse, the arithmetic ran in
the _browser's_ zone, so a New York location's window also collapsed on the UK's
transition date. CI could never have caught it: `ci.yml` pins `TZ=UTC` and UTC
has no DST. The suite now runs in Europe/London for exactly this reason —
**two zones, two bug classes, neither covers the other.** Fixed with `addDays`.

**A forgotten clock-out silently deleted a day's work.** In `pairClockEvents` a
second `in` while one was still open overwrote the first, so Monday's shift
vanished with no error and no trace: a full day worked and never paid. The
abandoned segment is now emitted with `reviewReason: 'missing_clock_out'` and
zero minutes — visible and flagged, not invented and not deleted.

**An unclosed break was paid in full.** `break_start` with no `break_end`
deducted nothing. Now deducted to the clock-out and flagged.

The governing rule added to that module: **where the events are ambiguous, do
not guess silently.** Produce the reading the evidence supports _and_ set
`reviewReason`, so `/app/timesheets` shows a badge and a human decides. A
timesheet row feeds someone's pay; it must not present a guess as a fact.

### P0-1 — the outbox

`flushQueuedWrites` now classifies each failure. Permanent (RLS denial,
constraint violation, deleted shift) → moved to a new `dead_letters` store and
**the loop continues**. Transient (offline, 5xx, rate limited, expired JWT) →
attempt counted, flush stops, dead-lettered after `MAX_ATTEMPTS = 5`. Unknown
defaults to _transient_ on purpose: a transient item is still bounded, so it is
never lost, whereas defaulting to permanent would set aside a write a retry
would have delivered.

Nothing is ever deleted on failure, and `FailedWritesNotice` renders what did
not send on the clock, leave and swap screens — wording that corrects a belief
(_"They did not happen"_), because the person was already told it worked.
Setting the write aside fixes the deadlock; only showing it fixes the silence.

IndexedDB goes to v2 with an in-place migration that backfills `attempts` on v1
rows — without it `undefined + 1` is `NaN`, `NaN >= MAX` is false, and the
ceiling never trips for exactly the users who were mid-queue during the upgrade.

### P0-2 — the test floor

**95 tests, ~0.7s**, wired into `ci.yml` between format-check and build.
Coverage is deliberately the money paths only: clock events → hours, the
regular/overtime split, leave entitlement, the schedule window, and the outbox.

They were checked against the old code rather than assumed useful: **9 of the 24
outbox tests fail** on the previous implementation, and 3 of the hours tests and
3 of the schedule tests fail on theirs. A test that cannot fail is decoration.

One behaviour is pinned but deliberately _not_ fixed: leave spanning new year is
counted in full against **both** entitlement years (14 days for a 7-day
holiday). Clamping is the obvious fix, but it changes every existing entitlement
figure the moment it ships and "which year does a straddling day belong to" is a
product decision. The test locks current behaviour so it cannot drift before
that call is made.

### P0-3 — partly resolved, and honest about the rest

All four Edge Functions are deployed and ACTIVE, and every secret they read is
set. The **auth boundaries are now verified against the live project** rather
than assumed:

| Probe                                                    | Result                            |
| -------------------------------------------------------- | --------------------------------- |
| `send-notification`, no Authorization header             | 401 `UNAUTHORIZED_NO_AUTH_HEADER` |
| `send-notification`, valid anon JWT, no shared secret    | 401 `{"error":"Unauthorized"}`    |
| `send-notification`, valid anon JWT, wrong shared secret | 401 `{"error":"Unauthorized"}`    |
| `ai-rota-assistant`, no auth                             | 401                               |
| `inngest`, unsigned POST (`verify_jwt: false`)           | 401 `{"message":"Unauthorized"}`  |

So the shared-secret guard is real, holding the public anon key is not enough to
write into someone's notification inbox, and the one function with the platform
JWT gate disabled is genuinely protected by Inngest's request signing.

### P0-3 continued — the delivery legs, 2026-08-01

The auth work above left the actual question open: _does anything arrive?_ This
is what is now positively verified, and what is still not.

**The two silent killers are both ruled out.** These are the failures that
present as "nobody has opted in" or "the email must be in spam", and neither
surfaces an error anywhere:

| Check                                            | Method                                                                                             | Result                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| VAPID keypair is genuinely a **pair**            | Derived the public point from the private scalar (P-256) and compared to the configured public key | **MATCH** — 65-byte public, 32-byte private, `web-push` accepts the details |
| The **deployed** private key is that same key    | sha256 of the local value vs the digest Supabase reports                                           | identical                                                                   |
| The client subscribes with the paired public key | same digest comparison on `VITE_VAPID_PUBLIC_KEY`                                                  | identical                                                                   |
| SMTP credentials actually authenticate           | `transport.verify()` against `premium17.web-hosting.com`                                           | **ok**                                                                      |
| SMTP actually **delivers**                       | real `sendMail` to the owner's own mailbox                                                         | **250 OK**, `accepted: [gakinz101@gmail.com]`, `rejected: []`               |

A mismatched VAPID pair would have made _every_ push 403 forever while looking
like an empty subscriber list. It isn't mismatched.

**Inngest is synced — which was a real unknown.** Before this session
`GET /v1/events` returned **zero events, ever**: the notification path had never
run once in production. A probe event (`announcement/published`) was accepted and
produced a **function run 0.6s later**, so the app is registered, the signing key
works, and Inngest can reach the Edge Function. That single fact rules out the
"deployed but never synced, so nothing was ever going to fire" failure.

The probe was deliberately unroutable — `orgId` and `userIds` set to the nil
UUID, which satisfies no foreign key — so it exercised
ingest → sync → invocation → shared-secret auth → the `notifications` insert and
could not deliver anything to anyone. It ended `Failed`, as designed.

**Two secrets diverge between local and deployed, and one matters.** Nine of ten
compared digests are identical. The exception is `SMTP_PORT`: the deployed value
is **587**, the developer's `.env` says **465**. `.env.example` says 587, so it
is the local file that is the outlier. This is not cosmetic — the function does
`secure: smtpConfig.port === 465`, so **local testing exercises implicit TLS and
production exercises STARTTLS: different code paths.** Both were tested against
this host and both connect, authenticate and deliver, so nothing is broken — but
a local "it works" proves the wrong branch. Align `.env` to 587.

#### What is still NOT verified

- **A push arriving on a real device.** The signing keys are provably correct,
  but no browser subscription has been exercised. Needs a device that has opted
  in.
- **The `notifications` row and the function's own `sendMail`.** The SMTP
  _transport_ is proven with the function's exact nodemailer config and both
  ports; the function running that code against a real recipient is not.
- **The probe run's error text.** Inngest's free API exposes run status but not
  output (`/runs/{id}/jobs` returns empty, `/output` 404s). The failure is
  consistent with the deliberate FK violation, and a shared-secret 401 is
  structurally impossible here — both functions read the _same_
  `NOTIFICATION_FUNCTION_SECRET` from the same project, and it is set — but the
  message was inferred, not read. The Inngest dashboard shows it.

#### The one step that closes this, and why it was not taken

Sign in as an org owner, publish an announcement, and confirm the row, the push
and the email. It needs a real account password, which is in a password manager
and not something to request or handle here, and it sends real notifications to
real staff on the demo orgs. That is the owner's call to make, not a dev
session's.

**Revised posture:** notification _infrastructure_ is verified — keys pair,
credentials authenticate, mail delivers, Inngest reaches the function. The
_application_ leg (row written, real recipient notified) remains unproven.
That is a materially smaller gap than "nobody has watched anything work", and
the remaining risk is concentrated in code, not configuration.

---

## 7c. Navigation — the decision, and a correction

Building the tab primitive meant reading both mockups closely, and one thing in
this report's own §6 summary was wrong.

**The correction.** §6 said the designs give Settings "(expandable, 8
sub-items)" and treated that as the whole story. Both are true at once, and they
are different components:

- `design/ProfileSettings.png` shows the sidebar with **Settings expanded** into
  its 8 sub-items — so a collapsible sidebar group is real and still to build.
- `design/SettingsOrganisation.png` shows the same sidebar with Settings
  **collapsed**, and the 8 sections instead as a **horizontal in-page tab bar**
  under the page title.

So the designs use _both_ affordances for the same 8 destinations. That is
normal (sidebar for navigation, tabs for orientation within the area) and it
means the tab bar was the piece actually blocking screens — it is what every one
of the 11 renders. It shipped in #61; the sidebar group did not, and does not
block anything.

**Why the sidebar was not restructured in the same PR.** Eight worktrees were
active on design-match branches while this ran. `Sidebar.tsx` is shared by every
one of them, and a nav restructure is the single highest-conflict change
available. The primitive is a new file that conflicts with nobody.

**The recommendation, so this stops being an open question.** Three differences
between the designed sidebar (12 items) and the built one (15):

| Item             | Design                        | Recommendation                                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Integrations** | a Settings tab, not top-level | Move it. `settingsTabs.ts` already lists it at `/app/settings/integrations`; the existing page moves under that route                                                                                                                                                                                        |
| **Clock in**     | absent                        | **Keep it, role-conditional.** The mockups are a manager's view (Sarah Manager). Clock-in is the single most-used screen a _staff_ member has, and burying the thing someone opens twice a day to satisfy a manager-view mockup would be a real usability loss. Show for `staff`, hide for `owner`/`manager` |
| **Team**         | absent                        | Fold into Settings → **Permissions**. It is invite/revoke — org administration, which is exactly what that tab is for. Removes an item and fills a designed tab that currently has no content                                                                                                                |

Net: managers get the designed 12-item sidebar, staff get 11 plus Clock in.
`docs/SCREENS.md` §6 should be updated when this lands.

---

## 8. The three things to do next

_Updated 2026-08-01, after #56–#61._

1. **Close the last of P0-3** — one owner-driven pass: sign in, publish an
   announcement, confirm the row, the push on a real device and the email.
   Everything underneath is proven (keys pair, SMTP delivers, Inngest reaches
   the function); what is left is the application leg and it needs a real
   account.
2. **Build the first Settings tab against `Tabs`** — Organisation is the
   obvious one, since `/app/settings` already covers part of it. That converts
   the flat route into `/app/settings/organisation` and proves the pattern for
   the other seven.
3. **Tier 1's remaining design-match passes** (§4) — several are already in
   flight across parallel branches.

Remaining P1s in order of cost: **P1-4 CSP** (drafted, needs a `npm run preview`
pass — `wss://` must be in `connect-src` or all 12 Realtime screens silently
stop updating), then **P1-2** the react-router v7 migration (now safer: the test
floor exists, and #48 is open with 7.18.2).

Housekeeping: set `SMTP_PORT=587` in the local `.env` so local testing exercises
the same TLS branch as production.
