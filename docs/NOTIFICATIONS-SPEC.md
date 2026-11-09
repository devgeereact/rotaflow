# Notifications specification

This file owns how a notification gets from an event to a person: the outbox,
the channels, the scheduled jobs that drive them, and web push. Created on
11 October 2026 and rewritten on 9 November 2026 from `backend/src/Notify.php`,
`backend/src/Dispatcher.php`, `backend/bin/cron.php` and the modules that call them,
after the 1 November 2026 cutover. Delivery numbers from production (how many have
actually been sent) are in `docs/SAAS.md` §2, because they change.

## How notifications work

Everything is a database outbox drained by cron. There is no HTTP hop, no shared
secret and no second service: the request that causes an event writes the outbox row
in its own transaction, and a cron run delivers it.

| Step | How it works | Where |
| ---- | ------------ | ----- |
| Enqueue | `Notify::enqueue` is called inside the PHP transaction that makes the change (rota publish, leave decision, swap decision, announcement publish and reminder, support reply, billing events, and the scheduled alerts). It inserts one `notification_outbox` row with the recipients and the wording as JSON. The row commits with the change or not at all, so a closed tab or a crashed request cannot lose a notification. A `dedupe_key` makes a scheduled alert once-only: a second insert with the same key is ignored | `backend/src/Notify.php`, `backend/migrations/007-communication.sql` |
| Drain | cPanel cron runs `backend/bin/cron.php`, which runs `Mod\Notifications::cron`: scheduled alerts first (so they go out in the same run), then `Dispatcher::drain`. Live runs it every five minutes (the script is also safe to run once a minute) | `backend/bin/cron.php`, `backend/src/Mod/Notifications.php` |
| Claim and retry | A due row (`pending`, `next_attempt_at` passed) is claimed (`sending`) before delivery; a claim older than ten minutes goes back to `pending`, so a crashed run loses nothing. A failure backs off 1, 2, 4 then 8 minutes (capped at an hour) and the fifth failed attempt marks the row `abandoned`. The delays are minimums: a row waits for the first cron run after its time, so at a five-minute cadence a 60-second back-off waits for the next run | `backend/src/Dispatcher.php` (`MAX_ATTEMPTS`, `CLAIM_STALE_MINUTES`, `drain`) |
| Deliver | `Dispatcher::deliver`: drop recipients who are not active members of the organisation; the organisation's notification matrix decides which channels an event may use, in-app included (anything absent or malformed reads as ON); a person's own switch (`notifications_enabled`) mutes email and push but never their inbox; then the inbox row, then email, then push. One `notification_deliveries` row per attempt records `sent`, `failed`, `skipped` (with the reason) or `expired` | `backend/src/Dispatcher.php` |
| Email | `Mail::forOrg` picks the organisation's own SMTP account when one is saved and the private `secret_key` can decrypt it, else the platform account (`smtp` in the private config), else none (email is skipped and the delivery log says why). `SmtpMailer` is a minimal authenticated client: port 465 implicit TLS, any other port STARTTLS, certificate and host name always verified, header-injection checks | `backend/src/Mail.php`, `backend/src/SmtpMailer.php` |
| Push | `WebPushSender`: RFC 8291 encryption and RFC 8292 VAPID with OpenSSL and cURL only. It needs the `vapid` private config; without it `NullPusher` reports `unavailable` and the push is skipped. A 404 or 410 from the push service marks the delivery `expired` and deletes that subscription | `backend/src/WebPushSender.php`, `backend/src/NullPusher.php` |
| Templates | The organisation's `notification_templates` row, else the platform row (`org_key` `-`), else the built-in wording; `{{name}}` placeholders are filled in one pass so a value is never expanded twice | `backend/src/Dispatcher.php` (`template`, `fill`) |
| Invitations | Not an outbox row, because an invitee has no account to address one to: `Mod\Invites` emails the link itself on creation and on resend, best effort; the invitation is kept if the send fails and its `send_error` says why | `backend/src/Mod/Invites.php` |
| Website enquiries | Not an outbox row (an enquirer belongs to no organisation): `Enquiries::cron` sends one short email per new enquiry to `enquiry_notify_email` over the platform account, with none of the visitor's text in it | `backend/src/Mod/Enquiries.php` |

What each event sends, by the module that queues it. Every notice is a row of `type`
`rota`, `leave`, `swap`, `announcement`, `attendance`, `document`, `billing` or
`support`; the first four follow the organisation's matrix, the rest are sent on every
channel the person has not switched off.

| Event | Who is told | Queued by |
| ----- | ----------- | --------- |
| `rota/published` | A first publish tells everyone with a shift. An amendment writes one row per affected person, listing what changed for them | `Mod\Rotas::notifyPublished`, `backend/src/RotaDiff.php` |
| `leave/reviewed` | The requester, when a request is approved or declined | `Mod\Leave` |
| `swap/requested`, `swap/reviewed`, `swap/voided` | The colleague asked to swap; the requester when a swap is decided; both people when a swap is voided because its shift changed or started | `Mod\Swaps` |
| `announcement/published` | The announcement's audience on publish, and the audience members who have not read it when a manager presses "Remind unread" (limited per hour) | `Mod\Announcements` |
| `platform/announcement` | The people a platform announcement is addressed to | `Mod\PlatformAnnouncements` |
| `support/replied` | The person who raised a case, on a public reply from support (never an internal note); title "Reply on CASE-nnnn", first 240 characters of the reply | `Mod\Support` |
| `alert/missed_clock_in` | The organisation's owners and managers, once per shift, when a shift started more than 30 minutes ago (and less than 12 hours ago) with nobody clocked in | `Mod\Notifications::scheduledAlerts` |
| `billing/trial_ending` | The owners of an active organisation whose own free trial ends within three days and whose billing state is still `trial`; deduplicated on the trial end, so an extended trial is reminded again | `Mod\Notifications::trialEndingAlerts` |
| `billing/trial_will_end`, `billing/payment_failed` | The organisation's active owners, from Stripe events. Deduplicated per subscription and trial end, and per invoice (once per invoice, not per retry) | `Mod\StripeWebhook`, `backend/src/BillingRules.php` |
| `compliance/submitted`, `compliance/approved`, `compliance/rejected` | Owners and managers (not the person who submitted it) when a document awaits review; the person, with the reason, when it is decided | `Mod\Compliance` |
| `compliance/expiring`, `compliance/expired` | The person (if they have a login) and always the owners and managers, 30, 14 and 7 days before an approved document's expiry date and on the first day after it | `Mod\Compliance::cron` |
| `cover/*`, `swap/voided` | Type `swap`, so they follow the swap matrix (below) | `Mod\Cover`, `Mod\Swaps` |

**Documents.** `Compliance::cron` runs at most once in fifteen minutes (a stamp in the
private cache folder), whatever the cron cadence is. Each stage is sent once per
document (`document_reminders` primary key plus an outbox `dedupe_key` of the form
`document_reminder:<id>:<stage>:person` or `:managers`). Days are counted in the
organisation's timezone; missed runs send only the most urgent stage due. Deactivated
staff, archived types and replaced rows are skipped. Approved documents only.

**Cover** (only while the `cover_tools` flag is on) queues `cover/absence` (owners and
managers, not the reporter), `cover/offered` (up to 50 eligible people with a login
when a manager opens a cover request), `cover/released` (the person taken off the
shift), `cover/applied` (owners and managers), `cover/approved`, `cover/rejected`,
`cover/filled` (an offer turned down because someone else was chosen) and
`cover/absence_dismissed` (the person stays on the shift), all in the transaction that
makes the change. `Cover::cron` closes cover requests whose shift started, was
cancelled or was filled some other way, closes pending applications on shifts no
longer open, and voids stale swaps; it is idempotent.

**Billing notices.** `Mod\StripeWebhook` writes the two Stripe notices through the same
outbox. `billing` has no row in the organisation's notification matrix, so the
notice goes on every channel the person has not switched off. Only a **Stripe** trial
produces `billing/trial_will_end`; an organisation in its own no-card trial
(`organisations.trial_ends_at`) is reminded by `Notifications::trialEndingAlerts`
instead.

**Website enquiries.** `Enquiries::cron` says a message arrived, whether a demo was
asked for, the team size and sector, and links to `/admin/enquiries`. It carries **no
text the visitor typed**: the name, address and message stay behind sign-in in the
console. Without `enquiry_notify_email` or the platform mail account nothing is sent
and the console inbox still shows the enquiry; nothing is ever sent to the visitor's
address, so the form cannot be used to mail a third party.

**Platform announcements.** `PlatformAnnouncements::cron` publishes announcements
whose scheduled time has come, through the same outbox. It runs after
`Notifications::cron` (modules run in name order), so a delivery is stamped delivered
or failed in the same run that sent it.

## The path, end to end

1. **Enqueue, in the same transaction as the event.** `Notify::enqueue` writes a row
   to `notification_outbox` inside the transaction that caused it (GAP-026). An
   amendment to a published rota writes one row per affected person.
2. **Drain, on every cron run.** `bin/cron.php` takes a lock, so only one run is
   active, and calls each module's `cron()`; `Notifications::cron` queues the
   scheduled alerts and drains up to 50 due rows with `Dispatcher::drain`.
3. **Deliver.** `Dispatcher::deliver` applies the rules in the table above and writes
   the inbox row, the email and the push.
4. **Record.** Every attempt per channel is a `notification_deliveries` row. Delivery
   log and settled outbox rows (`sent` or `abandoned`) are kept for twelve months, then
   removed by the daily retention run in `Lifecycle::cron` (the `notifications` policy
   in `backend/migrations/013-data-lifecycle.sql`; a pending outbox row is never
   removed).

## Channels

| Channel  | State |
| -------- | ----- |
| In-app   | Built. The `notifications` table, read with `GET /orgs/{o}/notifications` and shown at `/app/notifications`; marked read with `POST /orgs/{o}/notifications/read`. Only the Dispatcher writes it |
| Email    | Built. An organisation's own SMTP account (`org_smtp_settings`) is preferred, tested from Settings with `POST /orgs/{o}/smtp/test` (`backend/src/Mod/OrgSettings.php`); otherwise the platform account, and email is skipped when neither exists. Wording comes from `notification_templates`, with an organisation override where one exists |
| Web push | Built. The VAPID keys are private config (`vapid`); the public key is `VITE_VAPID_PUBLIC_KEY`. Subscriptions are `push_subscriptions` (at most 10 devices per person, newest kept; only addresses of the browsers' push services are accepted). Whether a push has ever arrived on a real device is recorded in `docs/SAAS.md`, not assumed: `NOT VERIFIED` from the repository |
| SMS      | **Not built.** A reserved seam: the `sms` value exists on `notifications.channel` (`backend/migrations/007-communication.sql`), `backend/src` has no SMS code, and Settings does not offer it (`src/lib/orgPreferences.ts`) |

**Email summaries are not sent.** A person can choose a daily or weekly summary on My
account, Preferences (`app_settings.digest_frequency`, `backend/src/Mod/Account.php`).
Nothing reads it: every notification is still sent on its own, and the screen says so.
A digest job would be a new `cron()` function in a module.

### Web push on the device

The browser side is `useWebPush` (`docs/ARCHITECTURE.md#hook-contracts` §16), which
subscribes the device and stores it with `POST /me/push-subscriptions`. The service
worker that displays a push is `public/push-sw.js`, imported into the generated
service worker through `workbox.importScripts` in `vite.config.ts` (BUG-050); it shows
the notification and opens `/app/notifications` (or the payload's URL) on a click.

Signing out deliberately releases the device (plan S4, 2026-10-11):
`releasePushSubscription` in `src/lib/session.ts` deletes this endpoint's
`push_subscriptions` row (`POST /me/push-subscriptions/delete`) and then unsubscribes
the browser, before the session ends, so the next person to use a shared phone is not
shown the last person's notifications. It is bounded at 3 seconds and never blocks
sign-out. A session that expires or is revoked elsewhere does not run it; see
`docs/ARCHITECTURE.md`, "Offline and PWA".

## Scheduled jobs

There is one cron entry, and it runs every module that defines
`public static function cron(Ctx $ctx): string`, in file-name order, one run at a time
(`backend/bin/cron.php`). Jobs decide for themselves whether they are due and are
idempotent, so the schedule is only a heartbeat. Live runs it every five minutes; the
script is also safe to run once a minute. The seven modules:

| Module | Its `cron()` job |
| ------ | ---------------- |
| `Compliance` | Expiry reminders for staff documents, at most once in fifteen minutes (above) |
| `Cover` | Closes stale cover requests and applications, voids stale swaps, for organisations with `cover_tools` on |
| `Enquiries` | Emails the team about each new website enquiry (`enquiry_notify_email`) |
| `Gdpr` | Finishes the logins an erasure case owes: deletes each queued login from Clerk (needs `clerk_secret_key`) and then from the database; five failures abandon a row visibly |
| `Lifecycle` | Removes queued stored files and folders (`storage_deletions`), then runs the retention policies once a day after 02:15 UTC |
| `Notifications` | Scheduled alerts (missed clock-in, free trial ending), then `Dispatcher::drain` |
| `PlatformAnnouncements` | Publishes due scheduled announcements, then reconciles delivery stamps |

The one entry the host needs (the owner adds it; run `backend/bin/doctor.php` first;
install a cron line from a file, never by piping into `crontab -`, see
`docs/DEPLOYMENT.md`):

```text
*/5 * * * * ROTAFLOW_PRIVATE_ROOT=$HOME/rotaflow-private php $HOME/rotaflow-private/app/bin/cron.php >> $HOME/rotaflow-private/logs/cron.log 2>&1
```

That the cron job is installed and runs every five minutes on the live host is
recorded in `docs/AUDIT.md` (the 2026-11-08 section); the host state today is not
re-checked here. The database backup is a separate job, `backend/bin/backup.php`
(`docs/DEPLOYMENT.md`, "Database backups").

The scheduled alerts do not cover leave: they are a missed clock-in, a document nearing
its expiry date (GAP-013, CAP-019, CAP-088) and a free trial ending.

## Classes and routes

- **`Notify`** (`backend/src/Notify.php`): `enqueue` (see the first table),
  `managers` (the active owners and managers of an organisation) and `userOfStaff`
  (the login behind a staff record, or null).
- **`Dispatcher`** (`backend/src/Dispatcher.php`): `drain` and `deliver`, with
  `matrix` (which channels the organisation permits) and `fill` (templates).
- **`Mod\Notifications`** (`backend/src/Mod/Notifications.php`): the person's inbox
  (`GET /orgs/{o}/notifications`, `POST /orgs/{o}/notifications/read`), their push
  devices (`POST /me/push-subscriptions`, `/me/push-subscriptions/delete`) and `cron()`.
- **`Pusher`**, **`NullPusher`**, **`WebPushSender`**; **`Mailer`**, **`SmtpMailer`**,
  **`Mail`** (`backend/src`).

**Legacy.** Before the 1 November 2026 cutover the outbox was filled by Postgres triggers and drained by seven `pg_cron` jobs that posted to the `send-notification` Edge Function with a secret held in the database vault (legacy; none of it runs any more). The previous text of this file, with the trigger and job notes, is available with `git show live-supabase-2026-11-01:docs/NOTIFICATIONS-SPEC.md`.
