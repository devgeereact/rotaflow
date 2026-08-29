# Observability and the success-metrics taxonomy

**Status:** First pass, 13 August 2026. Answers
`docs/SAAS.md` ("publish event taxonomy") and
maps directly onto that plan's §12 success-metrics table — this document
names, for each metric, exactly what data computes it and whether that data
exists today. Nothing here is instrumented as a dashboard; several rows are
already computable from existing tables with a query, not a new event.
Where something needs new capture, that is stated plainly rather than
implied.

## How to read the table

- **Computable now** — the data already exists in the schema; what is
  missing is the query/aggregation, not new instrumentation. Verified
  against real migrations, not assumed.
- **Needs a small addition** — most of the metric is computable, but one
  input genuinely does not exist yet (a specific timestamp, a specific
  event).
- **Needs new capture** — nothing today produces this signal; it requires
  either a new event/table or a process outside the app (a survey, an
  interview).
- **Out of scope for instrumentation** — a human or business process
  (interviews, pricing conversations), not something client-side tracking
  can produce regardless of effort.

| Metric                 | State                                | What actually computes it                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activation             | **Computable now**                   | `organisations.created_at`, first `locations.created_at`, first `invites.created_at`, first `rotas.published_at` for that org, all within 7 days of `organisations.created_at`.                                                                                                                                                                                                      |
| Time to first rota     | **Computable now**                   | `organisations.created_at` → the org's earliest `rotas.published_at`. Median across orgs.                                                                                                                                                                                                                                                                                            |
| Rota completion        | **Needs a small addition**           | The publish half is `rotas.published_at`, real. The denominator — how many times a manager _opened_ the builder, including the ones that didn't end in a publish — is not captured anywhere; nothing records a builder-session start today.                                                                                                                                          |
| Staff adoption         | **Needs new capture**                | Nothing records "viewed the published schedule" as a distinct event. `invites.accepted_at` gives invited→joined; view is a genuine gap.                                                                                                                                                                                                                                              |
| Attendance reliability | **Computable now, with a caveat**    | `clock_events.synced`, `clock_events.event_at` (when it happened on-device) vs `clock_events.created_at` (when the row landed server-side) approximates time-to-sync — the gap between the two for a previously-`synced = false` row. This is a proxy, not an instrumented sync-duration field; stated as such rather than presented as exact.                                       |
| Workflow completion    | **Computable now**                   | `leave_requests`/`shift_swaps`/`overtime_requests` all carry `created_at` and `reviewed_at`. Completion time is the gap; verified present on all three tables, not assumed.                                                                                                                                                                                                          |
| AI quality             | **Partially computable**             | Acceptance/drop counts and the requester are real, written by `ai-rota-assistant` on every completed request (`audit_logs`, action `ai_assistant.rota_suggestions_generated`). Manager-edit-before-save and an explicit usefulness rating are not captured — the audit row records what the model produced and what passed verification, not what the manager did with it afterward. |
| Accessibility          | **Computable now**                   | The `e2e` CI job's axe output is a real automated violation count per run, already gating merges. Manual keyboard/screen-reader pass rate is a human UAT process (P0 #5 of the transformation plan), not something to automate.                                                                                                                                                      |
| Performance            | **Needs new capture**                | No Web Vitals collection exists client-side. p75 LCP/INP/CLS need a reporting mechanism (e.g. the `web-vitals` library posting to Sentry or a dedicated table) that does not exist yet.                                                                                                                                                                                              |
| Satisfaction/retention | **Partially computable**             | `support_cases.csat` is real (written by the support flow). NPS/interviews are a human process. 30/60/90-day active-org retention is computable from `organisations.last_activity_at` (maintained by `touch_org_activity()`, 0023) once there is enough history to measure against.                                                                                                  |
| Commercial             | **Out of scope for instrumentation** | Conversion, willingness-to-pay, support cost per org are pricing and sales-process outputs, not client-side events.                                                                                                                                                                                                                                                                  |

## The queries were run, not just proposed

Every row marked "computable now" was actually run against the live
demo/seed dataset (13 August 2026), not just checked for schema presence.

> ⚠️ **That dataset no longer exists.** It was torn down on 2026-08-14 and every seed
> script was deleted in `#120`. Production now holds one organisation and zero clock
> events, so none of the figures below can be reproduced, and the recommendation later
> in this document to "re-run the six computable queries against the seed data" is not
> executable. The _queries_ and the schema columns they rely on are still correct; only
> the numbers are historical. Re-derive them against a real tenant before quoting any.

Two things came back wrong, and both point at the same root cause rather
than at the metric definitions:

- **Activation / time to first rota** returned **−33 days** for five of the
  demo companies — a rota `published_at` dated before its own
  organisation's `created_at`. Impossible for a real organisation; an
  artifact of the seed's rolling three-month rota window being generated
  independently of the organisation row's own timestamp on each re-seed.
- **Workflow completion** returned **negative average hours** on all three
  tables (leave, swaps, overtime) — a `reviewed_at` earlier than its own
  `created_at`, for the same reason: the seed assigns each timestamp
  relative to "now" independently rather than enforcing
  `reviewed_at >= created_at`.

Both are seed-data quality gaps, not query bugs or metric-design errors —
the SQL is correct and would return a sane number against real usage, where
a decision cannot be recorded before the request that prompted it. Worth
fixing in `platform_seed.sql`/`demo_seed.sql` at some point — constrain each
generated `reviewed_at`/`published_at` to be no earlier than the row it
depends on, the same class of fix as the `support_case_reference_seq`
collision documented in `supabase/seed/platform_seed.sql`'s own comments —
but not urgent: nobody is reading these numbers as real product metrics
today, and the plan's own guidance is not to invent baselines yet
regardless. Recorded here so the next person to run these queries against
seed data doesn't mistake a seed-timestamp artifact for a broken metric —
or worse, a broken product.

The two that returned clean, plausible numbers: **attendance reliability**
(3,506 clock events, 3,484 synced, 22 currently queued — a real, sane
online/offline split) and **CSAT** (6 rated cases, average 4.33/5, matching
the seed's own planted values). The sync-latency proxy itself (`created_at`
minus `event_at`) is still not a trustworthy number from seed data —
bulk-inserted historical rows have a `created_at` reflecting insert time,
not real device sync time, so the average it produced (~38 hours) measures
seed generation, not attendance reliability. Only real device usage will
make that column mean what the metric wants it to mean.

## What this means for Phase 3

Four of eleven rows need genuinely new work before they can report a real
number: rota-session starts, schedule-view events, an explicit AI-suggestion
outcome (edited/used as-is/discarded), and Web Vitals collection. The rest
are a query away from real, not a new instrumentation project — the
temptation to build a generic "event tracking" system before checking which
metrics already have their data is exactly the premature-dashboard mistake
`docs/SAAS.md`'s own Phase 3 guidance warns against
("do not invent targets before observing the first design partners").

**Recommended order, cheapest first:**

1. Query the six already-computable rows and confirm the numbers look
   sane against the live demo/seed data before writing a single new event.
2. Add the AI-suggestion-outcome capture (edited/used/discarded) as a small
   extension of the existing audit write in `ai-rota-assistant`, since that
   code path and its service-role audit client already exist.
3. Decide whether rota-session-start and schedule-view events are worth a
   first-party `product_events` table (same pattern as `audit_logs`,
   `incidents`, `support_cases` — org-scoped, RLS-guarded, stored in the
   same Supabase project rather than shipped to a third-party analytics
   vendor) or deferred until there is a design partner asking for the
   number. Either way, this is a schema decision — a migration — not
   something to apply ad hoc outside the normal review path.
4. Web Vitals collection is the most standalone of the four gaps and the
   least tied to a product decision; reasonable to build independently of
   the others.

No third-party analytics vendor is assumed or recommended here. A vendor
decision carries its own privacy-disclosure obligation (`/legal/cookies`
currently a placeholder pending counsel, see `docs/DATA_LIFECYCLE.md`) that
this document deliberately does not resolve.
