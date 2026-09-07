# Platform console repolish — 7 September 2026

A dated record of a second pass over `/admin/*`, made the same day as
`docs/PLATFORM-CONSOLE-REPAIR-2026-09-07.md` and picking up exactly where that
one stopped. `docs/SAAS.md` remains the capability register and is where the
statuses live; this exists so the next person can see what was looked at, what
changed, what was proved, and what was not.

Branch `platform/console-repolish-2026-09-07`, from `9d94b83`. 23 files,
+2,255 / −149.

---

## 1. The brief was already out of date, and saying so is the first finding

The request that started this work quoted a source review of 5 September at
`42ec2ce`, with seven findings: unpaginated directory reads, a user search that
could not find a multi-organisation account, audit search over a capped window,
an announcement composer disabled against a table that exists, and four
misleading disabled controls.

**All seven were closed before this pass began**, by PR #300 (`268895e`) and
#302 (`9d94b83`), which merged after that review was written. Re-validating
rather than implementing from the brief is what made the rest of this pass
possible; building to it would have rewritten working code.

What the earlier pass did leave is stated plainly in its own §2: seven routes
marked **"Not changed this pass"** and explicitly not claimed as verified, plus
the platform health page, which its coverage matrix never listed at all. Those
eight routes are this pass's scope.

---

## 2. One root cause under most of it

`is_platform_admin()` reads a single boolean on `profiles`. It is true for all
four platform roles and says nothing about which one. `0122` fixed that
blindness across eight **tables** on 5 September and closed GAP-053.

It enumerated those tables by hand. The query it needed is:

```sql
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosrc ilike '%is_platform_admin()%'
   and p.prosrc not ilike '%has_platform_role%';
```

That returns nine more objects, every one still open to `platform_finance` — a
role documented in `src/lib/platformRoles.ts` as "Subscriptions and billing
state only. No operational tenant data".

Two statements inside `0122`'s own header are wrong as a result. It says
`platform_user_auth_facts` "does not exist in this schema; nothing was done
about it because there is nothing to do". It has existed since `0027`, it reads
`auth.users`, and finance could call it for any account on the platform.

**The lesson is the query, not the list.** A hand-written enumeration is a list
of what somebody remembered.

---

## 3. What was wrong, in the order it matters

**A finance role could read the DSAR register.** `gdpr_requests_select` named
all four roles. Subject names, subject emails, extension reasons, outcome notes.
`/admin/gdpr` is also one of only two admin routes with no `RequirePlatformRole`,
and `src/lib/adminNav.ts` recorded that omission as something to fix "together
with the policy" — which had never happened.

**A finance role could write into a support case.** `reply_to_support_case`
decided the author's side with `is_platform_admin()`. `0122` had removed
finance's read of `support_cases`, so it could not open a case — and could still
post into one with a known id, rendering to the customer as **Platform**, and
could flag the message `is_internal`. `0116` named roles for three write paths
and missed this one.

**Admin-assisted organisation creation was dead.** `0126` rewrote
`create_invite` to add `p_department`/`p_location`, rebuilt both guards from the
`0006` text, and silently dropped the bootstrap exception `0052` had added. The
word "bootstrap" does not appear in `0126`. Since a new organisation has no
members, nobody can hold `owner`, so the guard cannot be satisfied:

```
ERROR:  Only owners and managers can invite people
CONTEXT: PL/pgSQL function create_invite(uuid,text,text,uuid,uuid) line 13
```

`admin_create_organisation_with_invite` calls `create_invite(…, 'owner')`
internally, so the whole sales-led path failed with it, not just the re-invite
control on the organisation detail page.

**The last platform owner could be raced to zero.** The guard was an unlocked
`count(*)`. Two owners revoking each other both read two owners, both passed,
and both updated different rows, so nothing conflicted. Verified with two
sessions: `OWNERS REMAINING: 0`. There is no way back from inside the product —
`grant_platform_role`, `revoke_platform_role` and `set_platform_mfa_required`
all require being a platform owner — on an instance with no backup (GAP-036).

**The queue-depth tile read a table with no writer.** `background_jobs` has
zero rows, no triggers, and no function in `public` referencing it; its only
writer was Inngest, retired in `0087`. The tile read "0 queued" and the panel
"Nothing is queued or running", permanently, on the one screen whose job is to
say whether work is stuck. The preview harness had the inverse fixture — 48 rows
across four invented queues — which is why nobody noticed: the only place anyone
looked at it, it had data.

**A rated case could not be reopened.** `set_support_case_status` cleared
`resolved_at`; `support_cases_csat_after_resolution` required it whenever `csat`
was set. So the one case nobody could reopen was the one the customer had been
happy enough to rate, and the operator got a bare `23514`.

**The organisation detail route was the way around the boundary.** No
`RequirePlatformRole`, and RLS **filters rather than raises**, so a finance
administrator read the organisation, got working counts, and saw "This
organisation has no members", an empty Audit tab, and a Users tile of 0 beside a
real Locations count. The comment explaining why the Users tab needed no session
said memberships were "reopened to any platform admin by 0031" — untrue since
`0122`, and the reasoning defect that produced the gap.

**The Integrations tab asserted a fact it had been refused.**
`org_smtp_settings_safe` is `security_invoker`, so the base policy applied:
owner-only, which for a platform administrator means a `read_write` support
session. A `platform_owner` with no session read 0 rows for a tenant with SMTP
configured, and the tab rendered "This organisation has not configured its own
SMTP."

**Three statements in the console's own honesty panel were false**, plus one on
the GDPR board. Detailed in GAP-089.

**A browser's own failure was recorded as a platform outage.** Every probe
collapsed each failure mode to `down` and the page wrote it to
`platform_health_samples`. Realtime has no scheduled probe (`0076` covers
database, auth and REST only), so its uptime comes entirely from console
samples: one administrator's blocked websocket permanently lowered the figure
every other reader sees.

---

## 4. Migrations, in the order they must apply

`0135` → `0139`, on top of `0130`–`0134`, which have still never been applied
anywhere. Every one is `create or replace` or a policy swap: no table is
rewritten and no grant is widened beyond `EXECUTE` to `authenticated` on
functions that refuse the wrong caller before reading anything.

| Migration | What it does                                                                                                                           | Rollback                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `0135`    | Nine role-blind guards moved to `is_platform_operational()`; `organisation_deletion_preview` to the roles `delete_organisation` admits | Restore the bodies from `0020`, `0024`, `0027`, `0028`, `0110`             |
| `0136`    | `create_invite`'s bootstrap branch restored, plus `invites_select` and `record_invite_send`                                            | Re-issue from `0126`, `0006` and `0129`                                    |
| `0137`    | `for update` on the live owner set before the last-owner count, in grant and revoke                                                    | Re-issue both from `0015`                                                  |
| `0138`    | `platform_queue_depths()` over `notification_outbox`                                                                                   | `drop function`; `background_jobs` is left in place                        |
| `0139`    | CSAT CHECK replaced by a trigger; `org_smtp_settings` read widened (with-check untouched)                                              | Re-add the CHECK once no reopened-and-rated row exists; restore the policy |

**They must merge with the client, not before or after it.** The console calls
`platform_queue_depths` and the client stops reading `background_jobs`, so the
client without `0138` calls a function that does not exist, and `0138` without
the client changes nothing. This is the constraint GAP-074 already records for
`0126`–`0128`, and the whole set ships together.

---

## 5. Evidence

| Gate                       | Result                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run typecheck`        | PASS                                                                       |
| `npm run lint`             | PASS, zero warnings                                                        |
| `npm run format:check`     | PASS                                                                       |
| `npm test`                 | **1,220 passed**, 72 files (was 1,207 / 71)                                |
| `npm run build`            | PASS, with no `.env`                                                       |
| `npm run check:bundle`     | PASS — 645.6 KiB of 700 KiB, no DEV page shipped                           |
| `npm run check:migrations` | PASS                                                                       |
| `npm run check:docs`       | PASS — migration count corrected 134 → 139 in three files                  |
| `npm run check:export`     | PASS                                                                       |
| `npx playwright test`      | **116 passed**, 4 skipped, 0 contrast violations in both themes            |
| `supabase test db`         | **589 assertions**, 63 files (was 560 / 60), on a database rebuilt in full |

New pgTAP, and what each would catch:

- `platform_finance_boundary.test.sql` (16) — finance refused the DSAR register,
  both auth-fact functions, tenant counts, SLA state, a case reply, an internal
  note and the deletion preview; support still doing its job through every one;
  finance keeping seats and organisations.
- `invite_bootstrap.test.sql` (8) — the full round trip for a platform admin on
  a member-less organisation, and that the exception closes the moment the
  organisation has any member, does not extend to `platform_support`, and does
  not cover the manager role.
- `support_case_reopen.test.sql` (5) — a rated case reopening with its rating
  intact, and a rating still refused on a case that was never resolved, on both
  the update and the insert path.

New unit tests: `organisationTabs.test.ts` (7), six `classifyProbeFailure` cases
in `platformHealth.test.ts`.

Screens driven in `/admin-preview` at 1440×900, light and dark: the GDPR board
(the contradictory statutory label, and the unreachable In progress / Awaiting
information states), the health page before and after (a fabricated 135-failed
queue, then a real notification queue with per-service failure detail and last
observation), and the organisation detail Data and Integrations tabs showing the
corrected copy.

---

## 6. What was NOT verified

Stated plainly, because a report that omits this reads as though everything was.

- **No finance-role session in a browser.** The preview harness signs in as a
  Platform Owner and has no role switch, so every UI consequence of the role
  boundary is asserted through pure functions and pgTAP, not seen. This is
  precisely why the tab gate was extracted to `src/lib/organisationTabs.ts`.
- **No production query of any kind.** Every `[db-verified]` claim here is
  against the local stack, built from the same migration history. The
  `create_invite` regression in particular should be confirmed against
  production before its urgency is sized.
- **The two-session owner race is not in pgTAP**, which is single-session. It was
  verified by hand with two psql connections and is recorded here as the
  evidence. A regression would not be caught by CI.
- **No Stripe call, no real communication, no credit or refund.** GAP-073 is
  still blocked on a test credential.
- **No production volumes.** Production holds no tenant; every truncation
  argument is reasoned from the code's own stated contract about `db.max_rows`,
  which was not measured against the hosted project.
- **Six defects the audits found are recorded and not fixed** — see §7.
- **`supabase test db` needs Docker**, started for this work. CI's
  `db-tests` and `e2e-authenticated` run against their own stack.

---

## 7. Found, recorded, then fixed

These six were listed here as deliberately left. They were fixed in a follow-up
commit on the same branch, so this section now records what they were and where
they went rather than what is outstanding.

**The support-access opt-out was unreachable and unenforced.** `0140`.
`organisations.support_access_allowed` was read only by
`request_support_access`, once, as a precondition; `has_support_access` — the
function every tenant policy routes through — never read it, so withdrawing
consent did nothing to a session already open. And because `has_org_role` ends
at `has_support_access`, the holder of a `read_write` session satisfied
`set_org_support_access`'s owner branch and could switch that consent back on.
The flag now sits inside `has_support_access` (re-read per query, so withdrawal
closes every live session at once) and the setter tests `memberships` directly
with no platform branch. It also had no caller at all: built on the customer's
own settings screen, with live sessions listed beneath it.
`support_access_consent.test.sql`, 7 assertions.

**GDPR requests could not reach two of their five statuses.**
`set_gdpr_request_status` always accepted all five and requires a note only for
`completed` and `refused`; the board offered Close and Extend. Both unreachable
states already had badge tones defined, so the register rendered states nothing
could produce. Start work and Awaiting information are now row actions.

**Incidents had no status transitions, filters or pagination.**
`add_incident_update` and `listIncidentUpdates` both existed with no caller, so
`identified` and `monitoring` were unreachable and an incident went from
declared straight to resolved. A timeline modal reads and writes it, with the
status moving in the same statement. Filters adopt the shared contract, and "no
matches" is a different sentence from "no incident has been declared".

**Three lists truncated silently.** The organisation detail page read the
platform-wide GDPR list capped at 200 and filtered it in the browser — ordered
by deadline ascending, so this tenant's newest requests were dropped first,
under a heading claiming none had been raised. Same shape for support sessions.
Both are scoped in the query now. The GDPR board carries the server's exact
count and says when it is showing a subset; the organisation audit tab says
"showing the most recent 100 of N".

**`/admin/settings` had dead fields.** `platform_settings` has 28 columns and
exactly one, `require_mfa`, drives anything. The page says so once at the top,
and the maintenance callout stops describing a banner no code renders — wiring
it needs a policy decision first, because that table is readable by platform
administrators only.

**The preview harness leaked out of itself.** Console screens link to
`/admin/...`, so following a row from `/admin-preview` bounced the reviewer to
sign-in. Fixed inside the harness with a capture-phase click handler rather than
by editing 18 links in production components, so it covers links that do not
exist yet.

### Still not verified, after those fixes

- **The consent control is not seen rendered.** It is on an authenticated screen
  with no preview route, so it is proved by pgTAP and typecheck only.
- **The GDPR truncation notice cannot fire in the harness**, whose fixture
  derives its count from the page length. That the count is real was checked
  against PostgREST directly: `Content-Range: 0-2/7` for a three-row page over
  seven rows.
- **Wiring the maintenance banner is a decision, not a repair**, and is left.

## 8. Remaining blockers, unchanged

- **GAP-080** — invoice credits: no table, no policy, no RPC, no test credential.
- **GAP-081** — the tenant-side announcement surface.
- **GAP-073** — Stripe test-mode verification, blocked on a credential.
- **GAP-036** — production still has no backup and no PITR. Unrelated to this
  work, and larger than all of it. `0137` exists because of it: a race that
  empties the owner table is only unrecoverable because there is nothing to
  restore from.
