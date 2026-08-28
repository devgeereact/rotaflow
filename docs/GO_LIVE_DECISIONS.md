# Go-live decisions

Written 6 August 2026, against `c97cf5f`, after auditing the deployed build,
the live database and the console signed in as a Platform Owner.

Nothing here is a bug report. These are the twelve places where the code is
waiting on a decision only you can make, ordered by what happens if the wrong
one is taken. Each says what is true today, what the options cost, and which
one I would pick.

Below that is a list of the work that needs no decision, so you can see what
is merely unfinished rather than undecided.

---

## 1. Platform staff can read every tenant's data, and a support session does not gate it

**What is true.** `is_org_member()` ends with `or is_platform_admin()`. Every
policy built on it therefore admits any platform administrator to any
organisation's rotas, staff records, clock events and leave. The support access
session feature records that someone intended to look, with a reason and an
expiry, but no policy consults it. Access is identical with or without a
session.

**Why it matters.** Under UK GDPR you are a processor for your customers' staff
data. "Our staff can read anything at any time and we log intent voluntarily"
is a different answer to a DPIA than "access requires a time-boxed grant". If a
customer's DPO asks, the honest answer today is the first one.

**Options.**

| | Cost | Effect |
|---|---|---|
| Leave as is, document it | none | Support works today. The DPIA says unrestricted. |
| Gate reads on an active session | one migration touching every policy, plus a support workflow change | Access becomes provably time-boxed. Support has to request before helping. |
| Gate writes only, leave reads open | smaller migration | Middle ground. Reading is still unrestricted. |

**My recommendation: gate reads on an active session, before the first paying
customer, not before the first demo.** It is the single change that most
improves what you can say to a buyer, and it gets harder the more tenants
exist. Doing it now costs a day; doing it at fifty tenants costs a migration
window.

---

## 2. Demo data is sitting on your real organisations

**What is true.** `platform_seed.sql` attached 60 invoices, 10 support cases,
29 integration connections and 812 sync runs to the eight organisations that
actually exist in production, including GAKINZ. The rows are marked in no way
that a customer would notice.

**Why it matters.** If any of those eight organisations is real, or becomes
real, they have invented invoices and support tickets against their name. There
is currently no teardown script for `platform_seed.sql`, unlike `demo_seed.sql`
which has one.

**Options.**

| | Cost | Effect |
|---|---|---|
| Keep it | none | Console demos look alive. Any real tenant sees fiction about themselves. |
| Write a teardown and run it at go-live | an hour | Console goes empty until real activity exists. |
| Keep it, but only against organisations flagged as demo | half a day, needs a flag on `organisations` | Both, at the cost of one more column. |

**My recommendation: write the teardown now, run it the day you onboard a real
customer.** The seed is idempotent by derived id, so a teardown is mechanical.
Until then the demo data is doing useful work.

---

## 3. Feature flags control nothing

**What is true.** Six flags exist, they toggle, every change is audited, and the
rollout percentage is stable per tenant. `flag_enabled_for_org()` is never
called anywhere in the application. No feature is gated on any flag.

**Why it matters.** A Platform Owner can turn off "GPS clock-in" in the console
and GPS clock-in keeps working. That is worse than having no flag screen,
because it looks like a control.

**Options.**

| | Cost | Effect |
|---|---|---|
| Wire the flags to real gates | half a day per feature, and a decision about which six | Flags become real. |
| Cut the six product flags, keep the screen for the two real platform switches | an hour | Screen shrinks and stops lying. |
| Leave it | none | A live control that does nothing. |

**My recommendation: wire `ai_rota_assistant` and `beta_integrations` first,
cut the other four.** Those two gate things that genuinely should be
switchable. "GPS clock-in" and "advanced reporting" are plan entitlements, not
flags, and belong on `plans` where the price list already is.

---

## 4. No payment provider

**What is true.** `invoices` records amounts, statuses, failure reasons and
attempt counts. Nothing charges a card. `provider` and `provider_ref` exist and
are never written. Marking an invoice paid moves a row and no money.

**Why it matters.** You can bill on paper today. You cannot take a payment, and
the Billing screen's Credit and Retry buttons are disabled because there is
nothing behind them.

**Options.** Stripe is the obvious choice given the schema already has
`provider`/`provider_ref` and pence-integer amounts. The work is an Edge
Function for webhooks plus a checkout flow.

**My recommendation: decide whether v1 charges at all.** If the first ten
customers are invoiced manually, this is not a blocker and the schema already
supports it. If self-serve signup takes money on day one, this is two weeks and
should start now.

---

## 5. Data retention is a published policy that nothing enforces

**What is true.** `retention_policies` holds six rows. Five say `enforced =
false`. Nothing deletes a rota at seven years or an attendance record at three.
The audit log is the only row that is true, and it is true because the table
carries no delete policy at all.

**Why it matters.** If the privacy notice or a customer contract states these
periods, you are describing a control you do not have. The console says so on
screen, which protects you internally but not contractually.

**Options.**

| | Cost | Effect |
|---|---|---|
| Build the nightly job | two to three days, needs a scheduler | The schedule becomes real. |
| Change the published policy to match reality | an hour, needs legal review | Honest, less attractive. |
| Leave it, keep the on-screen caveat | none | Fine internally, a problem in a contract. |

**My recommendation: do not put these periods in a customer contract until the
job exists.** Building it is not urgent; promising it is the risk.

---

## 6. Three features can never produce their own data

**What is true.** Three RPCs exist, work, and are called from nowhere:

- `mark_announcement_read`, so the announcement read rate can only ever be
  what the seed wrote. No tenant-side UI marks anything read.
- `rate_support_case`, so CSAT can never be collected. The Support Centre
  reports 4.3 out of 5 from seeded rows and will never gain a real one.
- `touch_org_activity`, so `organisations.last_activity_at` is only ever
  written by the seed. The Overview's "Tenants active today" will decay to zero
  as the seeded timestamps age past 24 hours.

**Why it matters.** These are not missing features. They are dials that report
a number which cannot change.

**My recommendation: call `touch_org_activity` from the tenant app this week.**
It is one line in a shared service and it makes a live tile true. The other two
need UI and can wait, but the tiles they feed should be removed until then
rather than reporting a frozen number.

---

## 7. Health and uptime figures are seeded, not measured

**What is true.** 480 health samples exist, all with `source = 'manual'`, from
the seed. Three services carry a genuine round trip when an administrator opens
System status. Nothing probes on a schedule, so uptime over 24 hours is
arithmetic over rows a human inserted.

**Options.** A scheduled Edge Function probing every five minutes would make it
real. Supabase cron or an external pinger both work.

**My recommendation: build it or delete the uptime tile.** A 99.94% uptime
figure that nothing measures is the most quotable wrong number on the site.

---

## 8. Eleven console screens still show demonstration figures

**What is true.** 65 demo constants across eleven pages. The heaviest are
System status (15), Notifications (10), Integrations (8), Users (7) and
Platform settings (7). Every one is labelled on screen, and
`src/lib/adminOverviewDemo.ts` ships in the production bundle because live
pages import it.

**Why it matters.** Most now have a real table behind them. Converting them is
mechanical work, not new schema.

**My recommendation: convert Users, Notifications and Integrations, in that
order.** All three have complete tables and services already. The rest
(branding, security, API settings) are describing things that genuinely do not
exist, and should stay labelled until they do.

---

## 9. An orphan table in production

**What is true.** `incident_events` exists in the live database, responds over
the API, and appears in no migration file and no application code. It was
suggested by PostgREST as a near-match when `incidents` was missing, which is
how it was found.

**Why it matters.** Something created a table outside the migration set. Either
a person ran DDL by hand, or a tool did. Until that is known, the schema in the
repository is not a complete description of production.

**My recommendation: find out what made it before dropping it.** The table is
harmless; the unknown writer is the actual finding.

---

## 10. The repository is public and `main` is unprotected

**What is true.** `devgeereact/rotaflow` is public, `main` has no branch
protection, and merging to `main` auto-applies migrations to the production
database. Anyone can read the full schema, every RLS policy and every seed.

**Why it matters.** The schema being public is defensible: RLS is the control,
not obscurity. The unprotected branch is different. One bad merge ships DDL to
a live database with no review gate, and I have already seen a migration
recorded without its DDL running.

**My recommendation: turn on branch protection requiring the `verify` check.**
It costs nothing and closes the gap between "CI is green" and "this reached
production".

---

## 11. Support cases have no way in

**What is true.** A case can only exist if someone creates it through the app.
Nothing turns an email to a support address into a case. The queue therefore
reflects the app, not the support load.

**My recommendation: decide where support actually happens first.** If it is
email or a shared inbox, the console queue is the wrong system and should not
grow. If it is in-product, the tenant-side form is a day's work.

---

## 12. The public status page

**What is true.** `incidents.is_public` exists, defaults to false, and no policy
grants anonymous read. Setting it changes nothing. The console says so.

**My recommendation: leave it.** A status page is a second surface with its own
hosting, its own audience and its own failure mode (it must stay up when you do
not). It is not a go-live blocker.

---

## Needs no decision, only time

These are unambiguous and I can do them whenever you want:

- Convert the remaining eleven pages that have tables behind them.
- Write the `platform_seed` teardown.
- Call `touch_org_activity` from the tenant app.
- Remove the tiles whose underlying figure cannot change until their feature
  exists.
- Regenerate `src/types/database.types.ts` from the live schema. It is hand
  maintained today, which is why several new tables carry `Insert: never`.

## Already settled, recorded so it is not relitigated

- Email sends from `rotaflow.space` as of 2026-08-29 (`support@` for contact,
  `noreply@` for automated mail). Between 2026-08-13 and then it sent as
  `info@gakinz.com`. The reason recorded here previously — that
  `rota.gakinz.com` had "no SPF or DKIM" — was wrong: it had both. What it
  lacked was **MX**, so it could sign outbound mail and silently drop every
  reply. `rotaflow.space` carries MX ×3, one SPF, one DKIM and one DMARC.
- Migrations 0021 to 0027 are applied and their files are frozen. 0021 needed a
  repair after being recorded without its DDL running.
- Every write to the new tables goes through a SECURITY DEFINER function with
  table grants revoked, so reference numbers, resolution notes and audit rows
  cannot be skipped by a client.
- The marketing site carries no invented traction, testimonials or logos.
