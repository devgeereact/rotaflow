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

## Release decision

**NOT READY** for a release that claims offline support or a recoverable
production environment.

Two lines carry that on their own. There is **no backup of production** (28) and
**no documented rollback** (29), which together mean a bad deploy or a bad
migration has no defined way back. Neither is a code defect and neither is
new. What is new is that they are now counted against a release decision instead
of sitting in a gap list.

The offline claims are the second problem, and a cheaper one. The queue is good
work and the gate says so. The reading story is a five-minute cache that the UI
describes as "your cached rota". Either narrow the copy or build the cache the
copy implies; `docs/OFFLINE-SPEC.md` sets out both options.

Nothing here blocks continued development, and the ordinary CI gates remain the
gate for merging. This is the gate for **deploying**, and it should be re-run
and re-dated at that point rather than read from this snapshot.
