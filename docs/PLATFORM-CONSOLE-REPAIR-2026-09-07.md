# Platform console repair — 7 September 2026

A dated record of one pass over `/admin/*`, not a plan. `docs/SAAS.md` remains the
capability register and is where the statuses live; this exists so the next person can
see what was looked at, what was changed, what was proved and what was left.

Branch `platform/console-repair`, seven commits from `44e6259`, 58 files, +9,107 / -1,349.

---

## 1. What was actually wrong

Six defects, in the order they matter.

**The console could not see past PostgREST's row cap, and never said so.**
`/admin/organisations`, `/admin/users`, `/admin/audit` and `/admin/billing` each loaded
whole tables and then filtered, sorted, counted and exported the arrays that came back.
Supabase caps a response at `db.max_rows` in silence. Above the cap the total tile is the
cap, a search for an older record reports "no match" — a sentence about the filter rather
than about the truncation — and Export CSV writes the loaded page under the name of the
whole set. None of it is visible on this deployment, which has no tenant; all of it
becomes visible on the day it matters and not before.

**A multi-organisation account was unfindable.** `summariseMembershipsByUser()` set
`soleOrgName` only when an account belonged to exactly one organisation, and the user
search matched that field. So the accounts a support case is most often about could not
be found by either of their organisations' names.

**A published announcement was recorded as delivered before anything sent it.**
`publish_platform_announcement` (`0025`) stamped `sent_at` on every delivery row at
insert, against its own migration's header. Nothing ever sent them: fan-out was deferred
to an Edge Function that was never written, while `notification_outbox` had been draining
rota publications through `send-notification` every minute since `0069`. And
`status = 'scheduled'` was read by no job at all — storing a time is not scheduling.

**The console had never been told about `0122`.** That migration put eight tables holding
operational tenant data behind `is_platform_operational()`, excluding `platform_finance`.
The nav and the route table still offered Users, Support Centre, Support Access,
Incidents, Integrations and Audit Logs to that role, where RLS filters rather than raises
— so each rendered as an empty table rather than as a refusal, which reads as a broken
product rather than as a boundary.

**One failing read emptied the whole overview.** Eleven sources in a single
`Promise.all`. A refused RPC or one 500 on invoices showed a retry button and nothing
else.

**Seven controls were disabled, and four of them were wrong about the backend.** Audit
"Save filter", invoice "View" and "Credit", support "New case", organisation "Import",
integrations "Retry all failed", flags "Create flag", subscriptions "Discount".

---

## 2. Route and control coverage

Every `/admin` route was opened, and every control classified. `working` means driven in
the preview harness or asserted in pgTAP; `unavailable` means removed with the reason in
the page copy.

| Route                      | Controls                                                                                                | Verdict                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                   | Period select, Export report, 6 tiles, growth chart, plan mix, health, system health, activity, support | **Working.** Tiles and chart from server aggregates (`0133`); partial failure named per panel                                |
| `/admin/organisations`     | Search, 6 filters, 9 sortable columns, pagination, Export, Import, Add organisation                     | **Working.** All server-side (`0130`). Import built this pass                                                                |
| `/admin/organisations/:id` | 8 tabs, lifecycle actions, re-invite                                                                    | **Not changed this pass.** Health tone corrected to match the list; the rest is untouched and unverified here                |
| `/admin/users`             | Search, 3 filters, sortable columns, pagination, Export, Grant/Revoke                                   | **Working.** Server-side (`0131`). Last-administrator guard now reads the estate, not the page                               |
| `/admin/users/:id`         | Profile, memberships, auth facts, role grant                                                            | **Not changed this pass**                                                                                                    |
| `/admin/subscriptions`     | Filters, seat usage, Change plan                                                                        | **Working.** "Discount" removed — nothing here can price a plan                                                              |
| `/admin/billing`           | Currency select, Export, 6 money tiles, trend, plan mix, invoice list, View                             | **Working.** Totals per currency over every row (`0134`); list paged. "Credit" removed → GAP-080                             |
| `/admin/support`           | Filters, SLA tiles, New case                                                                            | **Working.** New case built this pass, on `open_support_case`'s existing platform branch                                     |
| `/admin/support/:id`       | Status, assignment, reply, internal note                                                                | **Not changed this pass**                                                                                                    |
| `/admin/support-access`    | Request, revoke, active sessions                                                                        | **Not changed this pass**                                                                                                    |
| `/admin/incidents`         | Create, update, resolve                                                                                 | **Not changed this pass**                                                                                                    |
| `/admin/integrations`      | Connector table, per-org status                                                                         | **Working.** "Retry all failed" removed — no connector has code behind it and `integration_sync_runs` has never had a writer |
| `/admin/notifications`     | New announcement, 4 filters, pagination, Publish, Cancel, delivery split                                | **Working.** Composer, scheduler and dispatch built this pass (`0132`)                                                       |
| `/admin/audit`             | Search, 3 filters, pagination, Copy link, Export CSV                                                    | **Working.** Whole-history search; "Save filter" replaced by a real bookmarkable link                                        |
| `/admin/gdpr`              | Request list, status, actions                                                                           | **Not changed this pass**                                                                                                    |
| `/admin/feature-flags`     | Toggles, rollout percentage                                                                             | **Working.** "Create flag" removed — code checks a key by name                                                               |
| `/admin/settings`          | Editable settings, administrator roster                                                                 | **Not changed this pass**                                                                                                    |

Six routes are marked **not changed**. They were read, and nothing in them was found that
this pass's contract covered; they are not claimed as verified.

---

## 3. Migrations, in the order they must apply

`0130` → `0134`. Every one is additive: new functions, one nullable column, no table
rewritten, no policy loosened, no grant widened beyond `EXECUTE` to `authenticated` on
functions that refuse the wrong caller before reading anything.

| Migration | What it adds                                                                                                                                                                     | Rollback                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `0130`    | `platform_health_band`, `platform_organisation_directory`, `platform_organisation_facets`                                                                                        | `drop function` on the three                                      |
| `0131`    | `platform_user_directory`, `platform_user_facets`                                                                                                                                | `drop function` on the two                                        |
| `0132`    | `platform_announcement_deliveries.outbox_id`; rewrites `publish_platform_announcement`; adds cancel, reconcile, due-publisher and the `rotaflow-announcement-scheduler` cron job | `cron.unschedule`, restore `0025`'s publish body, drop the column |
| `0133`    | `platform_growth`, `platform_operations_summary`                                                                                                                                 | `drop function` on the two                                        |
| `0134`    | `platform_billing_summary`, `platform_invoice_directory`                                                                                                                         | `drop function` on the two                                        |

**They must merge with the client, not before or after it.** The console calls all of
them; merging the client alone gives `PGRST202` on every directory read. This is the same
constraint GAP-074 records for `0126`–`0128`, which this branch also carries, so the whole
set ships together.

**`0130` was amended after it was written** — `active_24h` and `archived_band` were added
to its facets function — rather than superseded by a later migration. It has never been
applied anywhere: nothing on this branch has merged, and migrations reach production by
merging. Amending an unapplied migration is cheaper than a `create or replace` that has to
drop a return type.

**`0132` starts a cron job.** It runs every minute alongside the existing outbox drain and
does nothing when nothing is due.

---

## 4. Evidence

| Gate                       | Result                                           |
| -------------------------- | ------------------------------------------------ |
| `npm run typecheck`        | pass                                             |
| `npm run lint`             | pass, zero warnings                              |
| `npm run format:check`     | pass                                             |
| `npm test`                 | **1,185 passed**, 69 files (was 1,139 / 66)      |
| `npm run build`            | pass                                             |
| `npm run check:bundle`     | pass — 644.7 KiB of 700 KiB, no DEV page shipped |
| `npm run check:migrations` | pass                                             |
| `npm run check:docs`       | pass — 128 capability rows, migration count 134  |
| `npm run check:export`     | pass                                             |
| `npx playwright test`      | **116 passed**, 2 skipped                        |
| `supabase test db`         | **560 assertions**, 60 files (was 487 / 55)      |

New pgTAP files, and what each would catch:

- `platform_directory.test.sql` (24) — `total_count` against a 60-tenant fixture, a search
  that finds a tenant beyond the first page, stable paging over an equal-valued sort, and
  that `platform_finance` can neither read nor search by an owner email.
- `platform_user_directory.test.sql` (14) — a two-organisation account found by either
  name and returned once; organisation AND role satisfied by one membership.
- `announcement_delivery.test.sql` (15) — two reachable organisations left **queued** and
  zero delivered; the unreachable one a recorded failure; one outbox row each; the
  scheduler publishing a due announcement; only reconciliation moving a delivery to sent.
- `platform_overview.test.sql` (9) — month boundaries, and a requested-but-active
  cancellation not counted as churn.
- `platform_billing_summary.test.sql` (11) — two currencies producing two rows rather than
  one sum.

New unit files: `serverPage.test.ts` (15), `organisationDirectory.test.ts` (10),
`organisationImport.test.ts` (15), plus 5 currency assertions in `revenue.test.ts`.

Screens driven in `/admin-preview` at 1440×900 and 390×844, light and dark: the
organisations directory paging 1–25 of 34 and finding "Northgate" through a multi-org
account, the announcement composer previewing its audience, the billing console switching
GBP → EUR, the audit page paging a server-counted result, the import modal returning three
distinct verdicts for a three-row file, and the overview at
`?fail=rpc/platform_operations_summary,rpc/platform_growth` naming both failures while
everything else renders.

---

## 5. What was NOT verified

Stated plainly, because a report that omits this reads as though everything was.

- **The authenticated platform-admin spec ran green** — 2 passed, and it left 30
  organisations, one "Zulu Care Homes" and a promoted grant behind, which is the evidence
  the bodies executed. GAP-082 closed. It took four attempts, and the failure was worth
  keeping: `reuseExistingServer: !CI` meant a dev server left running from an earlier
  suite run was reused, started against a different Supabase — so the fixture seeded one
  instance and the browser signed in to another, and the only symptom was `Invalid login
credentials`. On a developer's machine the other instance is production. The config
  refuses to reuse a server on a live run now, and the spec asserts the origin the app
  actually calls.
- **No production volumes.** Production holds no tenant. Every truncation defect fixed
  here was demonstrated against a synthetic 60-record fixture, not observed.
- **No real delivery.** No email or push has been watched arriving. `0132` proves the
  announcement joins the queue that drains; it proves nothing about the last mile, which
  is the same gap `docs/SAAS.md` ❓-007 already records.
- **No Stripe call of any kind.** `STRIPE_TEST_SECRET_KEY` is still absent (GAP-073). No
  charge, no credit, no webhook was sent.
- **No bulk creation against a database.** The import's parse, duplicate detection and
  per-row reporting are tested; the harness answers the creation RPC from a fixture, so
  fifty real transactions are unproven.
- **Six `/admin` routes were not changed and are not claimed as verified** — organisation
  detail, user detail, support case detail, support access, incidents, GDPR, settings.
- **`supabase test db` needs Docker**, which was started for this work. CI's
  `e2e-authenticated` and `db-tests` jobs run against their own stack; a green local run
  is a strong signal, not the same run.

---

## 6. Remaining blockers

- **GAP-080** — invoice credits: no table, no policy, no RPC, no test credential. Named
  rather than half-built.
- **GAP-081** — the tenant-side announcement surface, which is why the read column is
  permanently zero and says so.
- **GAP-082** — no authenticated platform-admin end-to-end test.
- **GAP-073** — Stripe test-mode verification, still blocked on a credential.
- **GAP-036** — production still has no backup and no PITR. Unrelated to this work and
  larger than all of it.
