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
npm run preview                      # smoke-test the production bundle before shipping
```

The only shippable output is `dist/` plus the repo-root **`.htaccess`** (HTTPS
redirect, SPA rewrite to `index.html`, MIME types, cache + security headers).

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

These are generic cPanel-static truths. Obey them regardless of tooling:

1. **Dry-run any mirror/delete first.** If your deploy mirrors with `--delete`, run it
   in dry-run and read the diff before writing. A mirror-delete pointed at the wrong
   directory silently wipes files that exist in **no repo and no backup** (e.g. a
   site's `uploads/`).
2. **Never mirror-delete a shared docroot.** If one directory serves multiple sites or
   holds loose `api.php` / `config.php` / `.htaccess`, target a **specific
   subdirectory** instead. Mirroring the shared root deletes the neighbours.
3. **Exclude runtime & secret files from deletes:** at minimum `uploads/`, `.env`,
   `config.php`, `*.bak*`, `*.zip`, `*.sql`, `error_log`, `node_modules`, `.git`,
   and **`.well-known/`** — see rule 4.
4. **Protect `.well-known/` on every single deploy.** `dist/` never contains it:
   `public/` holds only `favicon.svg`, `icons/`, `offline.html` and `robots.txt`, so
   the build has nothing to put there. But the live docroot **does** — it holds the
   TLS domain-validation file. To rsync, "not in my source" and "stale, delete it"
   look identical, so a mirror-with-delete removes it and certificate renewal fails.

   The deploy command for this app is therefore always:

   ```bash
   cpanel-deploy dist rotaflow.space --keep .well-known --go
   ```

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
- **Supabase / ImageKit / Inngest keys shipped to the browser must be write-only or
  RLS-guarded** (Supabase anon, ImageKit public, Inngest write-only event key). The
  `service_role` key and Inngest signing key are server-only and never touch this
  static bundle.
