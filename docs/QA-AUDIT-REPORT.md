# RotaFlow — Full QA / E2E / CRUD / Production-Readiness Audit

**Auditor:** rotaflow-qa-auditor (autonomous agent)
**Date:** 2026-08-14
**Target:** `http://localhost:5042` (dev server, live-wired to the real `rotaflow` Supabase project, ref `vwqqbdvlskngrqrejzxi`, region `eu-west-1`) — **not production**
**Methodology:** `docs/Working-Agent.md`, followed in full
**QA test identity used:**
- Organisation name attempted: `QA RotaFlow Test Organisation 20260814-141047`
- Test account (confirmed, used for all testing): `scriptural.os+rfqa20260814141047@gmail.com`
- A second sign-up attempt with `gakinz101+rfqa20260814141047@gmail.com` was abandoned unconfirmed after discovering the Gmail MCP tool available in this session is connected to the `scriptural.os@gmail.com` inbox, not `gakinz101@gmail.com` — that unconfirmed `auth.users` row is harmless leftover test data (see §15).
- Org B for the multi-tenant test was never created — blocked by BUG-001 before it could exist.

---

> ⚠️ **Status as of 2026-08-20: P0 (BUG-001, org creation broken) is FIXED.**
> Migrations `0048_restore_org_creation_bootstrap.sql` and
> `0049_fix_org_bootstrap_correlation.sql` restore and correctly qualify the
> `organisations_select` bootstrap clause this report diagnosed in §4 — the
> shipped fix is nearly verbatim this report's own recommended SQL (§16). A
> new organisation can be created again. This report's other findings
> (BUG-002 onboarding-draft-lost-on-refresh, BUG-004 Platform Console
> fabricated data) were **not** part of the P0 and remain open at last check —
> see `docs/PRD.md`/`docs/LOOP.md` for current per-feature status. **No
> regression test exists yet** for the org-creation-by-a-zero-membership-user
> path this report's own recommended fix (§16) called for — this bug can
> recur silently. The rest of this report is a point-in-time snapshot from
> 2026-08-14 and should not be read as reflecting the current NOT READY /
> 22-100 verdict.

## 1. Executive Summary

**Overall status: NOT READY.**
**Quality score: 22 / 100.**

A brand-new customer can sign up, verify their email, and reach the "Create your organisation" step of onboarding — and then the product stops working. **Every attempt to create an organisation fails**, on every retry, for every account, with no workaround reachable through the UI. Because RotaFlow requires an organisation to do anything (build a rota, add staff, clock in, request leave — all of it is `org_id`-scoped), this single defect (BUG-001, P0) makes the entire product unusable for a new customer starting from zero. It is not a UI glitch — it is fully root-caused at the database/RLS level (§4), and it is a **regression of a bug that RotaFlow's own migration history already found and fixed twice** (`0003_fix_organisations_select_rls.sql`, then narrowed safely in `0005_narrow_organisations_select_rls.sql`), silently undone by a later migration (`0031_platform_metadata_reads.sql`).

Everything downstream of organisation creation — Phase 5 CRUD audit, Phase 7 rota lifecycle (draft → publish → clock-in → timesheet → approve → report), the multi-tenant security test, availability/leave/swaps/overtime, announcements, and most of the Phase 3 navigation inventory — could not be exercised as a genuine new customer, because there is no legitimate (non-cheating) way to get past this screen. Per the audit's DO NOT CHEAT rule, none of it was faked via direct SQL inserts; it is honestly reported as **BLOCKED — UPSTREAM P0** throughout this report, not as PASS.

What *was* reachable is, encouragingly, solid: the marketing site, sign-up flow (validation, password strength, email confirmation via real Supabase Auth email), login, 404 handling, route guarding for an org-less authenticated user, and the general engineering hygiene (clean console, sensible error copy, careful RLS commentary in the migration history) all point to a team that builds carefully. The problem is narrow, well-understood, and has an exact, low-risk fix (§4, §16) — this is a bad day, not a bad codebase.

**The one-line answer to the audit's central question:** *No.* A completely new customer cannot get past step 1 of setting up their organisation today, so no part of the rest of the promised workflow (rota build → publish → clock-in → leave → reports) is reachable from zero.

---

## 2. Test Coverage

| Area | Coverage |
|---|---|
| Phase 1 — Application startup | Done. Cold load, console, network, 404 route, refresh, hard reload all checked. |
| Phase 2 — First-run experience | Done through org creation; blocked at "create organisation." Sign-up validation (empty/invalid email/weak password/duplicate-attempt awareness), email confirmation via real inbox, login, logout/re-login persistence all verified. |
| Phase 3 — Navigation audit | Partial. Full route table extracted from source (35+ routes). Only public routes + auth + stuck-onboarding screen actually walked; everything under `/app/*` requiring an org is **BLOCKED — UPSTREAM P0**. |
| Phase 4 — Every-button test | Partial. Buttons on landing, sign-up, onboarding step 1, login exercised (including double-submit/retry). Everything past onboarding **BLOCKED**. |
| Phase 5 — CRUD audit (23 entities) | **BLOCKED — UPSTREAM P0** for all entities except Organisation itself (Create = FAIL, everything else unreachable). |
| Phase 6 — Persistence | Done for what's reachable: onboarding failure state does *not* survive refresh (form resets, arguably correct), but the *stuck-at-step-1* state correctly survives logout/re-login (server-side, confirmed via DB — good finding). |
| Phase 7 — Rota live-ops lifecycle | **BLOCKED — UPSTREAM P0.** None of draft/publish/clock-in/timesheet/approve/report reachable. |
| Multi-tenant security test | **BLOCKED — UPSTREAM P0.** Org A could not be created, so Org B and the cross-org access test could not run. |
| Offline / PWA | **BLOCKED — BY DESIGN IN THIS ENVIRONMENT.** `vite.config.ts` sets `VitePWA({ devOptions: { enabled: false } })` — the service worker is deliberately disabled in `npm run dev`. Confirmed 0 service worker registrations. Requires a production build to test; not a defect. |
| Destructive/high-consequence actions | **BLOCKED — UPSTREAM P0** (no staff, rota, or org to act on). |
| Recovery testing | Partial — recovery from a *failed org-creation* was tested repeatedly (deterministic failure, no corrupted state, no orphaned rows — confirmed via DB). Mid-publish/mid-clock-in recovery **BLOCKED**. |
| Error/empty/loading states | Partial — sign-up and onboarding error/loading states checked and are good. Rest **BLOCKED**. |
| UI/UX vs `docs/DESIGN.md` | Partial — spot-checked on reachable screens only; no obvious token violations seen. |
| Responsive | Partial — landing page checked at mobile/tablet/desktop (375/768/1280), no horizontal overflow found. Rota builder / schedule / clock-in (the highest-risk mobile surfaces per the brief) **BLOCKED**. |
| Accessibility | Not independently re-run — memory indicates existing Playwright+axe CI coverage for 13 public pages at 0 violations; authenticated app screens **BLOCKED**, so the "extend the same rigor" ask could not be completed this session. |
| Performance | Partial — page-load and route-transition times observed as fast (<200ms typical) on all reachable screens; the 100-staff/500-shift rota-builder stress scenario **BLOCKED**. |
| Console/network audit | Done continuously throughout. Zero JS errors on landing/signup/login. Two console errors surfaced during the onboarding failure (expected 403s from the failed insert) plus one unexplained 401 (§4, BUG-003, SUSPECTED). |
| Cross-screen consistency | **BLOCKED — UPSTREAM P0** (nothing to propagate). |
| Data integrity | Confirmed no orphaned rows result from the repeated failed org-creation attempts (§4) — the failure rolls back cleanly. |
| Feature gap analysis | Done at a source/route-table level (§14); functional depth **BLOCKED**. |
| Seed/demo data audit | Done (§15) — this dev environment holds 3 pre-existing organisations in the shared Supabase project, consistent with prior memory of "3 real is_demo-mis-flagged orgs" from production teardown. None were touched, used, or relied upon for any pass/fail claim in this report. |
| Super Admin / Platform Console | Visually spot-checked only, via the documented **DEV-only** `/admin-preview` harness (renders the console without a login). This is **not equivalent to authenticated functional testing** — no login gate, no role-permission boundary, and no mutation was exercised through it. Used strictly to confirm the console's screens exist and render (Overview, Organisations, Users, Subscriptions, Billing, Support Centre, Support Access, Incidents, Integrations, Notifications, Audit Logs, Feature Flags, GDPR & Data, Platform Settings). |

**Time-boxing — what was explicitly NOT reached, per the priority order given:** Phase 4 exhaustive every-button testing beyond onboarding, offline/PWA in a built (non-dev) instance, destructive-action testing, interrupted-mutation recovery, full accessibility re-audit of authenticated screens, and the AI rota assistant (`supabase/functions/ai-rota-assistant`) JWT-forwarding/RLS test. All of these require an organisation to exist, which BUG-001 prevents. No amount of remaining time budget would have changed this — the blocker is structural, not a matter of testing more screens.

---

## 3. Bug Summary

| Severity | Count | IDs |
|---|---|---|
| P0 — Blocker/Critical | 1 | BUG-001 |
| P1 — High | 0 | — |
| P2 — Medium | 1 | BUG-004 (SUSPECTED) |
| P3 — Low | 2 | BUG-002, BUG-005 |
| P4 — Cosmetic | 1 | BUG-003 (SUSPECTED) |

No P1s were *found*, but that is largely because BUG-001 prevented the entire surface area where P1s (broken publish, broken clock-in, broken leave approval) would normally be found. Treat the P1 row as **unknown, not clean** — see §16.

---

## 4. Critical Findings

### BUG-001 — P0 — New organisation creation is completely and permanently broken

- **Area:** Onboarding / Organisation service (`src/services/orgService.ts`, `src/pages/OnboardingPage.tsx`)
- **Feature:** Step 1 of onboarding — "Create your organisation"
- **Environment:** `localhost:5042` dev server against live Supabase project `vwqqbdvlskngrqrejzxi` (same project the audit was told to treat as authoritative; this is a database-level RLS defect, not a dev-only artifact — it will reproduce identically in production)
- **Role:** Any newly-registered, email-confirmed user (Organisation Owner-to-be)
- **Preconditions:** Fresh account, no existing organisation
- **Steps to reproduce:**
  1. Sign up with a new email, confirm it via the emailed link (real Supabase Auth email, verified end-to-end via Gmail).
  2. Land on `/onboarding`, fill in Organisation name / industry / size (any valid values).
  3. Click **Continue**.
- **Expected result:** Organisation is created; user proceeds to step 2 ("About your organisation").
- **Actual result:** Toast/inline error: *"Could not create the organisation. Please try again."* User remains on step 1. Reproduced **100% deterministically** across repeated attempts, across two different accounts, and via direct SQL simulation of the exact same request — never once succeeded.
- **Evidence:**
  - Browser console at the moment of failure: `Failed to load resource: the server responded with a status of 403 ()` on `POST https://vwqqbdvlskngrqrejzxi.supabase.co/rest/v1/organisations?select=*`.
  - Calling the app's own `createOrganisation()` function directly (same code path the UI uses) returns: `{"message":"new row violates row-level security policy for table \"organisations\"","details":null,"code":"42501","hint":null}`.
  - **Root cause, fully isolated at the SQL level** (read-only `supabase db query --linked`, no writes committed — see below):
    - The live `organisations_insert` policy (`with check (auth.uid() = created_by)`) is correct and passes.
    - The problem is the **`organisations_select`** policy, which PostgreSQL also evaluates against `INSERT ... RETURNING` (which is exactly what `.insert({...}).select('*').single()` compiles to via PostgREST).
    - The currently deployed `organisations_select` policy is:
      ```sql
      using (public.is_org_member(id) or public.is_platform_admin())
      ```
    - A brand-new organisation has **no membership row yet** — the owner membership is only created by the `on_org_created` AFTER INSERT trigger (`handle_new_org()`), and Postgres's RLS check for the `RETURNING` clause does not see that trigger's effect in time. So `is_org_member(id)` is `false`, the creator isn't a platform admin, and the `RETURNING` projection fails RLS — which aborts the whole `INSERT` and rolls it back.
    - **This is not a new bug for RotaFlow — it's a regression of one already found and fixed twice:**
      - `supabase/migrations/0003_fix_organisations_select_rls.sql` — added `or created_by = auth.uid()` specifically to fix this exact bootstrap race, with a detailed comment explaining it.
      - `supabase/migrations/0005_narrow_organisations_select_rls.sql` — narrowed that clause (only while no membership row exists yet) to close a permanent-backdoor concern, while explicitly preserving the bootstrap window.
      - `supabase/migrations/0031_platform_metadata_reads.sql` — added `is_platform_admin()` visibility for the Platform Console, but **dropped the `created_by` bootstrap clause entirely** in the process. Its own comment even says *"The permanent creator backdoor 0005 closed stays closed"* — the author appears to have read 0005 as "close the backdoor" without registering that 0005 also *kept the bootstrap window open* (that was the whole point of narrowing rather than removing it). The result: the exact `0003` bug is back.
    - **Proof the diagnosis is exact:** running the identical `INSERT ... RETURNING` at the SQL level with `role authenticated` and `request.jwt.claims` set to the real user's `sub` fails with the same `42501`; the *same insert without `RETURNING`* succeeds. All test statements were run inside `begin ... rollback` or without a `RETURNING`/commit path — **no data was written**; confirmed after the fact via `select count(*) from organisations` = 3 (the same 3 pre-existing orgs noted in §15, unchanged).
  - Retried via the real UI a second time (same session) — identical failure, identical error text.
  - Duplicate/rapid-click handling: the **Continue** button correctly shows "Creating account…"/disables during the sign-up submit; the onboarding Continue button was not caught mid-flight for a true double-click race, but repeated sequential clicks each independently fail the same way — no duplicate/partial organisation rows were ever created (confirmed via DB).
- **Frequency/reproducibility:** 100%, every attempt, every account.
- **Likely cause:** `supabase/migrations/0031_platform_metadata_reads.sql`, lines ~37–45, dropped the `created_by = auth.uid() and not exists (select 1 from memberships where org_id = id)` clause that `0005_narrow_organisations_select_rls.sql` had established as the correct, safe bootstrap fix.
- **Impact:** Total. No new customer, in production or anywhere else this schema is deployed, can create an organisation. This is the single most important finding in this audit — it blocks 100% of the product's value proposition for any new signup.
- **Recommended fix:** Restore the bootstrap clause in the current policy definition, e.g.:
  ```sql
  drop policy if exists organisations_select on public.organisations;
  create policy organisations_select
    on public.organisations for select
    using (
      public.is_org_member(id)
      or public.is_platform_admin()
      or (
        created_by = auth.uid()
        and not exists (select 1 from public.memberships m where m.org_id = id)
      )
    );
  ```
  Ship as a new migration (do not hand-edit `0031`), and add a regression test that specifically exercises `insert ... select().single()` as a freshly-authenticated user with zero memberships — the exact shape of test that would have caught this the moment `0031` was written.
- **Regression test:** Sign up a new user, confirm email, attempt organisation creation through the onboarding UI, assert step advances to "About your organisation" and the org row exists with the creator as an active owner. Add this as an automated E2E test given how easily this specific regression slipped back in once already.

### BUG-004 — P2 (SUSPECTED) — Platform Console "Total organisations" figure does not match the database

- **Area:** Platform Console → Overview (`/admin-preview`, and presumably the authenticated `/app/platform` overview it mirrors)
- Console showed **"Total organisations: 6"**; a direct read-only count against `public.organisations` in the same live project returned **3**.
- Not root-caused (out of time-box) — could be a stale/cached demo figure, a different counting basis (e.g., including soft-deleted or a differently-scoped table), or a genuine query bug in `src/lib/adminOverviewDemo.ts` (a file the console's own footer explicitly names as the source of its placeholder figures — churn and system-health history are labelled placeholder there, but the organisation count is claimed as "real"). Flagged as **SUSPECTED**, not confirmed, and reported via the DEV-only preview harness rather than an authenticated session, which is itself a caveat on this finding.
- **Recommended action:** Verify the overview query's source and whether it's reading a stale materialized view, a cached snapshot, or double-counting.

### BUG-002 — P3 — Onboarding step 1 form values are lost on refresh

- Refreshing `/onboarding` while on step 1 resets Organisation name / industry / size to blank, rather than restoring the in-progress draft. Minor, but combined with BUG-001 it means a user who refreshes while troubleshooting the "Could not create the organisation" error has to retype everything on every attempt.

### BUG-005 — P3 — No client-side duplicate-tab / stale-session guard observed on the stuck onboarding screen

- Not a discovered failure so much as an untested risk: because organisation creation never succeeds, the "two managers/two tabs" class of race conditions this audit is meant to probe (Phase 7, "Test case generation") could not be exercised at all. Recorded here as a coverage gap rather than a confirmed defect — re-test once BUG-001 is fixed.

### BUG-003 — P4 (SUSPECTED) — Unexplained console `401` during the auth/onboarding flow

- One `Failed to load resource: the server responded with a status of 401 ()` was logged in the browser console during the session, timestamped between the email-confirmation redirect and the first organisation-creation attempt. It did not visibly break anything (no user-facing error, no stuck UI beyond BUG-001 itself), and was not reliably isolated to a specific request given the volume of background calls onboarding makes. Reported as **SUSPECTED** per the audit's instructions for a suspected-but-not-conclusively-reproduced issue; worth a look at whatever fires immediately after PKCE email-confirmation redirect, in case of a benign token-not-yet-refreshed race.

---

## 5. CRUD Completeness

Per the audit's rule, seed/demo data is never accepted as evidence of CRUD, and nothing here is marked PASS without an actual UI demonstration.

| Entity | Create | Read | Update | Delete/Archive | Persist | Notes |
|---|---|---|---|---|---|---|
| Organisation | **FAIL** | BLOCKED | BLOCKED | BLOCKED | N/A | BUG-001. This is the root blocker for every row below. |
| Membership | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | Depends on Organisation. |
| Staff | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Location | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Department | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Shift type | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Shift template | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Rota | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Shift | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Availability | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Leave request | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Shift swap | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Overtime request | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Clock event | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Timesheet | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Announcement | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Notification | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Notification preference | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Report | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Role | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Permission | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Integration | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | " |
| Support case | Not tested | Screen present (unauth preview only) | Not tested | Not tested | Not tested | Platform-level entity; not gated by BUG-001, but no platform-admin credentials were available to test authenticated. |
| Feature flag | Not tested | Screen present (unauth preview only) | Not tested | Not tested | Not tested | Same as above. |
| Platform administrator | Not tested | Screen present (unauth preview only) | Not tested | Not tested | Not tested | Same as above. |

**Verdict for Phase 5: FAIL.** The single most fundamental entity in the system — Organisation — fails Create, which cascades to every dependent entity by construction (RLS scopes everything to `org_id`; nothing else can exist without one).

---

## 6. Screen-by-Screen Report

| Screen | Route | Result |
|---|---|---|
| Landing page | `/` | PASS — loads clean, no console errors, all CTAs present and correctly routed |
| 404 | any unknown path | PASS — proper "This page doesn't exist" state, no console error, "Back home" link works |
| Sign up | `/signup` | PASS — empty-state validation (Create account disabled until valid), invalid-email inline error with clear title text, live password-strength checklist (8+ chars / number / uppercase / symbol, each independently tracked), successful submit shows loading state then "Check your email to confirm your account," real email delivered and confirmed end-to-end |
| Email confirmation | Supabase-hosted `/auth/v1/verify` → redirect | PASS — correct redirect to `/onboarding` after confirming |
| Onboarding step 1 — Create organisation | `/onboarding` | **FAIL** — BUG-001. Field validation, slug availability check ("… is available"), and industry/size selectors all work; submission itself is broken |
| Onboarding steps 2–5 | `/onboarding` (stepper) | BLOCKED — never reached |
| Login | `/login` | PASS (functionally) — successful sign-in with the confirmed test account correctly re-routes back to the exact same stuck onboarding step, proving org-less state is persisted server-side, not just client-side. One tooling note, not an app bug: the page renders two DOM nodes matching a naive "Sign in" text selector (worth a `data-testid` for test-authoring convenience, not a user-facing issue) |
| `/app/dashboard` (direct URL, org-less user) | `/app/dashboard` | PASS — correctly redirected back to `/onboarding` rather than rendering a broken or partially-authorized dashboard; no security bypass observed |
| Platform Console (all sub-screens) | `/admin-preview` (DEV-only, unauthenticated) | Screens render (Overview, Organisations, Users, Subscriptions, Billing, Support Centre, Support Access, Incidents, Integrations, Notifications, Audit Logs, Feature Flags, GDPR & Data, Platform Settings) — **not functionally tested**, no login gate exercised |
| Everything under `/app/*` requiring an org (schedule, staff, leave, swaps, overtime, timesheets, announcements, reports, settings, roles, permissions, etc.) | various | **BLOCKED — UPSTREAM P0** |

---

## 7. End-to-End Workflow Report

| Workflow | Result |
|---|---|
| Sign-up → email verification | **PASS** |
| Organisation creation / owner assignment | **FAIL** (BUG-001) |
| Staff / location / department creation | BLOCKED |
| Rota build → publish | BLOCKED |
| Staff schedule view | BLOCKED |
| Availability submission | BLOCKED |
| Leave request → approval | BLOCKED |
| Shift swap → accept/decline | BLOCKED |
| Overtime request → approval | BLOCKED |
| Clock-in/out → timesheet | BLOCKED |
| Timesheet approval | BLOCKED |
| Reports/export | BLOCKED |
| Super Admin workflows | BLOCKED (no credentials; screens visually present only) |

---

## 8. Live Rota Safety

Could not be assessed — there is no rota, because there is no organisation. This section cannot respond PASS to any of the brief's specific questions (safe publish, draft-vs-published clarity, unpublish/correct, recovery from interrupted publish, stale-data risk) and none should be inferred as safe from the code alone. **BLOCKED — UPSTREAM P0.** Recommend this be the first thing re-tested once BUG-001 ships a fix, given the brief's own framing of this as "the highest-risk workflow in the product."

---

## 9. Offline Report

**BLOCKED — BY DESIGN IN THIS ENVIRONMENT, not a defect.** `vite.config.ts` explicitly sets `VitePWA({ devOptions: { enabled: false } })`, with a comment noting it can be flipped on to debug the service worker in dev. Confirmed 0 active service worker registrations against `navigator.serviceWorker.getRegistrations()`. Testing offline queueing, sync-on-reconnect, and duplicate-action prevention requires a production build (`npm run build` + serve `dist/`), which was outside this session's scope given the instruction to test against the running dev server. **Recommend a follow-up audit pass specifically against a built artifact** — this is the single largest gap in this report's coverage of the brief.

---

## 10. Security Report

- **Multi-tenant isolation verdict: NOT DETERMINED — BLOCKED.** The single most critical test in the entire brief (Org A vs Org B cross-tenant access) could not run because Org A itself could never be created. This is not a pass and must not be read as one. It needs to be the **first** thing re-tested the moment BUG-001 is fixed, given how existentially important tenant isolation is for RotaFlow's model.
- **Route guarding:** PASS on what was testable — an authenticated, org-less user hitting `/app/dashboard` directly was correctly bounced back to `/onboarding`, not shown a broken or partial view. No privilege-escalation or IDOR surface was reachable to test beyond this, since nothing exists yet to escalate into.
- **`service_role` key exposure:** Not found in any client-served file. The client bundle (dev-served, unminified) exposes only the `anon` key via `VITE_SUPABASE_ANON_KEY`, which is by design safe to expose (RLS-gated) — confirmed this is genuinely the anon key (JWT `role` claim = `anon`), not a service key.
- **RLS engineering quality (general observation):** The migration history shows real security discipline — `0003`/`0005` show the team correctly identifying and narrowing a permissive bootstrap exception rather than leaving a permanent backdoor. BUG-001 is a regression *introduced while adding platform-admin visibility*, which is exactly the kind of change that deserves a "does this still let a brand-new user create their first org" regression test going forward (§4, §16).
- **AI rota assistant JWT-forwarding test (`supabase/functions/ai-rota-assistant`):** **BLOCKED** — requires an org and staff data to prompt meaningfully.
- **Injection / excessive error detail:** Not exhaustively tested beyond the reachable forms (sign-up, login, onboarding step 1), which use standard controlled inputs and returned clean, human-readable errors (no raw Postgres codes or stack traces surfaced to the user, even for the BUG-001 failure — the UI correctly showed a generic human message while the technical detail stayed in the console, which is the right behavior per the brief's error-message rule).

---

## 11. Performance Report

Limited by scope. On all reachable screens: initial paint and route transitions were fast (dev-server HMR aside, typically sub-200ms for API calls per the network log), no duplicate network calls were observed on the sign-up/onboarding flow, and no obvious N+1 pattern was visible in the request log (the onboarding page issues a small, flat set of GETs for profile/memberships/platform-role, not a fan-out). The brief's specific stress scenario (100+ staff, 500+ shifts in the rota builder) is **BLOCKED — UPSTREAM P0** and unassessed.

---

## 12. Accessibility Report

Not independently re-run this session. Per project memory, Playwright + axe-core CI coverage already exists for the 13 public marketing pages at 0 contrast violations. The brief specifically asks to "extend the same rigor to authenticated app screens" — that could not be done, since none of the authenticated app screens beyond the stuck onboarding step were reachable. Spot-checked onboarding step 1 by eye only: form fields have visible labels, the disabled-state Continue button is visually distinguished, and the password-strength checklist pairs each requirement with text (not colour alone). No formal axe run was performed against it.

---

## 13. UX/UI Report

On the screens that were reachable, the implementation reads as consistent with a considered design system: consistent button/input radii and spacing, a real password-strength component (not just a strength bar), clear step indicators in the onboarding stepper, and error messaging that explains what happened without technical leakage. No obvious `docs/DESIGN.md` token violations were spotted on the reachable surface. The one concrete UX issue found (BUG-002 — form values lost on refresh) is minor on its own, but stings more than it should because BUG-001 forces repeated retries through the same form.

---

## 14. Feature Gap Report

Derived from the full route table in `src/App.tsx` (35+ routes) and the landing page's own "built and working today, not a roadmap" claims, cross-referenced against what could actually be exercised:

| Feature area | Classification | Basis |
|---|---|---|
| Marketing site, sign-up, email verification, login | **Implemented + Working** | Directly demonstrated |
| Organisation creation / onboarding | **Implemented + Broken** | BUG-001 |
| Staff, Location, Department, Shift type, Rota, Shift, Availability, Leave, Swap, Overtime, Clock, Timesheet, Announcement, Notification, Report | **Blocked / Unknown** | Routes exist in source (`schedule`, `staff`, `leave`, `swaps`, `overtime`, `timesheets`, `announcements`, `activity`, `notifications`, etc.), code paths exist in `src/services/*`, but zero functional verification was possible from zero |
| AI rota assistant (`supabase/functions/ai-rota-assistant`) | **Backend present, functionally unverified** | Edge Function exists in repo per `CLAUDE.md`'s own architecture notes; untested this session |
| Platform Console (Organisations, Users, Subscriptions, Billing, Support Centre, Support Access, Incidents, Integrations, Notifications, Audit Logs, Feature Flags, GDPR & Data, Platform Settings) | **UI-present, functionally unverified** | Confirmed rendering via the DEV-only preview harness only; no authenticated pass |
| Offline queueing / PWA | **Implemented, unverified in this session** | Deliberately disabled in dev (`devOptions.enabled: false`); requires a production-build pass |
| GDPR erasure (`anonymize_staff_member`) | **Implemented + previously verified (per project memory), not re-verified this session** | Blocked — no staff exists in the QA org to erase |

---

## 15. Seed Data Audit

- The shared Supabase project (`vwqqbdvlskngrqrejzxi`) currently contains **3 pre-existing organisations** (confirmed via a read-only `count(*)` against `public.organisations`), consistent with project memory's note that 3 real `is_demo`-mis-flagged orgs remain after the earlier demo-dataset teardown.
- **None of these were read for content, used as a substitute for CRUD evidence, or relied upon anywhere in this report's PASS/FAIL claims.** They were referenced only for the aggregate count used in root-causing BUG-001/BUG-004 and appear, unmodified, in the Platform Console preview.
- **Leftover test data from this audit:** one unconfirmed `auth.users` row (`gakinz101+rfqa20260814141047@gmail.com`) from the abandoned first sign-up attempt, and one confirmed test user (`scriptural.os+rfqa20260814141047@gmail.com`) with **zero organisations, zero memberships** — exactly what's expected given BUG-001 blocked every creation attempt. Nothing else was written to the database by this audit; this was independently confirmed via `select count(*)` immediately after testing (3 orgs, 2 memberships — both pre-existing, matching the state before this session started).
- No seed SQL (`supabase/seed/*.sql`) was run or relied upon.
- Per the required framing: for every entity this audit could reach, the equivalent record could **not** be created by a real user through the UI alone, for exactly one reason (BUG-001) rather than 23 independent gaps — but formally, this still qualifies as `FEATURE GAP — Seeded Data Without User-Facing Creation Workflow` for the pre-existing organisations relative to a *new* customer's ability to reach that same state.

---

## 16. Recommended Priority Order

1. **Fix BUG-001 immediately.** This is a one-migration fix with an exact, already-drafted SQL statement (§4). Ship it as a new migration, not a hand-edit of `0031`. This unblocks literally everything else in this report.
2. **Add a regression test for organisation bootstrap** (sign up → confirm → create org → assert step 2 reached and an active owner membership exists) so this specific class of RLS regression — which has now happened once already — cannot silently reoccur when the `organisations_select` policy is touched again (e.g., for a future Platform Console feature).
3. **Re-run this entire audit's Phase 5, Phase 7, and Multi-Tenant Security sections** the moment BUG-001 ships. Those are unknowns, not passes — treat the current P1 count of "0" as untrustworthy until re-tested.
4. **Investigate BUG-004** (Platform Console org-count discrepancy, 6 vs. 3) — low effort, but a Platform Console admin should not be looking at a wrong headline number.
5. **Fix BUG-002** (onboarding draft not persisted across refresh) — small UX polish, more valuable once BUG-001 no longer forces repeated retries through the same form.
6. **Run a follow-up audit pass against a production build** specifically for Offline/PWA behavior (§9) — this was the largest scope item this session structurally could not reach for reasons unrelated to BUG-001.
7. **Re-verify GDPR erasure and other destructive actions** against a real staff member in a real org, once one can exist.
8. Chase down BUG-003 (SUSPECTED 401) opportunistically; low priority given no observed user impact.

---

## 17. Release Decision

# **NO-GO**

One unresolved P0 (BUG-001) makes the product unusable for its primary purpose — a new customer cannot create an organisation, full stop, on every attempt, with a fully diagnosed and 100%-reproducible root cause. Per the audit's non-negotiable rule, this alone forecloses any GO or GO WITH CONDITIONS recommendation, independent of the fact that the P0 also structurally prevented verifying the P1-critical workflows (rota publish, clock-in, multi-tenant isolation) this session was supposed to prioritize.

The good news, and the reason this is a NO-GO rather than a deeper indictment of the product: the fix is narrow, precisely located, and already drafted in §4. Everything observed *around* the blocker — sign-up UX, email verification, error messaging, route guarding, RLS engineering discipline in the wider migration history — suggests a codebase that is close to ready, not far from it. Fix BUG-001, re-run Phase 5/7/Multi-Tenant Security against a working organisation, and this verdict should move quickly.
