# Deployment. Static PWA on cPanel

This app builds to a **static `dist/`** folder and is served as plain files. There is
**no server runtime**. The cPanel host runs PHP/Apache only (typically `git`,
`rsync`, `mysql`; **no `node`/`npm`**). So the frontend is **built locally** (or in CI)
and only the built artifacts are shipped.

> **RotaFlow target:** domain **`rota.gakinz.com`**, a subdomain of the `gakinz.com`
> cPanel account, deployed into its **own** docroot, `~/rota.gakinz.com/`. Never the
> shared `public_html/`. If you deploy through a personal wrapper/CI, that tooling still
> has to obey the safety rules below. They exist because breaking them has caused real
> outages and leaks.
>
> ⚠️ **Do not use `rotaflow.app`.** It was the placeholder in this repo until
> 2026-07-29, but it is **not ours**. It resolves to an unrelated shift-scheduling
> product. It had leaked into `VITE_APP_URL` (the auth redirect target), the VAPID
> subject and the SMTP identities. All are now `rota.gakinz.com` / `gakinz.com`.
>
> **DNS/TLS for the subdomain:** add an `A` record `rota` → `185.61.152.45` in
> Cloudflare, **proxied (orange cloud)**. The origin holds Cloudflare _Origin_ certs
> that browsers reject directly, so grey-clouding takes the site down instantly.
> Cloudflare's edge certificate already covers `*.gakinz.com` (verified 2026-07-29), so
> no edge certificate work is needed; confirm the **origin** cert also covers the
> subdomain in cPanel → SSL/TLS.
>
> **Auth:** `VITE_APP_URL` must match Supabase → Authentication → URL Configuration
> (Site URL `https://rota.gakinz.com`, Redirect URLs `https://rota.gakinz.com/**`).
> A mismatch silently bounces every sign-in to the Site URL.
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
   `config.php`, `*.bak*`, `*.zip`, `*.sql`, `error_log`, `node_modules`, `.git`.
4. **Keep backups OUTSIDE every webroot.** Apache serves `.bak` / `.zip` / `.sql` as
   **plain text**, so a backup left in a docroot leaks its contents (including any
   credentials) to the public internet. Put backups in a directory that is not served
   (e.g. `~/private_backups/`).
5. **Never commit real secrets.** `.env` stays git-ignored; only `.env.example`
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
