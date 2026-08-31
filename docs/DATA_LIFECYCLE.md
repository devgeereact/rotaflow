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
numeric version (66 migrations as at 21 August 2026 — 94 today; the figure dates
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

- **Erasure**, real, callable, and live-verified 2026-08-13 (previously only
  read from source): `anonymize_staff_member` (migration `0011`), called
  end-to-end as a real org owner against a real demo staff record. Before:
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
  `exportOrganisationData()` (`src/services/orgLifecycleService.ts`) assembles 20
  tables into a single JSON file from Settings → Organisation, read through the
  caller's own session so RLS decides what is included and anything unreadable is
  listed under `omitted`. A **per-subject** package still does not exist:
  `exportStaffData()` (`src/services/gdprService.ts`) covers eight datasets for one
  staff member, but neither export includes the person's `auth.users` row, and
  nothing assembles a subject-access package across organisations.
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

## 7. Support escalation

`public.support_cases` and `/admin/support` are real (migration `0024`,
confirmed live with real rows this session) — priority, assignment, first
response and resolution timestamps are all measured, not invented. What
routes an inbound email into a case is not built: the queue only contains
what the app itself created, so a message to the contact mailbox today does
not become a case automatically.

## Open items, in priority order

1. **Enable backups** (§1) — billing decision, blocks a safe beta more than
   anything else in this document.
2. **Name an incident owner and an on-call path** (§6) — a decision, not
   code.
3. **Wire a scheduled health probe** so detection does not depend on someone
   opening the console (§6).
4. **Build the deleted-tenant grace window** — the one policy in §3 still not on a
   timer. Four of the five listed here as unenforced have been running nightly since
   2026-08-21 (`0029`, fixed by `0057`); this item was left stale and is corrected,
   once the retention periods themselves are confirmed against legal advice.
5. **Build a subject-access export** that assembles one package instead of a
   manual per-table pull (§4).
