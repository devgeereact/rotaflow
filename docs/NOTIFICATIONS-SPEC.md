# Notifications specification

This file owns how a notification gets from an event to a person: the outbox,
the channels, the scheduled jobs that drive them, and web push. Created on
11 October 2026 from facts read in `supabase/migrations/`, `supabase/functions/`
and `public/` on that date; the function and trigger notes at the end were moved
from `docs/DATA-MODEL.md` §6. Delivery numbers from production (how many have
actually been sent) are in `docs/SAAS.md` §2, because they change.

## The path, end to end

1. **Enqueue, in the same transaction as the event.** A trigger or RPC writes a
   row to `notification_outbox` (`0069`) inside the transaction that caused it, so
   a closed tab or a crashed client cannot lose the notification (GAP-026). Rota
   publication, leave and swap decisions, announcements and scheduled alerts all
   enqueue this way. An amendment to a published rota writes one row per affected
   person, listing what changed for them (`0083`).
2. **Drain, every minute.** `pg_cron` runs `dispatch_notification_outbox()`
   (`0069`), which posts each pending row over `pg_net` to the `send-notification`
   Edge Function with a shared secret in the `x-notification-secret` header. The
   secret is generated inside Postgres and lives only in `vault` (`0091`); the
   function compares it in the database and never reads it. A row that keeps
   failing is marked `abandoned` after five attempts (`0069`).
3. **Deliver.** `send-notification` drops recipients who are not members of the
   organisation, applies the organisation's notification matrix and each person's
   own switch (BUG-048), writes the in-app `notifications` row unless the
   organisation has muted in-app, and sends email over the organisation's SMTP and
   web push over VAPID. Its request and response contract is in
   `docs/API-SPEC.md`.
4. **Record.** Every attempt per channel is a `notification_deliveries` row
   (`0067`), status `sent`, `failed`, `skipped` or `expired`. Delivery log and
   settled outbox rows are kept for twelve months, then removed by the nightly
   retention job (`0092`); a pending outbox row is never removed.

Invitations are the exception: `send-invite` sends its email directly, because an
invitee has no account to address an outbox row to.

## Channels

| Channel  | State                                                                                                                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app   | Built. The `notifications` table, read at `/app/notifications`                                                                                                                                                                                                                                                   |
| Email    | Built. An organisation's own SMTP account (`org_smtp_settings`, `0010`) is preferred, tested from Settings with `test-smtp`; otherwise the platform SMTP secrets, and email is skipped when neither exists. Wording comes from `notification_templates` (`0108`), with an organisation override where one exists |
| Web push | Built. VAPID keys are Edge Function secrets; the public key is `VITE_VAPID_PUBLIC_KEY`. Subscriptions are `push_subscriptions` (`0009`). Whether a push has ever arrived on a real device is recorded in `docs/SAAS.md`, not assumed                                                                             |
| SMS      | **Not built.** A reserved seam: no provider, and Settings shows it as unavailable                                                                                                                                                                                                                                |

### Web push on the device

The browser side is `useWebPush` (`docs/ARCHITECTURE.md#hook-contracts` §16), which
subscribes the device and writes `push_subscriptions`. The service worker that
displays a push is `public/push-sw.js`, imported into the generated Workbox
service worker through `workbox.importScripts` (BUG-050).

## Scheduled jobs

Five `pg_cron` jobs are defined in `supabase/migrations/`. Background work runs
inside Postgres with `pg_cron` and `pg_net`; nothing runs on the cPanel origin, and
Inngest was retired in `0087`. On 31 August 2026 four of these were verified
running by reading `cron.job` in production; the fifth was added by `0132` after
that check, and its production state has not been re-read for this document.

| Job                               | Schedule                      | Runs                                   | Defined in | What it does                                                                                                     |
| --------------------------------- | ----------------------------- | -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `rotaflow-notification-outbox`    | every minute                  | `dispatch_notification_outbox()`       | `0069`     | Drains the outbox into `send-notification`                                                                       |
| `rotaflow-announcement-scheduler` | every minute                  | `publish_due_platform_announcements()` | `0132`     | Publishes platform announcements whose scheduled time has come, through the outbox                               |
| `rotaflow-scheduled-alerts`       | every 15 minutes              | `enqueue_scheduled_alerts()`           | `0093`     | Missed clock-ins and **expiring documents**, one outbox row per fact, deduplicated by `dedupe_key`               |
| `rotaflow-health-probe`           | every 5 minutes               | `probe_platform_health()`              | `0076`     | Platform health samples, not a notification; listed here because it is a scheduled job (`docs/DATA-MODEL.md` §6) |
| `rotaflow-retention`              | daily at 02:15, pg_cron clock | `enforce_retention(false)`             | `0029`     | Deletes rows past their retention window, including the notification log (`docs/SECURITY.md` §3)                 |

`0093` does not alert on leave: the scheduled alerts are a missed clock-in and a
document nearing its expiry date (GAP-013, CAP-019, CAP-088).

## Functions and triggers

- **`announcement_audience(announcement)`** (`0087`, `security definer`, stable): the
  user ids an announcement is addressed to, from its own department/location scope.
  One definition, shared by the publish trigger and the unread reminder — the page
  used to resolve the audience from its own loaded staff list, so an announcement's
  reach depended on a client-side cache.
- **`remind_announcement_unread(announcement)`** (`0087`, `security definer`,
  owner/manager): enqueues one reminder to everyone in the audience who has no
  `announcement_reads` row, and returns the count. An RPC rather than a trigger
  because pressing "Remind unread" changes no row — there is no transition to hang a
  trigger on. It still commits the outbox row before returning, which is the property
  that matters.
- **Notification enqueue triggers** (`0087`): `leave_requests_enqueue_reviewed` and
  `shift_swaps_enqueue_reviewed` fire when a request moves to `approved`/`rejected`,
  and `announcements_enqueue_published` when `published_at` first becomes non-null.
  Each skips the case where the reviewer IS the requester, and an edit to an
  already-published announcement notifies nobody a second time.
