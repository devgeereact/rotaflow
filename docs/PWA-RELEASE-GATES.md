# PWA release gates

The recordable release gate from GEE OS
(`~/.agents/gee-os/standards/PWA-RELEASE-GATES.md`), kept here as project-local
evidence. Every line carries a status, the evidence for it and the date it was
taken.

Statuses are `PASS`, `FAIL`, `PARTIAL`, `NOT TESTED`, `N/A` (with a reason) and
`BLOCKED` (with the dependency). **A ticked box with no observed behaviour behind
it is not a pass.** `NOT TESTED` is the correct and expected answer for anything
nobody ran; rounding it up to `PASS` is the failure this file exists to prevent.

This file records evidence. It does not set capability status: that stays in
`docs/SAAS.md`, and `docs/GEE-OS.md` holds the mapping between the two.

---

## Run of 4 September 2026

Local gates on branch `chore/gee-os-adoption`, from a clean build. Where a check
needs Docker, a browser or the live environment, it says so rather than
borrowing an older result.

### Runtime and network

| #   | Gate                                                     | Status  | Evidence                                                                                                                                                                         |
| --- | -------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Application works online                                 | PASS    | `npm run build` clean; CI green on the three most recent merged pull requests                                                                                                    |
| 2   | Network failure produces intentional behaviour           | PARTIAL | `OfflineBanner`, `FailedWritesNotice` and per-screen queued-write notices all exist and are unit-tested; no browser run has ever exercised them                                  |
| 3   | Offline behaviour matches the approved specification     | PARTIAL | the specification did not exist until today. `docs/OFFLINE-SPEC.md` now states it, and the three queued writes match it; the read story is weaker than the UI copy claims        |
| 4   | Service worker registration, scope and lifecycle         | PASS    | one registration site, `src/components/UpdatePrompt.tsx:15`, with `injectRegister: null`; scope `/`; `generateSW` config at `vite.config.ts:70-151`                              |
| 5   | Old caches are removed safely                            | PASS    | `cleanupOutdatedCaches: true`, `vite.config.ts:114`                                                                                                                              |
| 6   | New versions update without trapping users on stale code | PARTIAL | `registerType: 'prompt'` with `skipWaiting: false` and a Reload prompt, which is the right design; never exercised by a test or a recorded manual run                            |
| 7   | Failed requests recover appropriately                    | PARTIAL | five attempts, transient versus permanent classification, dead-letter with Retry and Discard: `src/services/syncQueue.ts`, 40-plus unit cases. Recovery of _reads_ is untested   |
| 8   | Duplicate submissions prevented or idempotent            | PASS    | `client_event_id` minted before the first attempt; partial unique indexes in `supabase/migrations/0081_outbox_idempotency.sql`; a same-key `23505` is treated as already applied |
| 9   | API failures have visible, recoverable states            | PARTIAL | true on the three queued paths; approvals, publish and every console screen surface a failure without a recovery path                                                            |

### Installation and navigation

| #   | Gate                                           | Status     | Evidence                                                                                                                                                                                              |
| --- | ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Installation works on supported platforms      | NOT TESTED | `InstallPrompt` and `usePWAInstall` exist; no install has been performed and recorded                                                                                                                 |
| 11  | Icons and launch presentation work             | NOT TESTED | three icons ship (192, 512, 512 maskable) and an `apple-touch-icon` is linked; nobody has looked at an installed launch                                                                               |
| 12  | The manifest is valid                          | PASS       | emitted as `dist/manifest.webmanifest` and linked from `index.html`; source at `vite.config.ts:79-100`. No `id`, no screenshots: neither blocks installation, `id` is worth adding before any listing |
| 13  | Start URL, scope, deep links, refreshed routes | PARTIAL    | `navigateFallback: index.html` with **no denylist**, so every unmatched path returns the shell. That is what makes a missing file answer 200, which has produced a false security finding here before |

### Identity, data and synchronisation

| #   | Gate                                                | Status  | Evidence                                                                                                                                                                               |
| --- | --------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | Authentication survives the intended lifecycle      | PARTIAL | supabase-js persists the session, so a signed-in user boots offline. A queued write replayed _after_ the session expires is unproved, and it is the realistic case                     |
| 15  | Private data is not cached accidentally             | PASS    | one runtime rule touches domain data, `/rest/v1/` NetworkFirst for 5 minutes, purged on sign-out by `clearTenantState`. `/auth/v1/`, `/functions/v1/` and `/storage/v1/` match no rule |
| 16  | User work is not silently lost                      | PASS    | nothing is dropped without saying so: dead-lettered writes surface in `FailedWritesNotice` on all three queueing screens, with Retry and Discard                                       |
| 17  | Queue, retry, conflict and sync states are explicit | PARTIAL | queue and retry yes; **conflict has no offline story at all**, only server-side rejection. A queued leave request that the server refuses dead-letters and a human re-enters it        |
| 18  | Database policies and permissions verified          | BLOCKED | pgTAP needs Docker, which is not available on this machine. `supabase/tests/database/rls_invariants.test.sql` runs in CI's `db-tests` job only                                         |
| 19  | Role permissions verified server-side               | PASS    | RLS plus the function behind each RPC; the register records three separate cases where a browser-only control was found and closed (`0070`, `0074`, `0080`)                            |

### Experience and release

| #   | Gate                                         | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20  | Mobile layout on supported sizes             | NOT TESTED | no device or emulator run recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 21  | Desktop layout on supported sizes            | PARTIAL    | Playwright renders 40 screens in CI; that is a render, not a layout review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 22  | Accessibility checked with recorded evidence | PARTIAL    | 13 public pages at zero axe contrast violations; the authenticated screens were never scanned until 30 August and the real figure was 172, tracked as GAP-030                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 23  | Production build succeeds                    | PASS       | `npm run build`, 4 September 2026: 166 precache entries, 1,997 KiB precached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 24  | No critical console or runtime errors        | NOT TESTED | requires a browser session; none was run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 25  | No exposed secrets                           | PASS       | every inlined `VITE_*` is public by design (anon key, publishable key, DSN, VAPID **public** key). A pattern scan of `dist/` matched only the words `service_role` inside three `.map` files' comments, and `*.map` is excluded from the deployed set                                                                                                                                                                                                                                                                                                                                        |
| 26  | No critical security findings open           | PARTIAL    | `npm audit --audit-level=high` runs in CI's `verify` job and is green; no manual review of `supabase/functions/**`, which is excluded from typecheck and lint                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 27  | Monitoring and error reporting operational   | PARTIAL    | Sentry is wired in `src/lib/sentry.ts` with the release tagged to the git SHA; ingest was verified on 30 August and has not been re-checked today                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 28  | Backup and recovery exist                    | **FAIL**   | `.github/workflows/backup.yml` **has never succeeded**. Verified today: it failed again at 07:24 on 4 September, six seconds in, because the repository holds exactly one secret (`OPENROUTER_API_KEY`) and the workflow needs `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`. On the Supabase side, `pitr_enabled: false` and an empty backup list were read on 13 August and **not re-checked today** — the project (`vwqqbdvlskngrqrejzxi`, eu-west-1) was confirmed `ACTIVE_HEALTHY`, which says nothing about backups. Even if that has since changed, the nightly dump has produced nothing |
| 29  | Rollback documented and feasible             | **FAIL**   | `docs/DEPLOYMENT.md` contains no rollback procedure. Deploys are an rsync mirror, so the previous build is gone once it completes, and migrations apply to production on merge                                                                                                                                                                                                                                                                                                                                                                                                               |
| 30  | Production environment verified directly     | NOT TESTED | not checked from this session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Local gate evidence, 4 September 2026

All green, and worth stating precisely because a green local run is a partial
signal here: the `e2e-authenticated` and `db-tests` CI jobs need Docker and did
not run.

```text
npm run typecheck      PASS
npm run lint           PASS   (--max-warnings 0)
npm run format:check   PASS
npm test               PASS   808 tests, 45 files
npm run build          PASS   166 precache entries, 1,997 KiB
npm run check:bundle   PASS   precache 678/760 KiB gzip, entry 132/175 KiB
npm run check:migrations  PASS   no new migrations on this branch
npm run check:export   PASS   40 tenant tables accounted for
npm run check:docs     PASS   113 capability rows match the summary
npx playwright test    NOT TESTED   not run locally on this branch
supabase test db       BLOCKED      needs Docker
```

---

---

## Run of 4 September 2026, second — production-readiness pass

The run above was taken on branch `chore/gee-os-adoption` before this pass and
is left standing as the record of that moment. This run is taken after the
deploy of `9ae1a54`, from a real browser against **the live origin**, so several
lines that could only be `NOT TESTED` before now have observed behaviour behind
them.

Only the lines whose status or evidence changed are restated. Everything not
listed here keeps the status recorded above, and the reason it kept it.

| #   | Gate                                           | Was        | Now      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2   | Network failure produces intentional behaviour | PARTIAL    | PARTIAL  | still partial, but no longer unexercised: Playwright with `context.setOffline(true)` against the deployed build loaded `/` and `/pricing` from the service worker with real content. The queued-write path is still only unit-tested                                                                                                                                                                                                                                                                                                                                     |
| 3   | Offline behaviour matches the specification    | PARTIAL    | PARTIAL  | unchanged in substance. The read story is still the five-minute cache `docs/OFFLINE-SPEC.md` describes; GAP-049 stands                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | New versions update without trapping users     | PARTIAL    | PARTIAL  | `UpdatePrompt` now has four unit assertions covering announce, apply and dismiss. No test installs a second worker, so the update path itself is still unproved in a browser — GAP-054                                                                                                                                                                                                                                                                                                                                                                                   |
| 13  | Start URL, scope, deep links, refreshed routes | PARTIAL    | **PASS** | verified live: `/`, `/pricing` and the deep route `/app/dashboard` all 200 through Cloudflare, and `/sitemap.xml`, `/robots.txt` and `/.well-known/security.txt` return `application/xml` and `text/plain` **while a service worker is controlling the page** — the `navigateFallbackDenylist` added in this pass                                                                                                                                                                                                                                                        |
| 18  | Database policies and permissions verified     | BLOCKED    | **PASS** | still `BLOCKED` locally — Docker was never started — but CI's `db-tests` job ran the full pgTAP suite on this branch: **387 assertions across 44 files, all passing**, including `rls_invariants.test.sql` and the eight new `platform_write_roles.test.sql` assertions. A gate that can only run in CI is not the same as a gate nobody ran                                                                                                                                                                                                                             |
| 20  | Mobile layout on supported sizes               | NOT TESTED | **PASS** | Playwright at 320, 360, 375, 390, 414, 768, 1024, 1280, 1440 and 1920 px across all 14 public routes: **zero horizontal overflow**, measured as `documentElement.scrollWidth > clientWidth` rather than by eye. Touch targets checked separately at 375 px: 18 targets under 24×24, **all 18 meeting the WCAG 2.2 2.5.8 spacing exception** (nearest target ≥ 24 px centre-to-centre)                                                                                                                                                                                    |
| 21  | Desktop layout on supported sizes              | PARTIAL    | **PASS** | same run, the 1024–1920 px half                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 22  | Accessibility checked with recorded evidence   | PARTIAL    | PARTIAL  | 80 Playwright assertions pass including axe scans of 14 public pages and 26 authenticated screens, at **0 contrast violations in both light and dark**. Improved in this pass: the update toast was the one global banner with no `role`, so it entered the DOM silently; it is now `role="status" aria-live="polite"` with a labelled dismiss. Still partial because GAP-030's status-palette debt is open and no manual screen-reader pass has been done                                                                                                               |
| 24  | No critical console or runtime errors          | NOT TESTED | **PASS** | a real Chromium session against `https://rotaflow.space` across `/`, `/features`, `/pricing`, `/legal/cookies`, `/login`, `/signup`: **zero** `console.error` and zero `pageerror`. The only third-party origin contacted across all six is Sentry's EU ingest — no `fonts.googleapis.com`, which is what makes the cookie notice true in production rather than only on `main`                                                                                                                                                                                          |
| 25  | No exposed secrets                             | PASS       | **PASS** | strengthened, and it needed to be. The bundle carried `VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_…"`, a variable no source file reads, because `src/lib/env.ts` used a dynamic `import.meta.env[key]` and Vite therefore inlined the whole env object. Keys are named statically now, and `check:bundle` fails on any undeclared `VITE_*` in `dist/`. Verified on the deployed build: exactly nine names, no `pk_live_`. The key is publishable, so this is a configuration defect rather than a disclosure — but the mechanism would have admitted a secret just as readily |
| 26  | No critical security findings open             | PARTIAL    | PARTIAL  | `0116` closes the platform-write escapes: `delete_organisation`, `connect_integration` and `set_org_integration_status` authorised on role-blind `is_platform_admin()`. **Verified — CI's `db-tests` job ran the eight new pgTAP assertions and they pass**, 387 assertions across 44 files. Still partial for two reasons, both stated rather than rounded off: the migration is **not merged**, so production still holds the old guards, and the _read_ half is open as GAP-053                                                                                       |
| 29  | Rollback documented and feasible               | **FAIL**   | PARTIAL  | `docs/DEPLOYMENT.md` now has a rollback section: build the previous commit, `--keep` the server-owned subtrees, and do **not** ship `.htaccess` unless that is what is being rolled back. It states what a rollback cannot do — the edge keeps the superseded chunk for a year, an already-updated client needs another prompt, and **a migration does not roll back at all**. Not `PASS`: it has been reasoned and the deploy half exercised, but no rollback has been performed                                                                                        |
| 30  | Production environment verified directly       | NOT TESTED | **PASS** | verified after this deploy, from outside: ten paths return their real content types; direct-to-origin at `185.61.152.45` returns **403** while `/.well-known/security.txt` returns **200** through the ACME exemption; CSP, HSTS, nosniff, frame-options, referrer and permissions policies all present, with the CSP now carrying **no Google Fonts origin**; and the deployed commit confirmed **by content** — `9ae1a54` found inside the `index-*.js` the live HTML references, not inferred from a filename                                                         |

### Local gate evidence, 4 September 2026 (second run)

```text
npm run typecheck         PASS
npm run lint              PASS   (--max-warnings 0)
npm run format:check      PASS
npm test                  PASS   849 tests, 48 files (4 new: UpdatePrompt)
npm run build             PASS   166 precache entries, 2,009 KiB
npm run check:bundle      PASS   precache 682/760 KiB gzip, entry 134.2/175 KiB
npm run check:migrations  PASS   1 new migration, no undeclared destructive statements
npm run check:export      PASS   40 tenant tables accounted for
npm run check:docs        PASS   113 capability rows, migration count 116
npx playwright test       PASS   80 passed, 1 skipped (the authenticated loop needs Docker)
supabase test db          BLOCKED locally, PASS in CI — see below
```

**`supabase test db` could not run on this machine** (Docker was never started),
so `0116` was first checked with libpg-query — real PostgreSQL grammar, which
proves syntax and nothing about behaviour. CI has Docker, and its `db-tests` job
is where the assertions actually executed:

```text
db-tests            PASS   387 assertions, 44 files (up from 379)
e2e                 PASS
e2e-authenticated   PASS   a real sign-up → create-org → dashboard loop
verify              PASS
CodeQL              PASS
```

The first `db-tests` run **failed**, and it is worth recording why rather than
only that it now passes. The fixture selected a connector `where available`, and
`0073` set `available = false` on all eight seeded connectors — so 0 of 8
assertions ran. The guard was correct; the fixture was not. What that exposed:
`connect_integration` refuses every call on availability grounds _before_
reaching the role check, and `set_org_integration_status` has no row to act on,
so both are latent. **`delete_organisation` is not**, and it is the one that
destroys a tenant.

## Release decision

### Superseded — the decision of the first run, 4 September 2026

**NOT READY** for a release that claims offline support or a recoverable
production environment. Two lines carried it: no backup of production (28) and
no documented rollback (29). Kept because a decision that quietly disappears
when it becomes inconvenient is worth less than one that stays visible.

### Current — after the production-readiness pass, 4 September 2026

**NOT READY FOR PRODUCTION.**

Not "ready with minor fixes". The pass closed real defects and the deployed site
is materially better than the one standing this morning, but the decision turns
on one line, and it is the same line as before.

**There is no backup of production, and no restore has ever been performed.**
`.github/workflows/backup.yml` has never succeeded — the repository holds one
secret and the workflow needs two more. On the Supabase side `pitr_enabled` is
false with an empty backup list. That is gate 28, GAP-001, CAP-095 and ❓-005,
and every one of them is outside what anybody but the account owner can do.

The reason that single line decides it is worth stating plainly, because it is
easy to read "no backups" as a hygiene item. RotaFlow holds staff personal data
— names, contact details, emergency contacts, DBS and right-to-work documents,
and optional health fields. `delete_organisation` removes a tenant and
everything in it, and this pass found it authorised by a role-blind check.
Migrations apply to production on merge. Any one of those, on a bad day,
produces data loss with no defined way back. A product can ship without
structured data or an offline read cache; it should not hold other people's
employment records with nothing to restore from.

Second, and now closed: `0116` **merged and applied**. It landed in `ac483ab`
(#291) and, because a merge applies a migration to production immediately, the
role-blind `delete_organisation` it replaced is gone from production too. This
paragraph described it as verified-but-unmerged until 5 September 2026, which is
the failure mode this file exists to prevent: a gate that records a decision as
outstanding after somebody took it.

What this pass did change, and what the evidence supports:

- Production runs the current `main` again, having been eight commits and four
  days behind. Verified by the commit SHA found **inside** the served bundle.
- No third-party origin is contacted from the public site except Sentry, so the
  cookie notice is now true where it is published, not only on `main`.
- The bundle no longer carries an environment variable the application does not
  read, and CI now fails if one reappears.
- Zero console errors, zero axe contrast violations, zero horizontal overflow
  across ten viewport widths, and every undersized touch target meets the
  WCAG 2.2 spacing exception.

### What would change the decision

In order, and only the first is blocking:

1. **Add `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`** to the repository secrets,
   let `backup.yml` succeed once, then **restore that dump into a scratch
   project and open the application against it.** A backup nobody has restored
   is a belief. Add `SUPABASE_ACCESS_TOKEN` at the same time so `auth-config.yml`
   starts watching the Auth settings.
2. **Review `0117`, `0118` and `0119`** from the delivery audit of 5 September
   2026, which are written and verified but not merged. `0118` closes a P0: any
   manager could make themselves an owner by writing an invite row directly.
   Merging applies all three to production immediately, so it is the owner's
   call rather than an agent's.
3. Then re-run this file. It is the gate for **deploying**, and it is meant to be
   re-dated at that point rather than read from a snapshot — including this one.

Nothing here blocks continued development, and the ordinary CI gates remain the
gate for merging.
