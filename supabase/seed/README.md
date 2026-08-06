# RotaFlow demo dataset

A reusable showcase dataset: five organisations carrying a **rolling three-month
rota**. This month plus the two after it, with three weeks of completed history
behind it, plus nine sign-in-able accounts covering every role.

Built for client demos and for end-to-end manual testing, which is why it is not
a tidy rota: a set of problems is planted on purpose so the warnings, conflict
and shortage paths get exercised, not just the happy one.

| File | What it does |
| ---- | ------------ |
| `demo_seed.sql` | Builds (or rebuilds) the whole demo |
| `demo_teardown.sql` | Removes it again |

> These are **not migrations** and deliberately live outside `supabase/migrations/`.
> Migrations auto-apply on merge to `main`; demo data must never ship that way.

## Running it

**First, set `c_password` near the top of `demo_seed.sql`.** It ships as
`CHANGE-ME-BEFORE-SEEDING` and the seed raises an exception until you change it. See [Accounts](#accounts) for why.

Then paste the file into the Supabase SQL editor and run it as one unit, or POST
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
             'User-Agent': 'rotaflow-seed/2.0'})   # Cloudflare 403s the default UA
print(urllib.request.urlopen(req).read().decode()[:2000])
PY
```

If you substitute the password programmatically, replace **only the assignment**
(`constant text := '…'`), never every occurrence, a blanket find-and-replace also
rewrites the guard's comparison, which makes it true again and aborts the run.

The seed ends with a verification `SELECT` printing a row per organisation with a
count for every section and the rota date range it built.

## Re-run it before every demo

Every id is derived deterministically (`md5('rotaflow-demo-v1:' || key)`) and every
date is relative to `current_date`, so re-running **deletes the demo organisations
and rebuilds the whole three months centred on today**. History stays worked and
clocked, the future stays open. Re-running is the supported refresh, not an error.

It never reads or writes organisations created through the app.

## Accounts

**This repository is public.** These are real, email-confirmed accounts on a live
Supabase project, so a password committed here would be a working public
credential. `c_password` therefore ships as a placeholder and the seed refuses to
run until you set it. Keep the value you choose out of the repo.

Unlike v1, **the seed rotates the password of accounts that already exist**, so
whatever you set in `c_password` is always the live value, no guessing whether an
older run set something different.

The blast radius is bounded even so: these accounts are members of the demo
organisations only, so RLS keeps them out of any real tenant. The worst case is a
scribbled-on demo, which a re-run repairs.

| Sign in as | Email | Role |
| ---------- | ----- | ---- |
| Gideon Akinlotan | `gakinz101@gmail.com` | **Super Admin** + owner of all 5 orgs; on the Northgate rota |
| Amelia Hart | `gakinz101+demo.owner@gmail.com` | Owner. Harbour View only |
| Daniel Okafor | `gakinz101+demo.manager1@gmail.com` | Manager. Northgate, Harbour View, + 3 more |
| Priya Raman | `gakinz101+demo.manager2@gmail.com` | Manager. Northgate |
| James Whitfield | `gakinz101+demo.staff1@gmail.com` | Staff. Northgate |
| Sofia Marchetti | `gakinz101+demo.staff2@gmail.com` | Staff. Northgate |
| Tomas Nowak | `gakinz101+demo.staff3@gmail.com` | Staff. Harbour View |
| Grace Adeyemi | `gakinz101+demo.staff4@gmail.com` | Staff. Harbour View |
| **Maya Whitfield** | `gakinz101+demo.worker@gmail.com` | **Staff. The worker test account** |

The demo addresses are plus-addressed on the owner's real mailbox, so password
resets and magic links genuinely arrive and **nothing can bounce**, a fake domain
would hard-bounce, and Supabase has already warned this project about bounce rate.

### The worker account

`+demo.worker` (Maya Whitfield, Northgate House) exists to be signed into as an
ordinary member of staff. She is on the six-pattern roster's alternating
early/late rotation. Saturday to Wednesday, swapping pattern week by week, so
her Schedule shows a real rhythm rather than five identical days. She carries
worked history with clock events, shifts across all three months, and four unread
notifications so the bell has a badge on first sign-in.

## The five organisations

| Org | Sector | Plan | Roster |
| --- | ------ | ---- | ------ |
| Northgate Care Group | Healthcare | business | **30 staff on six rotating patterns**. The flagship |
| Harbour View Hotels | Hospitality | professional | 15 on three patterns; separate owner, proves tenant isolation |
| Brightside Retail | Retail | professional | 15 on three patterns; head-office logins only |
| Clearway Logistics | Logistics | starter | 15 on three patterns; head-office logins only |
| Meridian Security | Security | business | 15 on three patterns; head-office logins only |

Each has 5 locations, 5 departments, 6 shift types, 18 templates, **85 rotas (one
per site per week for 17 weeks)** and 1,200-2,500 shifts, plus leave, overtime,
swaps, timesheets, availability, documents, announcements, notifications, invites,
audit entries and a subscription.

### Why a rota per site per week

`RotaBuilderPage` calls `getOrCreateRotaForPeriod(org, location, Monday..Sunday)`
and then reads shifts **by rota id**. A week with no rota row for a site gets a
fresh empty draft on open, and seeded shifts attached to some other rota never
appear. v1 seeded site 1 only, which is why four of five sites looked blank.

### Rotating patterns, not random shifts

Each site gets one person on each pattern, so every site is covered every day of
the week and the grid reads as a real rolling rota:

| Pattern | Shift | Days |
| ------- | ----- | ---- |
| 1 | Early 07:00-15:00 | Mon, Fri |
| 2 | Late 14:00-22:00 | Mon, Fri |
| 3 | Night 21:45-07:15 | Wed, Sun |
| 4 | Long Day 08:00-20:00 | Mon, Wed + weekend |
| 5 | Twilight 17:00-23:00 | Thu, Sun |
| 6 | Early/Late, alternating week by week | Sat, Wed |

Shift-type colours come from the **eight-swatch palette in
`src/lib/shiftPalette.ts`**. Anything outside it falls through
`paletteTintForColour()` to the grey default, which is exactly why every chip in
the v1 demo rendered colourless.

## The planted problems

A demo that only shows a healthy rota never exercises the warnings. On purpose:

| # | Problem | Where to find it |
| - | ------- | ---------------- |
| a | **Unfilled weekend nights and twilights** | Sites 2 and 4, weeks +2, +4, +6, +9 and +11, an "Unfilled" row on the grid |
| b | **Double booking** | One person, two overlapping shifts, next week |
| c | **Approved leave with shifts still rostered inside it** | Two weeks out |
| d | **Rest breach** | A late finishing 22:00 followed by an early at 07:00-9h, under the WTR's 11 |
| e | **Unavailability clash** | Someone unavailable every Monday who works Mondays |
| f | **Documents** | One DBS already expired, one expiring this week, one in three weeks |
| g | **No-shows** | Two recent past shifts per org with no clock events at all |
| h | **Missing clock-out** | One shift per org clocked in and never out |
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
  where an org happens to have nobody on shift at that moment.

## Not seeded, on purpose

- `org_smtp_settings`, a fake SMTP row would break the real "Test SMTP" button.
- `push_subscriptions`. Device-bound; only a real browser can create a valid one.

## Removing it

```sql
-- supabase/seed/demo_teardown.sql
```

Drops the demo orgs (everything cascades), deletes the demo accounts, and clears
the Super Admin flag. It never deletes `gakinz101@gmail.com`.
