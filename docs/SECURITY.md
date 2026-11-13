# Data lifecycle

**Status:** First pass, verified against the live deployment 13 August 2026 —
not yet reviewed by counsel. This is the technical record
`docs/SAAS.md` P0 needs as input for the published
Privacy Notice; it is not that notice. Where something is a gap rather than a
fact, it is written as a gap.

**Rewritten 9 November 2026 for the live stack** (PHP API, MariaDB, Clerk sign-in, the host's own file store). The
present-tense parts of §1, §2, the §3 table, §4, §5, §6, §7 and the privacy data map now describe the code in `backend/`,
`scripts/` and `release.json`. Each claim cites the file that shows it, and what only the server or a dashboard can show is
marked `NOT VERIFIED`. The dated records are unchanged: the revision notes just below, §3a, §3b and the "What was wrong"
account in §6a. The Supabase-era version of this file is available with `git show live-supabase-2026-11-01:docs/SECURITY.md`.
The legal text customers see (`src/lib/privacyNotice.ts`, `src/lib/termsDraft.ts`, `src/lib/subprocessors.ts`,
`src/lib/legalFacts.ts`) is Phase 4 and is not changed here; where it disagrees with the code, this file says what the code
does and says that the published text differs.

**Revised 20 August 2026, twice.** §1 was re-examined: the backup gap is
unchanged and now deliberately deferred, with the condition that ends the
deferral written down in §1a.

§3 was then rewritten, and rewriting it turned up a live defect rather than
just stale prose. §3 had claimed the retention purge job was unstarted work.
It exists (`0029`), it is scheduled and active — and it had **failed on all
14 of its scheduled runs** with a runtime ambiguity error, while
`retention_policies.enforced` advertised `true` to users. Fixed by `0057`,
guarded by a pgTAP test that actually calls the function. Detail in §3a.

**Updated 22 August 2026: that defect is resolved.** The nightly job has run
successfully every night since 2026-08-21 — verified in both `retention_runs`
and `cron.job_run_details`, with no failures after the fix. Retention is now
genuinely enforced, and §3's "Enforced?" column can be trusted again. §3b
carries the evidence and the query to re-check it.

## 1. Backup and restore

**What exists**, read on 9 November 2026 from `backend/bin/backup.php`, `backend/src/Backup.php` and the suite
`backend/tests/suites/300-backup.php`:

- `php backup.php [--dir=PATH] [--keep=28]` dumps the MariaDB database to `rotaflow-<UTC>.sql.gz` with file mode 0600, a
  `.sha256` beside it and a `.counts.json` (each table's row count just before and just after the dump, bound to the
  dump's hash). The dump is read back for its completion marker before it is published, a lock file stops two runs
  overlapping, and a run that passes 30 minutes is stopped. The database password reaches the dump tool through a 0600
  defaults file that is removed afterwards, never on a command line. A failed or cut-off dump leaves no file and the run
  exits 1. Then the newest 28 are kept (`--keep`).
- The default folder is `$HOME/backups/rotaflow/db` (the `ROTAFLOW_BACKUP_DIR` default in the header of
  `backend/bin/backup.php`): under the account's home folder, not under the web root that `release.json` ships to.
- `--restore-check --scratch-db=NAME` checks the newest dump against its checksum, loads it into a scratch database,
  requires every table's restored count to lie in the recorded range, and empties the scratch database again. The
  scratch database must already exist, differ from the live one, be empty and have `restorecheck` in its name
  (`Backup::restoreCheck`); anything else is refused and touched not at all.
- `--self-check` lists what would stop a backup on this machine (`proc_open` disabled, a missing dump tool, an
  unreachable database).

**Cadence.** Neither script states one. The schedule is in the tracked `docs/DEPLOYMENT.md`, "Database backups (MariaDB,
since the 1 November 2026 cutover)": `17 */6 * * *`, which is every six hours, plus a monthly `--restore-check` drill.

**Install state.** Installed on the live host and proven on 2026-11-08: the first live backup, the restore proof into
the scratch database and the six-hourly cron line are recorded in `docs/AUDIT.md` (section "2026-11-08: Phase 1, live
safety and ground truth") and in `docs/DEPLOYMENT.md` ("Database backups"). Those are records of a session on the host;
this repository cannot re-run them, and the host as it is today has not been re-checked from here (`NOT VERIFIED`, server
state).

**Not in place. None of these is written as done anywhere in this repository.**

- **An encrypted off-site copy.** Key custody is an owner decision. Until it exists the dumps sit on the same hosting
  account as the database, so losing the account loses both.
- **Alerting on a failed run.** The job appends to a log file on the host; nothing reads it or tells anyone.
- **A scheduled monthly restore drill.** `docs/DEPLOYMENT.md` says "not scheduled yet".
- **Point-in-time recovery.** A dump is a snapshot every six hours, so the worst case is losing up to one interval of
  changes (the owner's pilot target is a 6 hour data-loss window and a 4 hour recovery time; these are targets, and no
  recovery has been timed: `NOT VERIFIED`). `docs/SAAS.md` D6 still records an older figure tied to the hosted-Postgres plan
  and is not changed here.
- **Stored files.** `backup.php` dumps the database only. Staff documents and photos live in the private upload folder
  (`backend/src/FileStore.php`) and nothing in the repository copies it. Whether the hosting provider's own backups cover
  that folder is `NOT VERIFIED` (provider setting).
- **Private configuration.** The dump does not contain it. `backend/src/Secret.php` encrypts an organisation's SMTP password
  with `secret_key` from that file, so a restored dump without the file cannot decrypt it. Where a copy of the private
  configuration is kept is `NOT VERIFIED` (owner).

**Until the off-site copy and the failure alert exist**, treat every destructive admin action (organisation deletion,
erasure, bulk membership changes) as unrecoverable beyond the last dump, and say so to whoever performs one. Deleting an
organisation takes effect at once (`backend/src/Mod/Lifecycle.php`).

### 1a. Deliberately deferred, and the condition that ends the deferral (Supabase era, history)

This subsection is kept so that a reference to "§1a" still resolves; the text it replaces is dated and belonged to the
hosted-Postgres project. At the time, on 13 August 2026, that project had no backups and no point-in-time recovery (read
through the provider's management API). The gap was recorded as a deliberate deferral with an event as its trigger, the
first real organisation with live staff data, because production held almost no data. A nightly encrypted `pg_dump`
workflow ran from 30 August 2026 (first success 5 September; a human restore on 7 September found the dump missing grants,
fixed the same day: GAP-001, GAP-036) and was read as green every night to 10 October.

Since the 1 November 2026 cutover that workflow (`.github/workflows/backup.yml`) backed up the archived Supabase project,
not the live database, and its scheduled runs failed every night. It was not a backup of anything live, and it was removed on
13 November 2026 (commit `787b398` on `main`). The full previous text of
§1, including "What exists in the meantime, and what it is not", is at the tag: `git show
live-supabase-2026-11-01:docs/SECURITY.md`.

## 2. Data residency

**Since the 1 November 2026 cutover the application data is in one MariaDB database and one private file folder on the
cPanel host, reached only through the PHP API** (`backend/src/Bootstrap.php`, `backend/src/FileStore.php`). The host is
published as a Namecheap data centre in the United Kingdom (`src/lib/subprocessors.ts`, which cites `docs/DEPLOYMENT.md`);
the owner confirmed that on 1 November 2026. That is a provider fact the repository cannot show, so it is `NOT VERIFIED`
from the code (hosting dashboard). Before the cutover the database was Supabase in `eu-west-1` (Ireland), and ImageKit
served the pictures; neither is used now.

Read on 9 November 2026. Where the table says `NOT VERIFIED`, the answer is a provider or dashboard setting.

| Component | What it holds or is sent | Where | Source |
| --------- | ------------------------ | ----- | ------ |
| **MariaDB on the cPanel host** | Every tenant table, the audit trail, enquiries, support cases and the retention records (69 tables in the 19 migrations) | United Kingdom as published; `NOT VERIFIED` | `backend/migrations`, `backend/src/Bootstrap.php` |
| **The host's own file store** | Staff documents and staff photos, in two buckets under `<private root>/uploads`, outside every web root, served only through the API | Same host | `backend/src/FileStore.php`, `backend/src/Mod/Photos.php`, `backend/src/Mod/Compliance.php` |
| **Outbound mail** | Recipient address and first name, the notification title and body, the organisation's name. Sent through the organisation's own SMTP account if it saved one, otherwise the platform `smtp` account from the private configuration | The platform SMTP provider and where it processes: `NOT VERIFIED` (server configuration). An organisation's own mail server is its own choice | `backend/src/Mail.php`, `backend/src/SmtpMailer.php`, `backend/src/Dispatcher.php` |
| **Web push services** | A notification's title and body, encrypted to the device's key, posted to the address the browser gave when it subscribed (the browser vendor's push service) | `NOT VERIFIED` (depends on the browser) | `backend/src/WebPushSender.php`, `backend/src/Dispatcher.php` |
| **Clerk** | Sign-in: the email address, a name if given, session and device details. No rota, staff or organisation data. The API calls Clerk to delete a login after a completed erasure (`clerk_secret_key`) | United States as published; `NOT VERIFIED` | `backend/src/Jwt.php`, `backend/src/Users.php`, `backend/src/Mod/Gdpr.php`, `src/context/AuthContext.tsx` |
| **Stripe** | Billing identity (email, and the card details the person types on Stripe's own page), the organisation id and plan code. Webhook events come back signed | United States as published | `backend/src/StripeClient.php`, `backend/src/Mod/Billing.php`, `backend/src/Mod/StripeWebhook.php` |
| **OpenRouter and the model provider behind it** | Only when a manager runs the AI assistant: the organisation's name, the period, and for each person an alias (`S1`, `S2`) with job title, skills, weekly hours, contract type and scheduled hours; shift types and sites by name; shifts by alias and time; approved leave as dates only; unavailable weekdays and dates by alias; and the manager's own prompt with names masked. Leave type is never sent | United States as published; the default model is `openai/gpt-4o-mini` | `backend/src/Mod/AiAssistant.php`, `backend/src/AiGrounding.php` |
| **Sentry** | A stack trace, the page path and the steps that led to it, from the browser only and only after the visitor agrees to diagnostics. There is no Sentry code in the PHP API (`git grep -li sentry -- backend/src` prints nothing) | EU: the ingest host named in the Content-Security-Policy of `.htaccess` is a `.de.sentry.io` host. The region of the account itself is `NOT VERIFIED` (dashboard) | `src/lib/sentry.ts`, `.htaccess` |
| **Cloudflare** | DNS, TLS and the proxy in front of the site, so the address and requested pages of every visitor. Also Turnstile on the contact form, when `turnstile_secret` is configured: the visitor's token and address go to Cloudflare's verification endpoint | Global edge network | `.htaccess`, `backend/src/Mod/Enquiries.php` |

**The published sub-processor list differs from this table in four places, and this table is what the code does.**
`src/lib/subprocessors.ts` lists six (OpenRouter, Stripe, Clerk, Sentry, Namecheap / cPanel, Cloudflare).

- The published list does not name web push services; the code posts every push notification's title and body to them.
  The published sub-processor list differs: no row for them; correction is Phase 4.
- It does not name an organisation's own mail server, which receives the same mail content when an owner saves one.
  The published sub-processor list differs: no row for it; correction is Phase 4.
- It says the host sends the outbound mail. The code shows only an SMTP host read from the private configuration, so
  where the mail leaves from is `NOT VERIFIED`. The published sub-processor list differs: stated as fact, unproven;
  correction is Phase 4.
- Its hosting row lists private file storage as "staff photos" only; the same store holds staff documents. The published
  sub-processor list differs: documents omitted; correction is Phase 4.

**Three of these send personal data outside the UK and EU: Clerk, Stripe and OpenRouter (with its model provider), all
United States as published.** All three must stay in the Privacy Notice and the sub-processor list. Web push services and
Cloudflare are the other transfers worth a legal opinion (§4 of the data map).

⚠️ **Leave type used to be sent, and should not have been. Corrected 2026-08-30.** At the time the prompt carried
`approvedLeave[].type` beside real first and last names. Leave types include `sick`, so a named person's sickness-absence
dates left the UK/EU on every request: special-category health data under UK GDPR Article 9, disclosed to a US processor
and the model provider behind it. Nothing wanted it: the one rule that reads the array (never schedule someone on approved
leave) needs the dates and not the reason. Today the code builds the array from dates only, and a comment beside it says
why (`backend/src/Mod/AiAssistant.php`, `approvedLeave`). That was found while writing the sub-processor page (`GAP-014`),
which is the argument for writing one.

Neither of the two main US dependencies is optional while its feature is used: sign-in is Clerk, and the billing path
needs Stripe. What is available is disclosure and, for the AI, scope: the two deterministic assistant tabs run entirely on
rows the organisation already has and make no network call, so a tenant that never opens "Ask AI" never sends staff data
to OpenRouter (`backend/src/Mod/AiAssistant.php` refuses before any outside call unless the plan, the feature flag and a
server key are all present).

Anyone writing the Privacy Notice, a DPA or a security questionnaire answer should treat this table as the list of what
the code sends, and the published page (`/legal/trust`, built from `src/lib/subprocessors.ts`) as the text that has to be
brought into line with it.

## 3. Retention

`retention_policies` (created and seeded in `backend/migrations/013-data-lifecycle.sql`) is the schedule, and
`retention_runs` records every run, dry runs included. Platform staff (owner, admin, support, finance) read both through
`GET /platform/retention`, which returns the policies and the last 50 runs; owner and admin can ask for a dry run that
counts what the next run would remove (`POST /platform/retention/dry-run`), both in `backend/src/Mod/Lifecycle.php`. No
tenant-facing screen shows the schedule. The `enforced` column exists so a declared schedule is never mistaken for a
running job.

**How it runs.** `Lifecycle::cron` (`backend/src/Mod/Lifecycle.php`) runs from `backend/bin/cron.php`, which the live host
runs every five minutes. Once a day, at the first run at or after 02:15 UTC with no real (non-dry) run recorded for that
UTC day, it calls `Retention::run` (`backend/src/Retention.php`). Each data type runs on its own, so one failing rule cannot
stop the others; a failure is written to `retention_runs.error` and shown in the cron output. A data type with a policy
row but no rule in the code is recorded as an error, not skipped. Every removal is a plain `DELETE` by the date a thing
ended, in whole calendar months; nothing is anonymised. The values below are the seeded ones in migration 013; the live
values are database state (`NOT VERIFIED`, readable through the route above).

| Data type (`data_type`) | Seeded period | What `Retention::run` removes | Enforced? |
| ----------------------- | ------------- | ----------------------------- | --------- |
| `rota_history` | 84 months | Shifts whose start date is older than the cutoff, then rotas past their period end with no shift left | Yes (`enforced` = 1) |
| `attendance` | 36 months | Clock events by event date (their corrections go with them), then timesheets past their period end | Yes |
| `leave` | 72 months | Leave requests by end date | Yes |
| `support_cases` | 36 months | Resolved cases only, by resolution date; open ones are never removed | Yes |
| `notifications` | 12 months | Delivery records, and outbox rows that are `sent` or `abandoned`; a `pending` row is a notification still owed and is never removed | Yes |
| `enquiries` | 24 months | Website enquiries of every status, from the day they arrived | Yes |
| `audit_log` | none (indefinite) | Nothing: the table is append-only (§5) and has no rule | By the database |
| `deleted_tenant` | 1 month, seeded `enforced` = 0 | Nothing: deleting an organisation takes effect at once (`backend/src/Mod/Lifecycle.php`); the policy row exists "so nobody assumes a grace period exists" | **No** |

Also on a timer, outside `retention_policies`: finished `storage_deletions` rows are removed after 30 days
(`Lifecycle::cron`), finished `account_deletions` rows after a year (`Gdpr::cron`, `backend/src/Mod/Gdpr.php`), and
rate-limit counters after a day (`backend/src/RateLimiter.php`). The platform health samples of the Supabase era are not
carried to MariaDB (`backend/src/DataMove/Map.php` records why), so there is nothing to age out.

**The owner's retention defaults, and what the code implements.** The owner's stated defaults are: right-to-work records
kept for the employment plus two years; withdrawn or rejected uploads removed after 90 days; a deleted organisation kept
for a 30-day grace window. **The code implements none of the three.** Documents have no timer: a document row and its file
stay as long as the person's staff record does, withdrawn, rejected and replaced rows included, and go only when the
person is erased or the organisation is deleted (`backend/src/Mod/Compliance.php` has no `DELETE`, and its cron only sends
expiry reminders). The grace window is the unimplemented `deleted_tenant` row above. Whether the owner's defaults are
adopted, and with which periods, is the owner's decision.

**Nothing added since the cutover needs a row here, and that is a decision rather than an oversight.** Configuration
(`notification_templates`, `support_sla_targets`, `feature_flags`) is not history, so ageing it out would delete a
setting somebody still uses. `role_delegations` and `calendar_feed_tokens` are small and their revoked rows are the
evidence that cover ended or a feed was rotated. **`staff_pay_rates` is the one worth arguing over**: it is financial
history, HMRC expects payroll records kept for years, and deleting a rate makes every past labour-cost figure
unreproducible. It is kept, and if a policy is ever wanted it should be a long one, set deliberately. The rate rides along
with the anonymised staff record after an erasure, where it identifies nobody.

### 3a. Incident, 7–20 August 2026: the job existed and never once completed

_Resolved — see §3b. Kept because the failure mode is worth remembering, not
because it is still true._

This section previously said the purge job was unstarted work. That was wrong
in both directions, and the truth is worse than what it claimed.

Migration `0029_retention_enforcement.sql` — titled "Retention stops being a
promise" — built the whole thing: `enforce_retention()`, the
`public.retention_runs` evidence table, and a pg_cron entry running it nightly
at 02:15 UTC. It also flipped `retention_policies.enforced` to `true` for the
four scheduled types. All of that is live and verifiable: the cron job is
present, `active = true`, on schedule `15 2 * * *`.

**And it has failed on every single execution.** Verified 20 August 2026 in
`cron.job_run_details`: 14 consecutive failures, 2026-08-07 through
2026-08-20, every one of them:

```
ERROR:  column reference "data_type" is ambiguous
DETAIL:  It could refer to either a PL/pgSQL variable or a table column.
```

`enforce_retention` is declared `returns table (data_type text, ...)`, which
makes `data_type` a variable inside the body; `0029`'s driving loop referenced
it unqualified, so it was ambiguous against `retention_policies.data_type`.
Postgres accepts that definition and fails only at execution — which is why
it passed review, passed `create or replace`, and produced a cron entry that
looks healthy.

Two consequences worth stating plainly, because they are the reason this
matters more than an ordinary broken job:

- **`public.retention_runs` is empty. Zero rows, ever.** That table was built
  as "the evidence that the schedule is enforced rather than published", and
  it worked exactly as designed — it recorded nothing, because nothing ran.
  Nobody looked.
- **The application has been asserting a guarantee it never performed.**
  `enforced = true` is shown to every signed-in user via `/app/settings` and
  to platform staff in the console. That is a compliance-facing claim.

No data was wrongly deleted; the failure mode is that nothing was deleted at
all. A promise silently unkept, not damage.

Fixed by `0057_fix_enforce_retention_ambiguity.sql`, which qualifies the
references, and guarded by
`supabase/tests/database/enforce_retention.test.sql`, which **calls** the
function. That call is the missing check: the definition was reviewed and the
schedule was confirmed active, and neither of those can catch a runtime-only
ambiguity error.

### 3b. Resolved — enforcement is real as of 21 August 2026

`0057` reached production on 20 August and is recorded in the ledger under its
numeric version (66 migrations as at 21 August 2026 — 164 today; the figure dates
the observation, it is not a running count). The nightly job has run
successfully every night since:

|                        |                                            |
| ---------------------- | ------------------------------------------ |
| Failed runs            | 14, 2026-08-07 → 2026-08-20                |
| Successful runs        | 2, 2026-08-21 → 2026-08-22, both 02:15 UTC |
| Failures since the fix | none                                       |
| `retention_runs` rows  | 4 per night, `dry_run = false`             |
| Rows actually removed  | 0                                          |

`pg_cron` reports `succeeded` with return message `4 rows`, matching the
function's own row count — two independent records agreeing.

**Zero rows removed is the correct result, not a quiet failure.** The cutoffs
are 2019–2023 and no data in this database is older than a few weeks, so there
is genuinely nothing aged out. The proof the job _worked_ is that the
`retention_runs` rows exist at all: the code path executed and recorded
itself. The cutoffs also advance a day each night (attendance 2023-08-21 →
2023-08-22), which is what a correctly computed relative window does.

The "Enforced?" cells in the table above can now be read as true for the four
scheduled types. More to the point, so can the `enforced` flag the application
shows to every signed-in user in `/app/settings` — between 7 and 20 August it
asserted a retention guarantee that had never once been performed.

**How to check this is still true**, rather than trusting this section:

```sql
select data_type, rows_removed, ran_at
from public.retention_runs
where not dry_run
order by ran_at desc limit 8;
```

Expect four rows dated within the last 24 hours. A gap of more than a day
means the job has stopped again, and `cron.job_run_details` filtered to
`jobname = 'rotaflow-retention'` will say why. Note that an empty
`retention_runs` is the _only_ outward sign of this class of failure — the
pg_cron entry reads `active = true` whether or not the function it calls
actually completes, which is exactly how the original bug hid for two weeks.

## 4. Export and deletion (GDPR Articles 15-21)

**The register.** `gdpr_requests` (`backend/migrations/013-data-lifecycle.sql`) tracks all six request types (`access`,
`portability`, `rectification`, `erasure`, `restriction`, `objection`) as a case-managed workflow. Platform owner, admin
and support work the cases in `/admin/gdpr` (`backend/src/Mod/Gdpr.php`, route in `src/App.tsx`); an organisation's owner
can read the requests that name their organisation (`GET /orgs/{o}/gdpr`). A request is due one month after it is
received. A platform owner or admin can extend it once, to two months after the original due date, for a stated reason of
at least 15 characters. A case cannot be closed as
`completed` or `refused` without an outcome note (a handler check and the `gdpr_closed_has_outcome` constraint).

**A person can ask, but not act.** My account, Your data (`/app/account/data`) files an access, portability,
rectification or erasure request for the signed-in person (`POST /me/data-requests`, `GET /me/data-requests` to follow
it). The subject is taken from the signed-in user, so the page cannot name anybody else. Asking again for the same kind
returns the open case, at most five stay open, and the route is limited to 10 an hour. The person sees where the case
stands, without the outcome note. Restriction and objection, and anyone without an account, go by email to the support
address. Filing the case does not fulfil it.

What each type does today:

- **Erasure of a staff member's record** (`POST /orgs/{o}/staff/{s}/erase`, owner only, `Gdpr::eraseStaff`). In one
  transaction it deletes the person's emergency contacts and **all** their document rows (history included: a passport scan
  is not rota history), replaces the free text in their cover absences and cover offers (which can be about their health),
  revokes their calendar feed, anonymises the `staff_profiles` row in place ("Deleted Member"; the columns it clears are
  `Gdpr::ERASURE_CLEARED`: names, email, phone, photo, payroll id, the link to the login, and `active`) and queues both
  of the person's file folders for deletion. It writes an audit row (`gdpr_anonymize`). The login and the membership are
  not touched by it. What it keeps, deliberately, is the staff row's job title, department, contract type, weekly hours,
  holiday allowance, skills and start date (`Gdpr::ERASURE_RETAINED`), and every shift, clock event (with its GPS
  position), leave request, swap, timesheet, availability row and pay rate that points at that row, so payroll history
  stays consistent for UK retention requirements. The suite `backend/tests/suites/190-lifecycle.php` fails when a column
  of `staff_profiles` is in neither list, so a new column cannot be added without a decision.
- **Removing the login** is the tail of a completed erasure *request*, not of the step above. Closing an erasure request
  as `completed` queues the person's login in `account_deletions` (migration 013), and refuses to close, leaving the
  request open, when the person holds a platform role or is the only owner of an organisation. If nobody signed in with
  that address the case closes with nothing queued. `Gdpr::cron` then deletes the user from Clerk with `clerk_secret_key`
  (a login Clerk no longer has counts as done) and deletes the local `users` row; without the key the queue waits, and five
  failures abandon a row visibly.
- **Files** follow their record: the erase step, a removed document, a replaced photo and an organisation deletion queue
  the files in `storage_deletions`, and `Lifecycle::cron` removes up to 20 a run (a file that is already gone counts as
  done, five failures abandon the row). A legacy pasted document or photo link is only a link: the row goes, the file at
  the other end is not ours to delete.
- **Deleting an organisation** (`POST /orgs/{o}/delete`, an owner, or a platform owner or admin through
  `/platform/orgs/{o}/delete`) needs the exact name typed, is limited to 10 an hour, writes the audit row first and then
  deletes immediately in one transaction. There is no grace period (§3). The audit trail, support cases, data-subject
  requests and billing events survive, detached from the tenant (`backend/src/Mod/Lifecycle.php`).
- **Access and portability** have two exports, both assembled in the browser from the API's own list routes, read with the
  caller's own permissions:
  - The **organisation export** (Settings, Organisation; `exportOrganisationData` in `src/services/orgLifecycleService.ts`)
    lists 36 names in `EXPORTED_TABLES`. Twenty-two are read from API list routes; the other 14 are listed in the file's
    `omitted` section with the reason "Not available from the API in this release" (staff sites, pay rates, clock
    corrections, emergency contacts, documents, announcement reads, notifications and their deliveries and templates,
    support cases, integrations, integration sync runs, subscriptions and invoice credits). The clock-event read asks for
    1000 rows and the audit read for 100, and neither follows a further page, so an organisation with more history gets a
    partial file. Nothing tells the reader which of these two cut the file short. This is a gap, not a design choice.
    `pnpm run check:export` (`scripts/check-export-coverage.mjs`) reads the legacy `supabase/migrations` tree, not `backend/migrations`, so
    it no longer proves coverage of the live tables.
  - The **per-subject package** (`exportStaffData` in `src/services/gdprService.ts`) names 14 datasets in
    `SUBJECT_EXPORT_TABLES`. The documents dataset is always empty: `listDocumentsForStaff` returns `[]` with a comment that
    documents "arrive with compliance (S10)", although `backend/src/Mod/Compliance.php` now exists. A subject-access
    package therefore omits the person's uploaded documents. Read from the code; not run against a live organisation
    (`NOT VERIFIED`).
  - Neither export includes the person's login, and nothing assembles a subject-access package across organisations.
- **Rectification** is editing the staff record. **Restriction and objection** are tracked as cases with no automated
  action; each is a manual data change by whoever is assigned the request.

A request sitting in `gdpr_requests` with no further action is a paper trail, not a completed erasure. Closing a case
queues the login deletion only; it does not anonymise a staff record in any organisation (`Gdpr::setStatus` never calls the
erase step), so the two are different acts and both have to happen.

## 5. Audit log

`audit_logs` (`backend/migrations/002-identity.sql`) is written by explicit `Audit::log` calls in the modules that make
a change (`backend/src/Audit.php`; `git grep -n 'Audit::log(' -- backend/src` prints 127 lines on 9 November 2026), not
by database triggers. Each row holds the organisation id, a copy of the organisation's name taken at write time, the actor's
user id, the action, the entity type and id, a JSON metadata field, a severity (`info`, `warning`, `critical`), a
visibility (`org` or `platform_only`), the caller's IP address and the time. **It does not hold the actor's name, email or
user agent**: the platform view looks the actor up in `users` when it reads, so after an erasure removes the user the row
keeps an id that no longer resolves. It has deliberately no foreign key to `organisations`, so deleting a tenant leaves its
trail in place.

**What makes it append-only.** Two triggers in `backend/migrations/003-audit-immutable.sql`, `audit_logs_no_update` and
`audit_logs_no_delete`, raise `audit_logs is append-only` for any `UPDATE` or `DELETE`, the application's own database user
included. `backend/tests/suites/030-identity.php` proves both statements are refused, against the throwaway test database.
It is not proof about the live database, and the triggers do not stop `TRUNCATE` or `DROP TABLE` by an account that holds
those privileges; which accounts hold them on the host is `NOT VERIFIED` (server state). Retained indefinitely (§3).

**Who reads it.**

- An organisation: `GET /orgs/{o}/audit` (`backend/src/Mod/Account.php`) returns `org`-visibility rows only, newest first
  with a `before_id` cursor and at most 100 a page. An owner sees the organisation's rows; anyone else sees only what they
  did themselves. `platform_only` rows are never returned to a tenant.
- The browser may record six actions about itself through `POST /orgs/{o}/audit` (`gdpr.export`, `report.exported`,
  `timesheet.exported`, `staff.exported`, `timesheet.amended`, `leave.reviewed`), limited to 120 an hour, with at most 2000
  bytes of metadata. Nothing else can be written through that route.
- The platform: `GET /platform/audit` (`backend/src/Mod/PlatformAudit.php`) reads every row across organisations for
  platform owner, admin and support; finance reads none. It filters by scope, actor, severity, free text and dates.

## 6. Incident response

No formal runbook or on-call rotation exists yet. What already exists to build one on:

- **Detection.** Sentry catches browser errors (EU ingest, after the visitor's consent; `src/lib/sentry.ts`); the PHP API
  has no error reporting of its own beyond the host's logs. `GET /api/health` is answered by the API
  (`backend/src/Api.php`, `backend/public/api/index.php`) and `/admin/platform-health` probes it from the administrator's
  browser (`src/services/platformHealthService.ts`). The scheduled prober of the Supabase era, which wrote
  `platform_health_samples` from the database, is not carried to MariaDB (`backend/src/DataMove/Map.php`); that file's
  comment says it was replaced by an external uptime check, and whether one exists is `NOT VERIFIED` (owner action, see the
  work queue in `docs/SAAS.md`). Without one there is no unattended detection between visits to that screen.
- **Declaration and tracking.** `incidents` and `incident_updates` (`backend/migrations/011-platform-ops.sql`),
  `backend/src/Mod/Incidents.php` and `/admin/incidents` are real: severity, status, timeline updates, owner. Nothing writes
  an incident automatically (`Incidents.php` holds the only `INSERT`); every incident there was entered by hand.
- **Communication.** `platform_announcements` notify affected organisations through the ordinary notification outbox, so an organisation's channel settings and each
  person's mute apply; maintenance and incident notices ignore an organisation's opt-out (`backend/src/Mod/PlatformAnnouncements.php`).
  There is no public status page.
- **Missing.** A defined severity to response-time mapping, an on-call rotation, an escalation path from "Sentry fired" to
  "a human is paged", and a template for the customer communication that goes out during a live incident. This is squarely
  `docs/SAAS.md`'s P0 incident-response item, which needs a person named, not more code.

## 6a. The browser, and what it is allowed to keep

Added 2026-09-04, because this file described every store the product has
except the one every visitor carries.

### What was wrong

`/legal/cookies` published, and `/legal/privacy` repeated, that there was "no
analytics, no tracking, and no third-party script on this site". At the same
time `src/lib/sentry.ts` configured `browserTracingIntegration()` at
`tracesSampleRate: 0.2` and `replayIntegration()` at
`replaysOnErrorSampleRate: 1.0`, started from `src/main.tsx` before the first
render, on every route — including the two pages making the claim. A traced URL
carries organisation and staff ids in its path. A replay is a masked recording
of a session, buffered and uploaded when an error occurs.

Nobody had been asked, and the sub-processor row for Sentry described it as
error monitoring receiving "the signed-in user's id" — which was wrong in the
other direction too, since `Sentry.setUser` is never called.

This is worth stating as a class rather than an incident: **the claim and the
code lived in different files and nothing compared them.** `subprocessors.ts`
already had a rule for exactly this — every row cites the file that proves it —
and the storage list did not.

### What it is now

Read on 9 November 2026 from `src/lib/consent.ts`, `src/lib/legalFacts.ts`, `src/lib/sentry.ts`, `src/lib/session.ts` and
`vite.config.ts`.

| Category      | What it covers                                                                                                                                                                                                                      | Switchable       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `necessary`   | Clerk's sign-in cookies and storage, `rotaflow:activeOrgId`, `rotaflow:calendarFeed:<organisation>`, the onboarding draft, the offline outbox, the consent record itself                                                            | No               |
| `preferences` | `pwa-theme`, `rotaflow.sidebar.collapsed`, `rotaflow:report-favourites:*`, `rotaflow:report-runs:*`, `rotaflow:installPromptSnoozedUntil` (the list is `CATEGORY_KEYS` in `src/lib/consent.ts`)                                      | Yes, default off |
| `diagnostics` | Sentry crash reporting. No replay and no tracing (`buildSentryOptions` sets neither), console breadcrumbs dropped, query strings and invitation tokens stripped from both the breadcrumb URLs and `event.request.url`                  | Yes, default off |

The decision lives in `localStorage` under `rotaflow:consent` as `{version, decidedAt, preferences, diagnostics}`, the
minimum evidence, no identifier of any kind. `CONSENT_VERSION` re-asks when the categories change.

**Two leftovers the code shows, both Phase 4.** First, `rotaflow:workMode:<user>:<organisation>` is written by
`src/context/WorkModeContext.tsx` and swept on sign-out by `src/lib/session.ts`, but it is in neither `CATEGORY_KEYS` nor
the published `STORED_ITEMS` list in `src/lib/legalFacts.ts`, and its write is not behind `isAllowed`. The published
storage list therefore omits a key the app writes. Second, `src/lib/session.ts` still deletes two caches named
`supabase-api` and `imagekit-media`; the service worker no longer writes either (`vite.config.ts` has exactly one runtime
cache, `rotaflow-fonts`), so the deletion only clears what an older build left.

### Where the gate actually is

In the write path, `isAllowed()` in `src/lib/consent.ts`, called at each of the four preference writes
(`src/context/ThemeContext.tsx`, `src/components/layout/Sidebar.tsx`, `src/lib/reportPrefs.ts`,
`src/components/InstallPrompt.tsx`) and before `Sentry.init` (`src/lib/sentry.ts`), not in the banner. A banner that merely
covers the page stops nothing, and a visitor who ignores it must still be left untouched. Every failure mode reads as "not
decided, nothing allowed": absent record, corrupt JSON, an older version, or a `localStorage` that throws.

### How to check it is still true

The unit and e2e suites cover the logic and the interface, but neither can see what leaves the browser, because Sentry only
runs in a production build (`enabled: env.isProd`) and the Playwright suite runs against `pnpm run dev`. The check that
matters is a production build with a DSN pointing at a host that cannot resolve, served by `vite preview`, watching the
network:

```
VITE_SENTRY_DSN='https://<key>@consent-probe.invalid/1' pnpm run build
pnpm run preview
```

Then, in a browser with site data cleared: throw an error before answering, and after rejecting, and see no request to
that host in either case. Accept, throw again: one request, whose envelope contains no `replay_event`, no
`"type":"transaction"`, no console breadcrumb, and no query string.

**That last one is why this paragraph exists.** Breadcrumb scrubbing was in place, the unit tests passed, and a real
envelope still carried the full query string, because Sentry fills `event.request.url` from `window.location.href` and
never routes it through `beforeBreadcrumb`; `scrubEvent` in `src/lib/sentry.ts` now trims it. A test that asserts a hook
was configured proves nothing about what is transmitted. That probe passed 9 checks of 9 on 2026-09-04, before the
cutover, and has not been re-run on the current build (`NOT VERIFIED`).

## 7. Support escalation

`support_cases` and `support_case_messages` (`backend/migrations/010-support-desk.sql`) and `/admin/support` are real:
priority, assignment, first-response and resolution timestamps are measured, and `support_sla_targets` gives each a due
time (`backend/src/Mod/Support.php`, `backend/src/SupportRules.php`). A case is visible to the person who raised it, an
owner of its organisation and operational platform staff; internal notes reach staff only; a case you may not see is a
plain 404. What routes an inbound email into a case is not built: the queue only contains what the app itself created,
so a message to the contact mailbox does not become a case automatically (**GAP-035**).

**Opening a tenant's data needs the customer's consent first.** Platform support reads tenant data only through a
time-boxed session (`support_access_sessions`, `backend/migrations/009-platform-access.sql`): a reason of at least 15
characters, a case reference, scope `read` or `read_write`, 15 minutes to 24 hours, one open session per person and
organisation (`backend/src/Mod/Console.php`). `Scope::supportMembership` (`backend/src/Scope.php`) re-checks on **every
request** that the session is unrevoked and unexpired, that the organisation still has `support_access_allowed` set, that
the organisation is not archived, and that the person is still platform owner, admin or support. So an owner who turns it
off ends a live session at once. The column defaults to **off** for a new organisation (`002-identity.sql`), and the owner
turns it on when support asks. A support session gets a manager's reach, never an owner's, and a `read` session refuses
writes. It is refused outright on staff documents (`backend/src/Mod/Compliance.php`). The switch does not turn itself off
when a session ends.

## Open items, in priority order

1. **Copy the MariaDB backups off the server, and alert on a failed run** (§1). The six-hourly job is installed and proven
   (recorded in `docs/AUDIT.md`), but the dumps sit on the same hosting account as the database, nothing tells anyone when
   a run fails, the monthly restore drill is not scheduled, and the stored files are not in the dump. Key custody for an
   encrypted copy is an owner decision. Blocks a safe beta more than anything else in this document.
2. **Name an incident owner and an on-call path** (§6), a decision, not code.
3. **Arrange an unattended uptime check and an alert to a person** (§6). The scheduled health probe of the Supabase era
   (`pg_cron`, migration `0076`) is gone with that database; whether an external monitor exists is `NOT VERIFIED` (owner
   action).
4. **Build the deleted-tenant grace window**, or decide there is none. It is the one policy in §3 not on a timer; the
   owner's three retention defaults (§3) are all unimplemented, and the retention periods themselves still need legal
   advice.
5. **Build a subject-access export that assembles one package** instead of two partial ones (§4), starting with the
   organisation export's 14 omitted names, its single page of audit and clock history, and the empty documents dataset in
   the per-subject export.
6. **Replace the CF-RAY origin lock** with Cloudflare Authenticated Origin Pulls or a Cloudflare IP-range lock in the
   composed root `.htaccess`: the `CF-RAY` header can be sent by anyone who reaches the server's address directly
   (security audit, 2 November 2026; the lock block is `scripts/htaccess/origin-lock.conf`).
7. **Push the composed root `.htaccess`** (`pnpm htaccess push --go`, needs approval; it replaces "copy the header block by
   hand"): `ServerSignature Off` and unsetting `X-Turbo-Charged-By` / `X-Powered-By` (the repository copy has them; the
   release never ships the root file).
8. **Require a verified email at the API.** `Users::resolve` (`backend/src/Users.php`) refuses a session whose token carries
   `email_verified` unless it is true, but does not require the claim to be present. Add `email_verified` to the Clerk
   session token (a Clerk dashboard setting, `NOT VERIFIED`) and then require it, now that Google sign-in is enabled beside
   the email code (also a dashboard setting, `NOT VERIFIED`).
9. **Clerk account hardening, owner action, `NOT VERIFIED` (dashboard).** Bot protection on sign-up, breached-password
   checks where a password exists, and two-step verification are Clerk settings. The earlier items about leaked-password
   protection and CAPTCHA in the hosted-auth settings no longer apply to this stack; the equivalent checks are in the
   Clerk dashboard, and nothing in the repository can show their state.
10. **Retire the scheduled workflow that still targets the retired Supabase project** (`auth-config.yml`; `backup.yml` was removed on
    13 November 2026): Phase 5.

## Privacy data map

Every point where personal data is collected, stored in the browser, sent to a processor, retained and released. Merged from the deleted `docs/PRIVACY-DATA-MAP.md` on 11 October 2026. It was written on 4 September 2026 and each row cites where it can be checked; `docs/SAAS.md` stays the register of current status. **Re-read against the PHP and MariaDB stack on 9 November 2026:** where a row says where data is stored, which module handles it or what a table holds, that is the live stack; the purpose and subject columns are the 4 September analysis and were not re-argued.

**Dated 4 September 2026, storage re-read 9 November 2026.** A snapshot, like `qa/FUNCTIONAL-AUDIT.md`, not a
living document: the register in `docs/SAAS.md` is what stays current.

Built by reading the code and the migrations, not by asking what the product does. Every row cites where it can be checked. Where a fact is
a legal conclusion rather than an observation it is marked **REQUIRES LEGAL
REVIEW**; where it is a business fact nobody has recorded it is marked
**REQUIRES OWNER INPUT**, and those are collected in the last two sections.

**This is the technical input a privacy notice needs. It is not the notice**
(that is `src/lib/privacyNotice.ts`, rendered at `/legal/privacy`), and it is
not legal advice.

---

### 1. The frame

|                |                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project        | RotaFlow, deployed to `rotaflow.space` (`release.json`)                                                                                                                    |
| Operator       | Gideon Akinlotan, UK sole trader, trading as RotaFlow. No company number. **REQUIRES OWNER INPUT:** no postal address published, no ICO registration                       |
| Intended users | UK and EEA. Employers and the staff they invite                                                                                                                            |
| Role           | **Controller** for visitors, account holders, billing contacts, support correspondence and crash reports. **Processor** for everything an employer records about its staff |
| Live data      | Not measured since the cutover (`NOT VERIFIED`, database state). The last measurement, of the Supabase project, was 0 organisations and 1 user on 2026-08-31; the data move is described in `docs/CUTOVER.md` |
| Database       | MariaDB on RotaFlow's cPanel server, in a Namecheap UK data centre as published and owner-confirmed (`NOT VERIFIED` from the repository). Supabase Postgres in `eu-west-1` until the cutover |
| Backups        | **On-server backup every six hours, installed and proven 2026-11-08** (`backend/bin/backup.php`, recorded in `docs/AUDIT.md` and `docs/DEPLOYMENT.md`); **no off-site copy, no alert on failure, no point-in-time recovery, and the stored files are not in the dump** (§1 above). Every deletion is irreversible beyond the last dump |

---

### 2. Collection points

Grouped by where a person's information enters the system. "Subject" is who the
data is about, which is not always who typed it.

| #   | Collection point                                  | Fields                                                                                                                                                                              | Subject                                                    | Purpose                                        | Stored in                                                                         | Evidence                                                           |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| C1  | Sign-up                                           | email address (Clerk emails a code; no password is set), name if Clerk's form asks for one (dashboard setting, `NOT VERIFIED`)                                                       | account holder                                             | create an account                              | Clerk; `users` (`clerk_user_id`, `email`, `full_name`)                            | `src/pages/SignupPage.tsx`, `backend/src/Users.php`                |
| C2  | Sign-in, Google where enabled                     | email, the emailed code, provider identity if Google is enabled (dashboard setting, `NOT VERIFIED`)                                                                                  | account holder                                             | authenticate                                   | Clerk; the API stores no credential                                               | `src/pages/LoginPage.tsx`, `backend/src/Jwt.php`                   |
| C3  | Password reset (retired)                          | none: there is no password. `/forgot-password` and `/reset-password` redirect to `/login`                                                                                            | account holder                                             | account recovery                               | not applicable                                                                    | `src/App.tsx`                                                      |
| C4  | Organisation setup                                | org name, slug, sector, team size, site name, **site postal address**, coordinates, geofence radius                                                                                 | the organisation                                           | provision the tenant                           | `organisations`, `locations`                                                      | `src/components/onboarding/StepAbout.tsx`, `backend/src/Mod/Orgs.php` |
| C5  | Invitations                                       | colleague email, role, location, department                                                                                                                                         | the invitee                                                | onboard staff                                  | `invites` (the token is kept as a hash)                                           | `src/components/settings/TeamInviteManager.tsx`, `backend/src/Mod/Invites.php` |
| C6  | Staff record (manager-entered)                    | name, job title, department, contract type, weekly hours, holiday allowance, skills, **payroll id**, start date, **phone**, **email**, sites, photo (an uploaded file, or a legacy link)  | the staff member                                           | scheduling and pay                             | `staff_profiles`, `staff_locations`                                               | `src/components/staff/StaffFormModal.tsx`, `backend/src/Mod/Staff.php` |
| C7  | Own profile                                       | full name, phone, photo upload (`staff-photos` bucket)                                                                                                                              | the staff member                                           | keep the record current                        | `users`, `staff_profiles`; the file store                                         | `src/pages/app/account/ProfilePage.tsx`, `backend/src/Mod/Photos.php` |
| C8  | Emergency contacts                                | contact name, relationship, phone, second phone. **Medical notes** no longer collected or shown (2026-10-11); the column does not exist in `emergency_contacts`                      | **a third party**, plus health data about the staff member | emergency response                             | `emergency_contacts`                                                              | `src/components/staff/EmergencyContactsModal.tsx`, `backend/src/Mod/Staff.php` |
| C9  | Documents                                         | the document type (an organisation-defined list), name or number, the **uploaded file** (PDF, JPEG, PNG, WebP or HEIC, 10 MiB at most), issue and expiry dates, review status and any rejection reason; older rows hold a pasted **link** | the staff member                                           | compliance records                             | `documents`, `document_types`; the file store                                     | `src/components/staff/DocumentsModal.tsx`, `backend/src/Mod/Compliance.php` |
| C10 | Pay rates                                         | hourly rate (pence), effective date                                                                                                                                                 | the staff member                                           | labour cost and payroll export                 | `staff_pay_rates`                                                                 | `backend/migrations/004-people-places.sql`, `backend/src/Mod/Staff.php` |
| C11 | Leave                                             | **type (includes `sick`)**, dates, free-text reason                                                                                                                                 | the staff member                                           | absence management                             | `leave_requests`                                                                  | `src/components/leave/LeaveRequestModal.tsx`, `backend/src/Mod/Leave.php` |
| C12 | Clock in / out                                    | time, method, **latitude, longitude, accuracy**, location name                                                                                                                      | the staff member                                           | attendance and pay                             | `clock_events`, `clock_event_corrections`                                         | `src/pages/app/ClockInPage.tsx`, `src/hooks/useGeolocation.ts`, `backend/src/Mod/Clock.php` |
| C13 | Shifts, swaps, overtime, availability, timesheets, cover | dates, times, notes visible to colleagues, reasons; for cover, the free-text reason for an absence and the note on an offer to cover                                         | the staff member                                           | scheduling                                     | `shifts`, `shift_swaps`, `overtime_requests`, `availability`, `timesheets`, `cover_absences`, `cover_applications` | `src/components/swaps/`, `src/components/overtime/`, `backend/src/Mod/Cover.php` |
| C14 | In-app support                                    | message bodies, replies, rating, requester email                                                                                                                                    | the requester                                              | answer the request                             | `support_cases`, `support_case_messages`                                          | `backend/src/Mod/Support.php`                                      |
| C15 | Website contact form                              | name, work email, organisation, sector, team size, message, wants a demo, **marketing consent (unticked by default)**; server-side an **HMAC of the IP address** and the user agent | the enquirer                                               | reply to an enquiry                            | `enquiries` (platform-wide, no `org_id`), read by operational platform roles only | `backend/src/Mod/Enquiries.php`, `backend/migrations/011-platform-ops.sql` |
| C16 | AI assistant                                      | manager's free-text prompt, plus assembled staff context                                                                                                                            | the staff scheduled                                        | draft a rota or an announcement                | prompt not stored (the audit row keeps the model, the prompt version and the prompt's length); output reviewed before saving | `backend/src/Mod/AiAssistant.php`                                  |
| C17 | Billing                                           | email and card details **entered on Stripe's page**, org id, plan code, Stripe's invoice page and PDF links                                                                         | the payer                                                  | take payment                                   | Stripe; `subscriptions`, `invoices`, `billing_events` locally                     | `backend/src/Mod/Billing.php`, `backend/src/Mod/StripeWebhook.php` |
| C18 | Push notifications                                | endpoint, `p256dh`, `auth` keys                                                                                                                                                     | the device owner                                           | deliver notifications                          | `push_subscriptions`                                                              | `src/hooks/useWebPush.ts`, `backend/src/Mod/Notifications.php`     |
| C19 | Audit trail                                       | actor id, **IP address**, action metadata, the organisation's name at the time. No actor email, name or user agent is stored on the row (§5 above)                                  | the actor                                                  | security and accountability                    | `audit_logs`                                                                      | `backend/src/Audit.php`, `backend/migrations/002-identity.sql`     |
| C20 | Sessions                                          | none held by the API: sessions are Clerk's. The API stores `users.last_seen_at`, written at most every 300 seconds                                                                  | the account holder                                         | let a person see and revoke their own sessions | Clerk; `users`                                                                    | `backend/src/Users.php`                                            |
| C21 | Crash reports                                     | stack trace, page path, breadcrumbs                                                                                                                                                 | whoever hit the error                                      | fix faults                                     | Sentry (EU)                                                                       | `src/lib/sentry.ts`                                                |
| C22 | Org SMTP settings                                 | host, port, user, **password**, from address                                                                                                                                        | the organisation                                           | send mail as the customer                      | `org_smtp_settings` (the password is encrypted with AES-256-GCM)                  | `src/pages/app/settings/SettingsIntegrationsPage.tsx`, `backend/src/Mod/OrgSettings.php`, `backend/src/Secret.php` |
| C23 | Calendar feed                                     | token in a URL, then that person's shifts, times, locations, notes                                                                                                                  | the staff member                                           | subscribe a calendar                           | `calendar_feed_tokens` (the token is kept as a SHA-256 hash)                      | `backend/src/Mod/CalendarFeed.php`                                 |
| C24 | Data requests                                     | the account's email and name, request kind, dates, status                                                                                                                           | the requester                                              | answer a UK GDPR request                       | `gdpr_requests`                                                                   | `backend/src/Mod/Gdpr.php`, `backend/migrations/013-data-lifecycle.sql` |

#### Notes on the ones that carry the most risk

**C8: emergency contacts.** The only place the product holds data about
somebody who has no relationship with it at all. `medical_notes` was
free text prompted with "Allergies, conditions", so it was Article 9 health data
by design. Since 2026-10-11 (GAP-058, plan S1) the product no longer collects or
shows it, and the column is not in the MariaDB table (`backend/migrations/004-people-places.sql`). In the Supabase era `0164` dropped the column (2026-10-22,
decision D5); a count-only read of production that day, approved by the owner,
found no row in `emergency_contacts` at all, so the planned export to owners
(O11) had nothing to export. Hard-deleted on erasure (`backend/src/Mod/Gdpr.php`). The leave reason field carries a hint not to
include medical details. **REQUIRES LEGAL REVIEW:** Article 14
notification duty, and how it divides between employer and processor.

**C9: documents.** The document type is chosen from the organisation's own list (`document_types`), and the row has a free-text name or number. Until 2026-10-11
the old type field's placeholder suggested DBS and right-to-work, so criminal-record and
immigration data landed in a column nothing was designed around by design. Phase
1 of plan S2 (decision D4) removed that suggestion and changed the copy to
"Record the document type, number and expiry. Keep the document itself in your
own HR system." The name field is still free text, and existing records are
untouched, so such data can still be typed in or already be held. A document is an upload to the private `staff-documents` bucket
of the host's file store, readable only by the person and the organisation's owners and managers through a 60-second signed
link; a platform support session cannot read documents at all, and erasure, removal and organisation deletion queue the file for
deletion (`backend/src/Mod/Compliance.php`, `backend/src/Mod/Lifecycle.php`, `docs/DATA-MODEL.md`). Rows moved from before stored files
keep their pasted link (`file_url`), which erasure cannot reach.

**C11: leave type.** `sick` makes an absence record a health record about a
named person. Deliberately excluded from the AI prompt
(`backend/src/Mod/AiAssistant.php`, `approvedLeave`) after it was found leaving the UK/EU
beside real names on 2026-08-30.

**C12: location.** `enableHighAccuracy: true`. The browser's own permission
prompt is the gate; declining falls back to a manual clock-in recorded as
manual, so the feature degrades rather than blocks.

**C16: AI.** Job titles, skills, contracted hours and leave _dates_ leave the
UK/EU on a manager's click. Since 2026-10-11 staff are sent as short aliases
(`S1`, `S2`) and names are restored server-side; a nickname, misspelling or
shared first name in the manager's own prompt still goes as typed. The browser never talks to OpenRouter;
the API does (`backend/src/Mod/AiAssistant.php`).

**C23: calendar feed.** The route is public (`GET /ics`, no sign-in); the token in the query
string _is_ the credential, and the module's own header says the URL is
assumed leakable. Revocable, and revoked by erasure. A token that no calendar has read for 90 days
stops working, and more than 120 reads an hour for one person are
refused with 429. The person rotates the link from "My rota" (Reset link); only the hash of the token is stored
(`backend/src/Mod/CalendarFeed.php`). The
token still travels in the query string, so it still reaches platform request
logs: that is the cost of a client that cannot send a header.

---

### 3. Browser storage

Verified on 4 September 2026 by reading every storage write in `src/`; re-read against the
current code on 9 November 2026 (a read, not a browser run: the runtime confirmation is `NOT VERIFIED`). The published list is
`STORED_ITEMS` in `src/lib/legalFacts.ts`. That list's own header still says "no cookies", while its first entry names Clerk's
sign-in cookies (`__session`, `__client_uat`); the published text differs from itself, and correction is Phase 4. What Clerk's
script sets beyond those names, and what Cloudflare's sign-up challenge sets, is `NOT VERIFIED` (browser).

| Key                                  | Store              | Purpose                                                           | Category    | Consent needed | Lifetime                   | Evidence                                      |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------- | ----------- | -------------- | -------------------------- | --------------------------------------------- |
| Clerk: cookies `__session`, `__client_uat`, local storage `__clerk_environment` | cookies and localStorage | session, so you stay signed in                    | necessary   | No             | until sign-out or expiry   | `src/context/AuthContext.tsx`, `src/lib/legalFacts.ts` |
| `rotaflow:activeOrgId`               | localStorage       | which tenant you were in                                          | necessary   | No             | until sign-out             | `src/lib/session.ts`                          |
| `rotaflow:calendarFeed:<organisation>` | localStorage     | the private calendar link, so it can be copied again on the device that made it | necessary | No        | until reset or sign-out    | `src/services/calendarFeedService.ts`         |
| `rotaflow:workMode:<user>:<organisation>` | localStorage  | whether a manager is looking at the organisation or at their own work | not declared (see §6a) | not gated | until sign-out | `src/lib/workMode.ts`, `src/context/WorkModeContext.tsx` |
| `rotaflow:consent`                   | localStorage       | your answer, and when                                             | necessary   | No             | until cleared or changed   | `src/lib/consent.ts`                          |
| `rotaflow:onboarding-draft`          | **sessionStorage** | org name and site address across a refresh                        | necessary   | No             | until onboarding completes | `src/pages/OnboardingPage.tsx`                |
| `rotaflow-outbox`                    | IndexedDB          | clock-ins, leave and swaps made offline (stores `queued_writes` and `dead_letters`) | necessary   | No             | until synced or discarded  | `src/lib/offlineOutbox.ts`                    |
| `pwa-theme`                          | localStorage       | light or dark                                                     | preferences | **Yes**        | until site data cleared    | `src/context/ThemeContext.tsx`                |
| `rotaflow.sidebar.collapsed`         | localStorage       | sidebar state                                                     | preferences | **Yes**        | until site data cleared    | `src/components/layout/Sidebar.tsx`           |
| `rotaflow:report-favourites:*`       | localStorage       | starred reports, per org                                          | preferences | **Yes**        | until site data cleared    | `src/lib/reportPrefs.ts`                      |
| `rotaflow:report-runs:*`             | localStorage       | this browser's export history                                     | preferences | **Yes**        | until site data cleared    | `src/lib/reportPrefs.ts`                      |
| `rotaflow:installPromptSnoozedUntil` | localStorage       | you dismissed the install banner                                  | preferences | **Yes**        | 30 days                    | `src/lib/installPrompt.ts`                    |
| the Workbox precache (the app's own code, styles and icons) | Cache API | so the app opens with no signal. `vite.config.ts` sets no `cacheId`, so the cache carries Workbox's default name, not the `rotaflow-precache` that the published list gives | necessary | No | replaced with each release | `vite.config.ts` |
| `rotaflow-fonts`                     | Cache API          | self-hosted webfonts, no personal data                            | necessary   | No             | 1 year                     | `vite.config.ts`                              |

The service worker caches **no API response**: `vite.config.ts` has one runtime cache rule, for same-origin `/fonts/`, and
none for `/api/*`, so tenant data behind a bearer token is never stored by it. (The retired row for cached
authenticated responses is gone with the rule that wrote them.)

The `preferences` classification is **provisional and REQUIRES LEGAL REVIEW**.
Storage that is not strictly necessary needs consent under PECR regulation 6;
whether a preference the user sets by their own deliberate click falls inside
the strictly-necessary exemption is exactly the kind of question this document
should not answer for itself. It is treated as needing consent, which is the
safe direction.

**The offline outbox is deliberately not cleared on sign-out**
(`src/lib/session.ts`): a queued clock-in belongs to the person who made
it, not to the session. Isolation is by a `userId` ownership filter instead.
Rows written before that field existed belong to nobody since 2026-10-11 (plan
S4): kept on the device but never replayed, listed or retried
(`belongsTo` in `src/services/syncQueue.ts`). Residual: such a row, with its GPS
position, stays in IndexedDB on the device until removed by hand, because there
is no expiry yet. Sign-out now also deletes this device's `push_subscriptions`
row and unsubscribes the browser (`releasePushSubscription`,
`src/lib/session.ts`); a session that ends without a sign-out does not.

---

### 4. Processors and transfers

Published at `/legal/trust`, generated from `src/lib/subprocessors.ts`. Repeated
here only where this document adds something; the places where the published list and the code differ are in §2 above.

| Processor                   | What it gets                                                          | Where              | Outside UK/EU           |
| --------------------------- | --------------------------------------------------------------------- | ------------------ | ----------------------- |
| Namecheap / cPanel          | everything the product holds: database, files, the site, outbound mail (the mail route is `NOT VERIFIED`, §2) | United Kingdom as published | No                      |
| Clerk                       | sign-in email, name if given, session and device details              | United States      | **Yes**                 |
| OpenRouter + model provider | staff aliases (not names), job titles, skills, hours, leave **dates** | United States      | **Yes**                 |
| Stripe                      | billing identity of the payer                                         | United States      | **Yes**                 |
| Sentry                      | stack trace, page path, breadcrumbs                                   | EU ingest          | No                      |
| Cloudflare                  | IP address and requested pages of **every visitor**                   | global edge        | Not flagged, see below  |
| Web push services (not on the published list) | notification title and body, encrypted to the device | the browser vendor's push service, `NOT VERIFIED` | `NOT VERIFIED` |

**Cloudflare is the awkward one.** The `outsideUkEu` flag means "personal data
leaves the UK/EU to reach it", and a proxied request is served by the location
nearest the visitor. It is nonetheless a worldwide network run by a US company,
and it sees every visitor whether or not they sign in. Flagging it `true` would
group it with Stripe and OpenRouter, where the page says both are in the United
States and neither receives anything unless you use the feature it powers —
none of which is true of Cloudflare. It stays `false`, the region field and
`/legal/trust` say plainly what it is, and the transfer question is recorded
below. **REQUIRES LEGAL REVIEW.**

**REQUIRES LEGAL REVIEW** for the genuine transfers: no international data
transfer agreement, no UK addendum to the standard contractual clauses, and no
transfer risk assessment exists for Clerk, Stripe or OpenRouter. (Clerk joined the
list at the cutover; the earlier analysis named only Stripe and OpenRouter.)

---

### 5. Retention

From `retention_policies` (`backend/migrations/013-data-lifecycle.sql`), enforced once a day after 02:15 UTC by `Retention::run`
(`backend/src/Retention.php`, called from `Lifecycle::cron`), with each run recorded in
`retention_runs`. The full table, with what each rule removes, is §3 above; this is the summary.

| Data                                   | Period                | Trigger          | Method                                                       | Enforced                                                 |
| -------------------------------------- | --------------------- | ---------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Rota and shift history                 | 84 months             | shift start date | hard delete                                                  | Yes                                                      |
| Attendance, incl. GPS                  | 36 months             | event date       | hard delete                                                  | Yes                                                      |
| Leave                                  | 72 months             | end date         | hard delete                                                  | Yes                                                      |
| Support cases                          | 36 months             | resolution date  | hard delete                                                  | Yes                                                      |
| Notification delivery + settled outbox | 12 months             | creation         | hard delete                                                  | Yes                                                      |
| Website enquiries                      | 24 months             | arrival          | hard delete                                                  | Yes                                                      |
| Audit log                              | indefinite            | —                | append-only triggers refuse `UPDATE` and `DELETE`            | By the database                                          |
| Deleted tenant                         | immediate             | owner's action   | one transaction, then the stored files are queued            | **The declared 1-month grace window is not implemented** |
| `staff_pay_rates`                      | none                  | —                | survives anonymisation, identifying nobody                   | By decision                                              |
| Uploaded document files                | with their record     | record deleted   | queued in `storage_deletions`, removed by `Lifecycle::cron`  | Yes, each run removes up to 20 queued files              |
| Uploaded staff photos                  | with their record     | replaced, erased | queued in `storage_deletions`, removed by `Lifecycle::cron`  | Yes                                                      |
| Login after a completed erasure        | until the case closes | case completed   | queued in `account_deletions`, removed by `Gdpr::cron` from Clerk and from `users` | Yes, needs `clerk_secret_key` in the private configuration (`NOT VERIFIED` that it is set) |
| Legacy pasted document links, photos   | **none**              | —                | the link is removed, the file is not                         | No                                                       |

The retired row for platform health samples (pruned after 90 days) is gone: the samples are not carried to MariaDB (§3 above).

Nothing is anonymised by retention; every branch is a hard `DELETE`.

**Staff documents in the PHP API (R2 slice S10, `backend/src/Mod/Compliance.php`).** A document row and its file are
kept for as long as the person's staff record exists, **including withdrawn, rejected and replaced rows**, which are the
review history. They go when the person is erased (rows deleted, both folders queued in `storage_deletions` and removed
by `Lifecycle::cron` within minutes) or the organisation is deleted. Nothing removes them on a timer: there is no
`retention_policies` row for documents. **REQUIRES OWNER INPUT:** whether withdrawn and rejected uploads (which may be
the wrong person's passport) should be removed sooner, and a retention period for documents of people who have left. The owner's stated
defaults (right-to-work records for the employment plus two years; withdrawn or rejected uploads 90 days) are not implemented.
The file itself is never at a guessable address: it is served only through a 60-second HMAC-signed link, only while a
row still names it, with the type judged from the bytes (PDF, JPEG, PNG, WebP, HEIC; 10 MiB). A platform support session
cannot read documents at all. The audit trail records uploads, reviews and withdrawals by id and type, never a document's
name or number.

**Every period above REQUIRES LEGAL REVIEW.** They were chosen when the
schedule was built and have not been justified against a statutory or business
requirement. Indefinite audit retention is the one most worth defending or
shortening.

---

### 6. Rights

| Right                  | Available         | How                                              | Evidence                                     |
| ---------------------- | ----------------- | ------------------------------------------------ | -------------------------------------------- |
| Access                 | Partly            | manager exports one person's record, 14 named datasets; the documents dataset is always empty (§4 above) | `src/services/gdprService.ts` |
| Portability            | Partly            | same export, JSON                                | as above                                     |
| Rectification          | Yes               | edit the staff record                            | `src/components/staff/StaffFormModal.tsx`    |
| Erasure                | Partly            | `POST /orgs/{o}/staff/{s}/erase`, owner-only; the login is removed by a completed erasure request | `backend/src/Mod/Gdpr.php` |
| Restriction, objection | Case-managed only | `gdpr_requests` register                         | `backend/migrations/013-data-lifecycle.sql`  |
| Withdraw consent       | Yes               | consent panel, footer or account preferences     | `src/lib/consent.ts`                         |
| Org export             | Partly            | 36 named entries, 22 read, one JSON file; clock events and audit rows limited to one page (§4 above) | `src/services/orgLifecycleService.ts` |
| Org deletion           | Yes               | typed name confirmation, immediate               | `backend/src/Mod/Lifecycle.php`              |

**An individual can ask, but not act** (GAP-057). My account,
Your data (`/app/account/data`) files an access, portability, rectification or
erasure request for the signed-in person (`POST /me/data-requests`); the
subject is taken from the signed-in user, so the page cannot name anybody else, and
`GET /me/data-requests` shows the person their own cases without the outcome note.
Restriction and objection, and anyone without an account, still go by email. Every
route lands in `gdpr_requests`, which computes a due date one month out,
extendable once by two with a recorded reason, and cannot be closed without an outcome
note. Closing an erasure case as completed removes the person's
login: the case queues it in `account_deletions`, and `Gdpr::cron` deletes it from Clerk and from `users`
(`backend/src/Mod/Gdpr.php`).

What erasure keeps, deliberately: shifts, clock events, leave, swaps,
timesheets, availability, site assignments and pay rates, all attached to an
anonymised `staff_profiles` row reading "Deleted Member".
`Gdpr::ERASURE_RETAINED` enumerates the kept columns and the suite
`backend/tests/suites/190-lifecycle.php` fails when a new identifying column appears
in neither list, which is the right shape for this class of problem.

---

### 7. Security controls relevant to privacy

| Control                 | State                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Tenant isolation        | An access check in PHP (row-level security was retired at the cutover): every organisation route starts with `Scope::membership()`, the role is read from the database, and a non-member gets 404. The access-sweep suite calls every route as nobody, a stranger and a user with no organisation. It runs in `pnpm run check:php`; `ci.yml` has no PHP test step | `backend/src/Scope.php`, `backend/tests/suites/099-access-sweep.php` |
| Transport               | TLS only, Cloudflare in front, origin refuses direct requests (a `CF-RAY` header check that can be forged: open item 6)                                                                                                                                                                                                                                                                                                       | `.htaccess`, `scripts/htaccess/origin-lock.conf`   |
| Content security policy | `script-src 'self'` plus Clerk's and Cloudflare's challenge hosts; the app talks to its own `/api`, Clerk and Sentry's EU ingest host                                                                                                                                                                                                                                                                                          | `.htaccess`                                        |
| Fonts                   | self-hosted since 2026-09-03; previously leaked every visitor IP to Google                                                                                                                                                                                                                                                                                                                                                    | `public/fonts/README.md`                           |
| Secrets                 | Kept in the private configuration folder outside every web root (`rotaflow-private`); an organisation's SMTP password is stored encrypted (AES-256-GCM) with `secret_key` from that folder, so a dump alone reveals nothing                                                                                                                                                                                                     | `backend/src/Bootstrap.php`, `backend/src/Secret.php` |
| `smtp_pass`             | never returned by the API: a read says only whether one is set                                                                                                                                                                                                                                                                                                                                                                | `backend/src/Mod/OrgSettings.php`                  |
| Audit log               | append-only, enforced by two triggers                                                                                                                                                                                                                                                                                                                                                                                         | `backend/migrations/003-audit-immutable.sql`       |
| Second factor           | Clerk's setting, not the API's. The API verifies a Clerk session token (RS256, issuer, authorised party) and has no second-factor code of its own; whether two-step verification is on for accounts is `NOT VERIFIED` (dashboard)                                                                                                                                                                                              | `backend/src/Jwt.php`                              |
| Rate limiting           | 600 requests a minute per signed-in user, 300 a minute per address on public routes, and named limits on sensitive paths (invitations, enquiries, calendar feed, organisation deletion, support sessions, AI)                                                                                                                                                                                                                  | `backend/src/Api.php`, `backend/src/RateLimiter.php` |
| Backups                 | **On-server dump every six hours, installed and proven 2026-11-08; no off-site copy, no failure alert, no point-in-time recovery; stored files not covered** (§1)                                                                                                                                                                                                                                                              | `backend/bin/backup.php`, `docs/DEPLOYMENT.md`     |
| Scheduled checks        | `backup.yml` was removed on 2026-11-13; `auth-config.yml` still targets the retired Supabase project; the current state of `auth-config.yml` is `NOT VERIFIED` (not read this pass); repair is Phase 5                                                                                                                                                                                                                                                                                                                    | `.github/workflows/backup.yml`                     |

---

### 8. REQUIRES OWNER INPUT

1. **ICO registration.** Not registered, no number. Most UK organisations
   processing personal data must register and pay the fee. Blocks publication.
2. **Postal address.** The notice currently offers one on request. Whether that
   satisfies Article 13 is question 4 below.
3. **Legal form.** Sole trader or a limited company. Changes every clause of
   the Terms and the identity in the notice.
4. **EU Article 27 representative.** Unanswered, and the product is intended
   for EEA users.
5. **Commercial terms**, all marked inline in `src/lib/termsDraft.ts`: refunds,
   pro-rata credit, what happens to data at the end of the billing grace
   window, VAT inclusive or exclusive, notice before suspension, any service
   level.
6. **Uploaded files** (GAP-056). Uploaded documents and photos are deleted with
   their record, within minutes of being queued, by `Lifecycle::cron`
   (`backend/src/Mod/Lifecycle.php`). Legacy pasted document and photo links are
   still links the product cannot delete through.
7. **Minimum age** (GAP-060), and what an employer scheduling a 16- or
   17-year-old must be told.
8. **Whether a DPA will be commissioned.** `docs/SAAS.md` CAP-059 says never;
   any customer with an information-security review will ask for one.
9. **The `LICENSE` file** names no copyright holder, and the repository is
   public.
10. **The owner's retention defaults** (§3 above) and whether web push services and an organisation's own mail server
    should be added to the published sub-processor list.

### 9. REQUIRES LEGAL REVIEW

1. **Every lawful basis.** Proposed in the notice, confirmed by nobody.
2. **The Article 9 condition** for sickness leave. (The other Article 9
   field, `emergency_contacts.medical_notes`, was dropped in the Supabase era by `0164` on
   2026-10-22 and is not in the MariaDB schema.)
3. **Article 14** and emergency contacts (GAP-058).
4. **Whether an email address alone satisfies Article 13** for a sole trader.
5. **Transfer mechanism and risk assessment** for Clerk, Stripe and OpenRouter.
6. **Whether Cloudflare's edge network is a restricted transfer.**
7. **Every retention period**, and indefinite audit retention in particular.
8. **The PECR classification of the four interface preferences**: strictly
   necessary, or consent-requiring as currently treated.
9. **The one-month rights response time** as a published commitment, for both
   UK and EEA subjects.
10. **The whole liability section** of the Terms, and governing law.
11. **Whether a DPO or an Article 30 record is required** at this scale.
