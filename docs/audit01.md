# RotaFlow — Audit 02

**Date:** 2026-08-01 · **Audited:** `main` @ `529b8f5` · **Shipped as:** `943d62f`, `a7e2c29`
**Method:** full-repository smoke test — every route resolved against the real route
table, every navigation target, every button, every destructive action, the production
build's actual contents, and the screens driven in a browser.
**Scope:** 46,717 LOC · 40 design references · 9 test files / 155 tests · 26 tables ·
12 migrations · 4 Edge Functions.

> This report **replaces** Audit 01. Everything Audit 01 recorded as fixed has been
> re-verified rather than assumed; §8 carries forward what is still open. The parts of
> Audit 01 that still matter are preserved here — it is not a fresh start, it is the
> same backlog with a session of work applied and re-measured.

---

## 1. Verdict

**Audit 01 said the product was further along than the process around it. That is no
longer the main problem. The main problem is that the product was further along than
its own navigation.**

The test floor exists (155 tests), CI is green, the outbox is fixed, CSP is live, code
is split, and the app builds clean with zero warnings. Those were real wins and they
held.

What this smoke test found is a different failure mode, and a more embarrassing one:
**fourteen screens were listed in the navigation, tested by a unit test, and did not
exist.** `src/lib/settingsTabs.ts` declared eight Settings tabs and six Profile tabs.
It had a passing test asserting the tab list was correct. It was correct — and nothing
imported the module except that test. Every one of those fourteen routes fell through
to the `*` catch-all and rendered the 404 page.

Typecheck, lint, format, build and all 155 existing tests were green throughout. A
route is a string, a `<Route path>` is a string, and nothing had ever compared the two.

That is the same shape as every finding in Audit 01 — _four gates that check the shape
of the code and nothing that checks what the user gets_ — and it survived a full audit
because the audit read the tab file and saw a well-built, well-commented, well-tested
module. It was all of those things. It was also dead code.

**The lesson worth keeping:** a component shipped as "the thing that unblocks the
remaining screens" is not progress until something renders it. `Tabs` and
`settingsTabs.ts` were merged in #62 with exactly that framing, and the only consumer
of `Tabs` since then was an unrelated Locations header.

All fourteen screens are now built and routed, and a new test parses the real route
table out of `App.tsx` and fails if a tab ever points at nothing again.

---

## 2. What shipped in this session

### `943d62f` — the fourteen missing screens

| Area                     | Route                         | Data source                                    |
| ------------------------ | ----------------------------- | ---------------------------------------------- |
| Settings → Organisation  | `/app/settings/organisation`  | `organisations` + `organisations.settings`     |
| Settings → Permissions   | `/app/settings/permissions`   | `memberships` + `staff_profiles` + `invites`   |
| Settings → Roles         | `/app/settings/roles`         | `organisations.settings.role_labels`           |
| Settings → Policies      | `/app/settings/policies`      | `organisations.settings` (6 rules)             |
| Settings → Notifications | `/app/settings/notifications` | `organisations.settings.notification_defaults` |
| Settings → Integrations  | `/app/settings/integrations`  | `org_smtp_settings` (moved from top level)     |
| Settings → Billing       | `/app/settings/billing`       | `subscriptions` (real table, no provider)      |
| Settings → Audit         | `/app/settings/audit`         | `audit_logs`                                   |
| Profile → Profile        | `/app/account/profile`        | `profiles` + `staff_profiles`                  |
| Profile → Preferences    | `/app/account/preferences`    | `app_settings` + push subscription             |
| Profile → Security       | `/app/account/security`       | Supabase Auth                                  |
| Profile → Sessions       | `/app/account/sessions`       | Supabase Auth (current session)                |
| Profile → API Tokens     | `/app/account/tokens`         | — none exists; stated on the screen            |
| Profile → Activity       | `/app/account/activity`       | `audit_logs` filtered to the user              |

Twelve of the fourteen read real rows. The two that do not say so on the screen.

### `a7e2c29` — the production bundle was carrying the design previews

Audit 01 §P1-1 gated the preview routes behind `import.meta.env.DEV` and verified no
preview route string survived in the bundle. That verification was correct and the gate
works — the pages are genuinely unreachable in production.

**But the gate was on the routes, not the definitions.** Every `lazyPage(...)` call sat
at module top level, outside the branch, so Rollup saw thirteen live `import()`
expressions and emitted a chunk for each — and listed all thirteen in the **service
worker precache manifest**. Every user downloaded all of them on first visit.

Measured against the built output, before and after:

| Check                           | Before                    | After                |
| ------------------------------- | ------------------------- | -------------------- |
| Preview chunks in `dist/assets` | 13                        | **0**                |
| Preview entries in `dist/sw.js` | 13                        | **0**                |
| Precache                        | 125 entries / 1844.70 KiB | **97 / 1737.77 KiB** |
| Entry chunk                     | 335,157 B                 | 332,354 B            |
| Fabricated staff data shipped   | 87 kB                     | **0**                |

This had silently undone part of #69, whose entire point was that a carer opening
`/app/clock` should not download the rest of the app.

**Why it went unnoticed:** #52 verified the right thing (route strings absent) and drew
a broader conclusion than the evidence supported (the pages are gone). They were not
gone — they were unreachable and still downloaded. The generalisable rule: **verify a
bundle claim against `dist/`, not against the source, and check the precache manifest
separately from the chunk list.**

---

## 3. Findings

Severity is about **consequence**, not effort.

### P0-1 — Fourteen navigation targets resolved to 404 — **FIXED** (`943d62f`)

Covered in §1. The detail worth keeping is the failure of the existing test:
`settingsTabs.test.ts` asserted the tab list's contents, order and role filtering — 11
tests, all passing, all meaningful — and could not detect that none of the routes
existed, because it never looked at `App.tsx`.

**The fix that prevents recurrence** is `src/lib/navigationTargets.test.ts`. It reads
`App.tsx`, resolves nested routes onto their parent prefixes, and asserts every tab is
routable. Confirmed to fail 14 of 16 assertions against the previous `App.tsx`.

Its first draft is itself instructive: it resolved nesting by string prefixing, which
made `/app/settings/notifications` pass because a _top-level_ `/app/notifications`
existed. **Two assertions reported success for routes that were not there.** It now
walks real tag structure with a brace-aware scan, because `element={<Layout />}`
contains a `/>` that a naive regex mistakes for the end of the `<Route>` tag. A test
that can produce a false pass is worse than no test.

### P0-2 — Five destructive actions sat behind `window.confirm` — **FIXED** (`943d62f`)

Carried from Audit 01 P2-2, re-graded to P0 because one of the five is irreversible.

`window.confirm` is unstyled and untestable, but the reason it was genuinely unsafe is
narrower: **a browser is allowed not to show it.** Chrome suppresses repeated dialogs,
and an installed PWA is exactly the context where a user ticks "don't show again". A
suppressed `confirm()` returns `false`, so the guard fails _closed_ — but the person is
then clicking a button that silently does nothing, with no way to find out why.

The worst case was `anonymize_staff_member`: a GDPR erasure that permanently scrubs a
person's name, phone and photo, guarded by a dialog the browser may decline to render.

All five now use a themed promise-based `ConfirmDialog` with a `danger` tone, focus
trap and Escape handling.

### P0-3 — Preview chunks precached into production — **FIXED** (`a7e2c29`)

§2 above.

### P1-1 — One heading role, three sizes — **FIXED** (`943d62f`)

`design/designsystem.png` names exactly one Page Title style: **32/40 Semibold**.
`tailwind.config.ts` has carried a `text-page-title` token for it since the beginning.
It was used **three times in the entire codebase**.

The 26 page headings actually used:

| Class             | Count | Rendered |
| ----------------- | ----- | -------- |
| `text-2xl`        | 19    | 24 px    |
| `text-3xl`        | 10    | 30 px    |
| `text-xl`         | 4     | 20 px    |
| `text-page-title` | 3     | 32 px    |

This is what "the screens look slightly different from each other" is made of. Not a
wrong colour anywhere — the same heading at 24 px on Schedule and 30 px on Staff.

**The root cause is worth recording, because it will recur.** Several of those sizes
were _measured_ during pixel-match passes, and the measurements were right about the
reference and wrong about the design: every file in `design/` is **1672 px wide**, an
export of a 1920 px design at ~87%. A 32 px title appears in the PNG as ~28 px, and
matching it lands you on `text-2xl` or `text-3xl` depending on which way you round.

`designsystem.png` _states_ 32/40 as text rather than showing it, so the token is
authoritative over any measurement taken off a downscaled export. All 16 page titles
now use it, and layouts were re-checked in a browser afterwards.

**Rule for future design-match work:** read the stated value from `designsystem.png`
first; only measure the reference for things the design system does not name.

### P1-2 — The Button component was missing half the design system — **FIXED** (`943d62f`)

`designsystem.png` shows six button styles: Primary, Secondary, Ghost, **Success,
Warning, Danger**. `Button.tsx` implemented the first three.

Consequence: **43 elements** carry `bg-danger` or `text-danger` directly in a
`className`, none agreeing on padding, weight or hover. `success`, `warning`, `danger`
and `danger-outline` now exist as variants. `warning` takes dark ink rather than white
— its token value (`#E0A030`) fails contrast against white, and the reference shows
dark text on it.

The 43 existing ad-hoc sites are **not yet migrated** — see P2-1.

### P1-3 — Sidebar carried three items the designs do not have — **FIXED** (`943d62f`)

Fifteen items against the designs' twelve. Resolved along Audit 01 §7c's
recommendation, which was correct and had simply never been executed:

| Item             | Action                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integrations** | Moved into Settings, as every reference shows. `/app/integrations` redirects.                                                                                                 |
| **Team**         | Folded into Settings → Permissions — it is invite/revoke, i.e. org administration. Fills a designed tab that had no content. `/app/team` redirects.                           |
| **Clock in**     | **Kept, role-conditional.** Absent from the mockups, but the mockups are a _manager's_ view. Clock-in is what a carer opens twice a day. Shown to staff, hidden for managers. |

A manager now sees the designed twelve. A staff member sees the eight that concern
them, plus Clock in, with Settings replaced by My Profile —
`settingsTabsForRole('staff')` is empty, so a Settings link would have bounced them off
a redirect every time.

### P1-4 — `organisations.settings` is an untyped jsonb written by six screens — **MITIGATED** (`943d62f`)

Onboarding, Organisation, Roles, Policies and Notifications all write into the same
free-form blob. Nothing stops one storing `week_start: "Monday"` while another reads
`week_starts_on: 1` — and no typecheck, lint or test would notice. The value reads back
empty and the screen shows its default. **Silently wrong, permanently.**

That is the same bug class Audit 01 §7b found in the timesheet code, where it produced
a schedule that rendered empty one day a year.

`src/lib/orgPreferences.ts` now owns every key, its parser and its default. Screens do
not index the blob. This is a mitigation, not a fix — the real fix is typed columns, or
a JSON schema validated on write.

### P1-5 — `audit_logs` is still effectively empty

**Unchanged from Audit 01 P1-5, and now visible in the product.**

The table has exactly one writer in the entire system: the `anonymize_staff_member`
RPC. No login, rota publish, shift edit, role change, invite or GDPR export is
recorded.

The Audit and Activity screens now exist and read it honestly — they render what is
genuinely there and state plainly which events are captured, because a viewer over a
permanently empty table reads as broken and, worse, implies nothing has happened.

There is a second reason those screens can be empty and it is not obvious:
`audit_logs_select` is **owner-only**, so a manager or staff member reading their own
activity is filtered out by RLS rather than by an absence of events.

**This is now the highest-value schema work outstanding.** For a multi-tenant app
holding staff PII under UK GDPR, the audit trail is an accountability control, and
Settings → Permissions currently declines to offer role changes _because_ there is no
event to attribute them with. One migration unblocks two screens and a compliance
story: write the events (role change, rota publish/unpublish, GDPR export, invite
issued/revoked, login), and add `ip_address`, `severity` and an area column.

PR #71 drafted part of this and is **still held unmerged** — see §8.

### P1-6 — Demo accounts live in the production database

**Unchanged from Audit 01 P1-3. Still needs an owner decision, not an engineer.**

Five demo organisations and eight sign-in-able accounts share one password in the same
database that will hold the first real customer's staff records. RLS is the only thing
separating them, and it is also the thing most likely to change while Settings screens
are built — which just happened, across fourteen screens.

Options: (a) run `supabase/seed/demo_teardown.sql`, or (b) move the demo to its own
Supabase project. (b) is better if client demos are ongoing. Either way, **before the
first real tenant onboards.**

### P2 — worth fixing, no user-visible harm yet

| #    | Finding                                                                                                                                                                                                                                                                                         | Where                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P2-1 | **43 ad-hoc `bg-danger`/`text-danger` elements** not yet migrated to the new Button variants. Mechanical, but each needs eyes — some are badges, not buttons.                                                                                                                                   | app-wide                                            |
| P2-2 | **31 hand-rolled `Loading…` blocks and 13 hand-rolled empty states.** `EmptyState` now exists and is used by the new screens; the existing 13 are unconverted. A skeleton or shared `LoadingState` would also fix the layout shift each one causes.                                             | app-wide                                            |
| P2-3 | **11 "coming soon" toasts** on real buttons — Schedule filters, display settings, change history, Rota Builder's Month/Day views and extra filters, the timesheet guide. Honest, but a button that always apologises should be disabled with a tooltip.                                         | `SchedulePage`, `RotaBuilderPage`, `TimesheetsPage` |
| P2-4 | **No file storage.** `documents.file_url` is a pasted link — staff DBS/RTW/visa documents live on whatever third-party host someone chose. No avatar upload. ImageKit is in the stack and unused. For PII documents this is a privacy problem.                                                  | `documentService.ts`                                |
| P2-5 | **`RotaBuilderPage.tsx` is 1,052 lines**; `SwapsPage` and `SchedulePage` 631; `DashboardView` 614. Against `CLAUDE.md`'s "keep components small and typed". These are where the next bug will be and the hardest to test.                                                                       | —                                                   |
| P2-6 | **Rota Builder is excluded from Realtime** — deliberate and documented, but it is the one screen where two managers editing at once is likely. Needs a mutation-aware guard, not permanent exclusion.                                                                                           | `docs/SCREENS.md` §10                               |
| P2-7 | **`overtime_requests` and `shift_templates` have no reader and no writer.** Empty structure with an RLS surface nobody maintains.                                                                                                                                                               | `0002_rotaflow.sql`                                 |
| P2-8 | **Onboarding step 3 silently discards data.** Department/location fields stage locally and are never persisted. Self-documented, but the user typed something and it vanished.                                                                                                                  | `docs/SCREENS.md` §1                                |
| P2-9 | **Custom roles cannot be represented.** `memberships.role` is a fixed three-value CHECK and every RLS policy is written against those literals. Settings → Roles ships _display labels_ over the three real roles and says so. Real custom roles are a migration plus an authorisation rewrite. | `memberships.role`                                  |

### P3 — housekeeping

- `@sentry/react` 8.55 → 10.69, React 18 → 19, Vite 6 → 8, ESLint 8 → 10, TypeScript
  5.9 → 7 all available and correctly ignored by `dependabot.yml` as planned
  migrations. Schedule them; don't drift indefinitely.
- **No bundle-size assertion in CI.** The 1.2 MB logo sat in the precache through 45
  PRs, and 87 kB of preview chunks sat there through this one, because nothing measures
  `dist/`. It is five lines of bash and it would have caught both.
- No Lighthouse or a11y budget. `aria-*` appears in most component files — good, but
  unmeasured. Add `eslint-plugin-jsx-a11y`.
- **No lint rule keeps new preview routes inside the DEV gate**, and now none keeps
  their definitions there either. Both are conventions held by a comment.

---

## 4. What the designs still ask for that the system cannot do

Every one of these was resolved by **stating it on the screen** rather than mocking it
up. Recorded here so the decisions are visible and reversible.

| Reference                   | Asks for                                            | Why it is not built                                                                                                                                                 |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SettingsOrganisation.png`  | Industry Pack (templates, compliance rules)         | No packs table, no template rows, no installer. A card reading "Care Homes · Active" would label nothing.                                                           |
| `SettingsOrganisation.png`  | Platform Support Access                             | Support impersonation — needs an access-grant table, an expiry job and an audit event per grant. Hands a third party customer PII.                                  |
| `SettingsNotifications.png` | SMS channel                                         | No SMS provider, no delivery table, no function that could send one. A toggle that sends nothing is worse than no toggle.                                           |
| `SettingsNotifications.png` | 28 editable templates + delivery analytics          | Needs `notification_templates` and per-send tracking. Depends on §8's unverified application leg.                                                                   |
| `Settingspolicy.png`        | ~55 policies, scope/status/history, live validation | A project, not a screen. Six rules the product **already acts on** ship; the screen states they are defaults, not enforcement.                                      |
| `Settingsbilling.png`       | Invoices, payment methods, usage metering           | No payment provider — a business decision. An empty invoice table reads as "your invoices failed to load".                                                          |
| `ProfileSettings.png`       | Connected sessions across three devices             | Supabase's client SDK sees only this browser's session. "Sign out everywhere" ships instead — it revokes the devices the page cannot list.                          |
| `ProfileSecurity.png`       | "100% Secure" ring, 2FA tick                        | Three of its four checks cannot be answered from the client, and MFA is not enrolled. A static 100% ring tells someone they are protected when nothing was checked. |
| `ProfileSettings.png`       | API Tokens                                          | No public API. Issuing long-lived JWTs would be a bearer credential with full RLS scope, no expiry and no revocation.                                               |
| `ProfileSettings.png`       | Language selector                                   | No i18n layer; every string is an English literal.                                                                                                                  |
| `ProfileSettings.png`       | Avatar upload                                       | ImageKit is in the stack and unwired; `photo_url` is a pasted link (P2-4).                                                                                          |

**The principle applied throughout:** a control that appears to work and does nothing is
worse than a stated absence. This matters most where the control is a _security_ one — a
2FA tick, a suppressed confirm dialog, or an SMS toggle a manager relies on to reach
staff about a rota change.

---

## 5. What's left to build

40 design references. The eleven "remaining screens" Audit 01 tracked are now built.
What remains is **depth behind screens that exist**, not new screens:

1. **Audit events** (P1-5) — one migration; unblocks Settings → Audit, Profile →
   Activity, and role changes in Permissions.
2. **File storage** (P2-4) — ImageKit for documents and avatars. A privacy fix, not a
   feature.
3. **Billing** — needs a payment provider decision first.
4. **The policy engine** — scope separately; the settings surface it will read from now
   exists and is typed.
5. **Notification templates** — depends on closing §8's application leg.
6. **`marketting.png`** — blocked on real customers for social proof. **Do not fabricate
   testimonials or logos**; the existing HomePage comment commits to this and it is the
   right call.

---

## 6. What was verified in this session

| Check                                         | Result                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck`                           | clean                                                                     |
| `npm run lint` (`--max-warnings 0`)           | clean                                                                     |
| `npm run format:check`                        | clean                                                                     |
| `npm test`                                    | **155 passed**, 9 files                                                   |
| `npm run build`                               | clean; SW + manifest emitted                                              |
| Every navigation target vs the route table    | **0 dead targets** (was 14)                                               |
| New test fails against the old code           | **yes — 14 of 16** assertions                                             |
| `window.confirm` in `src/`                    | **0** (was 5)                                                             |
| Preview chunks in `dist/assets`               | **0** (was 13)                                                            |
| Preview entries in the SW precache            | **0** (was 13)                                                            |
| Preview route strings in any production chunk | **0** (unchanged — the route gate always worked)                          |
| DEV previews still render                     | yes — `/leave-preview` driven in a browser after the change               |
| New routes resolve (not 404)                  | yes — `/app/settings/billing` renders the auth gate; a bogus sibling 404s |
| Page-title token adoption                     | 3 → **19** sites                                                          |
| Pixel-matched screens after normalisation     | re-screenshotted; layouts intact                                          |

**Read this table with the same caution Audit 01 asked for.** Most of it is still
static. What is _not_ static, and is new: the route-table test, and the three
before/after bundle measurements taken from `dist/` rather than from source.

**One thing this session could not verify: the fourteen new screens rendering with real
data.** They need a signed-in session with an organisation, and the only credentials are
demo accounts whose shared password is in a password manager. Requesting or handling it
is the owner's call. What _is_ verified: they compile, they route, they pass lint and
tests, their queries are typed against the generated schema, and every table they read
exists with the columns they select. What is _not_: that a real organisation's data
renders correctly in them. **Treat the new screens as built and routed, not as proven.**
That is the single highest-value next check and it takes about ten minutes with a real
login.

---

## 7. Risk register

| Risk                                                | Likelihood                             | Impact                                             | Mitigation                                                          |
| --------------------------------------------------- | -------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| A new screen renders wrong against real data        | **Medium** — none has been signed into | Owner sees a broken Settings area                  | One signed-in pass (§6)                                             |
| Audit trail stays empty as customers onboard (P1-5) | **High**                               | No accountability record under UK GDPR             | One migration; write the events                                     |
| Demo data beside real tenants (P1-6)                | Medium                                 | Cross-tenant confusion, 8 accounts on one password | Tear down or move project before first customer                     |
| Staff PII documents on arbitrary third-party hosts  | **High** — it is the current design    | Privacy exposure outside any DPA                   | ImageKit (P2-4)                                                     |
| Another dead-navigation regression                  | **Low** — now tested                   | A 404 where a screen should be                     | `navigationTargets.test.ts`                                         |
| Bundle regressions ship unnoticed                   | **High** — twice now                   | Slow first load on ward wifi                       | `dist/` size assertion in CI (P3)                                   |
| Notifications never actually deliver                | Medium                                 | Staff miss published rotas and swaps               | §8 — the application leg                                            |
| Stale-base deploy rolls back `main`                 | **High** with concurrent sessions      | Live regression, silent                            | `git fetch` + rebase onto `origin/main` before every build + deploy |
| Tenant isolation regressed while building Settings  | Medium                                 | **Cross-tenant data exposure**                     | RLS has no tests — the largest remaining gap in the suite           |

---

## 8. Carried forward from Audit 01, still open

**P0-3 — the notification application leg.** Infrastructure is verified: the VAPID
keypair was proven to be a genuine pair by deriving the public point from the private
scalar, SMTP authenticates and delivers (`250 OK`), and Inngest reaches the Edge
Function (a probe event produced a function run 0.6 s later). What remains unproven is
the _application_ leg — a `notifications` row written and a real recipient notified. It
needs a real account password and sends real notifications to real staff on the demo
orgs. **Owner's call.**

**P1-5's migration (PR #71) is still held as a draft, deliberately.** `Supabase Preview`
reports `skipping`, so no preview database is created and the migration has been applied
nowhere — it would hit **production** on merge. Static checking caught two real bugs in
it (`invites` has no `status` column; the first draft widened `audit_logs_select` from
owner-only), but it cannot tell you the triggers fire or that `0013` applies cleanly on
top of the live `0012`. Merging it unverified is the pattern these reports exist to
stop. **Fixing the preview-database gap is what unblocks it.**

**Housekeeping:** set `SMTP_PORT=587` in the local `.env`. The deployed value is 587 and
the local file says 465, and the function does `secure: port === 465` — so local testing
exercises implicit TLS while production exercises STARTTLS. Both work against this host,
but a local "it works" currently proves the wrong branch.

---

## 9. The three things to do next

1. **Sign in and walk the fourteen new screens** (§6). Ten minutes, and it converts
   "built and routed" into "proven". Nothing else in this report is blocked on it, and
   everything in it is uncertain until it happens.
2. **Write the audit events** (P1-5). One migration. Unblocks two screens, the
   role-change control that Permissions currently declines to offer, and the GDPR
   accountability story — and it is the difference between an Audit tab that documents
   the product and one that documents nothing.
3. **Add a `dist/` size assertion to CI** (P3). Five lines of bash. It would have caught
   the 1.2 MB logo and the 87 kB of preview chunks, which are the only two bundle
   regressions this project has had — both found by an audit rather than a gate.

Then: demo teardown before the first real tenant (P1-6), and file storage (P2-4).
