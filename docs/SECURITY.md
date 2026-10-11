# Data lifecycle

**Status:** First pass, verified against the live deployment 13 August 2026 —
not yet reviewed by counsel. This is the technical record
`docs/SAAS.md` P0 needs as input for the published
Privacy Notice; it is not that notice. Where something is a gap rather than a
fact, it is written as a gap.

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

**Current state, read on 11 October 2026 from `.github/workflows/backup.yml` and
`gh run list`.** A nightly encrypted `pg_dump` of production runs at 02:40 UTC and
is kept as a GitHub Actions artifact for 90 days. Each run also has a
`verify-restore` job that decrypts that night's dump, restores it into a throwaway
PostgreSQL and asserts the tables and grants came back. The workflow has succeeded
on every scheduled run from 6 September to 10 October 2026 (first success, by hand,
5 September). A human restore was rehearsed on 7 September and found the dump was
missing grants, fixed the same day (GAP-001, GAP-036). What this does **not** give:
recovery to a moment, which only PITR gives, and a proven restore of Supabase's own
`auth` and `storage` schemas, which are not in the dump. PITR was last read as off
on 13 August and has not been re-checked. Recovery steps are in
`docs/DEPLOYMENT.md`, "Recovery". The paragraphs below are the 13 August record.

**Verified 13 August 2026 via the Supabase Management API**
(`GET /v1/projects/{ref}/database/backups`): `pitr_enabled: false`,
`backups: []`. **There are currently zero backups of the production
database.** `walg_enabled: true` means the underlying tool is present, not
that anything is scheduled.

This is the single most important gap this document records. A bad migration,
an accidental mass-delete, or a compromised admin credential has nothing to
restore from today. Point-in-time recovery and scheduled daily backups are a
paid-tier Supabase feature; closing this gap is a billing decision (upgrading
the project's plan), not a code change, and is deliberately left to the
account owner rather than actioned here.

**Until this is closed:** treat every destructive admin action (organisation
deletion, GDPR erasure, bulk membership changes) as unrecoverable in
practice, and say so to whoever performs one.

### 1a. Deliberately deferred, and the condition that ends the deferral

Re-examined 20 August 2026. The gap above is real and the wording stands, but
it is being **consciously deferred rather than forgotten**, for one reason:
production holds almost no data.

| table                                                                      | rows |
| -------------------------------------------------------------------------- | ---- |
| `audit_logs`                                                               | 366  |
| `auth.users`                                                               | 1    |
| `organisations`, `memberships`, `staff_profiles`, `shifts`, `clock_events` | 0    |

Re-counted live 2026-08-29. **Production now holds no organisations at all** — `0066`
purged the QA accounts and the tenant they had created. The earlier reading (1 org, 2
memberships, 1 shift) is superseded.

No organisations, one auth user, no attendance history. If the database were lost
today, recovery is: re-run the migrations and recreate one account.
That path genuinely works as of migration `0056` — before it, the migration
set could not rebuild a working database at all, because no migration granted
table privileges (they were inherited from Supabase's ambient defaults, which
belong to the hosted project and not to this repo). Paying for backups today
would protect data that does not exist yet.

**The trigger is an event, not a date: the first real organisation onboarded
with live staff data.** Sign-ups by the owner for testing do not count; a
customer whose staff clock in does.

Why that specific line: migrations reconstruct the _schema_, never the _rows_.
While the only rows are reproducible by hand, migrations are a sufficient
recovery path. The moment a real rota, real clock-ins and real timesheets
exist, they are not — losing a day of attendance data means payroll disputes
that cannot be reasoned back from a schema.

### What exists in the meantime, and what it is not

Since 30 August 2026 `.github/workflows/backup.yml` takes a nightly `pg_dump`,
gzipped and encrypted, retained 90 days as a build artifact. Encrypted because
this repository is **public** and artifacts on a public repository are
downloadable by anyone who can read it — that dump is every staff record, every
GPS-stamped clock-in and the audit log, so an unencrypted one would be a breach
dressed up as a backup.

Three things to be clear about:

- **It is inert until two secrets exist** (`SUPABASE_DB_URL`,
  `BACKUP_PASSPHRASE`) and fails loudly naming the missing one, rather than
  reporting success on an empty file.
- **It does not give recovery to a moment.** A bad migration at 14:00 costs
  everything since the previous night. Only PITR closes that.
- **No restore has ever been performed.** A backup nobody has restored is a
  belief, not a backup; that is tracked as ❓-005.

So it narrows the gap and does not close it. What to buy, in order:

1. **A paid plan is the prerequisite** — the organisation is on `free`, which
   has no backups of any kind. A paid plan includes scheduled daily backups
   with a retention window, and that alone closes the gap this section opens.
2. **Point-in-time recovery is a further per-project add-on** on top of that,
   and is not the same purchase. It narrows the recovery point from up to a
   day down to minutes. Worth it once a day of lost clock-ins is a payroll
   problem rather than an inconvenience; not before.

Read current prices from the Supabase dashboard rather than any figure quoted
in a document — they change, and a stale number here would be worse than none.

This subsection exists so the deferral is a decision with a written trigger
instead of a silence. If you are reading it and a real organisation is live,
the deferral has expired.

## 2. Data residency

The Supabase project runs in `eu-west-1` (Ireland). Sentry is configured for
an EU ingest region (`docs/DEPLOYMENT.md` §5). ImageKit and the cPanel mail
host (`premium17.web-hosting.com`) are UK-based.

**Two components do send personal data outside the UK/EU. Both are US-based, and
both must appear in the Privacy Notice and the sub-processor list.** This section
previously claimed the opposite; that claim was wrong and was corrected on
2026-08-29.

| Processor                                                                          | What leaves the UK/EU                                                                                                                                                                                                                   | Where                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **OpenRouter** (and the model provider behind it, `openai/gpt-4o-mini` by default) | Staff first and last names, job titles, skills, weekly hours, contract type, plus shift, location and approved-leave **dates** for the week being drafted — assembled into the prompt context. **Leave `type` is not sent** (see below) | `supabase/functions/ai-rota-assistant/index.ts`       |
| **Stripe**                                                                         | Billing identity for the organisation's owner: email, and whatever Checkout collects                                                                                                                                                    | `supabase/functions/create-checkout-session/index.ts` |

⚠️ **Leave type used to be sent, and should not have been. Corrected 2026-08-30.**
The prompt carried `approvedLeave[].type` alongside a `staff` array holding real
first and last names, joinable by `staffProfileId`. Leave types include `sick`
(`src/lib/leaveRows.ts`), so a named person's **sickness-absence dates** left the
UK/EU on every request — special-category health data under UK GDPR Article 9,
disclosed to a US processor and to the model provider behind it.

Nothing wanted it. The only rule that reads that array is the system prompt's
rule 1, "never schedule someone whose id appears in `context.approvedLeave` for a
date inside that leave", which needs the dates and not the reason. The field is
now not even selected from the database, so it cannot drift back into the
payload. This was found while writing the sub-processor page (`GAP-014`), which
is the argument for writing one.

Neither is optional today: the AI assistant's third tab and the whole billing path
depend on them. What _is_ available is disclosure and, for the AI, scope — the two
deterministic assistant tabs run entirely on rows the org already has and make no
network call at all, so a tenant that never opens "Ask AI" never sends staff data
to OpenRouter.

Anyone writing the Privacy Notice, the DPA or a security questionnaire answer should
treat this table as the authoritative list, not §2's previous sentence. It is now
also published, at **`/legal/trust`**, built from `src/lib/subprocessors.ts` — that
page and this table must not be allowed to disagree.

## 3. Retention

`public.retention_policies` (migration `0027`) is the schedule. RLS permits any
signed-in user to read it, but **no tenant-facing screen does** — its only readers
are `AdminSettingsPage` and `AdminGdprPage` in the platform console. Earlier
revisions of this section said it was shown "to every signed-in user via
`/app/settings`"; that screen does not exist, and the §3a framing that rested on it
has been corrected accordingly. Its
`enforced` column exists specifically so a declared schedule is never
mistaken for a running job:

| Data type                         | Declared retention          | Enforced?                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rota and shift history            | 84 months                   | **Yes** — nightly at 02:15 UTC (`0029`, fixed by `0057`); running since 2026-08-21, see §3a/§3b                                                                                                                                                                 |
| Attendance / clock-in (incl. GPS) | 36 months                   | **Yes** — nightly at 02:15 UTC (`0029`, fixed by `0057`); running since 2026-08-21, see §3a/§3b                                                                                                                                                                 |
| Leave records                     | 72 months                   | **Yes** — nightly at 02:15 UTC (`0029`, fixed by `0057`); running since 2026-08-21, see §3a/§3b                                                                                                                                                                 |
| Support cases                     | 36 months                   | **Yes** — nightly at 02:15 UTC (`0029`, fixed by `0057`); running since 2026-08-21, see §3a/§3b                                                                                                                                                                 |
| Notification delivery + outbox    | 12 months                   | **Yes** — nightly at 02:15 UTC (`0092`). Deliberately the shortest policy here: the rows above are records of work, this is telemetry about whether a message arrived. Only _settled_ outbox rows are removed — a `pending` one is a notification still owed    |
| Platform audit log                | Indefinite                  | **Yes** — a dedicated trigger rejects every `UPDATE`/`DELETE` (§5); enforced by the database, not a scheduled job                                                                                                                                               |
| Deleted-tenant data               | 1 month grace, then erasure | **Partly.** An owner can delete their organisation on demand (`0063`, `delete_organisation`, pgTAP-tested), which cascades immediately. What is _not_ enforced is the one-month grace window or any scheduled purge — deletion is a deliberate act, not a timer |

**Nothing added on 2026-08-31 needs a row here, and that is a decision rather
than an oversight.** Six tables arrived that day. `staff_locations`,
`notification_templates` and `support_sla_targets` are configuration, not
history — ageing them out would delete a setting somebody is still using.
`role_delegations` and `calendar_feed_tokens` are small and their revoked rows
are the evidence that cover ended or a feed was rotated, which is the thing
somebody would ask about. **`staff_pay_rates` is the one worth arguing over**:
it is financial history, HMRC expects payroll records kept for years, and
deleting a rate makes every past labour-cost figure unreproducible — so it is
kept, and if a policy is ever wanted it should be a long one, set deliberately.
The rate rides along with the anonymised staff record after an erasure, where
it identifies nobody.

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
numeric version (66 migrations as at 21 August 2026 — 152 today; the figure dates
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

`public.gdpr_requests` (migration `0020`) tracks all six request types —
`access`, `portability`, `rectification`, `erasure`, `restriction`,
`objection` — as a case-managed workflow in `/admin/gdpr`, not an automated
self-service flow. What each type actually does today:

- **Erasure**, real, callable, and live-verified 2026-08-13 — **and incomplete
  from that day until 2026-08-31**, which is worth reading before trusting any
  other verification in this file. `0053` added `staff_profiles.email` for
  account linking two months after `0011` was written, and the erasure never
  learned about it: the record left behind read "Deleted Member" with the
  person's email address still on it. The 13 August test was honest and
  passed; the column did not exist yet. `0111` clears it, revokes any live
  calendar feed token (a URL in somebody's phone would otherwise keep serving
  an erased person's shifts), and adds `erasure_retained_columns()` so the
  pgTAP test now asserts over the whole column list rather than a fixed set of
  fields — the next column added cannot survive an erasure the same way.
  What the original verification showed: `anonymize_staff_member` (migration
  `0011`), called end-to-end as a real org owner against a real demo staff
  record. Before:
  a named person, a phone number, a payroll ID, 85 shifts, 1 emergency
  contact, 5 documents. After: `first_name`/`last_name` → "Deleted"/"Member",
  `phone`/`photo_url`/`payroll_id` → null, `active` → false, all 85 shifts
  untouched, `emergency_contacts` and `documents` both at 0, and a real
  `audit_logs` row (`gdpr_anonymize`) recording who did it and when. It
  deliberately leaves `shifts`/`clock_events`/`leave_requests`/`shift_swaps`/
  `timesheets` intact (now pointing at the anonymised "Deleted Member"), so
  payroll history stays consistent for UK retention requirements. It does
  not touch `auth.users` (needs the Auth Admin API, not yet wired to this
  flow) and does not delete the file behind `documents.file_url` on
  ImageKit, only the database row — both limits are in the migration's own
  header, and neither was contradicted by the live test.
- **Access / portability**: an **organisation-level** one-click export exists —
  `exportOrganisationData()` (`src/services/orgLifecycleService.ts`) assembles
  **33** tables into a single JSON file from Settings → Organisation, read through
  the caller's own session so RLS decides what is included and anything unreadable
  is listed under `omitted`. It assembled 19 until 2026-08-31, against 40 tables
  carrying an `org_id`: the organisation's invoices, its staff inboxes and
  delivery record, its minimum-cover rules, its integration configuration and
  history, its own GDPR request log, its support cases and the record of platform
  support access to its data were all absent, none of it deliberately. The seven
  still excluded are excluded **with a reason printed in the file itself** — two
  are live credentials (`org_smtp_settings`, `calendar_feed_tokens`), one is a
  queue that empties in a minute, and four are platform plumbing.
  `npm run check:export` fails CI when a table with an `org_id` is in neither
  list, so this cannot drift again. A **per-subject** package covers one
  organisation's employment record: `exportStaffData()`
  (`src/services/gdprService.ts`) now returns **thirteen** datasets for one staff
  member. It covered eight until 2026-08-31 and left out **timesheets**,
  **overtime claims** and **pay rates** — so somebody in a dispute about their
  hours or their money received an export of their shifts and their holidays,
  and this document called that "eight datasets" as though eight were the whole.
  One table is deliberately excluded and says so in the file: a calendar feed
  token is a live credential, and emailing somebody a working URL to their own
  rota would create the disclosure the export exists to answer for. Neither
  export includes the person's `auth.users` row, and nothing assembles a
  subject-access package across organisations.
- **Rectification / restriction / objection**: tracked as cases with no
  automated action; each is a manual data change by whoever is assigned the
  request.

A request sitting in `gdpr_requests` with no further action is a paper trail,
not a completed erasure — the case-tracking table and the actual data change
are two different things today, and closing a case does not yet imply both
happened.

## 5. Audit log

`public.audit_logs` is written by triggers on every organisation-scoped
mutation (`memberships_audit` and equivalents) and is immutable by a
dedicated trigger (`audit_logs_no_update`, migration `0016`): any `UPDATE` or
`DELETE` raises `audit_logs is append-only`, with a documented carve-out for
the row's `org_id` being detached when its organisation is deleted — the row
itself survives, carrying the `org_name` snapshot taken at write time. This
session's live RLS testing confirmed no role below platform admin can even
_read_ another tenant's audit rows (`ST1 (staff) cannot read own-org
audit_logs`); it did not separately attempt a write against this trigger, so
that specific guarantee is read from the migration source, not re-verified
live here. Retained indefinitely (see §3).

## 6. Incident response

No formal runbook or on-call rotation exists yet. What already exists to
build one on:

- **Detection**: Sentry (error events, EU region), `platform_health_samples`
  (`source = 'scheduled' | 'console' | 'manual'` — a scheduled prober is not
  yet wired up; today's samples come from an admin opening System status,
  which means there is currently no unattended detection between visits to
  that screen).
- **Declaration and tracking**: `public.incidents` (migration `0021`) and
  `/admin/incidents` are real — severity, status, timeline updates, owner.
  Nothing currently writes to this table automatically; every incident
  recorded there today was entered by hand.
- **Communication**: `platform_announcements` can notify affected
  organisations in-app; there is no public status page.
- **Missing**: a defined severity → response-time mapping, an on-call
  rotation, an escalation path from "Sentry fired" to "a human is paged", and
  a template for the customer communication that goes out during a live
  incident. This is squarely `docs/SAAS.md`'s P0 incident-response item, which needs
  a person named, not more code.

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

| Category      | What it covers                                                                                                                                           | Switchable       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `necessary`   | Supabase session, `rotaflow:activeOrgId`, the onboarding draft, the offline outbox, the consent record itself                                            | No               |
| `preferences` | `pwa-theme`, `rotaflow.sidebar.collapsed`, `rotaflow:report-favourites:*`, `rotaflow:report-runs:*`, `rotaflow:installPromptSnoozedUntil`                | Yes, default off |
| `diagnostics` | Sentry crash reporting. No replay, no tracing, console breadcrumbs dropped, query strings stripped from both the breadcrumb URLs and `event.request.url` | Yes, default off |

The decision lives in `localStorage` under `rotaflow:consent` as
`{version, decidedAt, preferences, diagnostics}` — the minimum evidence, no
identifier of any kind. `CONSENT_VERSION` re-asks when the categories change.

**Two entries were missing from the published storage list entirely** and were
added at the same time: the onboarding draft (`sessionStorage`, holds an
organisation name and a site postal address) and the install-prompt snooze.

### Where the gate actually is

In the write path — `isAllowed()` in `src/lib/consent.ts`, called at each of
the four preference writes and before `Sentry.init` — not in the banner. A
banner that merely covers the page stops nothing, and a visitor who ignores it
must still be left untouched. Every failure mode reads as "not decided, nothing
allowed": absent record, corrupt JSON, an older version, or a `localStorage`
that throws.

### How to check it is still true

The unit and e2e suites cover the logic and the interface, but neither can see
what leaves the browser, because Sentry only runs when `import.meta.env.PROD`
is true and the Playwright suite runs against `npm run dev`. The check that
matters is a production build with a DSN pointing at a host that cannot
resolve, served by `vite preview`, watching the network:

```
VITE_SENTRY_DSN='https://<key>@consent-probe.invalid/1' npm run build
npm run preview
```

Then, in a browser with site data cleared: throw an error before answering, and
after rejecting — no request to that host in either case. Accept, throw again —
one request, whose envelope contains no `replay_event`, no
`"type":"transaction"`, no console breadcrumb, and no query string.

**That last one is why this paragraph exists.** Breadcrumb scrubbing was in
place, the unit tests passed, and a real envelope still carried the full query
string, because Sentry fills `event.request.url` from `window.location.href`
and never routes it through `beforeBreadcrumb`. A test that asserts a hook was
configured proves nothing about what is transmitted. Verified 2026-09-04:
9 checks, 9 passing.

## 7. Support escalation

`public.support_cases` and `/admin/support` are real (migration `0024`,
confirmed live with real rows this session) — priority, assignment, first
response and resolution timestamps are all measured, not invented. What
routes an inbound email into a case is not built: the queue only contains
what the app itself created, so a message to the contact mailbox today does
not become a case automatically. That is now tracked as **GAP-035** rather
than as a sentence in one document — the rest of the loop closed around it on
2026-08-31, when a target with a clock (`0110`) and a customer-facing reply
(GAP-012) both landed, and the one remaining hole deserved an id somebody
could schedule.

## Open items, in priority order

1. **Enable backups** (§1) — billing decision, blocks a safe beta more than
   anything else in this document.
2. **Name an incident owner and an on-call path** (§6) — a decision, not
   code.
3. ✅ **Scheduled health probe** runs every 5 minutes via `pg_cron`, testing
   Postgres and Supabase service reachability (`0076_scheduled_health_probe.sql`).
4. **Build the deleted-tenant grace window** — the one policy in §3 still not on a
   timer. Four of the five listed here as unenforced have been running nightly since
   2026-08-21 (`0029`, fixed by `0057`); this item was left stale and is corrected,
   once the retention periods themselves are confirmed against legal advice.
5. **Build a subject-access export** that assembles one package instead of a
   manual per-table pull (§4).

## Privacy data map

Every point where personal data is collected, stored in the browser, sent to a processor, retained and released. Merged from the deleted `docs/PRIVACY-DATA-MAP.md` on 11 October 2026. It is dated 4 September 2026 and each row cites where it can be checked; `docs/SAAS.md` stays the register of current status.

**Dated 4 September 2026.** A snapshot, like `qa/FUNCTIONAL-AUDIT.md`, not a
living document — the register in `docs/SAAS.md` is what stays current.

Built by reading the code, the migrations and the edge functions, not by asking
what the product does. Every row cites where it can be checked. Where a fact is
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
| Project        | RotaFlow, `~/WebstormProjects/rotaflow`, deployed to `rotaflow.space`                                                                                                      |
| Operator       | Gideon Akinlotan, UK sole trader, trading as RotaFlow. No company number. **REQUIRES OWNER INPUT:** no postal address published, no ICO registration                       |
| Intended users | UK and EEA. Employers and the staff they invite                                                                                                                            |
| Role           | **Controller** for visitors, account holders, billing contacts, support correspondence and crash reports. **Processor** for everything an employer records about its staff |
| Live data      | None. Production held 0 organisations and 1 user at the last measurement (2026-08-31). Nothing below has been exercised against a real tenant                              |
| Database       | Supabase Postgres, `eu-west-1` (Ireland)                                                                                                                                   |
| Backups        | **None.** No backups and no point-in-time recovery, by cost decision (`docs/SECURITY.md` §1). Every deletion is irreversible                                               |

---

### 2. Collection points

Grouped by where a person's information enters the system. "Subject" is who the
data is about, which is not always who typed it.

| #   | Collection point                                  | Fields                                                                                                                                                  | Subject                                                    | Purpose                                        | Stored in                                                                  | Evidence                                                       |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| C1  | Sign-up                                           | first name, last name, email, password                                                                                                                  | account holder                                             | create an account                              | `auth.users`, `profiles`                                                   | `src/pages/SignupPage.tsx`                                     |
| C2  | Sign-in, magic link, OAuth                        | email, password, provider identity                                                                                                                      | account holder                                             | authenticate                                   | Supabase Auth                                                              | `src/pages/LoginPage.tsx`                                      |
| C3  | Password reset                                    | email, new password                                                                                                                                     | account holder                                             | account recovery                               | Supabase Auth                                                              | `src/pages/ForgotPasswordPage.tsx`                             |
| C4  | Organisation setup                                | org name, slug, sector, team size, site name, **site postal address**, coordinates, geofence radius                                                     | the organisation                                           | provision the tenant                           | `organisations`, `locations`                                               | `src/components/onboarding/StepAbout.tsx`                      |
| C5  | Invitations                                       | colleague email, role, location, department                                                                                                             | the invitee                                                | onboard staff                                  | `invites`                                                                  | `src/components/settings/TeamInviteManager.tsx`                |
| C6  | Staff record (manager-entered)                    | name, job title, department, contract type, weekly hours, holiday allowance, skills, **payroll id**, start date, **phone**, **email**, sites, photo URL | the staff member                                           | scheduling and pay                             | `staff_profiles`                                                           | `src/components/staff/StaffFormModal.tsx`                      |
| C7  | Own profile                                       | full name, phone, photo URL                                                                                                                             | the staff member                                           | keep the record current                        | `profiles`, `staff_profiles`                                               | `src/pages/app/account/ProfilePage.tsx`                        |
| C8  | Emergency contacts                                | contact name, relationship, phone, second phone, **medical notes**                                                                                      | **a third party**, plus health data about the staff member | emergency response                             | `emergency_contacts`                                                       | `src/components/staff/EmergencyContactsModal.tsx`              |
| C9  | Documents                                         | free-text type (DBS, right to work…), name, **URL**, issue and expiry dates                                                                             | the staff member                                           | compliance records                             | `documents`                                                                | `src/components/staff/DocumentsModal.tsx`                      |
| C10 | Pay rates                                         | hourly rate, effective date, note                                                                                                                       | the staff member                                           | labour cost and payroll export                 | `staff_pay_rates`                                                          | `supabase/migrations/0104_pay_rates.sql`                       |
| C11 | Leave                                             | **type (includes `sick`)**, dates, free-text reason                                                                                                     | the staff member                                           | absence management                             | `leave_requests`                                                           | `src/components/leave/LeaveRequestModal.tsx`                   |
| C12 | Clock in / out                                    | time, method, **latitude, longitude, accuracy**, location name                                                                                          | the staff member                                           | attendance and pay                             | `clock_events`                                                             | `src/pages/app/ClockInPage.tsx`, `src/hooks/useGeolocation.ts` |
| C13 | Shifts, swaps, overtime, availability, timesheets | dates, times, notes visible to colleagues, reasons                                                                                                      | the staff member                                           | scheduling                                     | `shifts`, `shift_swaps`, `overtime_requests`, `availability`, `timesheets` | `src/components/swaps/`, `src/components/overtime/`            |
| C14 | In-app support                                    | message bodies, replies, rating, requester email                                                                                                        | the requester                                              | answer the request                             | `support_cases`, `support_case_messages`                                   | `src/services/supportCaseService.ts`                           |
| C15 | Marketing contact form                            | name, email, organisation, sector, team size, message                                                                                                   | the enquirer                                               | reply to an enquiry                            | **nothing server-side** — `mailto:` handoff                                | `src/pages/ContactPage.tsx:105-121`                            |
| C16 | AI assistant                                      | manager's free-text prompt, plus assembled staff context                                                                                                | the staff scheduled                                        | draft a rota or an announcement                | prompt not stored; output reviewed before saving                           | `supabase/functions/ai-rota-assistant/index.ts`                |
| C17 | Billing                                           | email and card details **entered on Stripe's page**, org id, plan code                                                                                  | the payer                                                  | take payment                                   | Stripe; `subscriptions`, `invoices` locally                                | `supabase/functions/create-checkout-session/index.ts`          |
| C18 | Push notifications                                | endpoint, `p256dh`, `auth` keys                                                                                                                         | the device owner                                           | deliver notifications                          | `push_subscriptions`                                                       | `src/hooks/useWebPush.ts`                                      |
| C19 | Audit trail                                       | actor id, **actor email and name snapshots**, **IP address**, **user agent**, action metadata                                                           | the actor                                                  | security and accountability                    | `audit_logs`                                                               | `supabase/migrations/0016_audit_events.sql`                    |
| C20 | Sessions                                          | user agent, last seen                                                                                                                                   | the account holder                                         | let a person see and revoke their own sessions | `own_sessions`                                                             | `supabase/migrations/0100_own_sessions.sql`                    |
| C21 | Crash reports                                     | stack trace, page path, breadcrumbs                                                                                                                     | whoever hit the error                                      | fix faults                                     | Sentry (EU)                                                                | `src/lib/sentry.ts`                                            |
| C22 | Org SMTP settings                                 | host, port, user, **password**, from address                                                                                                            | the organisation                                           | send mail as the customer                      | `org_smtp_settings`                                                        | `src/pages/app/settings/SettingsIntegrationsPage.tsx`          |
| C23 | Calendar feed                                     | token in a URL, then that person's shifts, times, locations, notes                                                                                      | the staff member                                           | subscribe a calendar                           | `calendar_feed_tokens`                                                     | `supabase/functions/calendar-feed/index.ts`                    |

#### Notes on the ones that carry the most risk

**C8 — emergency contacts.** The only place the product holds data about
somebody who has no relationship with it at all. `medical_notes` is
free text prompted with "Allergies, conditions", so it is Article 9 health data
by design. Hard-deleted on erasure. **REQUIRES LEGAL REVIEW:** Article 14
notification duty, and how it divides between employer and processor.

**C9 — documents.** The type is an unconstrained text input whose own
placeholder suggests DBS and right-to-work, so criminal-record and immigration
data lands in a column nothing was designed around. It is a _link_, not an
upload: erasure removes the row and cannot remove the file (GAP-056).

**C11 — leave type.** `sick` makes an absence record a health record about a
named person. Deliberately excluded from the AI prompt
(`ai-rota-assistant/index.ts:520-536`) after it was found leaving the UK/EU
beside real names on 2026-08-30.

**C12 — location.** `enableHighAccuracy: true`. The browser's own permission
prompt is the gate; declining falls back to a manual clock-in recorded as
manual, so the feature degrades rather than blocks.

**C16 — AI.** Names, job titles, skills, contracted hours and leave _dates_
leave the UK/EU on a manager's click. The browser never talks to OpenRouter;
the edge function does.

**C23 — calendar feed.** Deployed `--no-verify-jwt`; the token in the query
string _is_ the credential, and the function's own header says the URL is
assumed leakable. Revocable, and revoked by erasure since `0111`.

---

### 3. Browser storage

Verified by reading every storage write in `src/`, and confirmed at runtime
against a production build. **No cookies are set anywhere** — there is no
`document.cookie` write in `src/` or `public/`.

| Key                                  | Store              | Purpose                                                           | Category    | Consent needed | Lifetime                   | Evidence                                      |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------- | ----------- | -------------- | -------------------------- | --------------------------------------------- |
| `sb-<ref>-auth-token`                | localStorage       | session, so you stay signed in                                    | necessary   | No             | until sign-out or expiry   | `src/lib/supabase.ts`                         |
| `rotaflow:activeOrgId`               | localStorage       | which tenant you were in                                          | necessary   | No             | until sign-out             | `src/lib/session.ts`                          |
| `rotaflow:consent`                   | localStorage       | your answer, and when                                             | necessary   | No             | until cleared or changed   | `src/lib/consent.ts`                          |
| onboarding draft                     | **sessionStorage** | org name and site address across a refresh                        | necessary   | No             | until onboarding completes | `src/pages/OnboardingPage.tsx:295`            |
| `rotaflow-outbox`                    | IndexedDB          | clock-ins, leave and swaps made offline                           | necessary   | No             | until synced or discarded  | `src/lib/offlineOutbox.ts`                    |
| `pwa-theme`                          | localStorage       | light or dark                                                     | preferences | **Yes**        | until site data cleared    | `src/context/ThemeContext.tsx`                |
| `rotaflow.sidebar.collapsed`         | localStorage       | sidebar state                                                     | preferences | **Yes**        | until site data cleared    | `src/components/layout/Sidebar.tsx`           |
| `rotaflow:report-favourites:*`       | localStorage       | starred reports, per org                                          | preferences | **Yes**        | until site data cleared    | `src/lib/reportPrefs.ts`                      |
| `rotaflow:report-runs:*`             | localStorage       | this browser's export history                                     | preferences | **Yes**        | until site data cleared    | `src/lib/reportPrefs.ts`                      |
| `rotaflow:installPromptSnoozedUntil` | localStorage       | you dismissed the install banner                                  | preferences | **Yes**        | 30 days                    | `src/lib/installPrompt.ts`                    |
| `supabase-api`, `imagekit-media`     | Cache API          | offline reads. Holds authenticated tenant responses for 5 minutes | necessary   | No             | cleared on sign-out        | `vite.config.ts:219`, `src/lib/session.ts:50` |
| `rotaflow-fonts`                     | Cache API          | self-hosted webfonts, no personal data                            | necessary   | No             | 1 year                     | `vite.config.ts:235`                          |

The `preferences` classification is **provisional and REQUIRES LEGAL REVIEW**.
Storage that is not strictly necessary needs consent under PECR regulation 6;
whether a preference the user sets by their own deliberate click falls inside
the strictly-necessary exemption is exactly the kind of question this document
should not answer for itself. It is treated as needing consent, which is the
safe direction.

**The offline outbox is deliberately not cleared on sign-out**
(`src/lib/session.ts:16-27`) — a queued clock-in belongs to the person who made
it, not to the session. Isolation is by a `userId` ownership filter instead.
Residual: rows written before that field existed are treated as belonging to
whoever is signed in (`src/services/syncQueue.ts:211`), which is a shared-device
exposure for pre-upgrade data.

---

### 4. Processors and transfers

Published at `/legal/trust`, generated from `src/lib/subprocessors.ts`. Repeated
here only where this document adds something.

| Processor                   | What it gets                                            | Where              | Outside UK/EU           |
| --------------------------- | ------------------------------------------------------- | ------------------ | ----------------------- |
| Supabase                    | everything the product holds                            | eu-west-1, Ireland | No                      |
| OpenRouter + model provider | staff names, job titles, skills, hours, leave **dates** | United States      | **Yes**                 |
| Stripe                      | billing identity of the payer                           | United States      | **Yes**                 |
| Sentry                      | stack trace, page path, breadcrumbs                     | EU ingest          | No                      |
| ImageKit                    | uploaded images, including staff photographs            | United Kingdom     | No                      |
| Namecheap / cPanel          | the site itself, and outbound mail                      | United Kingdom     | No                      |
| Cloudflare                  | IP address and requested pages of **every visitor**     | global edge        | Not flagged — see below |

**Cloudflare is the awkward one.** The `outsideUkEu` flag means "personal data
leaves the UK/EU to reach it", and a proxied request is served by the location
nearest the visitor. It is nonetheless a worldwide network run by a US company,
and it sees every visitor whether or not they sign in. Flagging it `true` would
group it with Stripe and OpenRouter, where the page says both are in the United
States and neither receives anything unless you use the feature it powers —
none of which is true of Cloudflare. It stays `false`, the region field and
`/legal/trust` say plainly what it is, and the transfer question is recorded
below. **REQUIRES LEGAL REVIEW.**

**REQUIRES LEGAL REVIEW** for the two genuine transfers: no international data
transfer agreement, no UK addendum to the standard contractual clauses, and no
transfer risk assessment exists for either Stripe or OpenRouter.

---

### 5. Retention

From `retention_policies` (`0027`, `0092`), enforced by `enforce_retention()`
nightly at 02:15 UTC (`0029`, fixed by `0057`), with each run recorded in
`retention_runs`.

| Data                                   | Period     | Trigger          | Method                                        | Enforced                                                 |
| -------------------------------------- | ---------- | ---------------- | --------------------------------------------- | -------------------------------------------------------- |
| Rota and shift history                 | 84 months  | shift start date | hard delete                                   | Yes                                                      |
| Attendance, incl. GPS                  | 36 months  | event date       | hard delete                                   | Yes                                                      |
| Leave                                  | 72 months  | end date         | hard delete                                   | Yes                                                      |
| Support cases                          | 36 months  | resolution date  | hard delete                                   | Yes                                                      |
| Notification delivery + settled outbox | 12 months  | creation         | hard delete                                   | Yes                                                      |
| Audit log                              | indefinite | —                | append-only trigger refuses `UPDATE`/`DELETE` | By the database                                          |
| Deleted tenant                         | immediate  | owner's action   | cascade across ~32 tables                     | **The declared 1-month grace window is not implemented** |
| Platform health samples                | 90 days    | sample time      | pruned inside the probe                       | Yes                                                      |
| `staff_pay_rates`                      | none       | —                | survives anonymisation, identifying nobody    | By decision                                              |
| Uploaded files                         | **none**   | —                | **not deleted at all** (GAP-056)              | No                                                       |

Nothing is anonymised by retention; every branch is a hard `DELETE`.

**Every period above REQUIRES LEGAL REVIEW.** They were chosen when the
schedule was built and have not been justified against a statutory or business
requirement. Indefinite audit retention is the one most worth defending or
shortening.

---

### 6. Rights

| Right                  | Available         | How                                              | Evidence                                     |
| ---------------------- | ----------------- | ------------------------------------------------ | -------------------------------------------- |
| Access                 | Partly            | manager exports one person's record, 13 datasets | `src/services/gdprService.ts:47-61`          |
| Portability            | Partly            | same export, JSON                                | as above                                     |
| Rectification          | Yes               | edit the staff record                            | `src/components/staff/StaffFormModal.tsx`    |
| Erasure                | Partly            | `anonymize_staff_member`, owner-only             | `0111_erasure_misses_email.sql`              |
| Restriction, objection | Case-managed only | `gdpr_requests` register                         | `0020_gdpr_requests.sql`                     |
| Withdraw consent       | Yes               | consent panel, footer or account preferences     | `src/lib/consent.ts`                         |
| Org export             | Yes               | 33 tables, one JSON file                         | `src/services/orgLifecycleService.ts:92-127` |
| Org deletion           | Yes               | typed name confirmation, immediate cascade       | `0063_delete_organisation.sql`               |

**No self-service anything for an individual** (GAP-057). `auth.users` is never
touched by erasure (`0011:4-11`), so there is no account deletion in any real
sense. Requests go by email into `gdpr_requests`, which computes a due date one
month out, extendable by two with a recorded reason, and cannot be closed
without an outcome note.

What erasure keeps, deliberately: shifts, clock events, leave, swaps,
timesheets, availability, site assignments and pay rates, all repointed at an
anonymised `staff_profiles` row reading "Deleted Member".
`erasure_retained_columns()` enumerates the kept columns with reasons and a
pgTAP test fails the build when a new identifying column appears, which is the
right shape for this class of problem.

---

### 7. Security controls relevant to privacy

| Control                 | State                                                                                                                                                        | Evidence                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Tenant isolation        | Row-level security, not application filtering; CI fails on a table with no RLS, a readable table with no policy, or any grant to `anon`                      | `supabase/tests/database/rls_invariants.test.sql` |
| Transport               | TLS only, Cloudflare in front, origin refuses direct requests                                                                                                | `.htaccess`                                       |
| Content security policy | `script-src 'self'`; only Supabase, Sentry EU and ImageKit reachable                                                                                         | `.htaccess:158`                                   |
| Fonts                   | self-hosted since 2026-09-03; previously leaked every visitor IP to Google                                                                                   | `public/fonts/README.md`                          |
| Secrets                 | Edge Function secrets and Postgres `vault`; the notification secret is generated in-database and has no second copy                                          | `0091`                                            |
| `smtp_pass`             | excluded from the `authenticated` column grant; clients read `org_smtp_settings_safe`                                                                        | `docs/DATA-MODEL.md`                              |
| Audit log               | append-only, enforced by trigger, two narrow carve-outs                                                                                                      | `0066`                                            |
| Rate limiting           | on invites and other sensitive paths                                                                                                                         | `0085`, `0086`                                    |
| Backups                 | **none, and no PITR** on 4 Sep. Since 5 Sep: a nightly encrypted dump with a restore check, green every night to 10 Oct; PITR still off as last read (§1)    | `docs/SECURITY.md` §1                             |
| Scheduled checks        | `backup.yml` and `auth-config.yml` had **never succeeded** on 4 Sep. Since: backup green nightly; auth-config green 5 and 7 Sep, red with `401` since 14 Sep | GAP-036                                           |

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
6. **Uploaded files** (GAP-056). Erasure cannot reach them. Needs a decision
   about the image host before the notice can stop admitting it.
7. **Minimum age** (GAP-060), and what an employer scheduling a 16- or
   17-year-old must be told.
8. **Whether a DPA will be commissioned.** `docs/SAAS.md` CAP-059 says never;
   any customer with an information-security review will ask for one.
9. **The `LICENSE` file** names no copyright holder, and the repository is
   public.

### 9. REQUIRES LEGAL REVIEW

1. **Every lawful basis.** Proposed in the notice, confirmed by nobody.
2. **The Article 9 condition** for `emergency_contacts.medical_notes` and for
   sickness leave.
3. **Article 14** and emergency contacts (GAP-058).
4. **Whether an email address alone satisfies Article 13** for a sole trader.
5. **Transfer mechanism and risk assessment** for Stripe and OpenRouter.
6. **Whether Cloudflare's edge network is a restricted transfer.**
7. **Every retention period**, and indefinite audit retention in particular.
8. **The PECR classification of the four interface preferences** — strictly
   necessary, or consent-requiring as currently treated.
9. **The one-month rights response time** as a published commitment, for both
   UK and EEA subjects.
10. **The whole liability section** of the Terms, and governing law.
11. **Whether a DPO or an Article 30 record is required** at this scale.
