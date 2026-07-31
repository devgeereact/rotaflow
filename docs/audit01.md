# RotaFlow — Audit 01

**Date:** 2026-07-31 · **Branch audited:** `main` @ `d3173cf` → `a075208`
**Live:** https://rota.gakinz.com (HTTP 200, SW + manifest serving, deep routes resolving)
**Scope:** whole repository — 198 TS/TSX files, 28,241 LOC, 26 tables, 12 migrations,
4 Edge Functions, 40 design references, 45 PRs of history.

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

| Fix                              | Before                                      | After                                               |
| -------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| Source maps public on production | `index-*.js.map` → **HTTP 200**             | not emitted into the bundle, refused by `.htaccess` |
| `logo.png` in the precache       | 1024×1024, **1.2 MB**, rendered at 24–56 px | 256×256, **29 KB**                                  |
| Total precache                   | 2682 KiB                                    | **1495 KiB (−44%)**                                 |
| Design mockups tracked in git    | 22 of 40                                    | **40 of 40**                                        |
| `.claude/worktrees/`             | 84 MB untracked in the project root         | ignored                                             |
| Security headers                 | 3                                           | 5 (+ HSTS, Permissions-Policy)                      |
| `docs/LOOP.md`                   | 14 screens, 6 rows factually wrong          | 35 screens, status per screen                       |
| `docs/SCREENS.md` count          | 34 (violated its own invariant)             | 35, corrected                                       |

---

## 3. Findings

Severity is about **consequence**, not effort. P0 = can produce a wrong outcome for
a real person (wrong pay, wrong shift, exposed data) or blocks everything after it.

### P0-1 — The offline outbox deadlocks permanently and silently

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

### P0-2 — Zero automated tests

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

### P0-3 — The server-side half has never been verified end to end

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

### P1-1 — Seven design-preview routes are public in production

`/dashboard-preview`, `/rota-builder-preview`, `/schedule-preview`,
`/timesheets-preview`, `/clockin-preview`, `/onboarding-preview`, `/appboot` — all
return **HTTP 200 unauthenticated on rota.gakinz.com**. Verified live.

They exist for the design-match loop and render fabricated staff names and metrics
chosen to reproduce the mockups' numbers. No real data, no auth bypass — but a
prospect, a crawler or a client hitting `/dashboard-preview` sees an unbranded page
of invented staff, and every preview page and its mock dataset is carried in the
production bundle.

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

**Not applied tonight on purpose.** Two other agent sessions were editing
`src/App.tsx` live while this audit ran (see §7), one of them adding two more preview
routes on `design-staff-match`. Landing a competing edit on the exact file and exact
region they were mid-flight in would have cost them a conflict resolution for no
urgency. Apply this once that branch merges — and include their new
`StaffPreviewPage` / `StaffProfilePreviewPage` routes in the same block.

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

### P1-4 — No Content-Security-Policy

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

Two traps: `style-src` needs `'unsafe-inline'` while framer-motion writes inline
styles, and `connect-src` must include the **wss://** Supabase origin or every
Realtime screen silently stops live-updating — which is 12 of them.

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

### P2 — worth fixing, no user-visible harm yet

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                 | Where                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| P2-1 | **Settings and Profile are blocked on a component that doesn't exist.** 11 of the 11 remaining screens are tabs, and there is no tab-bar or collapsible-nav-group primitive anywhere. Build it once, in `src/components/ui`, before the first tab.                                                                                                                                      | `docs/SCREENS.md` §3/§4                                                                                                 |
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
| Source maps on production           | **was 200 — now fixed**                                                                                                                                       |

**Read this table carefully.** Everything in it is a _static_ property. Not one line
of it says the app computes a correct timesheet. That is the point of P0-2.

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

## 8. The three things to do next

1. **Fix the outbox (P0-1).** It is the only finding here that can cost someone their
   correct pay, and it is invisible when it happens.
2. **Put a test floor under the four money paths (P0-2).** ~30 Vitest tests plus one
   Playwright smoke path. Wire into `ci.yml`. Everything after this lands safer.
3. **Settle the navigation structure**, then build the tab-bar primitive (P2-1). It is
   one product conversation and it unblocks five of the eleven remaining screens.

Then Tier 1's seven design-match passes, which are the fastest visible progress
available and need none of the above.

---

_Audit 01 · 2026-07-31 · next audit after the Settings area lands._
