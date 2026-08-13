# RotaFlow demo dataset

A reusable showcase dataset: a RotaFlow SaaS platform team, plus five customer
companies each carrying a **rolling three-month rota** (this month plus the two
after it, with three weeks of completed history behind it). 33 sign-in-able
accounts covering every role the app has.

Built for client demos and for end-to-end manual testing, which is why it is not
a tidy rota: a set of problems is planted on purpose so the warnings, conflict
and shortage paths get exercised, not just the happy one.

| File | What it does |
| ---- | ------------ |
| `demo_seed.sql` | Builds (or rebuilds) the five companies, their staff and rotas, the SaaS platform team, and every login account |
| `demo_teardown.sql` | Removes it again |
| `platform_seed.sql` | Fills the platform console (invoices, support cases, incidents, integrations…) against the five companies. Run after `demo_seed.sql` |
| `platform_teardown.sql` | Removes what `platform_seed.sql` created |

> These are **not migrations** and deliberately live outside `supabase/migrations/`.
> Migrations auto-apply on merge to `main`; demo data must never ship that way.

## Running it

Paste `demo_seed.sql` into the Supabase SQL editor and run it as one unit, or POST
it to the Management API:

```bash
# PROJECT_REF is deliberately not hard-coded here. Pass the project you mean.
PROJECT_REF=<your-project-ref> python3 - <<'PY'
import json, os, subprocess, urllib.request
sql = open('supabase/seed/demo_seed.sql').read()
tok = subprocess.check_output(['security','find-generic-password','-s','Supabase CLI','-w'], text=True).strip()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{os.environ['PROJECT_REF']}/database/query",
    data=json.dumps({'query': sql}).encode(),
    headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json',
             'User-Agent': 'rotaflow-seed/3.0'})   # Cloudflare 403s the default UA
print(urllib.request.urlopen(req).read().decode()[:2000])
PY
```

Run `platform_seed.sql` the same way afterwards to fill the platform console.

The seed ends with a verification `SELECT` printing a row per company with a
count for every section and the rota date range it built.

## Re-run it before every demo

Every id is derived deterministically (`md5('rotaflow-demo-v1:' || key)`) and every
date is relative to `current_date`, so re-running **deletes the five companies and
rebuilds the whole three months centred on today**, and rotates every seeded
account's password back to the values below. History stays worked and clocked, the
future stays open. Re-running is the supported refresh, not an error.

**It never uses `is_demo` as a delete or attach filter.** That column was
blanket-backfilled onto every organisation that existed when migration 0035
shipped (2026-07-29) — including real ones ("City Hospital Care Group", "GAKINZ",
and any real customer signup such as "Harni MCare"). `demo_seed.sql` and
`platform_seed.sql` both scope by the five companies' exact slugs instead, and
`demo_teardown.sql` deletes by exact slug and exact account email. None of the
four scripts here can reach an organisation or account they didn't create
themselves.

## Accounts

**This repository is public.** `demo_seed.sql` hardcodes these as plain
`constant text` values rather than a `CHANGE-ME` guard — a deliberate,
discussed simplification. But the email-to-password pairing itself lives only in
**`docs/ACCOUNTS.md`**, which is **gitignored, never committed** — read it
locally, don't publish it.

- **Super Admin** — `dev@rota.gakinz.com`. Full cross-tenant platform access. Its
  own password, kept different from everything else seeded here, is recorded only
  in `docs/ACCOUNTS.md`'s own warning section — check there before assuming it is
  the shared one.
- **Everyone else** — the RotaFlow platform team (support/admin/finance) and all
  five companies' owner/manager/supervisor/staff logins — shares one simple
  password. Their blast radius is bounded: platform team roles reach the console
  but not tenant data directly, and company accounts are members of their own
  company's org only, so RLS keeps them out of every other tenant.

All addresses are plus-addressed on the owner's real mailbox
(`gakinz101+…@gmail.com`), so password resets and magic links genuinely arrive and
nothing can bounce — a fake domain would hard-bounce, and Supabase has already
warned this project about bounce rate once.

## The RotaFlow platform team

No organisation of their own — they administer the platform, not a tenant.
`platform_admins.role` gates what they can do in `/admin`:

| Role | Count | What they can do |
| ---- | ----- | ----------------- |
| `platform_owner` | 1 (`dev@rota.gakinz.com`) | Everything, including managing other administrators |
| `platform_admin` | 3 | Operational console access short of billing/other-admin management |
| `platform_support` | 3 | Support cases, incidents, announcements — the "handling queries" team |
| `platform_finance` | 2 | Subscriptions and billing state only, no operational tenant data |

## The five companies

| Company | Sector | Plan | Branches | Staff |
| ------- | ------ | ---- | -------- | ----- |
| Northgate Care Group | Healthcare | business | Northgate House (15), Willow Court (10) | 25, six rotating patterns — the flagship |
| Harbour View Hotels | Hospitality | professional | Harbour View Brighton (8), Harbour View Whitby (6) | 14, three patterns |
| Brightside Retail | Retail | professional | Brightside Arndale (10), Brightside Trafford (7) | 17, three patterns |
| Clearway Logistics | Logistics | business | Clearway Daventry DC (12), Clearway Warrington Hub (9) | 21, three patterns |
| Meridian Security | Security | starter (trialing) | Meridian Canary Wharf (5), Meridian Birmingham Central (3) | 8, three patterns |

Every branch's headcount includes a manager and a supervisor with real logins,
plus one more testable line-staff login per company (branch 1's third hire). The
rest of each roster is real staff data — rota, shifts, leave, documents — without
a sign-in, exactly as most of a real company's staff would be before they're
invited. Each company has 5 departments (org-wide), 6 shift types, 12 templates
(every shift type at both branches), **34 rotas (one per branch per week for 17
weeks)**, plus leave, overtime, swaps, timesheets, availability, documents,
announcements, notifications, invites, audit entries and a subscription.

### Why a rota per branch per week

`RotaBuilderPage` calls `getOrCreateRotaForPeriod(org, location, Monday..Sunday)`
and then reads shifts **by rota id**. A week with no rota row for a branch gets a
fresh empty draft on open, and seeded shifts attached to some other rota never
appear.

### Rotating patterns, not random shifts

Every branch's staff share a small set of rotating patterns, so every branch is
covered every day of the week and the grid reads as a real rolling rota. Northgate
(the flagship) runs six patterns; every other company runs three:

| Pattern | Shift | Days |
| ------- | ----- | ---- |
| 1 | Early 07:00-15:00 | Mon-Fri |
| 2 | Late 14:00-22:00 | Mon-Fri |
| 3 | Night 21:45-07:15 | Wed-Sun |
| 4 | Long Day 08:00-20:00 | Mon-Wed + weekend (Northgate only) |
| 5 | Twilight 17:00-23:00 | Thu-Sun (Northgate only) |
| 6 | Early/Late, alternating week by week | Sat-Wed (Northgate only) |

Shift-type colours come from the **eight-swatch palette in
`src/lib/shiftPalette.ts`**. Anything outside it falls through
`paletteTintForColour()` to the grey default.

## The planted problems

A demo that only shows a healthy rota never exercises the warnings. On purpose:

| # | Problem | Where to find it |
| - | ------- | ---------------- |
| a | **Unfilled weekend nights** | Harbour View & Clearway, branch 2, weeks +2, +4, +6, +9 and +11, an "Unfilled" row on the grid |
| b | **Double booking** | Every company's branch-1 owner/manager, two overlapping shifts, next week |
| c | **Approved leave with shifts still rostered inside it** | Every company's branch-1 supervisor, two weeks out |
| d | **Rest breach** | Every company's branch-2 supervisor: a late finishing 22:00 followed by an early at 07:00 — 9h, under the WTR's 11 |
| e | **Unavailability clash** | Every company's branch-2 manager, unavailable every Monday but works Mondays |
| f | **Documents** | One DBS already expired, one expiring this week, one in three weeks |
| g | **No-shows** | Two recent past shifts per company with no clock events at all |
| h | **Missing clock-out** | One shift per company clocked in and never out |
| i | **Unsynced offline events** | `synced = false`, the offline engine's own state |
| j | **Over-contract weeks** | Part-time and zero-hours staff are seeded throughout |

The rota assistant's **Review** tab surfaces every one of these, and **Fill gaps**
proposes ranked cover for (a).

## Attendance

- Every finished shift in the last four weeks has a realistic clock in/out pair
  with deterministic minute jitter, a repeatable minority run 18-30 minutes late.
- Long shifts (45+ minute breaks) also carry `break_start` / `break_end` events.
- **Whoever is genuinely mid-shift right now is clocked in**, so the Clock In
  screen has a live state whatever hour the demo runs. A fallback covers the case
  where a company happens to have nobody on shift at that moment.

## Not seeded, on purpose

- `org_smtp_settings`, a fake SMTP row would break the real "Test SMTP" button.
- `push_subscriptions`. Device-bound; only a real browser can create a valid one.

## Removing it

```sql
-- supabase/seed/demo_teardown.sql   (companies + their accounts)
-- supabase/seed/platform_teardown.sql   (console data)
```

`demo_teardown.sql` drops the five companies (everything cascades), removes the
platform team's `platform_admins` grants, and deletes every account it created —
by exact slug and exact email, never by `is_demo`. It never touches
`dev@rota.gakinz.com`'s `platform_owner` grant or `gakinz101@gmail.com`.
