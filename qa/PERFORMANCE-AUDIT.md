# Performance audit

Measured performance, dated. Created on 11 October 2026 from the measurements
recorded in `docs/SAAS.md` (GAP-071, GAP-083, GAP-089) and the budgets in
`bundle-budget.json`; each figure below names the row it comes from. Status stays
in the register.

## The acceptance dataset

The target a workforce read has to survive: **20 sites, 250 staff, 10,000 shifts
and 50,000 clock events** in one organisation. It was proposed by the 2 to 3
September 2026 audit (GAP-071) and is what `scripts/load-test-workforce.mjs`
seeds.

How to run it (`npm run load:test`): start a local stack with `supabase start`,
export `API_URL` and `SERVICE_ROLE_KEY` from `supabase status -o env`, then run the
script. It refuses any host other than `127.0.0.1`, `localhost` or `::1`, because
it writes tens of thousands of rows with the service role. It seeds one synthetic
organisation, signs its owner in through GoTrue, and re-runs the services'
PostgREST reads as `authenticated`, so RLS, the API row cap and the role's
8-second `statement_timeout` all apply.

## Load test, 7 September 2026 (GAP-071)

Local disposable stack, one machine. **Production parity is NOT TESTED**:
production held no organisations, so there was nothing real to measure against
and no concurrent load.

| Read                        | Rows   | Requests | Result   |
| --------------------------- | ------ | -------- | -------- |
| `clock_events`, five months | 50,000 | 51       | Complete |
| `shifts`, five months       | 10,000 | 11       | Complete |
| Staff directory             | 251    | 1        | Complete |

Cost grew faster than the range. Clock events before `0136`: one day 1,250 rows in
64 ms, one week 5,000 in 600 ms, one month 20,000 in 7.6 s, five months 50,000 in
45 s and 24.7 MiB into the browser. A repeat of the five-month run measured 24 s,
so treat these as a range (GAP-083). The screens issue the day and week reads.

## RLS predicate cost, 7 September 2026 (GAP-083, GAP-089)

| Change                        | At the database                                                     | End to end through PostgREST                                                      |
| ----------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `clock_events` policy, `0136` | 755 to 771 ms before, 3.9 to 6.8 ms after (about 190x), 50,000 rows | one day 58 to 14 ms, one week 451 to 48 ms, one month 4,828 to 256 ms (about 19x) |
| `shifts` policy, `0137`       | 536 ms before, 94 to 97 ms after (5.6x), 10,000 rows                | about 1,660 ms to 1,854 ms: no measurable gain, because 5.5 MiB of JSON dominates |

The rule that came out of it: convert a table's policy when a bulk read of it is
predicate-bound, measured first, not because it matches the pattern. The five-month
end-to-end figure with `0136` applied was never captured on a clean run.

## Bundle budgets

Enforced on every pull request by `npm run check:bundle` (`scripts/check-bundle-size.mjs`,
CAP-101) against `bundle-budget.json`. Budgets and the measurement they were set
from (30 August 2026):

| Budget                   | Limit   | Measured 30 Aug 2026 |
| ------------------------ | ------- | -------------------- |
| Precache, gzip           | 760 KiB | 665.0 KiB            |
| Precache entries         | 190     | 161                  |
| Entry JavaScript, gzip   | 175 KiB | 149.9 KiB            |
| Everything shipped, gzip | 700 KiB | 617.6 KiB            |

The current figures are printed by each CI run, not copied here.

## Not measured

- Hosted Supabase under concurrent load.
- Real devices on slow networks; Lighthouse or Core Web Vitals in the field.
- The service worker's first-install time on a cold cache.
