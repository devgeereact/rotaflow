# Offline specification

What RotaFlow actually does without a network, feature by feature, with the
evidence for each. Written 4 September 2026 by reading the code, not the claims.

## Why this file exists

The product describes itself as offline-first in `package.json`, in `CLAUDE.md`,
in `README.md` and on the marketing site. That was never written down as a
per-feature statement, so "offline-first" was doing a lot of work unsupervised.
Reading the code produced a narrower and more interesting answer than either
"it works offline" or "it does not".

GEE OS asks for exactly this classification before a PWA can be called ready
(`~/.agents/gee-os/systems/pwa/PWA-ENGINEERING-OS.md`). Its rule is the one that
matters here: **do not promise generic offline support; state exactly what works
and what does not.**

## The honest one-paragraph version

The **app shell** is genuinely offline: 166 precached entries, every lazy route
chunk included, so the application loads and navigates with no network. **Three
writes** are genuinely offline: clocking in or out, requesting leave, and
offering a swap, all queued in IndexedDB with idempotency keys and replayed on
reconnect. **Everything else needs the network.** There is no durable offline
copy of any domain data. What looks like offline reading is a five-minute,
fifty-entry service-worker cache that nothing guarantees will hold the thing you
are looking at.

## Classification

GEE OS classes are `offline read`, `offline write`, `offline queue`,
`offline processing`, `network required` and `never cache`.

| Feature area                              | Class             | Evidence                                                                               |
| ----------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| App shell, boot, install, update prompt   | offline read      | 166 precache entries, `vite.config.ts:111`; `src/App.tsx:84`                           |
| Marketing pages, legal pages              | offline read      | static React, precached chunks, `navigateFallback: index.html` `vite.config.ts:113`    |
| Clock in / clock out, including GPS       | **offline queue** | `src/pages/app/ClockInPage.tsx:314-358`, replay `src/services/syncQueue.ts:38`         |
| Leave request (staff submitting)          | **offline queue** | `src/pages/app/LeavePage.tsx:312-316`                                                  |
| Shift swap request or offer (staff)       | **offline queue** | `src/pages/app/SwapsPage.tsx:209-213`                                                  |
| Rota view, my shifts, clock history       | network required  | no application cache; only the shared 5 minute SW cache, `vite.config.ts:128-138`      |
| Rota builder and publish                  | network required  | `publish_rota` is an RPC and is not queued, `src/components/FailedWritesNotice.tsx:16` |
| Leave, swap and overtime approvals        | network required  | no `enqueue` on any review path, `src/pages/app/LeavePage.tsx:341,366`                 |
| Announcements                             | network required  | direct service reads, nothing cached or queued                                         |
| Notifications list, web push subscription | network required  | `src/hooks/useWebPush.ts:76,108`                                                       |
| Reports, timesheets, CSV export           | network required  | generated from live reads                                                              |
| Admin and platform console                | network required  | every `platform*Service` read                                                          |
| Sign in, magic link, password reset       | network required  | `/auth/v1/` matches no runtime cache rule, `vite.config.ts:130`                        |
| An existing session                       | offline read      | supabase-js persists it in `localStorage`, so a signed-in user boots offline           |
| Conflict resolution while offline         | **none**          | server-side rejection only, see below                                                  |

## The write queue, which is the strong part

`src/lib/offlineOutbox.ts` is raw IndexedDB, database `rotaflow-outbox` at
version 2, with `queued_writes` and `dead_letters` stores and a v1 to v2
migration. `src/services/syncQueue.ts` replays it.

- **Idempotency is real.** Every queued write carries a `client_event_id`
  minted before the first online attempt, and a same-key `23505` on replay is
  treated as success rather than a duplicate insert
  (`src/services/syncQueue.ts:143-160`). The database side is
  `supabase/migrations/0081_outbox_idempotency.sql`, which adds the column and a
  partial unique index per table. This is the design the PWA engine asks for.
- **Failure is classified, not retried blindly.** Permanent failures dead-letter
  and let the queue continue; transient ones stop the flush and wait for the next
  reconnect; five attempts exhausts a write. SQLSTATE classes `08/40/53/57/58`,
  HTTP 408/425/429 and 5xx are transient.
- **Nothing is silently discarded.** A dead-lettered write surfaces in
  `src/components/FailedWritesNotice.tsx` with Retry and Discard, on all three
  screens that can queue. This satisfies the engine's hardest rule, that user
  work is never silently lost.
- **Queued is not reported as saved.** The clock screen says "saved offline, will
  sync automatically" and shows queue depth; the leave and swap modals carry the
  same notice.

## What the reading story really is

There is one runtime cache for domain data:

```text
https://*.supabase.co/rest/v1/*   NetworkFirst
  networkTimeoutSeconds: 5
  maxEntries: 50
  maxAgeSeconds: 300
```

That is opportunistic, shared across every screen, and evicted by an LRU. Whether
a given rota is readable offline is genuinely **unknown** without measuring it on
a real device, and nothing measures it. Note what the pattern does not cover:
`/auth/v1/`, `/functions/v1/`, `/storage/v1/` and Realtime WebSockets are all
uncached, which is correct for authentication and edge functions but is an
exclusion by omission rather than by decision.

There is no react-query, SWR or TanStack cache; data loading is `useEffect` plus
a service call. IndexedDB is write-only. `localStorage` holds preferences
(active org, theme, sidebar, report options) and the Supabase session, and that
list is audited by `src/lib/legalFacts.ts`.

## Known defects this classification found

1. **The offline copy overclaims.** `src/components/OfflineBanner.tsx:14` says
   "Showing cached content", `SplashScreen.tsx:82` says "Showing your cached
   rota", `AppBootScreen.tsx:149` says "RotaFlow will use what it has cached".
   All three are backed only by the five-minute cache above, so each can be shown
   on a screen with nothing cached at all. Honest network states are a stated
   requirement of the PWA engine, and telling a user their rota is cached when it
   may not be is the failure mode it names.
2. **`public/offline.html` is precached and never served.** It is in
   `includeAssets` (`vite.config.ts:77`) and nothing else references it:
   `navigateFallback` is `index.html`, and no route, handler or `.htaccess` rule
   mentions it. `docs/ARCHITECTURE.md` calls it a "last-resort static fallback",
   which is what it was meant to be, not what it is.
3. **A cold offline load of the clock screen shows a failure state** even though
   its write path would have worked (`src/pages/app/ClockInPage.tsx:189-192`).
   The one screen most likely to be opened without signal is the one that reports
   itself broken there.
4. **`docs/ARCHITECTURE.md` said swap _responses_ queue.** Only
   `requestShiftSwap` queues; responding to a swap is a review action and needs
   the network. Corrected in the same change as this file.
5. **No test exercises any of this end to end.** `src/services/syncQueue.test.ts`
   is genuinely good at the module level, including a restored-network case, and
   `fake-indexeddb` backs the outbox tests. But `e2e/` contains no offline, slow,
   intermittent or restored-network specification at all, and nothing tests the
   service worker, the manifest, installation or the update prompt.

None of these are fixed by this file. They are recorded here and in
`docs/PWA-RELEASE-GATES.md` so that the next release decision has to look at
them.

## The nine conditions, and which have been tested

The PWA engine asks for critical journeys under nine network conditions. Status
uses the GEE evidence vocabulary.

| Condition                              | Status     | Note                                                                                                 |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| Full connection                        | PASS       | covered by e2e and by daily use                                                                      |
| Slow connection                        | NOT TESTED | no throttled run exists                                                                              |
| Intermittent connection                | NOT TESTED | unit tests simulate it; no browser has                                                               |
| Offline                                | PARTIAL    | queue logic unit-tested; no browser offline run                                                      |
| Network loss during an operation       | PARTIAL    | the "looked online but was not" path is handled and tested at unit level (`ClockInPage.tsx:372-384`) |
| Network restoration                    | PARTIAL    | `syncQueue.test.ts:282` covers delivery on return, in isolation                                      |
| Expired authentication during recovery | NOT TESTED | a queued write replayed after the session expires is unproved                                        |
| New version available                  | NOT TESTED | `registerType: 'prompt'` with a Reload button, never exercised in a test                             |
| Relaunch after installation            | NOT TESTED | installation itself is untested                                                                      |

The gap that would close most of this at once is a Playwright specification using
`context.setOffline(true)`. That is not written yet, and this file does not
pretend it is.

## Service worker and manifest facts

Generated by `vite-plugin-pwa` in `generateSW` mode (`vite.config.ts:70-151`).
Registered from `src/components/UpdatePrompt.tsx:15`, not from `main.tsx`, with
`injectRegister: null` so there is exactly one registration site. Updates use
`registerType: 'prompt'` with `skipWaiting: false`, so a user is never thrown off
a page mid-task; `cleanupOutdatedCaches` removes old caches. Push handlers are
added through `workbox.importScripts: ['/push-sw.js']`, which is the documented
way to get custom code into a `generateSW` worker.

The manifest is inline in `vite.config.ts:79-100`: `standalone`, portrait,
scope and start URL `/`, three icons (192, 512, and a 512 maskable). It has no
`id`, no `screenshots` and no `shortcuts`. None of those are required for
installation; `id` is worth adding before the app is ever listed anywhere, since
without it the identity is the start URL.

`.htaccess:78-80` serves `sw.js`, `workbox-*.js`, `manifest.webmanifest` and
`index.html` with `no-cache, no-store, must-revalidate`, while hashed assets are
immutable for a year. That is the correct pairing and worth not breaking.
