# RotaFlow demo dataset

Two independent datasets, for two different jobs.

| File | What it does |
| ---- | ------------ |
| `demo_seed.sql` | Builds (or rebuilds) the five-org demo |
| `demo_teardown.sql` | Removes it again |
| `sunnyvale_seed.sql` | Builds (or rebuilds) **Sunnyvale Care Group** — one org, 248 staff |
| `sunnyvale_teardown.sql` | Removes it again |

**`demo_seed.sql`** is the *breadth* dataset: five organisations across five
sectors, five items in every section, eight sign-in-able accounts covering every
role. Everything is small enough to read at a glance on a client call.

**`sunnyvale_seed.sql`** is the *depth* dataset: a single multi-site care group
with **248 staff, 3 sites and 8 departments**, sized so pagination, filters,
coverage arithmetic and the staff directory are under realistic load. It is the
organisation every reference screen in `design/` is drawn against, and Sarah
Manager is the persona they are signed in as.

The two use **different id namespaces** (`rotaflow-demo-v1:` and
`rotaflow-sunnyvale-v1:`), so neither can read or write the other's rows. Run
either, both, or neither.

> ⚠️ **`sunnyvale_seed.sql` has never been run.** It is written and statically
> reviewed but has not been executed against any database — there was no
> Postgres available to validate it, and running it needs the seed password,
> which lives in a password manager. Run it in the Supabase SQL editor, where a
> syntax error surfaces immediately and harmlessly; do not assume it is correct
> because it is committed. `demo_seed.sql`, by contrast, has been run many times.

### Why Sunnyvale's dashboard will not match the mockup's tiles exactly

`design/Workforce-Dashboard.png` shows 248 staff and **41 on shift today**.
Those two numbers are not consistent with each other: 248 staff working a normal
four-day rota puts roughly 140 people on shift on any given day, and 41 would
mean 83% of the workforce is unscheduled all week. The mockup's tile figures are
illustrative, not a specification.

The seed therefore builds a **realistic** rota — four shifts per active staff
member per week, spread by a per-person offset — so "on shift today" lands near
140. Open shifts (23) and pending leave (7) do match the mockup, because those
are independent of rota density and there was no reason to diverge.

The alternative — scheduling only 41 of 248 people so one tile matches a
screenshot — would have produced a dataset that is useless for the thing this
seed exists to test.

> These are **not migrations** and deliberately live outside `supabase/migrations/`.
> Migrations auto-apply on merge to `main`; demo data must never ship that way.

## Running it

**First, set `c_password` near the top of `demo_seed.sql`.** It ships as
`CHANGE-ME-BEFORE-SEEDING` and the seed raises an exception until you change it —
see [Accounts](#accounts) for why.

Then paste the file into the Supabase SQL editor and run it as one unit, or POST it
to the Management API:

```bash
# PROJECT_REF is deliberately not hard-coded here — pass the project you mean.
PROJECT_REF=<your-project-ref> python3 - <<'PY'
import json, os, subprocess, urllib.request
sql = open('supabase/seed/demo_seed.sql').read()
tok = subprocess.check_output(['security','find-generic-password','-s','Supabase CLI','-w'], text=True).strip()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{os.environ['PROJECT_REF']}/database/query",
    data=json.dumps({'query': sql}).encode(),
    headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json',
             'User-Agent': 'rotaflow-seed/1.0'})   # Cloudflare 403s the default UA
print(urllib.request.urlopen(req).read().decode()[:2000])
PY
```

The seed ends with a verification `SELECT` that prints a row per organisation with
a count for every section — all fives is a healthy run.

## Re-run it before every demo

Every id is derived deterministically (`md5('rotaflow-demo-v1:' || key)`), and every
date is relative to `current_date`. So re-running **deletes the five demo orgs and
rebuilds them centred on the current week** — the rota always looks live, shifts in
the past are already clocked, shifts ahead are still to come. Re-running is the
supported refresh; it is not an error.

It never reads or writes organisations created through the app.

## Accounts

**This repository is public.** These are real, email-confirmed accounts on a live
Supabase project, so a password committed here would be a working public credential —
anyone could sign in and mutate the demo data. `c_password` therefore ships as a
placeholder and the seed refuses to run until you set it. Keep the value you choose
out of the repo (a password manager, or your shell history at worst).

The blast radius is bounded even so: these accounts are members of the demo
organisations only, so RLS keeps them out of any real tenant. The worst case is a
scribbled-on demo, which a re-run repairs.

| Sign in as | Email | Role |
| ---------- | ----- | ---- |
| Gideon Akinlotan | `gakinz101@gmail.com` | **Super Admin** + owner of all 5 orgs; on the Northgate rota |
| Amelia Hart | `gakinz101+demo.owner@gmail.com` | Owner — Harbour View only |
| Daniel Okafor | `gakinz101+demo.manager1@gmail.com` | Manager — Northgate, Harbour View, + 3 more |
| Priya Raman | `gakinz101+demo.manager2@gmail.com` | Manager — Northgate |
| James Whitfield | `gakinz101+demo.staff1@gmail.com` | Staff — Northgate |
| Sofia Marchetti | `gakinz101+demo.staff2@gmail.com` | Staff — Northgate |
| Tomas Nowak | `gakinz101+demo.staff3@gmail.com` | Staff — Harbour View |
| Grace Adeyemi | `gakinz101+demo.staff4@gmail.com` | Staff — Harbour View |

The demo addresses are plus-addressed on the owner's real mailbox, so password
resets and magic links genuinely arrive and **nothing can bounce** — a fake domain
would hard-bounce, and Supabase has already warned this project about bounce rate.

Accounts are created with the password pre-set and the email pre-confirmed. Existing
accounts are reused, never overwritten, so a password you change by hand survives a
re-seed.

## The five organisations

| Org | Sector | Plan | Logins |
| --- | ------ | ---- | ------ |
| Northgate Care Group | Healthcare | business | All 5 staff have logins — the flagship demo |
| Harbour View Hotels | Hospitality | professional | Separate owner; proves tenant isolation |
| Brightside Retail | Retail | professional | Record-only staff + head-office logins |
| Clearway Logistics | Logistics | starter | Record-only staff + head-office logins |
| Meridian Security | Security | business | Record-only staff + head-office logins |

Each has 5 locations, 5 departments, 5 staff, 5 shift types, 5 templates, 5 rotas,
~93 shifts, 5 of each request type, 5 timesheets, 5 documents, 5 announcements,
5 notifications, 5 pending invites, 5 audit entries and a subscription.

Orgs 3–5 have record-only staff (no `user_id`), which is the real state of an
organisation that has added its people but not yet invited them. Their five Team
members are head-office logins with app access but no rota presence.

## What a demo can show

- **Rotas** — weeks −2 and −1 completed, this week live, next week published, week +2 a
  half-built draft. `getOrCreateRotaForPeriod` finds the existing rota rather than making one.
- **Open shifts** — 5 per org, one at each site, unassigned and needing cover.
- **Clock in/out** — past shifts already have GPS `in`/`out` pairs with realistic
  minute-level jitter. One person per org is **clocked in right now**, so the Clock In
  screen has a live state at any hour.
- **Requests** — leave, overtime and swaps each seeded across approved / pending /
  rejected, so approval queues are never empty.
- **Documents** — expiries staggered on purpose: one already expired, one due in 21 days.
- **Tenant isolation** — sign in as Amelia Hart and only Harbour View exists. Verified.
- **Super Admin** — `gakinz101@gmail.com` reads across every tenant.

## Not seeded, on purpose

- `org_smtp_settings` — a fake SMTP row would break the real "Test SMTP" button.
- `push_subscriptions` — device-bound; only a real browser can create a valid one.

## Sunnyvale Care Group

One organisation, built to the product brief's demonstration scenario.

| | |
| --- | --- |
| Sites | Sunnyvale Care Home (primary) · Westview Care Home · Riverside Support Centre |
| Departments | Care Home Floors 1–3 · Nursing · Kitchen · Maintenance · Administration · Head Office |
| Staff | 248 (236 active, 12 leavers) |
| Sign-ins | Helen Braithwaite (Owner) · **Sarah Manager** (Manager) |
| Rota | This week, published, per site — plus 23 open shifts needing cover |
| Attendance | Clock in/out pairs on every finished shift, with minute-level jitter |

Staff are distributed **60/25/15** across the three sites rather than evenly, so
per-site filters and coverage figures actually differ from one another — an
evenly split workforce makes every site look identical and hides exactly the
bugs a multi-site dataset exists to expose.

Two deliberate imperfections in the attendance data:

- **One in forty finished shifts has no clock-out.** That is the "forgot to
  clock out" case, and `pairClockEvents` must flag it for review rather than
  silently dropping the day — a bug this repository has already shipped once.
- **Clock times carry ±4 minute jitter.** A dataset where everyone clocks in
  exactly on time makes the timesheet variance column look broken.

Only Sarah Manager and the owner have logins; the other 246 are record-only,
which is the real state of a large organisation that has added its people but
not yet invited them all.

Accounts follow the same rules as the five-org demo — plus-addressed on the
owner's real mailbox so nothing can hard-bounce, and `c_password` must be set
before the seed will run.

## Removing it

```sql
-- supabase/seed/demo_teardown.sql       -- the five-org demo
-- supabase/seed/sunnyvale_teardown.sql  -- Sunnyvale Care Group
```

Drops the five orgs (everything cascades), deletes the seven demo accounts, and
clears the Super Admin flag. It never deletes `gakinz101@gmail.com`.
