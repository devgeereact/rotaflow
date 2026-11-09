# Deployment. Static front end and PHP API on cPanel

RotaFlow is a **static React front end** (built to `dist/`) and a **PHP 8.4 API** (`backend/`) on the **same cPanel
host**, released together by `pnpm release` (`scripts/release.mjs`, settings in `release.json`). Nothing in the release
needs Node on the host: the front end is **built on the machine that runs the release** (the owner's Mac, or the runner of
`.github/workflows/deploy.yml`), and the release uploads built files and PHP source. The database is MariaDB on the same
host, and background work is a cPanel cron entry running `backend/bin/cron.php` (a second entry runs the database backup). Migrations are **not** applied by the
release: `php bin/migrate.php` is a separate step on the host (see "Applying migrations"). The previous version of this
page, which described a static-only site with no API and the retired `cpanel-deploy` tool, is available with `git show
live-supabase-2026-11-01:docs/DEPLOYMENT.md`.

> **RotaFlow target:** domain **`rotaflow.space`**, its own registered domain, deployed into its **own** docroot,
> `~/rotaflow.space/` (the `rotaflow.space` destinations in `release.json`). Never the shared `public_html/`. The PHP source
> and the private configuration go to `~/rotaflow-private/` (`rotaflow-private/app` in `release.json`), outside every web
> root. If you deploy through a personal wrapper or CI, that tooling still has to obey the safety rules below. They exist
> because breaking them has caused real outages and leaks.
>
> ⚠️ **Do not use `rotaflow.app`.** It was the placeholder in this repo until 2026-07-29, but it is **not ours**. It
> resolves to an unrelated shift-scheduling product. It had leaked into `VITE_APP_URL`, the VAPID subject and the SMTP
> identities.
>
> **The previous host, a subdomain of a personal domain, was retired 2026-08-29:** docroot and mailbox archived, mail
> account deleted, and all 15 of its DNS records removed from the parent zone. It should not appear in any config. It
> carried SPF and DKIM but **no MX**, which is why mail addressed to it was undeliverable; `rotaflow.space` has the full
> record set.
>
> **DNS and TLS: `NOT VERIFIED (dashboard setting)`.** As last recorded in this file, `A @` and `CNAME www` point at the
> host and are **proxied by Cloudflare (orange cloud)**, and the origin holds Cloudflare _Origin_ certificates that
> browsers reject directly, so switching the proxy off (grey cloud) would take the site down at once. None of that can be
> read from this repository; check it in the Cloudflare dashboard. The origin address is deliberately not written here (it
> is in the hosting control panel); where a command below needs it, it is written `<origin-ip>`. Whether the host is in the
> United Kingdom, as `src/lib/subprocessors.ts` publishes with this page as its evidence, is also a provider fact:
> `NOT VERIFIED (hosting dashboard)`, owner-confirmed on 1 November 2026.
>
> ⚠️ **The live `.htaccess` is not the repo file.** `pnpm htaccess` composes and pushes it (see "Composing the live
> `.htaccess`"). The server copy is `scripts/htaccess/origin-lock.conf` (a `# === BEGIN Cloudflare-origin-lock ===` block)
> **prepended** to the repo file, and the lock 403s any request arriving without a `CF-RAY` header (with `/.well-known/`
> exempt so certificate renewal still works). Ship the repo file alone and that lock is silently removed, which is why
> `scripts/release.mjs` never sends the root `.htaccess`.
>
> **Sign-in addresses:** the build sets `VITE_APP_URL=https://rotaflow.space` and the public `VITE_CLERK_PUBLISHABLE_KEY`
> (`release.json`, `build`). Which origins Clerk lets sign-in redirect to, and the Clerk instance's allowed redirect URLs,
> are Clerk dashboard settings: `NOT VERIFIED (dashboard setting)`. The API accepts a session token only from the issuer
> and authorised parties in its private configuration (`clerk_issuer`, `clerk_authorized_parties`;
> `backend/src/Bootstrap.php`, `backend/private/config.example.php`). When sign-in misbehaves after a domain or port
> change, read both before assuming the bug is in the app.
>
> **PII posture (important. RotaFlow holds staff personal data):** RotaFlow stores names, contact details, emergency
> contacts, staff document files and leave records (which can include sickness) for UK employees (`docs/SECURITY.md`, the
> privacy data map). Create the **Sentry project in the EU region** (ingest host like `o<org>.ingest.de.sentry.io`; the
> host named in the Content-Security-Policy of `.htaccess` is a `.de.sentry.io` host) with **PII scrubbing on**, and set
> the region up front: Sentry does not allow it to be changed later (`NOT VERIFIED`, vendor behaviour). Handle data under
> UK GDPR: honour export and delete, keep audit logs, and never log personal data to the console.

---

## 1. Build locally

```bash
pnpm run check            # every gate: lint, format, typecheck, vitest, build, bundle, migrations, docs, export, php
pnpm run build            # tsc --noEmit, vite build, then scripts/prerender.mjs: emits ./dist
pnpm run check:bundle     # size budgets + "no DEV page shipped"; reads dist/
pnpm run preview          # smoke-test the production bundle before shipping
pnpm verify               # scripts/release.mjs --verify: checks, build and the upload guard; never contacts the host
```

`pnpm run check` is the `check` script in `package.json`; its gates are listed in `CLAUDE.md`. The PHP suites inside it
(`check:php`) need a throwaway local MariaDB (`scripts/test-db.sh`, data under `.local-test/`), and `ci.yml` has no PHP
step, so a green CI run does not cover them (`qa/README.md` is the table of jobs).

The shippable output is `dist/` (the front end) and `backend/` (the API), plus the repo-root **`.htaccess`**, which a
release never ships (HTTPS redirect, API pass-through, prerendered pages, SPA rewrite to `index.html`, a real 404, MIME
types, cache and security headers).

**`pnpm run build` also writes `dist/prerendered/`** (`scripts/prerender.mjs`): one static HTML file per sitemap page and
a `404.html`. `.htaccess` serves `/` and each public page from there, sends a path whose first segment is a route in
`src/App.tsx` to `index.html`, and answers anything else with **HTTP 404** and the prerendered not-found page. The service
worker does not precache `prerendered/`, so an installed client still navigates through the app shell. Two consequences:

- `dist/prerendered/` ships with the rest of `dist/`. If it is missing, the public pages still work through the
  `index.html` fallback; only crawlers lose the static copy and an unknown path gets the server's plain 404 page.
- **A change to those rules needs the root `.htaccess` replaced**, and the release never does that: use `pnpm htaccess
  push` (see "The command: `pnpm htaccess`"), composed with the origin-lock block. Without it the old routing stays live.
  After it, run the four checks under the table headed "Prerender and 404".

`check:bundle` runs in CI's `verify` job too, so a breach fails the PR rather than the deploy. Run it locally anyway
before shipping a build: it is the only check that reads the actual output, and the two bundle regressions this repo has
had, DEV preview pages precached to every visitor (#75) and a lazy route becoming a static import (#69), were both
invisible to typecheck, lint and the test suite. Budgets and the reasoning behind each number live in
`bundle-budget.json`; raising one is a reviewable diff, not a flag.

---

## 2. Ship the artifacts, into THIS app's own docroot

`pnpm release` (`node scripts/release.mjs`) is the only supported way to ship, over SSH with rsync. **No FTP, and no deploy
from GitHub Actions unless you start it by hand** (below). It is a **dry run** unless you add `--go`, and a real release
needs the owner's explicit "approved:". In order, per the header of `scripts/release.mjs`:

1. **Preflight.** On `main` (the `branch` key of `release.json`), working tree clean, and equal to `origin/main`.
2. **Checks and build.** `release.json` `checks` (`pnpm run check`) unless `--skip-checks` (emergencies only), then
   `build`: rebuild `dist` from scratch with `VITE_APP_URL` and the public Clerk key set inline, run `check:bundle`, assert
   the Clerk key is in the bundle, **fail if `dist` holds a retired service host or a secret-key shape** (a `grep` over
   `dist` for the retired Supabase and ImageKit hosts and for Stripe-style secret keys), and **fail if `dist/.htaccess`
   exists**. The release also refuses any `.env*`, `.sql.gz`, `.pem` or `.key` file in a part, and a nested `config.php`.
3. **Plan.** A checksum rsync dry run for each of the three `parts` in `release.json`: `backend` to `rotaflow-private/app`
   (excluding `/tests/`, `/public/`, `/private/` and `*.md`, allowing `*.sql` so the migration files travel),
   `backend/public/api` to `rotaflow.space/api` (the API entry point), and `dist` to `rotaflow.space` (excluding `*.map` and
   `/stats.html`, allowing folder `.htaccess` files and `.well-known/`). Without `--go` it stops here.
4. **Snapshot.** Every server file about to change is copied to `~/backups/rotaflow/releases/<utc>/` with a
   `RELEASE.json` (commit, parts, new files). The newest three snapshots are kept. This is **code only**; the database
   backup is separate (below).
5. **Upload.** Each part in order, with the entry files `index.html`, `sw.js` and `manifest.webmanifest` last.
6. **Smoke.** The six `smoke` checks in `release.json` must pass (each is retried): `/` 200; `/api/health` 200 containing
   `"ok":true`; `/api/me` 401 with an error body; `/app/dashboard` 200 containing the empty app shell; `/no-such-page` 404;
   `/assets/` 403. **Any failure restores the snapshot automatically.**

Other options: `--rollback` (restore the newest snapshot; a dry run without `--go`), `--list` (show snapshots), `--verify`
(step 2 and the upload guard only, never contacts the host), `--config=FILE`. `pnpm verify` is `--verify`.

What is **not** shipped: the root `.htaccess` (use `pnpm htaccess`), `*.map`, `/stats.html`, `backend/tests/`, any
`config.php`, `.env*`, dumps and keys. Private configuration is created once by hand on the host in
`~/rotaflow-private/config/` and never travels with a release; its key names are in `backend/private/config.example.php`.

**The GitHub deploy workflow** (`.github/workflows/deploy.yml`) runs the same `node scripts/release.mjs --go` from a GitHub
runner over SSH. It is `workflow_dispatch` only: push-to-deploy is off. It needs two repository secrets (`CPANEL_SSH_KEY`,
`CPANEL_KNOWN_HOSTS`) and public repository variables for the `VITE_*` values it names. Whether GitHub Actions can run for
the owner's account at all is `NOT VERIFIED` (owner action O14 in `docs/SAAS.md`). Its header comments still refer to the
cutover branch; correcting a workflow file is Phase 5.

After a release: load the site over **HTTPS** and confirm the app boots and the install prompt appears.

> **An HTTP 200 is not evidence that a file deployed.** A path whose first segment is an app route (`/app/anything`) is
> rewritten to `index.html` and answers `200` with the app's HTML whether or not the file exists, so curling a URL and
> seeing `200` proves nothing: it has already produced one false conclusion in this repo's history. (Since 22 October 2026
> an unknown path outside the routes answers a real `404`, and the `/no-such-page` smoke check depends on it.) Verify by
> **content** (`curl -s <url> | head`, or grep the response for something only that file contains) or over **SSH**
> (`ssh cpanel ls -la <path>`).

---

## 3. Deploy safety rules (non-negotiable)

These were learned by breaking the live site. Each is restated against `scripts/release.mjs`, which enforces most of them
by construction; the rest are marked.

0. **Three traps that have each cost a live site once.**
   - **cPanel's Document Root field is relative to `$HOME`.** Typing the absolute path produced `/home/<user>/home/<user>/<domain>`.
     Leave the auto-filled value alone. `NOT VERIFIED` (cPanel behaviour; learned on the live site).
   - **File modes.** An `rsync -a` upload preserved this repo's local `600` modes, so `.htaccess` landed unreadable by the web
     server and the site served a directory listing with no routing. `scripts/release.mjs` uses `rsync -rlt` and runs no
     `chmod`, so whether new files arrive readable on this host is `NOT VERIFIED`; the smoke checks would catch an unreadable
     `index.html`, but not one unreadable chunk. After a release, check a hashed asset by content.
   - **A `200` is not evidence a file exists** (the box in section 2).
1. **A dry run comes first, and is the default.** `pnpm release` without `--go` prints every change and uploads nothing.
2. **The release never deletes anything on the server, ever.** The rsync calls in `scripts/release.mjs` carry no
   `--delete`. So a mirror-delete cannot wipe a neighbour, a shared docroot or an `uploads/` folder. The other side of the
   same fact: a file removed from the repo **stays on the server** until removed by hand over SSH (see "A deploy does not
   undo a leak"). Never point a `parts[].to` in `release.json` at a shared docroot such as `public_html/`.
3. **Runtime and secret files are protected.** `PROTECT` in `scripts/release.mjs`: `config.php`, `.htaccess`, `.user.ini`,
   `php.ini`, `.env`, `.env.*`, `*.sql`, `*.sql.gz`, `*.pem`, `*.key`, `error_log`, `.well-known/` and `.DS_Store` are never
   sent, unless a part lists the name in `allow` (the `dist` part allows folder `.htaccess` files and `.well-known/`; the
   `backend` part allows `*.sql`, which goes to a folder outside every web root).
4. **The TLS validation directory is not touched.** Because nothing is deleted, whatever `.well-known/pki-validation`
   holds on the server survives a release. (The older tool's `--keep` flags, which were bidirectional excludes, are retired
   with it; nothing here needs them.) `dist/.well-known/security.txt` is allowed through by the `dist` part.
5. **Keep backups OUTSIDE every webroot.** A `.bak`, `.zip` or `.sql` left in a docroot would be served and could leak its
   contents. Release snapshots go to `~/backups/rotaflow/releases/`, database dumps default to `~/backups/rotaflow/db`
   (`backend/bin/backup.php`), and the private configuration is in `~/rotaflow-private/`: all under the home folder, none
   under a web root.
6. **Never commit real secrets.** `.env` stays git-ignored; only `.env.example` (key names, no values) is tracked, and
   `.githooks/pre-commit` runs gitleaks. `VITE_*` values are public: Vite inlines every one into the bundle whether code
   reads it or not.

---

## 4. Source maps → Sentry

`vite.config.ts` sets `build.sourcemap: 'hidden'`, so maps are emitted but never referenced from the code. The
`sentryVitePlugin` is added to the build **only when `SENTRY_AUTH_TOKEN` is in the build environment** (with
`SENTRY_ORG` and `SENTRY_PROJECT`); it uploads the maps to Sentry and then deletes `dist/**/*.js.map`. The `dist` part of
`release.json` also excludes `*.map`, so a map never reaches the public docroot either way. `scripts/release.mjs` itself
uploads nothing to Sentry. Whether the live build uploads maps depends on that environment variable existing on the
machine that runs the release: `NOT VERIFIED`. See `docs/ARCHITECTURE.md` for the browser-side posture.

---

## 5. Managed-service notes (deploy-relevant)

Names of settings only; no value belongs in this repository. The API's private configuration keys are in
`backend/private/config.example.php`; the public build variables are in `src/lib/env.ts` and `.env.example`.

| Service | What the deploy needs | State |
| ------- | --------------------- | ----- |
| **Clerk** (sign-in) | Build: public `VITE_CLERK_PUBLISHABLE_KEY` (set inline by `release.json`). API: `clerk_issuer`, `clerk_authorized_parties`, and `clerk_secret_key` for deleting a login after an erasure (`backend/src/Mod/Gdpr.php`) | Instance settings (redirect URLs, Google sign-in, bot protection): `NOT VERIFIED (dashboard setting)` |
| **Stripe** | API only: `stripe.mode` and the test or live secret and webhook secret for that mode (`backend/src/StripeClient.php`). The webhook is `POST /stripe/webhook`, signature-checked | Test or live mode on the host: `NOT VERIFIED` (server configuration) |
| **Sentry** | Build: public `VITE_SENTRY_DSN`. Optional source-map upload variables (section 4) | Region is fixed at project creation (`NOT VERIFIED`, vendor behaviour); alert rules: none known (below) |
| **OpenRouter** (AI) | API only: `openrouter_api_key`, optional `openrouter_model` and `openrouter_fallback_model` (`backend/src/Mod/AiAssistant.php`). The key never reaches the browser | Whether the key is set on the host: `NOT VERIFIED` |
| **Outbound mail** | API only: the platform `smtp` block in the private configuration, or an organisation's own account saved in the app (`backend/src/Mail.php`). Web push also needs `vapid` there and the public `VITE_VAPID_PUBLIC_KEY` at build | Which provider sends platform mail: `NOT VERIFIED` |
| **Cloudflare** | DNS, TLS and the proxy; Turnstile on the contact form needs both `turnstile_secret` (API) and `VITE_TURNSTILE_SITE_KEY` (build), or neither (`src/lib/env.ts`). The proxy header handling is `trust_cf_connecting_ip` | Dashboard settings: `NOT VERIFIED` |
| **Hosting** (cPanel) | SSH access as the `cpanel` host alias used by `release.json`; PHP 8.4 for the account (`php backend/bin/doctor.php` checks the extensions) | PHP version and extensions on the host today: `NOT VERIFIED` until `doctor.php` is run |

- **Run `php bin/doctor.php` on the host before a release**, from the folder the cron entry uses: it checks that the PHP the
  web server and cron will use is 8.4 or newer and has the extensions the API needs (`backend/bin/doctor.php`). The host's
  default PHP has changed under the project before.
- **Retired services.** The Supabase project is archived and kept read-only until about 2027-01-30 (owner decision, `NOT
  VERIFIED` from the repository); its previous Edge Function deploy steps, secrets and storage buckets no longer apply.
  Legacy pointer: `git show live-supabase-2026-11-01:docs/DEPLOYMENT.md`. ImageKit and Inngest are retired. **Retiring a
  service means removing its variable from `.env`, then checking the built bundle:** the build step in `release.json`
  fails if `dist` still holds a retired service host.
- **CodeRabbit only reviews pull requests** (`NOT VERIFIED`: a GitHub app setting; no CodeRabbit file is tracked). Use
  branch, pull request, merge.

## Applying migrations

`backend/bin/migrate.php` applies the numbered `NNN-*.sql` files of `backend/migrations` in order, using the **migration
identity** in the private `config/migrate.php` (a different database account from the one the API runs as). `--dry-run`
lists what it would apply. It records each file in `schema_migrations` with a SHA-256 checksum, and a file that was
applied and later edited **aborts the run (exit 2) before anything else is applied**; a statement that fails exits 3. MariaDB
commits DDL implicitly, so a file that fails halfway leaves its earlier statements in place and no log row: write
migrations as additive, re-runnable statements (`IF NOT EXISTS`) so the fixed file can be applied again.

`pnpm release` only **uploads** the `.sql` files (to `~/rotaflow-private/app/migrations`); it never runs them. So after a
release that carries a migration, someone runs `php bin/migrate.php --dry-run` and then `php bin/migrate.php` on the host,
as the owner, with the owner's approval (a migration on real data is an "ask first" act). Code that needs a new column
fails until the migration is applied (`NOT TESTED`). Whether a migration is pending on the live host today, and who runs the
step, is `NOT VERIFIED` (server state). The files are forward-only: there is no down migration in `backend/migrations`.

`pnpm run check:migrations` reads the legacy `supabase/migrations` tree, not `backend/migrations`, so it does not guard
these files (`docs/DATA-MODEL.md` section 8).

## The scheduled job

`backend/bin/cron.php` runs every module's `cron()` (seven today: `docs/NOTIFICATIONS-SPEC.md`) under a lock file, one run at
a time. Its header gives the cPanel cron line (using `$HOME/rotaflow-private`, output to `logs/cron.log`) and says the live
host **runs it every five minutes**; the jobs decide for themselves whether they are due, so the schedule is only a
heartbeat. The retention run, the file and login deletion queues and the notification outbox all ride on it. If it stops,
nothing sends email or push and nothing is purged. Its log is a file on the host; nothing alerts on it (below).

## The live release tag is the deployed commit, not `main`

`vite.config.ts` bakes the git short SHA into the bundle as `__SENTRY_RELEASE__` (`resolveSentryRelease`), so every error
carries the commit it shipped from. `scripts/release.mjs` also records the commit in the snapshot's `RELEASE.json`, and its
preflight requires `main` to equal `origin/main`, so a release is always a pushed `main` commit. Two consequences that look
like bugs and are not:

- **A docs-only commit changes the bundle hash.** `index-*.js` is content-hashed and the SHA is content, so merging a change
  that touches no code still produces a different filename. Do not read a hash difference between `dist/` and the live site
  as "the code is stale": check whether `git diff --stat <live-sha>..HEAD -- src/ public/ index.html vite.config.ts` is
  empty first.
- **The live commit lagging `main` is correct, not drift.** It names what was deployed, which is the only thing an error
  report can honestly be attributed to.

Verify what is live rather than inferring it: fetch the `index-*.js` the live HTML references and grep it for the short SHA.

## The API and Clerk in `.htaccess` (S9, applies from the R1 cutover)

The cutover itself (freeze, backups, migrations, data move, files, release, Clerk, Stripe, cron, rollback at every stage)
is the dated runbook `docs/CUTOVER.md`; it ran on 1 November 2026. Releases use `pnpm release`; the older
`cpanel-deploy` tool is retired.

The repository `.htaccess` carries two things the API depends on. Both must survive the composition below (merge, never
overwrite):

- **`/api` pass-through.** `RewriteRule ^api(/.*)?$ api/index.php [L,QSA]`, placed before the file check, the prerendered
  pages and the SPA fallback, plus the `HTTP_AUTHORIZATION` pass-through so PHP receives the bearer token.
  `backend/public/api/index.php` is deployed to `api/index.php` in the webroot; everything else in `backend/` goes to
  `~/rotaflow-private/app/` outside it.
- **A Content-Security-Policy naming Clerk.** `script-src` adds `https://clerk.rotaflow.space`,
  `https://cdn.protect.clerk.com`, `https://challenges.cloudflare.com`; `connect-src` adds `https://clerk.rotaflow.space`,
  `https://clerk-telemetry.com` and Sentry's EU ingest host; `frame-src https://challenges.cloudflare.com`; `img.clerk.com`
  is covered by `img-src https:`. The Supabase and ImageKit origins are removed. `src/lib/htaccessRoutes.test.ts` checks it.

The build needs `VITE_CLERK_PUBLISHABLE_KEY` (set inline by `release.json`); without it the build renders signed out.
`VITE_SUPABASE_*`, `VITE_IMAGEKIT_*` and `VITE_ENABLE_OAUTH` are no longer read.

**Folder `.htaccess` files ship with the release (2 November 2026).** `public/assets/`, `public/icons/` and `public/fonts/`
each carry an `.htaccess` with `Options -Indexes`, so the host's directory listing is off where the release can reach.
`release.json` allows `.htaccess` in the `dist` part; the build step and `scripts/release.mjs` both refuse a
`dist/.htaccess`, so the web-root file stays hand-composed. A smoke check expects `/assets/` to answer 403. The PHP entry
point removes `X-Powered-By` itself. Still only in the composed root file: `ServerSignature Off`, unsetting
`X-Turbo-Charged-By`, and the origin lock (`docs/SECURITY.md`, open items).

The release's smoke checks assert, on every release, that `/api/health` answers 200 containing `"ok":true` and that
`/api/me` without a token answers 401 with a JSON error body (not HTML). That sign-in loads with no CSP violation is not
automated: check it in a browser after a change to the policy (`NOT TESTED` behind Cloudflare in this pass).

## Composing the live `.htaccess`

Replacing the web-root `.htaccess` replaces the file that enforces the Cloudflare origin lock. Get it wrong and the site
either goes dark or silently reopens direct-to-origin. The composition is `scripts/htaccess/origin-lock.conf` followed by the
repo `.htaccess` (`composeHtaccess` in `scripts/htaccess.mjs`, which refuses to compose if the lock block lacks its BEGIN
and END markers). It was first done by hand on 2026-08-31 to carry a CSP change through, with these steps, which the
command below now performs or checks: back the live file up outside every docroot; diff it against the repo file minus the
lock block (**if the diff shows anything you cannot explain, stop**: the live file carries a hand-edit nobody wrote down);
compose lock plus repo file; dry-run; verify from outside afterwards:

| Check                                             | Expect                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `/` and a deep route (`/app/dashboard`)           | 200, and the second proves the SPA fallback survived                     |
| the hashed bundle and `/.well-known/security.txt` | 200                                                                      |
| `curl --resolve <domain>:443:<origin-ip>`         | **403**: the lock is intact                                              |
| the same, to `/.well-known/security.txt`          | **200**: the ACME exemption survived, or renewal fails months later      |
| response headers                                  | CSP reflects the change; HSTS and `X-Content-Type-Options` still present |

The fourth row is the one that fails silently. A lock with no `/.well-known/` exemption looks perfect until a certificate
comes up for renewal. **Prerender and 404**, for any change to the rewrite rules: read the status with `curl -s -o
/dev/null -w '%{http_code}'` and the body with `curl -s`, never a browser with the service worker installed, which answers
every navigation from its own shell:

| Check                            | Expect                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/no-such-page`                  | **404**, and the body contains `This page doesn’t exist` and `noindex`                           |
| `/features` and `/legal/privacy` | 200, and the body has `data-prerendered="/features"` (or that path) and the page's own `<title>` |
| `/app/dashboard` and `/invite/x` | 200, and the body is the empty app shell (`<div id="root"></div>`)                               |
| a missing `/assets/missing.js`   | **404**, still                                                                                   |

If the second row returns the empty shell, the prerendered copy is not being found: check that `dist/prerendered/`
deployed, then that `%{DOCUMENT_ROOT}` on this host is the site's own document root. The pages still work in that state;
only the static copy is missing. If the first row returns 200, the new `.htaccess` did not deploy.

### The command: `pnpm htaccess` (Phase 1, November 2026)

A change to the repo `.htaccess` never needs a hand edit on the server. `scripts/release.mjs` still never ships the root
file, on purpose. The command is `node scripts/htaccess.mjs` (`pnpm htaccess`):

- `pnpm htaccess compose [--out=FILE]` prints (or writes) the file that should be live: the lock block followed by the repo
  `.htaccess`. Composing its own output changes nothing.
- `pnpm htaccess diff` reads the live file over SSH (read-only) and lists the lines to add or remove. On 2026-11-08 it showed
  exactly the 11 banner-hardening lines (`ServerSignature Off`, `Header unset X-Powered-By`, `Header unset X-Turbo-Charged-By`).
- `pnpm htaccess push` is a dry run. `pnpm htaccess push --go` backs the live file up to `~/backups/rotaflow/htaccess/`,
  writes `.htaccess.new` beside it, moves it into place, runs the six `smoke` checks from `release.json` (each with a 15
  second limit and one retry), and **restores the backup if any fail or the check cannot run**. On any failure it prints where
  the backup is and the one command to put it back by hand. The backup keeps the file's mode (a restore must not leave it
  unreadable by the web server), a rollback is followed by a second smoke check whose result is reported, and `push` refuses
  to overwrite live lines the composed file lacks (a hand edit) unless `--accept-extra` is passed: after the 2026-11-08
  comment fix the first push needs it for exactly one comment line, which `diff` shows. After a push, also check the
  response headers (`x-turbo-charged-by` should be gone; if LiteSpeed ignores `Header unset` for it, that needs another
  way). It needs the owner's "approved:" like any deploy.
- Not covered: the `curl --resolve` lock check in the table above (run it by hand after a push), and replacing the CF-RAY
  lock with Cloudflare Authenticated Origin Pulls (a Cloudflare setting; the lock block stays as live until that exists).

## A deploy does not undo a leak

Learned on 2026-08-31, deploying the removal of a retired credential (HARDEN-010).

`dist/assets/*` is served with `cache-control: public, max-age=31536000, immutable`, which is correct: the filenames are
content-hashed, so a changed file is a changed name. The consequence is that **Cloudflare keeps serving a superseded chunk
from its edge for up to a year**, at a URL that nothing links to any more but that anybody who has seen it can still fetch.
Verified at the time: a chunk from a retired Inngest dispatcher returned 200 with `cf-cache-status: HIT` after the deploy
that removed it from the origin. And because `scripts/release.mjs` never deletes (section 3), the file also stays on the
origin's disk until someone removes it over SSH.

So the checks after a deploy that exists to _remove_ something must be:

1. **Over SSH, not over HTTP.** `ssh cpanel 'ls ~/rotaflow.space/assets/ | grep <thing>'`. HTTP answers from the edge, and
   the SPA fallback answers 200 for a missing file under an app route anyway.
2. **Then the served bundle by content**, not by status code: fetch the `index-*.js` the live HTML actually references and
   grep it.
3. **Then accept that the old URL stays fetchable.** Purge it if a token exists; the account has none stored on the
   deploying machine today (`NOT VERIFIED`). Either way a purge is not the remedy for a leaked credential: **rotation is.**
   A cached artefact you cannot reach is still an artefact somebody else already has.

The general rule: shipping a new artefact hides the old one from new visitors. It does not retract it. Anything secret that
was ever in a built bundle is compromised, and the only action that changes that is revoking it at the service that issued it.

## Rolling back

`qa/LAUNCH-CHECKLIST.md` recorded gate 29 ("Rollback documented and feasible") as **FAIL** until 2026-09-04, on the
accurate grounds that this file described how to deploy and nowhere described how to undo one. This section is written from
`scripts/release.mjs`. **A rollback has never been performed under pressure on this release path**, so treat the timings
as estimates (`NOT TESTED`).

### The files roll back. The database does not.

- **The release is files.** `pnpm release --rollback` (a dry run) and `pnpm release --rollback --go` restore the files the
  newest snapshot in `~/backups/rotaflow/releases/` recorded as changed, then run the smoke checks. The snapshot is **used
  up** (the next `--rollback` goes one release further back; `--list` shows what is left; the newest three are kept). **Files
  the release added are left in place**, because nothing is ever deleted.
- **A migration is not.** Migrations are forward-only and are applied by hand (`php bin/migrate.php`), so rolling the files back
  leaves the new schema in place. A schema change that turns out to be wrong is corrected by a _new forward migration_,
  not by reverting the old one: reverting the file in git changes nothing on the host, and an applied file whose checksum
  changes aborts the next run. Check that the older code still works against the newer schema before shipping it (usually it
  does, because migrations here are additive). The data itself is protected only by the database backups below.

### Going back to a specific older commit

`--rollback` restores the snapshot of the previous release, which is not always the commit you want. `scripts/release.mjs`
refuses to release from anything but `main` equal to `origin/main`, so returning to an older commit means committing the
revert on `main`, pushing it (both need the owner's approval), and releasing as normal. Do not edit files on the server
by hand.

### What a rollback does not fix

- **The edge keeps the bad build reachable.** Hashed assets are `immutable` for a year, so the chunk you just rolled back
  stays fetchable at its own URL from Cloudflare's cache. See "A deploy does not undo a leak". If the reason for the rollback
  was an exposed credential, the rollback is not the remedy: **revoking it at the issuer is.**
- **Service workers do not roll back on their own schedule.** `skipWaiting` is false and the update is offered to the person
  (`vite.config.ts`), so a client that already installed the bad build keeps running it until the person accepts an update.
  Rolling back produces a _new_ `sw.js`, which those clients will offer as an update, so recovery for an already-updated client
  is one more prompt, not instant. `UpdatePrompt` polls hourly, so an app left open recovers within the hour.
- **`index.html`, `sw.js` and `manifest.webmanifest` are `no-store`** (`.htaccess`), so the entry point itself does flip
  immediately, which is what makes the rollback take effect for new visitors at all. It also carries the site's JSON-LD
  block (publisher and product, no ratings or prices), so a rollback restores the structured data of that build too.

### Verifying a rollback

Identical to verifying a deploy, plus one: confirm the served bundle carries the _intended_ SHA, by content rather than by
status code.

```bash
LIVE=$(curl -s https://rotaflow.space/ | grep -o 'assets/index-[^"]*\.js')
curl -s "https://rotaflow.space/$LIVE" | grep -o '<short-sha>' | head -1
```

`vite.config.ts` bakes the git SHA in as `__SENTRY_RELEASE__`, so this is a direct answer rather than an inference from a
filename.

## Database backups (MariaDB, since the 1 November 2026 cutover)

The release snapshots in `~/backups/rotaflow/releases/` hold **code only**. The database is backed up by
`backend/bin/backup.php` (class `RotaFlow\Backup`, suite `300-backup.php`):

- `php backup.php [--dir=PATH] [--keep=28]` writes `rotaflow-<UTC>.sql.gz` (mode 0600), a `.sha256` and a `.counts.json`. The dump is read back for its completion marker before it is
  published, and it is published last, so a dump is never visible without its checksum; a run that exceeds 30 minutes is stopped (each table's row
  count just before and just after the dump, bound to the dump's hash), then keeps the newest N. Default folder `~/backups/rotaflow/db`.
  The password reaches `mariadb-dump` through a removed 0600 defaults file, never the command line. A failed or truncated dump leaves no
  file and exits 1.
- `php backup.php --restore-check --scratch-db=NAME` verifies the newest dump's checksum and counts file, loads it into the scratch
  database, requires every table's restored count to lie in the recorded range (exact, so it can be run days later and live changes do
  not matter), and empties the scratch database. `NAME` must exist, differ from the live database, contain `restorecheck` and be **empty** (any table or view in it, even a
  RotaFlow-named one, makes the check refuse and touch nothing; it leaves the database empty afterwards). The application's database user needs create and drop rights on it (a
  cPanel user must be added to that database). `--tolerance=PCT` (0 to 100) adds slack, and for an old dump with no counts file it is the only way a
  busy live database can pass.
- `php backup.php --self-check` lists what would stop a backup on this machine (`proc_open` disabled, a missing `mariadb-dump`, an
  unreachable database). Run it once as cron runs it, before trusting the schedule.
- **Use a dedicated read-only account, not the app's.** The dump needs SELECT, SHOW VIEW and TRIGGER on the live database; the app's runtime
  account deliberately lacks TRIGGER. On the live host the account is `devgeereact_rf_backup` (SELECT, SHOW VIEW, TRIGGER on the live DB, ALL
  on the scratch DB only), with its credentials in `~/rotaflow-private/config/backup.php` (mode 600, same `dsn` as `config.php`); run the
  command with `ROTAFLOW_CONFIG_FILE=backup.php`. The schema has triggers and no routines or events, so `--routines` is not requested.
- The tools are given a `--defaults-file`, not `--defaults-extra-file`: the extra file is read BEFORE the host's `~/.my.cnf`, which on the
  live host holds another project's account and silently overrode ours. When loading a dump for the restore check, `DEFINER=` clauses are
  removed from the schema statements (never from row data): the triggers belong to the migration account, and creating them as another
  account needs SUPER.
- **Installed on the live host on 2026-11-08** (owner-approved): every six hours at minute 17,
  `17 */6 * * * ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private ROTAFLOW_CONFIG_FILE=backup.php /usr/local/bin/php $HOME/rotaflow-private/app/bin/backup.php >> $HOME/rotaflow-private/logs/backup.log 2>&1`,
  plus a monthly `--restore-check` drill (not scheduled yet). The first live backup and the restore proof into
  `devgeereact_rotaflow_restorecheck` both passed (70 tables counted in the live database, which is the 69 `CREATE TABLE` names of the migrations plus `schema_migrations`, created by `backend/bin/migrate.php`; counts inside the recorded ranges, scratch left empty). The record of that
  session is in `docs/AUDIT.md`, section "2026-11-08: Phase 1, live safety and ground truth"; this repository cannot re-run it, and the host as it
  is today has not been re-checked (`NOT VERIFIED`, server state). The six-hour cadence is the suggested schedule in this section; neither
  `backup.php` nor `Backup.php` states one.
- **Install a cron line from a FILE, never by piping.** On this host `(crontab -l; echo LINE) | crontab -` replaced the whole crontab and
  dropped the `cron.php` job and another project's nightly job for about two minutes (restored from the saved copy, no run missed).
  Save `crontab -l` first, append to a copy, load it with `crontab FILE`, and check every original line is still there.
- Do not point `~/bin/prune-backups` (a host script, not in this repository) at the `db` folder: it keeps five per file pattern, which at six-hourly dumps is thirty hours.
- **Still missing, and never to be written as done until it is:** an encrypted off-site copy (key custody is an owner decision), alerting on a
  failed run, a scheduled monthly restore drill, point-in-time recovery, and any copy of the stored files (`backup.php` dumps the database
  only; the upload folder is `backend/src/FileStore.php`'s). Restoring the **live** database from a dump is not scripted: `--restore-check`
  proves a dump loads into a scratch database, and loading one into the live database is a manual act that has never been performed
  (`NOT TESTED`). The owner's pilot targets are a 6 hour data-loss window (the backup interval) and a 4 hour recovery time; they are targets,
  and no recovery has been timed.

## Recovery: the scheduled workflows that still target the retired Supabase project

Two scheduled GitHub workflows were written for the previous stack and **still target it** (read 9 November 2026,
`.github/workflows`): `backup.yml` takes a nightly `pg_dump` of the archived (retired) Supabase project, and `auth-config.yml` checks
that retired project's Auth settings against `scripts/check-auth-config.mjs`. Their secrets (`SUPABASE_DB_URL`,
`BACKUP_PASSPHRASE`, `SUPABASE_ACCESS_TOKEN`) belong to that retired stack. **Do not create them, and do not follow the old runbook to set
them.** `backup.yml`'s scheduled runs were failing when last read (five consecutive failures, 5 to 9 November 2026, `gh run
list`, read only), which is expected after the cutover and means nothing about the live database. Neither is a backup or a
monitor of anything live. Repairing or removing them is Phase 5 (workflow files); `ci.yml`'s `scheduled-checks` job reads their
last runs and annotates pull requests, so a red status there comes from these two. The 2026-09-05 runbook for setting those
secrets, and its notes on what a restore rehearsal into legacy stock PostgreSQL does and does not prove, are at the tag:
`git show live-supabase-2026-11-01:docs/DEPLOYMENT.md`.

### What is still missing for recovery of the live site

Recording these so that "backups are configured" is not mistaken for "we can recover":

- **An off-site copy** that survives the loss of the hosting account (above).
- **A restore of the live database into a working copy of the whole app**, with the private configuration, and one full
  rota-and-attendance journey exercised there. A scratch-database row-count check proves the dump loads, not that the app
  runs on it.
- **A named owner and recovery objectives.** The owner's pilot targets (6 hours, 4 hours) are stated above; nobody has
  measured against them.
- **An escalation destination that a human acknowledges.** A failing cron entry writes to a log file on the host and tells
  no one; the same is true of the backup job.

### Alert owners

A scheduled job fails where nobody is standing, so each one has a named person who acts when it is red or silent. Today that
is one person for all of them.

| Job | What failure means | Owner | First action |
| --- | ------------------ | ----- | ------------ |
| `backend/bin/backup.php` (cPanel cron, every six hours) | The newest dump is older than the schedule allows | Gideon Akinlotan | Read `~/rotaflow-private/logs/backup.log` over SSH and run `php backup.php --self-check`. **No alert reaches anyone today** |
| `backend/bin/cron.php` (cPanel cron, every five minutes) | Notifications, retention and file deletion have stopped | Gideon Akinlotan | Read `~/rotaflow-private/logs/cron.log`. **No alert reaches anyone today** |
| `plan-drift-audit.yml` | The weekly register-against-code audit did not run or found drift | Gideon Akinlotan | Read the drift log at the end of `docs/SAAS.md` and the run log |
| `codeql.yml` | A code-scanning finding, or the analysis failed | Gideon Akinlotan | Security tab, then a fix or a dismissal with a reason |
| `backup.yml`, `auth-config.yml` | Red is expected: they target the retired stack | Gideon Akinlotan | None until Phase 5 repairs or removes them |

GitHub emails the account that owns a schedule when a scheduled run fails, if that account's notification settings allow it;
whether they do, and whether Actions can run at all (owner action O14 in `docs/SAAS.md`), has not been checked from this
repository (`NOT VERIFIED`).

**What does not alert anyone yet** (decided with the 2026 plan pack, 10 October 2026; owner action O2 in `docs/SAAS.md`).
Until each of these exists, a failure is found by a customer first:

1. GitHub email notifications for failed scheduled runs, switched on and tested.
2. Sentry alert rules that email the owner on a new issue and on an error-rate spike. None was found when the pack was written.
3. A free external uptime check on `/` and on `/api/health`.
4. An alert when the backup job or the cron job stops. The scheduled health probe of the Supabase era is gone with that
   database; `/admin/platform-health` only probes from an administrator's browser.

The exit is a test alert that reaches the owner's phone.

### A standing check before any release

Before shipping, over SSH: `ls -l ~/backups/rotaflow/db | tail -3` and the tail of `~/rotaflow-private/logs/backup.log`. A
newest dump more than one backup interval (six hours) plus the minutes a run takes old means a run was missed: stop and read
the log before shipping a release that carries a migration. This is a rule proposed here; no script enforces it. The
window between "a destructive migration merged" and "we noticed" is the window the backup has to cover.
