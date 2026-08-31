# Deployment. Static PWA on cPanel

This app builds to a **static `dist/`** folder and is served as plain files. There is
**no server runtime**. The cPanel host runs PHP/Apache only (typically `git`,
`rsync`, `mysql`; **no `node`/`npm`**). So the frontend is **built locally** (or in CI)
and only the built artifacts are shipped.

> **RotaFlow target:** domain **`rotaflow.space`**, its own registered domain,
> deployed into its **own** docroot, `~/rotaflow.space/`. Never the shared
> `public_html/`. If you deploy through a personal wrapper/CI, that tooling still
> has to obey the safety rules below. They exist because breaking them has caused real
> outages and leaks.
>
> ⚠️ **Do not use `rotaflow.app`.** It was the placeholder in this repo until
> 2026-07-29, but it is **not ours**. It resolves to an unrelated shift-scheduling
> product. It had leaked into `VITE_APP_URL` (the auth redirect target), the VAPID
> subject and the SMTP identities.
>
> **The previous host — a subdomain of a personal domain — was retired 2026-08-29:**
> docroot and mailbox archived to `~/private_backups/docroots/`, mail account deleted,
> and all 15 of its DNS records removed from the parent zone. It should not appear in
> any config. It carried SPF and DKIM but **no MX**, which is why mail addressed to it
> was undeliverable; `rotaflow.space` has the full record set.
>
> **DNS/TLS:** `A @` and `CNAME www` → `185.61.152.45`, both **proxied (orange
> cloud)**. The origin holds Cloudflare _Origin_ certs that browsers reject directly,
> so grey-clouding takes the site down instantly. `rotaflow.space` is its own zone
> with its own Origin cert — the `*.gakinz.com` wildcard does not cover it.
>
> ⚠️ **The live `.htaccess` is not the repo file.** The server copy is the repo file
> with a `# === BEGIN Cloudflare-origin-lock ===` block prepended, which 403s any
> request arriving without a `CF-RAY` header (with `/.well-known/` exempt so ACME
> still works). Ship the repo file alone and that lock is silently removed. Prepend
> it, or leave `.htaccess` out of the deploy entirely.
>
> **Auth:** `VITE_APP_URL` must match Supabase → Authentication → URL Configuration
> (Site URL `https://rotaflow.space`, Redirect URLs `https://rotaflow.space/**`).
> A mismatch silently bounces every sign-in to the Site URL. Note this allowlist has
> been clobbered by another project's URLs once before (2026-08-29) — when auth
> redirects misbehave, read it before assuming the bug is in the app.
>
> **PII posture (important. RotaFlow holds staff personal data):** RotaFlow stores
> names, contact details, emergency contacts, documents (DBS/RTW/visa) and optional
> health/NHS fields for UK employees. Create the **Sentry project in the EU region**
> (ingest host like `o<org>.ingest.de.sentry.io`) with **PII scrubbing on**, and set the
> region up front. It cannot be changed later. Handle data under UK GDPR: honour
> export/delete, keep audit logs, and never log personal data to the console.

---

## 1. Build locally

```bash
npm run typecheck && npm run lint    # gates
npm run build                        # emits ./dist (hashed JS/CSS, sw.js, manifest, source maps)
npm run check:bundle                 # size budgets + "no DEV page shipped"; reads dist/
npm run preview                      # smoke-test the production bundle before shipping
```

The only shippable output is `dist/` plus the repo-root **`.htaccess`** (HTTPS
redirect, SPA rewrite to `index.html`, MIME types, cache + security headers).

`check:bundle` runs in CI's `verify` job too, so a breach fails the PR rather
than the deploy. Run it locally anyway before shipping a build you are about to
rsync: it is the only check that reads the actual output, and the two bundle
regressions this repo has had — DEV preview pages precached to every visitor
(#75) and a lazy route becoming a static import (#69) — were both invisible to
typecheck, lint and the test suite. Budgets and the reasoning behind each number
live in `bundle-budget.json`; raising one is a reviewable diff, not a flag.

---

## 2. Ship the artifacts, into THIS app's own docroot

Deploy `dist/*` and `.htaccess` into **the target site's own document root or a
dedicated subdirectory**, for example `~/<domain>/` for an addon domain, or
`public_html/<app>/` for a subpath. **Never** deploy into a shared docroot that other
sites live in.

Typical options:

- **rsync over SSH** (fast, incremental) into `<docroot>/`.
- **cPanel Git Version Control** + a `.cpanel.yml` copy step.
- **FTP/SFTP** upload of `dist/` (CI or manual).

After deploy: load the site over **HTTPS** and confirm the app boots and the install
prompt appears.

> **An HTTP 200 is not evidence that a file deployed.** This is a SPA: the server
> rewrites unknown paths to `index.html`, so a request for a file that is not on the
> server returns `200` with the app's HTML, not `404`. Curling a URL and seeing `200`
> therefore proves nothing — it has already produced one false conclusion in this
> repo's history. Verify by **content** (`curl -s <url> | head`, or grep the response
> for something only that file contains) or over **SSH** (`ssh cpanel ls -la <path>`).

---

## 3. Deploy safety rules (non-negotiable)

Three of these were learned by breaking the live site, not by reading a manual. They are
generic cPanel-static truths — obey them regardless of tooling:

0. **Three traps that have each cost a live site once.**
   - **cPanel's Document Root field is relative to `$HOME`.** Typing the absolute path
     produces `/home/<user>/home/<user>/<domain>`. Leave the auto-filled value alone.
   - **`rsync -a` preserves local file modes.** This repo's files are `600` locally, so
     `.htaccess` landed unreadable by the web server and the site served a **directory
     listing with no SPA routing**. Normalise to dirs `755` / files `644` over SSH after
     each sync — macOS ships `openrsync`, which rejects `--chmod=D755,F644`.
   - **The SPA fallback returns 200 for every unknown path.** A `200` is therefore not
     evidence a file exists. Check the content-type, or verify over SSH.

1. **Dry-run any mirror/delete first.** If your deploy mirrors with `--delete`, run it
   in dry-run and read the diff before writing. A mirror-delete pointed at the wrong
   directory silently wipes files that exist in **no repo and no backup** (e.g. a
   site's `uploads/`).
2. **Never mirror-delete a shared docroot.** If one directory serves multiple sites or
   holds loose `api.php` / `config.php` / `.htaccess`, target a **specific
   subdirectory** instead. Mirroring the shared root deletes the neighbours.
3. **Exclude runtime & secret files from deletes:** at minimum `uploads/`, `.env`,
   `config.php`, `*.bak*`, `*.zip`, `*.sql`, `error_log`, `node_modules`, `.git`,
   and the TLS validation directory — see rule 4.
4. **Protect the TLS validation directory on every single deploy.** The live
   docroot holds the domain-validation file certificate renewal depends on. To
   rsync, "not in my source" and "stale, delete it" look identical, so a
   mirror-with-delete removes it and renewal fails.

   The full command for this app — `cgi-bin` is created by cPanel and the deploy
   guard refuses without it, and the live `.htaccess` is the repo file with the
   server's Cloudflare origin-lock block prepended:

   ```bash
   cpanel-deploy dist rotaflow.space \
     --keep .well-known/pki-validation \
     --keep .well-known/acme-challenge \
     --keep cgi-bin \
     --with-htaccess <composed-file> --go
   ```

   ⚠️ **This changed on 2026-08-30, and the old form now has a silent failure
   mode.** It used to be `--keep .well-known`, on the premise that "`dist/` never
   contains it". That premise stopped being true when `public/.well-known/
security.txt` was added (GAP-014) — and `--keep` is implemented as an rsync
   `--exclude`, which is **bidirectional**. So the whole-directory form would have
   built a `security.txt`, passed CI, and quietly never uploaded it.

   The two paths above are named individually instead. `pki-validation` is what the
   live docroot actually holds — verified over SSH, it is the only entry —
   and `acme-challenge` is listed as well because a future change of validation
   method would write there instead, and an unprotected renewal path is not a thing
   to discover during an outage.

   Anything else under `.well-known/` is now mirrored from `dist/`, which is what
   lets `security.txt` reach production.

   This is not optional and not situational. It applies to every deploy of this
   app, including a one-file hotfix.

5. **Keep backups OUTSIDE every webroot.** Apache serves `.bak` / `.zip` / `.sql` as
   **plain text**, so a backup left in a docroot leaks its contents (including any
   credentials) to the public internet. Put backups in a directory that is not served
   (e.g. `~/private_backups/`).
6. **Never commit real secrets.** `.env` stays git-ignored; only `.env.example`
   (key names, no values) is tracked. Confirm with `git status --ignored` after setup.

---

## 4. Source maps → Sentry

Upload source maps as part of the release so stack traces de-minify, but **do not ship
`*.map` files to the public docroot**. Exclude them from the deployed set (or delete
after upload). See `docs/ARCHITECTURE.md` §8 for the security posture.

---

## 5. Managed-service notes (deploy-relevant)

- **Sentry region is fixed at project creation and cannot be changed later.** Pick the
  correct data region up front (e.g. an EU/DE ingest host looks like
  `o<org>.ingest.de.sentry.io`); apps handling EU/UK personal data should be created in
  the EU region with PII scrubbing on. Only browser-safe DSN ships to the client.
- **CodeRabbit only reviews pull requests.** Use branch → PR → merge; work pushed
  straight to the default branch is never reviewed.
- **Every key shipped to the browser must be write-only or RLS-guarded**
  (Supabase anon, ImageKit public). The `service_role` key, Stripe's secret and
  webhook secrets, the VAPID private key and all SMTP credentials are server-only and
  never touch this static bundle. The Inngest write-only event key is gone as of
  2026-08-31 — it had gone on shipping, unused, for the four days after `0087`
  deleted its last reader, because Vite inlines every `VITE_*` variable into
  `import.meta.env` whether code reads it or not. **Retiring a service means
  removing its variable from `.env`, then checking the built bundle.**

## Composing the live `.htaccess`

`--with-htaccess` replaces the file that enforces the Cloudflare origin lock. Get it wrong
and the site either goes dark or silently reopens direct-to-origin, so the procedure is
written down rather than reconstructed each time. Done on 2026-08-31 to carry a CSP change
through; it worked, and these are the steps that made it safe.

1. **Back the live file up outside every docroot first.**
   `ssh cpanel 'cp ~/rotaflow.space/.htaccess ~/private_backups/configs/rotaflow.space-htaccess.bak-<date>'`
2. **Fetch it and diff it against the repo file minus the lock block.** They should differ
   only where the repo has moved on. In the 2026-08-31 run the whole difference was three
   things — the CSP entry being removed, two references to a document deleted weeks earlier,
   and the new comment — which is what makes "prepend the lock to the current repo file" a
   safe composition rather than a guess. **If the diff shows anything you cannot explain,
   stop:** it means the live file carries a hand-edit nobody wrote down.
3. **Compose as `lock + repo file`, and assert on the result before uploading.** Thirteen
   properties were checked in that run: the lock is first, `CF-RAY` guard present,
   `/.well-known/` exempted, the `[F,L]` refusal rule present, the SPA fallback intact,
   exactly one CSP header, HSTS and nosniff still there, and the specific change actually
   made. Cheap, and it is the only opportunity to catch a bad splice.
4. **Dry-run.** The only change should be `.htaccess` itself, with no deletions.
5. **Verify from outside afterwards**, all of it:

   | Check | Expect |
   | --- | --- |
   | `/` and a deep route (`/app/dashboard`) | 200 — the second proves the SPA fallback survived |
   | the hashed bundle and `/.well-known/security.txt` | 200 |
   | `curl --resolve <domain>:443:185.61.152.45` | **403** — the lock is intact |
   | the same, to `/.well-known/security.txt` | **200** — the ACME exemption survived, or renewal fails months later |
   | response headers | CSP reflects the change; HSTS and `X-Content-Type-Options` still present |

   The fourth row is the one that fails silently. A lock with no `/.well-known/` exemption
   looks perfect until a certificate comes up for renewal.

## A deploy does not undo a leak

Learned on 2026-08-31, deploying the removal of a retired credential (HARDEN-010).

`dist/assets/*` is served with `cache-control: public, max-age=31536000, immutable`, which
is correct — the filenames are content-hashed, so a changed file is a changed name. The
consequence is that **Cloudflare keeps serving a superseded chunk from its edge for up to a
year**, at a URL that nothing links to any more but that anybody who has seen it can still
fetch. Verified: the pre-`0087` `useInngestDispatch-*.js` returned 200 with
`cf-cache-status: HIT` after the deploy that removed it from the origin.

So the checks after a deploy that exists to *remove* something must be:

1. **Over SSH, not over HTTP.** `ssh cpanel 'ls ~/<docroot>/assets/ | grep <thing>'`. HTTP
   answers from the edge, and the SPA fallback answers 200 for a missing file anyway —
   `docs/SAAS.md` has a security finding that was false for exactly that reason.
2. **Then the served bundle by content**, not by status code: fetch the `index-*.js` the
   live HTML actually references and grep it.
3. **Then accept that the old URL stays fetchable.** Purge it if a token exists; the
   account has none stored on the deploying machine today. Either way a purge is not the
   remedy for a leaked credential — **rotation is.** A cached artefact you cannot reach is
   still an artefact somebody else already has.

The general rule: shipping a new artefact hides the old one from new visitors. It does not
retract it. Anything secret that was ever in a built bundle is compromised, and the only
action that changes that is revoking it at the service that issued it.
