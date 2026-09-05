# RotaFlow — Website and PWA Production Audit

**Auditor:** Claude Opus 5, driven by the owner's Website Audit and PWA Audit standards
**Date:** 2026-09-02 into 2026-09-03
**Scope:** the public site at `https://rotaflow.space`, the authenticated PWA, the
Supabase schema behind both, and the CI that guards them
**Supersedes:** the 2026-08-14 QA audit, preserved in full as **Appendix A** — it is
still the home of BUG-001 to BUG-042, which `docs/SAAS.md` §6 points here for

---

## How this audit was run

The standard it was run against is explicit about the order, and it was followed:

> DISCOVER → INSPECT → TEST → RECORD → CLASSIFY → PRIORITISE → FIX → REGRESSION
> TEST → RE-AUDIT → REPORT

**No production code was changed during the first pass.** Every finding below was
recorded before anything was fixed, and every fix landed as its own pull request with
its own test.

Three environments, and it matters which claim came from which:

| Environment                                               | What it could answer                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `https://rotaflow.space` (live, read-only)                | headers, TLS, redirects, what the deployed bundle contains, what files really exist               |
| Supabase project `vwqqbdvlskngrqrejzxi` (live, read-only) | catalogue, grants, RLS, `pg_cron`, row counts, advisors                                           |
| A local Supabase stack, `supabase/postgres:17.6.1.143`    | everything that needed writes: RLS as a real role, the publish sequence, clock events, the outbox |

Nothing was written to production. No test organisation was created there; it still
holds **0 organisations, 0 staff, 0 clock events, 1 auth user, 366 audit rows**.

**Every claim below is marked VERIFIED or UNVERIFIED.** Verified means a command was
run and its output read. Where something could not be executed here it says so and
says why, rather than being scored on the code looking correct — the standard's first
non-negotiable rule.

---

## 1. Executive summary

The code is in materially better shape than the 2026-08-14 audit found it. That audit
scored 22/100 and was blocked at the first step: a new customer could not create an
organisation, so eleven of its thirteen workflows were never exercised. All of that is
long fixed, and this audit reached every workflow it set out to test.

What it found instead is a consistent pattern, and the pattern is the finding:

> **Rules that live in the browser, in a codebase whose own documentation says they
> must not.**

`CLAUDE.md` states it: _"a control whose only enforcement is a disabled button is not a
control"_. `docs/SAAS.md` records three occasions where that was learned — plan limits,
the AI entitlement, minimum cover. This audit found three more, and one of them is the
rule the product is named for:

- a staff member could read **next week's unpublished draft rota**, the week where a
  manager is trying out cutting somebody's hours;
- nothing on the server refused a **duplicate clock-in**;
- the **offline outbox belonged to the device, not to the person**, so on a shared ward
  tablet one worker's queued clock-in could be replayed by, or destroyed by, the next
  person to sign in.

Alongside those, a fourth finding is the most consequential and the least visible:
**a database rebuilt from this repository's own migrations does not work.** Production
is fine and always was, for a reason that is not in the repository.

Thirteen of the twenty-two findings are fixed, tested, and open as pull requests. The
other nine are recorded with their diagnosis, and each says plainly whether it is unfixed by
decision or unverifiable from here.

**The release decision is not driven by any of that.** It is driven by the fact that
**production has no backups and has never been restored**, which no amount of code
review changes.

---

## 2. Release decision

# NOT READY FOR PRODUCTION

Not because of the code. Because of three things the standard treats as release
blockers and none of which can be closed inside this repository:

1. **There are no backups of production, and no restore has ever been performed.**
   `pitr_enabled: false`, zero backups, and `backup.yml` has failed on every scheduled
   run since it was written for want of two secrets. The standard is direct about this:
   _"A backup that has never been restored successfully should not be considered a
   proven recovery strategy."_ RotaFlow does not have one to restore.
2. **The legal pages are placeholders and the app ships a live Stripe key.**
   `/legal/terms` renders the `LegalNotice` shell, `/resources` says so publicly, and
   the bundle carries `pk_live_…`. Taking money under placeholder terms is a decision
   for counsel, not for an audit.
3. **Nobody has ever seen a push notification arrive, or a charge complete, on a real
   device.** Both are marked ❓ in the register and both remain so; this audit could not
   change that from a terminal.

**What would move it to READY WITH CONDITIONS:** the three GitHub secrets that arm
`backup.yml` and `auth-config.yml`, one successful restore drill, and a decision on the
Stripe key mode. That is roughly an hour of the owner's time and no engineering.

---

## 3. Score

Scored per the standard's eighteen categories. A category is scored on what was
verified, not on what the code appears to do.

| Category               | Score | Why                                                                                         |
| ---------------------- | ----: | ------------------------------------------------------------------------------------------- |
| Functional reliability |  8/10 | every gate green; core flows exercised locally end to end                                   |
| Data integrity         |  8/10 | three real holes found and closed; concurrency now guarded on every decision path           |
| Authentication         |  8/10 | sound; leaked-password protection still off (GAP-034)                                       |
| Authorisation          |  8/10 | RLS is the boundary throughout; the publication rule was the exception and is now closed    |
| Tenant isolation       |  9/10 | 20 pgTAP assertions across 14 tables, re-run and passing; no escape found                   |
| Rota integrity         |  9/10 | immutability, single-published, minimum cover and now the read boundary all server-side     |
| Publishing             |  8/10 | audited, atomic, notified by trigger; duplicate notification still possible                 |
| Clock-in / out         |  8/10 | duplicates now refused; the 72-hour `event_at` window remains a stated residual             |
| Offline capability     |  8/10 | genuine queue, idempotent, now user-scoped and symmetric across all three writes            |
| Synchronisation        |  8/10 | classified retries, dead letters, bounded; no backoff between reconnects                    |
| PWA implementation     |  8/10 | installable, update path now actually checks; never installed on a real device here         |
| Notifications          |  5/10 | **delivery has never been observed**, and the server outbox has no idempotency key          |
| Mobile UX              |  7/10 | responsive and reduced-motion aware in code; not driven on a physical phone                 |
| Accessibility          |  8/10 | 16 public pages and 26 app screens at WCAG 2 A/AA, zero violations, in CI                   |
| Performance            |  7/10 | budgets enforced every build; never tested against a realistic data volume                  |
| Security               |  8/10 | no secret in the bundle, CSP and headers complete, origin locked, `anon` holds one function |
| Observability          |  7/10 | Sentry with a release tag, health probe, audit log; no alerting on any of it                |
| Recovery               |  1/10 | **no backups, no restore ever performed**                                                   |

**Total: 133 / 180.**

The single score doing the damage is the one that cannot be fixed with code.

---

## 4. Findings

Ordered by severity. Each carries the evidence it was found with.

### P0 — release blockers

**P0-1 · No backups of production, and no restore has ever been performed**
_(GAP-001 / CAP-095, previously recorded, re-verified)_
`pitr_enabled: false`; the backups list is empty; `backup.yml` fails on its 02:40
schedule with `Missing secret(s): SUPABASE_DB_URL BACKUP_PASSPHRASE`. The repository
holds exactly one secret. **VERIFIED** — read live.
Not fixable here: the secrets are the owner's to mint.

**P0-2 · Both scheduled checks have never succeeded** _(GAP-036)_
`backup.yml` and `auth-config.yml` are the only two checks that read live state no pull
request can change, and neither has ever completed. **VERIFIED.** Not fixable here.

### P1 — high

**P1-1 · A database rebuilt from this repository's migrations does not work**
_(GAP-038 — FIXED, #279)_
Every RLS policy in `0002` is `using (public.is_org_member(org_id))`. On a fresh
database, `authenticated` holds no EXECUTE on `is_org_member`, so the policy raises
`permission denied for function` and every row is refused.

```
supabase db reset && supabase test db   →  FAIL, 192 of 364 assertions ran
grant execute on the four RLS helpers   →  PASS, 364 of 364
```

Bisected by resetting to each version in turn: present at `0074`, gone at `0075`, which
closed an `anon` hole with `revoke ... from public, anon` and took `authenticated` with
it, because PUBLIC was the only path by which it had ever held the grant. **Nothing in
this repository has ever granted it.**

Production is unaffected, for a reason that is not in the repository:

```
production   pg_default_acl postgres/public/f = {postgres=X, authenticated=X, service_role=X}
local image                                    = {postgres=X}
```

So every function on production is created already granted. The defect is invisible in
both places anyone looks — production and CI — and appears only in a database built
somewhere else. **That is the database you build when restoring from a backup**, and
P0-1 says there is nothing to restore from, which makes this migration history the
entire recovery path. It also means `db-tests` has been asserting against a privilege
model that is not production's. **VERIFIED**, root-caused, fixed.

**P1-2 · A staff member could read unpublished draft rotas** _(GAP-039 — FIXED, #280)_
`rotas_select` and `shifts_select` were `using (is_org_member(org_id))`; the
draft/published boundary was a `.filter()` applied after the rows had arrived
(`shiftService.ts:66-89`). As `authenticated` with a staff member's `sub` claim — what
PostgREST does for a signed-in user:

```
select name from rotas where status = 'draft';
 → UNPUBLISHED DRAFT — pay cut week
select count(*) from shifts s join rotas r on r.id = s.rota_id where r.status='draft';
 → 1
```

And through the amendment flow — publish, `begin_rota_revision`, move a shift to 23:00 —
the staff member reads the new time before anybody has published it. That is the
standard's _DRAFT ≠ PUBLISHED_ sequence, and it failed. **VERIFIED**, fixed, and both
directions asserted in pgTAP.

**P1-3 · Nothing server-side refused a duplicate clock-in** _(GAP-040 — FIXED, #281)_
Three consecutive `in` rows, no `out` between them, all accepted as the staff member's
own session. `0081`'s idempotency indexes do not cover this: they stop the same event
being replayed, not two genuine events that should not both exist. The damage is not a
crash — `pairClockEvents` absorbs it into a zero-minute segment flagged
`missing_clock_out`, on a timesheet a manager approves for payroll. **VERIFIED**, fixed.

**P1-4 · The offline outbox belonged to the device, not to a user** _(GAP-042 — FIXED, #283)_
IndexedDB is scoped to the origin, so the queue outlives a sign-out — deliberately, since
destroying an unsent clock-in is the one outcome the queue exists to prevent. But it was
unowned. On a shared device the asymmetry is severe: RLS lets a **manager** insert a clock
event for anybody in their organisation, so a manager signing in on a ward tablet would
**successfully land** a colleague's queued clock-in on their behalf, hours late; a **staff
member** signing in on the same tablet fails that check, the failure classifies as
permanent, and the colleague's clock-in is **destroyed** into the dead-letter store — with
a notice on the new person's screen reading "1 action didn't save" about an action they
never took. **VERIFIED** by code and by four new tests; fixed.

**P1-5 · Leave and swap requests were lost on a transient failure** _(GAP-041 — FIXED, #282)_
`ClockInPage` has queued a failed-while-"online" write since BUG-046, because
`navigator.onLine` says true on a captive portal. `LeavePage` and `SwapsPage` queued only
when it was already false, so a transient failure the other side of that check showed
"Please try again" and dropped the work. Neither minted a `client_event_id` before its
first attempt, so a lost response replayed as a **second booking of the same week off**.
**VERIFIED** by reading both paths; fixed, and all three now share one tested helper.

**P1-7 · Enter did not submit any of the four auth screens** _(GAP-045 — FIXED, #287)_
None of `/login`, `/signup`, `/forgot-password` or `/reset-password` contained a `<form>`
element — no `<form>`, no `onSubmit`, no `type="submit"`, no key handler in any of the four.
Every submit was an `onClick` on a `<Button>`, so filling in an email and a password and
pressing Enter did nothing at all, on the most-used screen in the product. The keyboard is
how anybody signing in on a laptop finishes, and how a password manager finishes for them.
**VERIFIED** by grep; fixed. `Button` also now defaults to `type="button"`, because the
moment those screens gained forms, the magic-link button and the show-password toggle were
sitting inside one.

**P1-6 · Stripe ships a live publishable key while no charge has ever completed**
_(the disclosure half FIXED 2026-09-04; the commercial half still open — owner)_
The production bundle carried `pk_live_…`. `docs/SAAS.md` records `STRIPE_TEST_SECRET_KEY`
as absent and CAP-036 as ❓. A live client key with a test secret is a checkout that
cannot work; live with live is real money from a pre-launch product whose terms page is a
placeholder. **VERIFIED** in the bundle; the server-side key mode **cannot be read from
here**.

**The root cause was not configuration, which is what this finding assumed.** No source
file reads `VITE_STRIPE_PUBLISHABLE_KEY`, and `.env.example:130` records it as deliberately
not a variable — yet it was in the bundle. `src/lib/env.ts` read `import.meta.env[key]`, a
dynamic index. Vite replaces `import.meta.env.NAME` by matching that exact text, so a
dynamic lookup cannot be matched and it emits the entire env object instead: **every**
`VITE_*` in whoever's `.env` ran the build shipped, read or not. Removing the line from
`.env` would have fixed this instance and left the mechanism, which is exactly what
happened with the Inngest key a week earlier (HARDEN-011, then HARDEN-013).

Fixed 2026-09-04: the keys are named statically, and `scripts/check-bundle-size.mjs` now
fails the build on any `VITE_*` in `dist/` that `src/lib/env.ts` does not declare. Verified
on the deployed build — exactly nine names, no `pk_live_`. That gate immediately found a
second, smaller thing: the admin console labelled its single sign-on capability
`VITE_OAUTH_PROVIDERS`, a variable that does not exist; it reads `VITE_ENABLE_OAUTH`.

Still open, and still the owner's: the key is _publishable_, so nothing was disclosed that
was not meant to be public — but a live client key on a product that has never completed a
charge is a commercial decision, not a code one. CAP-036 stays ❓.

### P2 — medium

**P2-1 · The public site had no sitemap, canonicals or social cards** _(GAP-043 — FIXED, #284)_
`sitemap.xml` did not exist, and `/sitemap.xml` answered **200 with `index.html`** via the
SPA fallback. `robots.txt` still carried the scaffold's `https://yourdomain.com`. There was
**no `<link rel="canonical">`, no Open Graph and no Twitter card anywhere in the
repository**, so a link pasted into Slack or WhatsApp rendered as a grey rectangle. One
title and one description served all sixteen public pages. **VERIFIED** live; fixed.

**P2-2 · Four public routes had no title and the 404 was a dead end** _(part of GAP-043 — FIXED)_
`/login`, `/signup`, `/forgot-password`, `/reset-password` and the 404 set no title — the
password-reset tab read "RotaFlow — Scheduling certainty for every shift". The 404 was a
bare `<main>` with no nav and no footer, reached by every unknown path. **VERIFIED**; fixed,
and `/forgot-password` and the 404 joined the axe sweep they had never been in.

**P2-3 · The install banner could not be dismissed** _(GAP-044 — FIXED, #285)_
Its own doc comment called it dismissible. It had no close control and rendered on the
marketing pages, asking a first-time visitor to install software for a product they had
not signed up for. **VERIFIED**; fixed, confined to `/app`, dismissal lasts 30 days.

**P2-4 · Nothing ever checked for a new version, and a failed registration was silent**
_(GAP-044 — FIXED, #285)_
A browser checks for a new service worker on navigation. An installed PWA left open for a
week — how a ward tablet is used — may never navigate. `registerSW` also swallowed
registration errors, which lose offline support and the update path together with no
symptom anybody would report. **VERIFIED** by reading `UpdatePrompt`; fixed.

**P2-5 · `cancelLeaveRequest` had no compare-and-set** _(GAP-041 — FIXED, #282)_
A withdraw issued while a manager was approving overwrote the approval, leaving a row
that is `cancelled` and carries a `reviewed_by`. The manager never learned the leave they
granted had gone. **VERIFIED** by code; fixed.

**P2-9 · Every public CTA is a `<button>` inside an `<a>`** _(open)_
23 occurrences of `<Link to=…><Button…>` across the marketing pages, the public nav and the
final CTA band. `<a>` is interactive content and its content model forbids interactive
descendants, so this is invalid HTML and — the part that is felt — **every primary call to
action on the site is two tab stops**. axe does not fire on it: `nested-interactive` checks
roles that require presentational children, and `link` is not one, which is why the sweep is
green. **VERIFIED** by reading all 23 call sites; **UNVERIFIED** in a browser. Not fixed:
correcting it properly means teaching `Button` to render as a link, and changing the shared
button component across 23 call sites at the end of an audit is how an accessibility fix
becomes a visual regression. A contained half-day with a screenshot pass behind it.

**P2-6 · The server notification outbox has no idempotency key** _(open)_
`dispatch_notification_outbox` marks a row `sent` at post time and reconciles afterwards
from `net._http_response`. If the Edge Function delivered and then returned ≥300, or if no
response row is found — `v_resp.status_code is null → 'no response recorded'` — the row
returns to `pending` and is posted again. `send-notification` has no idempotency key and
does a plain insert; `notification_deliveries` has no unique constraint. So the same
notification can be delivered twice. **UNVERIFIED at runtime** — reproducing it needs
`pg_net` responses this environment cannot produce; the mechanism is read from
`0069:205-229` and `send-notification/index.ts:406-412`. The client outbox has keys
(`0081`); the server one does not.
_Proposed fix:_ a `dispatch_key` on the outbox row, carried in the payload, with the
`notifications` insert `on conflict do nothing` against a new unique index — the shape
`0081` already uses on the client side.

**P2-7 · Running the local stack turned `npm run lint` red** _(FIXED, #279)_
`supabase start` drops a Deno entrypoint under `supabase/.temp/` that is in no tsconfig,
and `--max-warnings 0` made it a red build. CI never saw it, because the `verify` job does
not start the stack. Anyone reproducing `db-tests` locally hit it immediately. **VERIFIED**;
fixed.

**P2-8 · Three contradictions inside the register** _(FIXED, #285)_
§5a decision 3 said feature flags "control nothing — 🔴 Still true" against a CAP-076
marked 🟢 closed; decision 10 said `e2e` and `db-tests` are not required checks, which
GAP-003 closed on 2026-08-30; and `HARDEN-010` was used for two different rows. A register
that contradicts itself is the failure it exists to prevent, because the halves are read
months apart. **VERIFIED** by reading it end to end; fixed.

### P3 — low

**P3-1 · `0107` buckets days in UTC where every other migration uses Europe/London** _(open)_
`0107_repeat_rota_weeks.sql` uses `coalesce(l.timezone, 'UTC')`; `0080`, `0083`, `0093` and
`0097` use `coalesce(..., 'Europe/London')`. `locations.timezone` is `not null default
'Europe/London'`, so the fallback only fires for a shift with no location — where, during
BST, repeat-week would place it an hour out. **VERIFIED** by reading all five. Not fixed:
correcting it means a new migration replacing the function, and it was not worth adding a
sixth database change to this batch unreviewed.

**P3-2 · Seven functions have a mutable `search_path`** _(open, downgraded)_
Supabase's advisor reports seven `function_search_path_mutable` warnings. All seven are
**SECURITY INVOKER**, so they run as the caller and the usual escalation argument does not
apply — the advisor does not distinguish. **VERIFIED** against the live catalogue. Worth
tidying, not worth a migration on its own.

**P3-3 · The deployed build is behind `main`** _(FIXED 2026-09-04 — and it was worse than
this row said)_
The live bundle reported `release: "6496966"`; `main` was at `b3e274a`, three commits ahead.
Docs-only commits, but the Sentry release tag is the deployed commit, so error grouping
points at a build that is not the tip. **VERIFIED** in the bundle.

By 4 September the gap was **eight commits and four days**, and it had stopped being a
tagging inconvenience. The live origin was serving 31 August's build, which meant: no
sitemap and no canonicals (#284), no install or update prompt (#285), no per-user offline
outbox (#283), no Enter-key submit on the four auth screens (#287), no focus management on
a failed submit (#288), and — the one that mattered most — a `<link>` to
`fonts.googleapis.com` in the served HTML while `/legal/cookies` said in bold that no
third-party script runs on this site. Every fix existed, was tested and was doing nothing.

Deployed 2026-09-04 at `9ae1a54`, verified by finding the SHA **inside** the served
`index-*.js` rather than inferring it from a filename, and by a live browser session across
six routes contacting no third-party origin except Sentry.

**P3-4 · No cookie consent mechanism** _(open, likely correct)_
There is no banner, and no advertising or analytics cookie to consent to — the app stores
a session and one preference key. Under PECR that is arguably strictly-necessary storage
and needs no consent. **Flagged for legal review rather than resolved**, per the standard's
instruction not to claim compliance.

---

## 5. What was verified and found correct

A good-news result is a finding too, and several of these were the ones most worth
checking.

**Secrets.** The production bundle was downloaded and searched. It contains the anon JWT
(`role: anon`, correct), the VAPID **public** key, the Sentry DSN, the ImageKit public key
and the Stripe **publishable** key. No `service_role`, no OpenRouter key, no Inngest key —
confirming the Inngest retirement reached the deployed bundle, not just the repository.

**Headers and transport.** Full CSP with `script-src 'self'`, HSTS, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, a `Permissions-Policy` that blocks camera, microphone
and payment while deliberately leaving geolocation for `/app/clock`. `http://` 301s to
HTTPS. `/.env` returns 403. `/assets/*` 404s honestly instead of falling back to
`index.html` — the one thing that makes a deploy verifiable.

**Tenant isolation.** `cross_tenant_isolation.test.sql` runs as `authenticated` with a real
`sub` claim across 14 tables plus cross-tenant insert, update and RPC misdirection. 20
assertions, re-run, all passing. Nothing this audit tried escaped a tenant.

**Clocking in for somebody else.** Attempted as a staff member and **correctly refused** by
RLS.

**`anon` exposure.** Exactly one function is executable by `anon` — `preview_invite`, which
the logged-out invitation screen needs. Confirmed against the live catalogue and by the
advisor independently.

**Background jobs.** All four `pg_cron` jobs are active, and `cron.job_run_details` shows
**zero failed runs in the last seven days**.

**Accessibility.** 16 public pages and 26 app screens scanned with axe at WCAG 2 A/AA:
zero violations, light and dark.

**Deployed files.** `security.txt`, `offline.html`, all three PWA icons and `push-sw.js`
were each fetched and confirmed to be real files rather than SPA fallbacks.

---

## 6. Website report

**Conversion — NEEDS ATTENTION, improved.** One primary CTA ("Join the beta"), consistent
across the site, with no competing primary. Pricing is visible without a form. The two
real frictions found were both fixed: the install banner interrupting the marketing pages,
and a 404 with no way back into the site. The remaining weakness is not fixable by
engineering — `TRACTION` and `TESTIMONIALS` are deliberately empty, and that is the right
call for a pre-launch product under the CAP Code.

**UX — PASS.** Navigation resolves everywhere; `navigationTargets.test.ts` now proves it
for the metadata list as well as the tab lists. Mobile nav is a focus-trapped dialog with
Escape handling.

**Accessibility — PASS.** Above, plus `prefers-reduced-motion` honoured and
`eslint-plugin-jsx-a11y` in the lint gate. Not verified: an actual screen reader.

**SEO — PASS after fixes, was FAIL.** Sitemap, canonicals, per-page titles and descriptions,
Open Graph and Twitter cards all now exist and are asserted in e2e. The honest limit is
stated in the code: link-preview scrapers that do not run JavaScript get the site-level
card rather than a per-page one, and fixing that properly means pre-rendering.

**Security — PASS.** Above.

**Performance — NEEDS ATTENTION.** Four budgets enforced on every build with 10–23%
headroom, code-split, fonts preconnected, images through ImageKit. **Never tested against a
realistic data volume:** production holds zero rows, and the standard's large-organisation
test (hundreds of staff, thousands of shifts) has not been run. The seed written for it
was deleted in #120 (`0a92d68`) and `supabase/seed/` no longer exists, so the large-volume
test now needs a generator before it needs a run.

---

## 7. PWA report

The standard asks for installability and offline capability to be assessed separately, and
they land differently.

**Installability — PASS (structurally).** Manifest has `name`, `short_name`, `start_url`,
`scope`, `display`, theme and background colours, 192 and 512 icons plus a maskable 512,
and now `id` and `display_override`. Served over HTTPS. Every Chromium requirement is met.
**Not verified: an actual installation on an actual device.** The standard says
installation behaviour varies by browser and platform and must be tested rather than
assumed; that remains true here.

**Offline capability — PASS with a caveat.** A real queue, not a cache-everything: four
write kinds, idempotency keys, classified retries, a bounded attempt ceiling, a dead-letter
store, and a UI that says plainly "this did not happen, do it again". This audit added the
missing user scoping and the missing symmetry. Reads are `NetworkFirst` with a five-second
timeout and a five-minute TTL, and both tenant-scoped caches are purged on sign-out.
**Not verified: a real device losing signal mid-shift** (❓-004, still open).

**Service worker — PASS after fixes.** `generateSW`, `registerType: 'prompt'`,
`skipWaiting: false` so an update never interrupts work, versioned caches with
`cleanupOutdatedCaches`. Registration errors are now reported and updates now polled.

**Cache inventory.**

| Cache                       | Contents                         | Strategy             | Lifetime          | Sensitive | Cleared on sign-out             |
| --------------------------- | -------------------------------- | -------------------- | ----------------- | --------- | ------------------------------- |
| precache                    | app shell, JS, CSS, icons, fonts | precache             | per build         | no        | n/a, versioned                  |
| `supabase-api`              | `/rest/v1/` responses            | NetworkFirst, 5s     | 5 min, 50 entries | **yes**   | **yes**                         |
| `imagekit-media`            | staff photos                     | CacheFirst           | 30 days, 200      | **yes**   | **yes**                         |
| `google-fonts`              | webfonts                         | StaleWhileRevalidate | —                 | no        | no                              |
| IndexedDB `rotaflow-outbox` | unsent writes                    | —                    | until sent        | **yes**   | **no, deliberately** — see P1-4 |

---

## 8. The fix process, start to finish

Thirteen findings closed across eight pull requests, stacked in the order they must merge.
Every one is green on `verify`, `e2e`, `e2e-authenticated` and `db-tests`.

### #279 — `fix(db): grant EXECUTE in the migration history, not from the image`

- **Problem.** A database rebuilt from `supabase/migrations` refuses every row to every
  signed-in user.
- **Root cause.** `0075` revoked EXECUTE `from public, anon` to close an `anon` hole.
  PUBLIC was the only path by which `authenticated` held EXECUTE on the four RLS helper
  functions, so it lost them too. Nothing in the repository ever granted it explicitly;
  production only works because its `pg_default_acl` grants `authenticated` at creation
  time and the local image's does not.
- **Solution.** `0113` restates production's live grant contract as SQL, read out of its
  catalogue: 88 functions to `authenticated`, all 97 to `service_role`, the nine
  server-only ones left shut. Every statement is a no-op on production.
  `supabase/config.toml` pins the Postgres major version so the image cannot drift again.
- **Files.** `supabase/migrations/0113_*.sql`, `supabase/config.toml`,
  `supabase/tests/database/function_grant_invariants.test.sql`, `eslint.config.js`,
  `.gitignore`, three docs.
- **Test.** `supabase db reset && supabase test db` → **366 assertions, PASS** (was 192 of
  364, FAIL). The new assertion was shown to fail on the real defect: revoking
  `is_org_member` from `authenticated` reports that function by name.
- **Result.** Fixed and verified.

### #280 — `fix(security): put the draft/published boundary in the database`

- **Problem.** A staff member could read draft and amended rotas and their shifts.
- **Root cause.** `rotas_select`/`shifts_select` were membership-only; the boundary was a
  client-side `.filter()` after the fetch.
- **Solution.** `0114`: owners, managers and live delegates see everything; everybody else
  sees `published` and `archived`. `archived` included deliberately — a rota reaches it only
  by having been published, and an abandoned amendment is deleted, not archived, so
  excluding it would erase every staff member's own history. `shifts` goes through a
  `security definer` helper so the rota's RLS is not evaluated twice per row.
- **Files.** `supabase/migrations/0114_*.sql`,
  `supabase/tests/database/rota_publication_boundary.test.sql`, `docs/SAAS.md`.
- **Test.** 7 assertions, both directions. Shown to fail on the real defect: restoring the
  old policy reports `have: 1, want: 0`. Suite 42 files / 373 assertions, PASS.
- **Result.** Fixed and verified. One deliberate behaviour change: a staff member in a
  multi-site organisation no longer sees "draft" because another site is still drafting.

### #281 — `fix(attendance): refuse a duplicate clock-in in the database`

- **Problem.** Three consecutive clock-ins accepted; an orphan clock-out accepted.
- **Root cause.** The state machine that prevented it was `clockStage()` in the browser.
- **Solution.** `0115` refuses an `in` when one is already open **and was recorded within
  the previous five minutes**. Owners, managers and replays are exempt.
- **Two things it deliberately does not do**, both learned by trying the stricter version
  first: refusing any `in` while a session is open strands somebody who forgot to clock out
  last night; and guarding `out` at all is unsafe, because `0068`'s clamp moves an offline
  `in` forward and can reorder it after a genuine `out`. The existing suite caught the second
  within a minute. **Guard the fabrication, never the exit.**
- **Files.** `supabase/migrations/0115_*.sql`,
  `supabase/tests/database/clock_event_sequence.test.sql`, `src/lib/clockRows.ts` (+ test),
  `src/pages/app/ClockInPage.tsx`.
- **Test.** 6 assertions, half of them asserting what the guard must **not** refuse. 43 files
  / 379 assertions, PASS. 811 unit tests.
- **Result.** Fixed and verified.

### #282 — `fix(offline): queue a leave or swap request that fails while "online"`

- **Problem.** A transient failure on leave or swaps dropped the work and could duplicate it.
- **Root cause.** Both queued only on `!navigator.onLine`, and neither minted an idempotency
  key before its first attempt.
- **Solution.** `sendOrQueue` in `src/lib/queuedWrite.ts` — pure, with `send`, `queue` and
  `isTransient` injected — now used by all three pages. Both mint the key first.
  `cancelLeaveRequest` gains the compare-and-set the other decision paths already had.
- **Test.** 4 new unit tests including the one that matters: a permanent refusal is rethrown,
  not queued. 815 unit tests.
- **Result.** Fixed and verified.

### #283 — `fix(offline): the outbox belongs to a user, not to a device`

- **Problem.** On a shared device the next person to sign in replayed, or destroyed, the
  previous person's queued writes.
- **Root cause.** IndexedDB is per-origin; records carried no owner.
- **Solution.** Every record carries the queueing user's id; flush, list and retry are scoped
  to it. A record with no owner is claimable, because stranding a clock-in forever is worse
  than replaying one and there is no second copy. `session.ts` now says in the file why the
  outbox is not cleared on sign-out.
- **Test.** 4 new tests: not replayed, not displayed, not retryable, legacy record still
  claimed. 819 unit tests.
- **Result.** Fixed and verified.

### #284 — `fix(seo): give the public site a sitemap, canonicals and a link preview`

- **Problem.** No sitemap, no canonicals, no social cards, one title for sixteen pages, five
  pages with no title, a dead-end 404.
- **Root cause.** Nothing owned per-route metadata; `MarketingLayout` set only the title.
- **Solution.** `src/lib/publicRoutes.ts` as one list feeding three consumers: a build-time
  sitemap plugin, `usePageMetadata`, and `navigationTargets.test.ts` — because a sitemap
  advertising a URL that renders the 404 page is worse than no sitemap. `og-image.png` is
  generated from the real `BrandMark` geometry, and excluded from the precache (it cost 8% of
  the budget for a file no screen renders). The 404 gets the nav, the footer and `noindex`.
- **Test.** 20 new unit assertions, 16 new e2e. `/forgot-password` and the 404 joined the axe
  sweep. 839 unit tests, 49 e2e.
- **Result.** Fixed and verified. One CodeQL alert during review — `js/incomplete-sanitization`
  on a regex built by escaping a path — was correct and is fixed by resolving the expected URL
  instead.

### #285 — `fix(pwa): let people dismiss the install banner, and actually check for updates`

- **Problem.** Undismissable banner on the marketing pages; silent registration failures;
  no update check for a session that never navigates.
- **Solution.** Banner confined to `/app` and `/onboarding` with a close button and a 30-day
  snooze stored per device; `onRegisterError` reported to Sentry; `registration.update()`
  hourly; manifest `id` and `display_override`.
- **Test.** 6 new unit tests, run in Node with an injected store rather than jsdom — whose
  default `about:blank` origin has no `localStorage`, so the DOM version failed for a reason
  unrelated to the code. 845 unit tests, 76 e2e.
- **Result.** Fixed and verified.

### #287 — `fix(auth): Enter did not submit any of the four auth screens`

- **Problem.** Enter did nothing on `/login`, `/signup`, `/forgot-password` or
  `/reset-password`.
- **Root cause.** No `<form>` element on any of them; every submit was an `onClick`.
- **Solution.** A real `<form onSubmit>` on each, `noValidate` because the messages are ours
  and are wired to the fields. `Button` defaults to `type="button"`, since the magic-link
  button and the show-password toggle now sit inside the sign-in form and the HTML default
  would have made either of them sign the person in.
- **Test.** 4 e2e assertions, structural rather than behavioural on purpose — a behavioural
  test would submit real credentials against whatever project the run points at. 80 e2e.
- **Result.** Fixed and verified.

### #285 also carries — `docs: three contradictions in the register`

Feature flags, required checks, and a duplicated `HARDEN-010`. Corrected.

---

## 9. Regression results

Run against the top of the stack, after every change:

| Gate                       | Result                                         |
| -------------------------- | ---------------------------------------------- |
| `npm run typecheck`        | pass                                           |
| `npm run lint`             | pass, zero warnings                            |
| `npm run format:check`     | pass                                           |
| `npm test`                 | **845 passed**, 47 files (was 808 / 45)        |
| `npm run build`            | pass                                           |
| `npm run check:bundle`     | pass — precache 681 KiB / 760, entry 134 / 175 |
| `npm run check:migrations` | pass                                           |
| `npm run check:docs`       | pass                                           |
| `npm run check:export`     | pass                                           |
| `npx playwright test`      | **80 passed**, 1 skipped (was 60)              |
| `supabase test db`         | **43 files, 379 assertions, PASS**             |

Every pass-1 test that produced a finding was re-run afterwards: the draft rota now returns
0 rows to a staff member, the amendment sequence returns 0, the second clock-in is refused,
and the whole pgTAP suite runs where 172 assertions previously could not.

No regression was found in the manager paths: `rota_revisions`, `minimum_cover`,
`open_shift_claims` and `cross_tenant_isolation` all still pass.

---

## 10. Remaining risks

**Not fixed, deliberately:**

- P2-6, the server notification outbox has no idempotency key. Diagnosed, with a proposed
  fix; not implemented because it could not be verified at runtime here and an unverifiable
  change to the notification path is how that subsystem broke last time.
- P3-1, `0107`'s UTC fallback. A sixth database change, unreviewed, was the wrong trade.

**Cannot be verified from here — needs the owner, a device, or a card:**

- Backups and a restore drill (P0-1). **This is the release blocker.**
- The three GitHub secrets that arm the scheduled checks (P0-2).
- Whether the Stripe secret is live or test (P1-6).
- A push notification arriving on a real handset (❓-007).
- A real charge completing (❓-002).
- Offline behaviour on a real device losing signal mid-shift (❓-004).
- Installation on iOS, Android, Chrome desktop and Edge (§21 of the standard).
- Performance against a realistic data volume — the 248-staff seed has never been run.
- Legal review of the placeholder Terms, and of cookie consent.

**Process note.** The stacked pull requests must merge in order: #279 → #280 → #281 → #282
→ #283 → #284 → #285 → #286 → #287. CodeRabbit skipped the eight stacked ones, because it does not review a
PR whose base is not `main`; each retargets to `main` automatically as its parent merges, and
should be given a review pass then.

---

## 11. Recommended order

1. Mint `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` and `SUPABASE_ACCESS_TOKEN`, and watch
   `backup.yml` go green. Then restore that dump into a scratch project and open the app
   against it. Until that has happened once, the recovery score stays at 1.
2. Merge #279 first and on its own. It is the one that makes the restore in step 1 produce a
   working database rather than a locked one.
3. Merge #280 through #285 in order.
4. Decide the Stripe key mode, and get the Terms in front of counsel.
5. Then the device work: install it, receive a push, lose signal on a shift, complete a
   charge. Four of the register's ❓ rows close in an afternoon with a phone.

---

## Appendix A — the 2026-08-14 audit, preserved

Kept verbatim because `docs/SAAS.md` §6 states that BUG-001 to BUG-042 "deliberately have no
rows here — the two sequences collide" and that this file "is a dated record of testing
performed and remains the place they live". Deleting it would orphan forty-two identifiers
the register points at.

Its verdict is superseded by this document. Its findings are not: BUG-002 and BUG-004 were
open when it was written and this audit did not re-test them.

---

### RotaFlow — Full QA / E2E / CRUD / Production-Readiness Audit

**Auditor:** rotaflow-qa-auditor (autonomous agent)
**Date:** 2026-08-14
**Target:** `http://localhost:5042` (dev server, live-wired to the real `rotaflow` Supabase project, ref `vwqqbdvlskngrqrejzxi`, region `eu-west-1`) — **not production**
**Methodology:** `docs/Working-Agent.md`, followed in full
**QA test identity used:**

- Organisation name attempted: `QA RotaFlow Test Organisation 20260814-141047`
- Test account (confirmed, used for all testing): `scriptural.os+rfqa20260814141047@gmail.com`
- A second sign-up attempt with `gakinz101+rfqa20260814141047@gmail.com` was abandoned unconfirmed after discovering the Gmail MCP tool available in this session is connected to the `scriptural.os@gmail.com` inbox, not `gakinz101@gmail.com` — that unconfirmed `auth.users` row is harmless leftover test data (see §15).
- Org B for the multi-tenant test was never created — blocked by BUG-001 before it could exist.

---

> ⚠️ **Status as of 2026-08-20: P0 (BUG-001, org creation broken) is FIXED.**
> Migrations `0048_restore_org_creation_bootstrap.sql` and
> `0049_fix_org_bootstrap_correlation.sql` restore and correctly qualify the
> `organisations_select` bootstrap clause this report diagnosed in §4 — the
> shipped fix is nearly verbatim this report's own recommended SQL (§16). A
> new organisation can be created again. This report's other findings
> (BUG-002 onboarding-draft-lost-on-refresh, BUG-004 Platform Console
> fabricated data) were **not** part of the P0 and remain open at last check —
> see **`docs/SAAS.md`** for current per-feature status — it became the single plan of
> record on 2026-08-29 and this line pointed at `docs/PRD.md`/`docs/LOOP.md` until 2026-08-31. **No
> regression test exists yet** for the org-creation-by-a-zero-membership-user
> path this report's own recommended fix (§16) called for — this bug can
> recur silently. The rest of this report is a point-in-time snapshot from
> 2026-08-14 and should not be read as reflecting the current NOT READY /
> 22-100 verdict.

#### 1. Executive Summary

**Overall status: NOT READY.**
**Quality score: 22 / 100.**

A brand-new customer can sign up, verify their email, and reach the "Create your organisation" step of onboarding — and then the product stops working. **Every attempt to create an organisation fails**, on every retry, for every account, with no workaround reachable through the UI. Because RotaFlow requires an organisation to do anything (build a rota, add staff, clock in, request leave — all of it is `org_id`-scoped), this single defect (BUG-001, P0) makes the entire product unusable for a new customer starting from zero. It is not a UI glitch — it is fully root-caused at the database/RLS level (§4), and it is a **regression of a bug that RotaFlow's own migration history already found and fixed twice** (`0003_fix_organisations_select_rls.sql`, then narrowed safely in `0005_narrow_organisations_select_rls.sql`), silently undone by a later migration (`0031_platform_metadata_reads.sql`).

Everything downstream of organisation creation — Phase 5 CRUD audit, Phase 7 rota lifecycle (draft → publish → clock-in → timesheet → approve → report), the multi-tenant security test, availability/leave/swaps/overtime, announcements, and most of the Phase 3 navigation inventory — could not be exercised as a genuine new customer, because there is no legitimate (non-cheating) way to get past this screen. Per the audit's DO NOT CHEAT rule, none of it was faked via direct SQL inserts; it is honestly reported as **BLOCKED — UPSTREAM P0** throughout this report, not as PASS.

What _was_ reachable is, encouragingly, solid: the marketing site, sign-up flow (validation, password strength, email confirmation via real Supabase Auth email), login, 404 handling, route guarding for an org-less authenticated user, and the general engineering hygiene (clean console, sensible error copy, careful RLS commentary in the migration history) all point to a team that builds carefully. The problem is narrow, well-understood, and has an exact, low-risk fix (§4, §16) — this is a bad day, not a bad codebase.

**The one-line answer to the audit's central question:** _No._ A completely new customer cannot get past step 1 of setting up their organisation today, so no part of the rest of the promised workflow (rota build → publish → clock-in → leave → reports) is reachable from zero.

---

#### 2. Test Coverage

| Area                                 | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 — Application startup        | Done. Cold load, console, network, 404 route, refresh, hard reload all checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Phase 2 — First-run experience       | Done through org creation; blocked at "create organisation." Sign-up validation (empty/invalid email/weak password/duplicate-attempt awareness), email confirmation via real inbox, login, logout/re-login persistence all verified.                                                                                                                                                                                                                                                                                                            |
| Phase 3 — Navigation audit           | Partial. Full route table extracted from source (35+ routes). Only public routes + auth + stuck-onboarding screen actually walked; everything under `/app/*` requiring an org is **BLOCKED — UPSTREAM P0**.                                                                                                                                                                                                                                                                                                                                     |
| Phase 4 — Every-button test          | Partial. Buttons on landing, sign-up, onboarding step 1, login exercised (including double-submit/retry). Everything past onboarding **BLOCKED**.                                                                                                                                                                                                                                                                                                                                                                                               |
| Phase 5 — CRUD audit (23 entities)   | **BLOCKED — UPSTREAM P0** for all entities except Organisation itself (Create = FAIL, everything else unreachable).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phase 6 — Persistence                | Done for what's reachable: onboarding failure state does _not_ survive refresh (form resets, arguably correct), but the _stuck-at-step-1_ state correctly survives logout/re-login (server-side, confirmed via DB — good finding).                                                                                                                                                                                                                                                                                                              |
| Phase 7 — Rota live-ops lifecycle    | **BLOCKED — UPSTREAM P0.** None of draft/publish/clock-in/timesheet/approve/report reachable.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Multi-tenant security test           | **BLOCKED — UPSTREAM P0.** Org A could not be created, so Org B and the cross-org access test could not run.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Offline / PWA                        | **BLOCKED — BY DESIGN IN THIS ENVIRONMENT.** `vite.config.ts` sets `VitePWA({ devOptions: { enabled: false } })` — the service worker is deliberately disabled in `npm run dev`. Confirmed 0 service worker registrations. Requires a production build to test; not a defect.                                                                                                                                                                                                                                                                   |
| Destructive/high-consequence actions | **BLOCKED — UPSTREAM P0** (no staff, rota, or org to act on).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Recovery testing                     | Partial — recovery from a _failed org-creation_ was tested repeatedly (deterministic failure, no corrupted state, no orphaned rows — confirmed via DB). Mid-publish/mid-clock-in recovery **BLOCKED**.                                                                                                                                                                                                                                                                                                                                          |
| Error/empty/loading states           | Partial — sign-up and onboarding error/loading states checked and are good. Rest **BLOCKED**.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| UI/UX vs `docs/DESIGN.md`            | Partial — spot-checked on reachable screens only; no obvious token violations seen.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Responsive                           | Partial — landing page checked at mobile/tablet/desktop (375/768/1280), no horizontal overflow found. Rota builder / schedule / clock-in (the highest-risk mobile surfaces per the brief) **BLOCKED**.                                                                                                                                                                                                                                                                                                                                          |
| Accessibility                        | Not independently re-run — memory indicates existing Playwright+axe CI coverage for 13 public pages at 0 violations; authenticated app screens **BLOCKED**, so the "extend the same rigor" ask could not be completed this session.                                                                                                                                                                                                                                                                                                             |
| Performance                          | Partial — page-load and route-transition times observed as fast (<200ms typical) on all reachable screens; the 100-staff/500-shift rota-builder stress scenario **BLOCKED**.                                                                                                                                                                                                                                                                                                                                                                    |
| Console/network audit                | Done continuously throughout. Zero JS errors on landing/signup/login. Two console errors surfaced during the onboarding failure (expected 403s from the failed insert) plus one unexplained 401 (§4, BUG-003, SUSPECTED).                                                                                                                                                                                                                                                                                                                       |
| Cross-screen consistency             | **BLOCKED — UPSTREAM P0** (nothing to propagate).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Data integrity                       | Confirmed no orphaned rows result from the repeated failed org-creation attempts (§4) — the failure rolls back cleanly.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Feature gap analysis                 | Done at a source/route-table level (§14); functional depth **BLOCKED**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Seed/demo data audit                 | Done (§15) — this dev environment holds 3 pre-existing organisations in the shared Supabase project, consistent with prior memory of "3 real is_demo-mis-flagged orgs" from production teardown. None were touched, used, or relied upon for any pass/fail claim in this report.                                                                                                                                                                                                                                                                |
| Super Admin / Platform Console       | Visually spot-checked only, via the documented **DEV-only** `/admin-preview` harness (renders the console without a login). This is **not equivalent to authenticated functional testing** — no login gate, no role-permission boundary, and no mutation was exercised through it. Used strictly to confirm the console's screens exist and render (Overview, Organisations, Users, Subscriptions, Billing, Support Centre, Support Access, Incidents, Integrations, Notifications, Audit Logs, Feature Flags, GDPR & Data, Platform Settings). |

**Time-boxing — what was explicitly NOT reached, per the priority order given:** Phase 4 exhaustive every-button testing beyond onboarding, offline/PWA in a built (non-dev) instance, destructive-action testing, interrupted-mutation recovery, full accessibility re-audit of authenticated screens, and the AI rota assistant (`supabase/functions/ai-rota-assistant`) JWT-forwarding/RLS test. All of these require an organisation to exist, which BUG-001 prevents. No amount of remaining time budget would have changed this — the blocker is structural, not a matter of testing more screens.

---

#### 3. Bug Summary

| Severity              | Count | IDs                 |
| --------------------- | ----- | ------------------- |
| P0 — Blocker/Critical | 1     | BUG-001             |
| P1 — High             | 0     | —                   |
| P2 — Medium           | 1     | BUG-004 (SUSPECTED) |
| P3 — Low              | 2     | BUG-002, BUG-005    |
| P4 — Cosmetic         | 1     | BUG-003 (SUSPECTED) |

No P1s were _found_, but that is largely because BUG-001 prevented the entire surface area where P1s (broken publish, broken clock-in, broken leave approval) would normally be found. Treat the P1 row as **unknown, not clean** — see §16.

---

#### 4. Critical Findings

##### BUG-001 — P0 — New organisation creation is completely and permanently broken

- **Area:** Onboarding / Organisation service (`src/services/orgService.ts`, `src/pages/OnboardingPage.tsx`)
- **Feature:** Step 1 of onboarding — "Create your organisation"
- **Environment:** `localhost:5042` dev server against live Supabase project `vwqqbdvlskngrqrejzxi` (same project the audit was told to treat as authoritative; this is a database-level RLS defect, not a dev-only artifact — it will reproduce identically in production)
- **Role:** Any newly-registered, email-confirmed user (Organisation Owner-to-be)
- **Preconditions:** Fresh account, no existing organisation
- **Steps to reproduce:**
  1. Sign up with a new email, confirm it via the emailed link (real Supabase Auth email, verified end-to-end via Gmail).
  2. Land on `/onboarding`, fill in Organisation name / industry / size (any valid values).
  3. Click **Continue**.
- **Expected result:** Organisation is created; user proceeds to step 2 ("About your organisation").
- **Actual result:** Toast/inline error: _"Could not create the organisation. Please try again."_ User remains on step 1. Reproduced **100% deterministically** across repeated attempts, across two different accounts, and via direct SQL simulation of the exact same request — never once succeeded.
- **Evidence:**
  - Browser console at the moment of failure: `Failed to load resource: the server responded with a status of 403 ()` on `POST https://vwqqbdvlskngrqrejzxi.supabase.co/rest/v1/organisations?select=*`.
  - Calling the app's own `createOrganisation()` function directly (same code path the UI uses) returns: `{"message":"new row violates row-level security policy for table \"organisations\"","details":null,"code":"42501","hint":null}`.
  - **Root cause, fully isolated at the SQL level** (read-only `supabase db query --linked`, no writes committed — see below):
    - The live `organisations_insert` policy (`with check (auth.uid() = created_by)`) is correct and passes.
    - The problem is the **`organisations_select`** policy, which PostgreSQL also evaluates against `INSERT ... RETURNING` (which is exactly what `.insert({...}).select('*').single()` compiles to via PostgREST).
    - The currently deployed `organisations_select` policy is:
      ```sql
      using (public.is_org_member(id) or public.is_platform_admin())
      ```
    - A brand-new organisation has **no membership row yet** — the owner membership is only created by the `on_org_created` AFTER INSERT trigger (`handle_new_org()`), and Postgres's RLS check for the `RETURNING` clause does not see that trigger's effect in time. So `is_org_member(id)` is `false`, the creator isn't a platform admin, and the `RETURNING` projection fails RLS — which aborts the whole `INSERT` and rolls it back.
    - **This is not a new bug for RotaFlow — it's a regression of one already found and fixed twice:**
      - `supabase/migrations/0003_fix_organisations_select_rls.sql` — added `or created_by = auth.uid()` specifically to fix this exact bootstrap race, with a detailed comment explaining it.
      - `supabase/migrations/0005_narrow_organisations_select_rls.sql` — narrowed that clause (only while no membership row exists yet) to close a permanent-backdoor concern, while explicitly preserving the bootstrap window.
      - `supabase/migrations/0031_platform_metadata_reads.sql` — added `is_platform_admin()` visibility for the Platform Console, but **dropped the `created_by` bootstrap clause entirely** in the process. Its own comment even says _"The permanent creator backdoor 0005 closed stays closed"_ — the author appears to have read 0005 as "close the backdoor" without registering that 0005 also _kept the bootstrap window open_ (that was the whole point of narrowing rather than removing it). The result: the exact `0003` bug is back.
    - **Proof the diagnosis is exact:** running the identical `INSERT ... RETURNING` at the SQL level with `role authenticated` and `request.jwt.claims` set to the real user's `sub` fails with the same `42501`; the _same insert without `RETURNING`_ succeeds. All test statements were run inside `begin ... rollback` or without a `RETURNING`/commit path — **no data was written**; confirmed after the fact via `select count(*) from organisations` = 3 (the same 3 pre-existing orgs noted in §15, unchanged).
  - Retried via the real UI a second time (same session) — identical failure, identical error text.
  - Duplicate/rapid-click handling: the **Continue** button correctly shows "Creating account…"/disables during the sign-up submit; the onboarding Continue button was not caught mid-flight for a true double-click race, but repeated sequential clicks each independently fail the same way — no duplicate/partial organisation rows were ever created (confirmed via DB).
- **Frequency/reproducibility:** 100%, every attempt, every account.
- **Likely cause:** `supabase/migrations/0031_platform_metadata_reads.sql`, lines ~37–45, dropped the `created_by = auth.uid() and not exists (select 1 from memberships where org_id = id)` clause that `0005_narrow_organisations_select_rls.sql` had established as the correct, safe bootstrap fix.
- **Impact:** Total. No new customer, in production or anywhere else this schema is deployed, can create an organisation. This is the single most important finding in this audit — it blocks 100% of the product's value proposition for any new signup.
- **Recommended fix:** Restore the bootstrap clause in the current policy definition, e.g.:
  ```sql
  drop policy if exists organisations_select on public.organisations;
  create policy organisations_select
    on public.organisations for select
    using (
      public.is_org_member(id)
      or public.is_platform_admin()
      or (
        created_by = auth.uid()
        and not exists (select 1 from public.memberships m where m.org_id = id)
      )
    );
  ```
  Ship as a new migration (do not hand-edit `0031`), and add a regression test that specifically exercises `insert ... select().single()` as a freshly-authenticated user with zero memberships — the exact shape of test that would have caught this the moment `0031` was written.
- **Regression test:** Sign up a new user, confirm email, attempt organisation creation through the onboarding UI, assert step advances to "About your organisation" and the org row exists with the creator as an active owner. Add this as an automated E2E test given how easily this specific regression slipped back in once already.

##### BUG-004 — P2 (SUSPECTED) — Platform Console "Total organisations" figure does not match the database

- **Area:** Platform Console → Overview (`/admin-preview`, and presumably the authenticated `/app/platform` overview it mirrors)
- Console showed **"Total organisations: 6"**; a direct read-only count against `public.organisations` in the same live project returned **3**.
- Not root-caused (out of time-box) — could be a stale/cached demo figure, a different counting basis (e.g., including soft-deleted or a differently-scoped table), or a genuine query bug in `src/lib/adminOverviewDemo.ts` (a file the console's own footer explicitly names as the source of its placeholder figures — churn and system-health history are labelled placeholder there, but the organisation count is claimed as "real"). Flagged as **SUSPECTED**, not confirmed, and reported via the DEV-only preview harness rather than an authenticated session, which is itself a caveat on this finding.
- **Recommended action:** Verify the overview query's source and whether it's reading a stale materialized view, a cached snapshot, or double-counting.

##### BUG-002 — P3 — Onboarding step 1 form values are lost on refresh

- Refreshing `/onboarding` while on step 1 resets Organisation name / industry / size to blank, rather than restoring the in-progress draft. Minor, but combined with BUG-001 it means a user who refreshes while troubleshooting the "Could not create the organisation" error has to retype everything on every attempt.

##### BUG-005 — P3 — No client-side duplicate-tab / stale-session guard observed on the stuck onboarding screen

- Not a discovered failure so much as an untested risk: because organisation creation never succeeds, the "two managers/two tabs" class of race conditions this audit is meant to probe (Phase 7, "Test case generation") could not be exercised at all. Recorded here as a coverage gap rather than a confirmed defect — re-test once BUG-001 is fixed.

##### BUG-003 — P4 (SUSPECTED) — Unexplained console `401` during the auth/onboarding flow

- One `Failed to load resource: the server responded with a status of 401 ()` was logged in the browser console during the session, timestamped between the email-confirmation redirect and the first organisation-creation attempt. It did not visibly break anything (no user-facing error, no stuck UI beyond BUG-001 itself), and was not reliably isolated to a specific request given the volume of background calls onboarding makes. Reported as **SUSPECTED** per the audit's instructions for a suspected-but-not-conclusively-reproduced issue; worth a look at whatever fires immediately after PKCE email-confirmation redirect, in case of a benign token-not-yet-refreshed race.

---

#### 5. CRUD Completeness

Per the audit's rule, seed/demo data is never accepted as evidence of CRUD, and nothing here is marked PASS without an actual UI demonstration.

| Entity                  | Create     | Read                                 | Update     | Delete/Archive | Persist    | Notes                                                                                                                |
| ----------------------- | ---------- | ------------------------------------ | ---------- | -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Organisation            | **FAIL**   | BLOCKED                              | BLOCKED    | BLOCKED        | N/A        | BUG-001. This is the root blocker for every row below.                                                               |
| Membership              | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | Depends on Organisation.                                                                                             |
| Staff                   | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Location                | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Department              | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Shift type              | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Shift template          | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Rota                    | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Shift                   | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Availability            | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Leave request           | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Shift swap              | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Overtime request        | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Clock event             | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Timesheet               | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Announcement            | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Notification            | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Notification preference | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Report                  | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Role                    | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Permission              | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Integration             | BLOCKED    | BLOCKED                              | BLOCKED    | BLOCKED        | BLOCKED    | "                                                                                                                    |
| Support case            | Not tested | Screen present (unauth preview only) | Not tested | Not tested     | Not tested | Platform-level entity; not gated by BUG-001, but no platform-admin credentials were available to test authenticated. |
| Feature flag            | Not tested | Screen present (unauth preview only) | Not tested | Not tested     | Not tested | Same as above.                                                                                                       |
| Platform administrator  | Not tested | Screen present (unauth preview only) | Not tested | Not tested     | Not tested | Same as above.                                                                                                       |

**Verdict for Phase 5: FAIL.** The single most fundamental entity in the system — Organisation — fails Create, which cascades to every dependent entity by construction (RLS scopes everything to `org_id`; nothing else can exist without one).

---

#### 6. Screen-by-Screen Report

| Screen                                                                                                                                                       | Route                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing page                                                                                                                                                 | `/`                                          | PASS — loads clean, no console errors, all CTAs present and correctly routed                                                                                                                                                                                                                                                                                                                                |
| 404                                                                                                                                                          | any unknown path                             | PASS — proper "This page doesn't exist" state, no console error, "Back home" link works                                                                                                                                                                                                                                                                                                                     |
| Sign up                                                                                                                                                      | `/signup`                                    | PASS — empty-state validation (Create account disabled until valid), invalid-email inline error with clear title text, live password-strength checklist (8+ chars / number / uppercase / symbol, each independently tracked), successful submit shows loading state then "Check your email to confirm your account," real email delivered and confirmed end-to-end                                          |
| Email confirmation                                                                                                                                           | Supabase-hosted `/auth/v1/verify` → redirect | PASS — correct redirect to `/onboarding` after confirming                                                                                                                                                                                                                                                                                                                                                   |
| Onboarding step 1 — Create organisation                                                                                                                      | `/onboarding`                                | **FAIL** — BUG-001. Field validation, slug availability check ("… is available"), and industry/size selectors all work; submission itself is broken                                                                                                                                                                                                                                                         |
| Onboarding steps 2–5                                                                                                                                         | `/onboarding` (stepper)                      | BLOCKED — never reached                                                                                                                                                                                                                                                                                                                                                                                     |
| Login                                                                                                                                                        | `/login`                                     | PASS (functionally) — successful sign-in with the confirmed test account correctly re-routes back to the exact same stuck onboarding step, proving org-less state is persisted server-side, not just client-side. One tooling note, not an app bug: the page renders two DOM nodes matching a naive "Sign in" text selector (worth a `data-testid` for test-authoring convenience, not a user-facing issue) |
| `/app/dashboard` (direct URL, org-less user)                                                                                                                 | `/app/dashboard`                             | PASS — correctly redirected back to `/onboarding` rather than rendering a broken or partially-authorized dashboard; no security bypass observed                                                                                                                                                                                                                                                             |
| Platform Console (all sub-screens)                                                                                                                           | `/admin-preview` (DEV-only, unauthenticated) | Screens render (Overview, Organisations, Users, Subscriptions, Billing, Support Centre, Support Access, Incidents, Integrations, Notifications, Audit Logs, Feature Flags, GDPR & Data, Platform Settings) — **not functionally tested**, no login gate exercised                                                                                                                                           |
| Everything under `/app/*` requiring an org (schedule, staff, leave, swaps, overtime, timesheets, announcements, reports, settings, roles, permissions, etc.) | various                                      | **BLOCKED — UPSTREAM P0**                                                                                                                                                                                                                                                                                                                                                                                   |

---

#### 7. End-to-End Workflow Report

| Workflow                                 | Result                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| Sign-up → email verification             | **PASS**                                                |
| Organisation creation / owner assignment | **FAIL** (BUG-001)                                      |
| Staff / location / department creation   | BLOCKED                                                 |
| Rota build → publish                     | BLOCKED                                                 |
| Staff schedule view                      | BLOCKED                                                 |
| Availability submission                  | BLOCKED                                                 |
| Leave request → approval                 | BLOCKED                                                 |
| Shift swap → accept/decline              | BLOCKED                                                 |
| Overtime request → approval              | BLOCKED                                                 |
| Clock-in/out → timesheet                 | BLOCKED                                                 |
| Timesheet approval                       | BLOCKED                                                 |
| Reports/export                           | BLOCKED                                                 |
| Super Admin workflows                    | BLOCKED (no credentials; screens visually present only) |

---

#### 8. Live Rota Safety

Could not be assessed — there is no rota, because there is no organisation. This section cannot respond PASS to any of the brief's specific questions (safe publish, draft-vs-published clarity, unpublish/correct, recovery from interrupted publish, stale-data risk) and none should be inferred as safe from the code alone. **BLOCKED — UPSTREAM P0.** Recommend this be the first thing re-tested once BUG-001 ships a fix, given the brief's own framing of this as "the highest-risk workflow in the product."

---

#### 9. Offline Report

**BLOCKED — BY DESIGN IN THIS ENVIRONMENT, not a defect.** `vite.config.ts` explicitly sets `VitePWA({ devOptions: { enabled: false } })`, with a comment noting it can be flipped on to debug the service worker in dev. Confirmed 0 active service worker registrations against `navigator.serviceWorker.getRegistrations()`. Testing offline queueing, sync-on-reconnect, and duplicate-action prevention requires a production build (`npm run build` + serve `dist/`), which was outside this session's scope given the instruction to test against the running dev server. **Recommend a follow-up audit pass specifically against a built artifact** — this is the single largest gap in this report's coverage of the brief.

---

#### 10. Security Report

- **Multi-tenant isolation verdict: NOT DETERMINED — BLOCKED.** The single most critical test in the entire brief (Org A vs Org B cross-tenant access) could not run because Org A itself could never be created. This is not a pass and must not be read as one. It needs to be the **first** thing re-tested the moment BUG-001 is fixed, given how existentially important tenant isolation is for RotaFlow's model.
- **Route guarding:** PASS on what was testable — an authenticated, org-less user hitting `/app/dashboard` directly was correctly bounced back to `/onboarding`, not shown a broken or partial view. No privilege-escalation or IDOR surface was reachable to test beyond this, since nothing exists yet to escalate into.
- **`service_role` key exposure:** Not found in any client-served file. The client bundle (dev-served, unminified) exposes only the `anon` key via `VITE_SUPABASE_ANON_KEY`, which is by design safe to expose (RLS-gated) — confirmed this is genuinely the anon key (JWT `role` claim = `anon`), not a service key.
- **RLS engineering quality (general observation):** The migration history shows real security discipline — `0003`/`0005` show the team correctly identifying and narrowing a permissive bootstrap exception rather than leaving a permanent backdoor. BUG-001 is a regression _introduced while adding platform-admin visibility_, which is exactly the kind of change that deserves a "does this still let a brand-new user create their first org" regression test going forward (§4, §16).
- **AI rota assistant JWT-forwarding test (`supabase/functions/ai-rota-assistant`):** **BLOCKED** — requires an org and staff data to prompt meaningfully.
- **Injection / excessive error detail:** Not exhaustively tested beyond the reachable forms (sign-up, login, onboarding step 1), which use standard controlled inputs and returned clean, human-readable errors (no raw Postgres codes or stack traces surfaced to the user, even for the BUG-001 failure — the UI correctly showed a generic human message while the technical detail stayed in the console, which is the right behavior per the brief's error-message rule).

---

#### 11. Performance Report

Limited by scope. On all reachable screens: initial paint and route transitions were fast (dev-server HMR aside, typically sub-200ms for API calls per the network log), no duplicate network calls were observed on the sign-up/onboarding flow, and no obvious N+1 pattern was visible in the request log (the onboarding page issues a small, flat set of GETs for profile/memberships/platform-role, not a fan-out). The brief's specific stress scenario (100+ staff, 500+ shifts in the rota builder) is **BLOCKED — UPSTREAM P0** and unassessed.

---

#### 12. Accessibility Report

Not independently re-run this session. Per project memory, Playwright + axe-core CI coverage already exists for the 13 public marketing pages at 0 contrast violations. The brief specifically asks to "extend the same rigor to authenticated app screens" — that could not be done, since none of the authenticated app screens beyond the stuck onboarding step were reachable. Spot-checked onboarding step 1 by eye only: form fields have visible labels, the disabled-state Continue button is visually distinguished, and the password-strength checklist pairs each requirement with text (not colour alone). No formal axe run was performed against it.

---

#### 13. UX/UI Report

On the screens that were reachable, the implementation reads as consistent with a considered design system: consistent button/input radii and spacing, a real password-strength component (not just a strength bar), clear step indicators in the onboarding stepper, and error messaging that explains what happened without technical leakage. No obvious `docs/DESIGN.md` token violations were spotted on the reachable surface. The one concrete UX issue found (BUG-002 — form values lost on refresh) is minor on its own, but stings more than it should because BUG-001 forces repeated retries through the same form.

---

#### 14. Feature Gap Report

Derived from the full route table in `src/App.tsx` (35+ routes) and the landing page's own "built and working today, not a roadmap" claims, cross-referenced against what could actually be exercised:

| Feature area                                                                                                                                                                                       | Classification                                                                           | Basis                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing site, sign-up, email verification, login                                                                                                                                                 | **Implemented + Working**                                                                | Directly demonstrated                                                                                                                                                                                                                       |
| Organisation creation / onboarding                                                                                                                                                                 | **Implemented + Broken**                                                                 | BUG-001                                                                                                                                                                                                                                     |
| Staff, Location, Department, Shift type, Rota, Shift, Availability, Leave, Swap, Overtime, Clock, Timesheet, Announcement, Notification, Report                                                    | **Blocked / Unknown**                                                                    | Routes exist in source (`schedule`, `staff`, `leave`, `swaps`, `overtime`, `timesheets`, `announcements`, `activity`, `notifications`, etc.), code paths exist in `src/services/*`, but zero functional verification was possible from zero |
| AI rota assistant (`supabase/functions/ai-rota-assistant`)                                                                                                                                         | **Backend present, functionally unverified**                                             | Edge Function exists in repo per `CLAUDE.md`'s own architecture notes; untested this session                                                                                                                                                |
| Platform Console (Organisations, Users, Subscriptions, Billing, Support Centre, Support Access, Incidents, Integrations, Notifications, Audit Logs, Feature Flags, GDPR & Data, Platform Settings) | **UI-present, functionally unverified**                                                  | Confirmed rendering via the DEV-only preview harness only; no authenticated pass                                                                                                                                                            |
| Offline queueing / PWA                                                                                                                                                                             | **Implemented, unverified in this session**                                              | Deliberately disabled in dev (`devOptions.enabled: false`); requires a production-build pass                                                                                                                                                |
| GDPR erasure (`anonymize_staff_member`)                                                                                                                                                            | **Implemented + previously verified (per project memory), not re-verified this session** | Blocked — no staff exists in the QA org to erase                                                                                                                                                                                            |

---

#### 15. Seed Data Audit

- The shared Supabase project (`vwqqbdvlskngrqrejzxi`) currently contains **3 pre-existing organisations** (confirmed via a read-only `count(*)` against `public.organisations`), consistent with project memory's note that 3 real `is_demo`-mis-flagged orgs remain after the earlier demo-dataset teardown.
- **None of these were read for content, used as a substitute for CRUD evidence, or relied upon anywhere in this report's PASS/FAIL claims.** They were referenced only for the aggregate count used in root-causing BUG-001/BUG-004 and appear, unmodified, in the Platform Console preview.
- **Leftover test data from this audit:** one unconfirmed `auth.users` row (`gakinz101+rfqa20260814141047@gmail.com`) from the abandoned first sign-up attempt, and one confirmed test user (`scriptural.os+rfqa20260814141047@gmail.com`) with **zero organisations, zero memberships** — exactly what's expected given BUG-001 blocked every creation attempt. Nothing else was written to the database by this audit; this was independently confirmed via `select count(*)` immediately after testing (3 orgs, 2 memberships — both pre-existing, matching the state before this session started).
- No seed SQL (`supabase/seed/*.sql`) was run or relied upon.
- Per the required framing: for every entity this audit could reach, the equivalent record could **not** be created by a real user through the UI alone, for exactly one reason (BUG-001) rather than 23 independent gaps — but formally, this still qualifies as `FEATURE GAP — Seeded Data Without User-Facing Creation Workflow` for the pre-existing organisations relative to a _new_ customer's ability to reach that same state.

---

#### 16. Recommended Priority Order

1. **Fix BUG-001 immediately.** This is a one-migration fix with an exact, already-drafted SQL statement (§4). Ship it as a new migration, not a hand-edit of `0031`. This unblocks literally everything else in this report.
2. **Add a regression test for organisation bootstrap** (sign up → confirm → create org → assert step 2 reached and an active owner membership exists) so this specific class of RLS regression — which has now happened once already — cannot silently reoccur when the `organisations_select` policy is touched again (e.g., for a future Platform Console feature).
3. **Re-run this entire audit's Phase 5, Phase 7, and Multi-Tenant Security sections** the moment BUG-001 ships. Those are unknowns, not passes — treat the current P1 count of "0" as untrustworthy until re-tested.
4. **Investigate BUG-004** (Platform Console org-count discrepancy, 6 vs. 3) — low effort, but a Platform Console admin should not be looking at a wrong headline number.
5. **Fix BUG-002** (onboarding draft not persisted across refresh) — small UX polish, more valuable once BUG-001 no longer forces repeated retries through the same form.
6. **Run a follow-up audit pass against a production build** specifically for Offline/PWA behavior (§9) — this was the largest scope item this session structurally could not reach for reasons unrelated to BUG-001.
7. **Re-verify GDPR erasure and other destructive actions** against a real staff member in a real org, once one can exist.
8. Chase down BUG-003 (SUSPECTED 401) opportunistically; low priority given no observed user impact.

---

#### 17. Release Decision

### **NO-GO**

One unresolved P0 (BUG-001) makes the product unusable for its primary purpose — a new customer cannot create an organisation, full stop, on every attempt, with a fully diagnosed and 100%-reproducible root cause. Per the audit's non-negotiable rule, this alone forecloses any GO or GO WITH CONDITIONS recommendation, independent of the fact that the P0 also structurally prevented verifying the P1-critical workflows (rota publish, clock-in, multi-tenant isolation) this session was supposed to prioritize.

The good news, and the reason this is a NO-GO rather than a deeper indictment of the product: the fix is narrow, precisely located, and already drafted in §4. Everything observed _around_ the blocker — sign-up UX, email verification, error messaging, route guarding, RLS engineering discipline in the wider migration history — suggests a codebase that is close to ready, not far from it. Fix BUG-001, re-run Phase 5/7/Multi-Tenant Security against a working organisation, and this verdict should move quickly.
