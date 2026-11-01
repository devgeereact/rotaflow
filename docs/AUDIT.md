# Audit record

Dated sections, newest last. Each records what changed, the evidence that it works, and what was not tested.
The slice history before S9 is in `.agent/CURRENT-TASK.md`.

## 2026-10-30: S9, the React app moves off Supabase onto the PHP API and Clerk

Branch `move/cpanel-clerk`, local commits only (S9a to S9f). `main` and the live site are unchanged and still
run on Supabase until the R1 cutover is approved.

**What changed**

- Sign-in is Clerk (`@clerk/clerk-react` 5.61.3, `VITE_CLERK_PUBLISHABLE_KEY`). Login and sign-up are Clerk's
  forms in the existing layout; password reset, the MFA gate and challenge, sessions and connected accounts pages
  were deleted (Clerk's account screen on Security; the old routes redirect). `useSupabaseAuth` became `useAuth`.
- `src/lib/api.ts` is the only network client: `/api`, Clerk session token as Bearer, SQL datetimes read as UTC.
  Every service in `src/services` calls the API; supabase-js is removed from `package.json` and `src/lib/supabase.ts`
  is deleted. No `@supabase` import remains in `src`.
- Organisations are by invitation: a person with no organisation sees a no-organisation screen in onboarding.
- The service worker caches no API response; the old `supabase-api` and `imagekit-media` caches are only deleted.
- `.htaccess`: `/api` pass-through (with the Authorization header) before the SPA rules, and a CSP naming the
  Clerk hosts instead of Supabase and ImageKit. ImageKit and the dead `VITE_*` variables are gone.
- API routes added where an R1 screen needed one (listed in `docs/API-SPEC.md`, "Slice S9"): organisation
  profile and slug, organisation preferences, labour cost and current pay rates, display name,
  notifications switch, client-recorded audit actions, and four console reads.
- Features left off for R2: staff documents (S10) behind the `staff_documents` feature flag.
  Cut-list items (integrations, IP allow-list, stored health probes) read empty and refuse writes.
  Manual invoice issue/status and the platform require-MFA switch are refused with a sentence.

**Evidence (local, 30 October 2026)**

- `pnpm run check` exit 0 before every commit: ESLint, Biome format, `tsc`, vitest, build, bundle budget,
  migration safety, doc counts, export coverage, PHP lint and suites. Final run: vitest 115 files / 1676 tests;
  PHP 1639 assertions passed, 0 failed (S8 ended at 1585); bundle 704.9 KiB shipped against 760 (was 723.5).
  One PHP run in S9b saw `210-photos-templates` "cron then deletes the file" fail once; it passed on three
  reruns and on every later full run (a timing flake in an S8 test, not touched by S9).
- PHP suites added or extended: `220-frontend-switch` (new), `085-account`, `150-console`. The access sweep
  (`099`) reads the route table, so every new route is called as anonymous, a stranger and a user with no
  organisation; the role cases (staff, manager, owner, wrong tenant) are in the per-module suites.
- Tests that faked supabase-js now fake `src/lib/api`: rotaBatchLoading, leaveOverlap, swapDecision,
  reviewConcurrency, aiPlanEntitlement, orgExportSource; calendarFeed reads the 90-day rule from the PHP module.

**NOT TESTED**

- A real Clerk session against the API (no browser sign-in was run; Clerk's JWKS and the `email` claim are
  covered only by the PHP `000-jwt` suite with test keys).
- The app in a browser against a running API: no screen was exercised end to end. Shapes were matched by reading
  each PHP handler; mismatches are possible and are the first thing to check in local-live.
- The `.htaccess` rules behind Apache and Cloudflare, and the CSP in a real browser.
- The dev-only preview harnesses (`/dashboard-live-preview`, `/settings-preview/*`, `/admin-preview`) still fake
  the old REST paths and now render without data.
- Playwright e2e specs (they target the Supabase flows and were not run).
- Real Stripe, real push, real SMTP, real OpenRouter, real Turnstile (unchanged from S6 to S8).

## 2026-10-30: S10 (R2), compliance: document types, staff documents with review, reminders

Branch `r2/s10-compliance` from `move/cpanel-clerk` (5d5c9d6), local commits only. Nothing pushed or deployed.
Spec: `docs/RESTRUCTURE-PLAN.md` section 4, "S10 Compliance". Ported from SiteRelay's `Compliance` module and its
`060-compliance` suite (read only), re-made for RotaFlow's staff records and roles.

**What changed**

- Migration `backend/migrations/015-compliance.sql`: `document_types`, `documents` (review columns; `status` defaults
  to `approved`), `document_reminders`, and the `staff_documents` feature flag seeded **off**.
- `backend/src/Mod/Compliance.php` (13 org routes and the public signed `GET /document-files`) and the pure
  `backend/src/ComplianceRules.php`. Eligibility is an internal service (`Compliance::eligible`) for S12.
- Reminders d30, d14, d7 and expired run from the existing one-minute `bin/cron.php`, at most once in fifteen
  minutes; they replace the `0093` expiring-document alert rather than adding a second one.
- `Gdpr::eraseStaff` deletes the person's documents; `Lifecycle::CLEAR_FIRST` clears `documents` before staff
  records; `Api` gives the upload route a 14 MiB body limit (a 10 MB file as base64), every other route unchanged.
- Front end: `documentService` on the real endpoints, the Documents window (typed upload, status chips, send for
  review, withdraw), `/app/compliance` (Compliance for managers, My documents for staff), Settings, Document types,
  and the eligibility chip in the rota builder and on open shifts. All of it only while the flag is on.

**Decisions where the spec met the code (the safer option taken)**

1. The plan says `documents` is "altered". It did not exist in MariaDB yet (S8 left it for S10), so 015 creates it
   with the Postgres column names kept, so moved rows need no mapping. The plan's `issued_on` is the existing
   `issued_at` column, not a second one.
2. Four eyes: nobody reviews a document about themself, **owners included** (SiteRelay let an owner approve their
   own). A manager who uploaded for someone cannot approve it; an owner can, as the spec says.
3. "Super Admin: none" is enforced: a platform support session gets 403 on every compliance route, although
   support otherwise has a manager's reach.
4. SiteRelay required types per role (worker, supervisor) and per site. RotaFlow has neither dimension in its
   approved model, so a type is either required of every active staff record or of nobody (`required`).
5. A row moved from Postgres has no type. It counts for a type whose name equals its free-text `type`, so an
   approved DBS on file is not made worthless when a manager creates a required "DBS check".
6. Withdrawn, rejected and replaced documents (and their files) are kept as review history until the person is
   erased or the organisation deleted. Whether to remove them sooner is an owner decision (`docs/SECURITY.md`).
7. The reminder days are fixed at 30, 14 and 7 (SiteRelay's per-company setting was not ported; the spec names
   the three stages).
8. The chip informs and never blocks; the open-shift claim gains the server-side document check in S12, as planned.
9. A suspended organisation refuses compliance writes; the billing read-only state does not (it is about building
   rotas, and a person must still be able to file a renewed certificate).
10. `210-photos-templates` "cron then deletes the file" (the flake recorded under S9) was traced to the deletion
    drain taking 20 rows a run while about 20 were queued in the same second; the test now drains twice.

**Evidence (local, 30 October 2026)**

- `pnpm run check` exit 0 before each commit (ESLint, Biome, `tsc`, vitest, build, bundle, migration safety,
  doc counts, export coverage, PHP lint and suites).
- PHP: 1755 assertions, 0 failed (S9 ended at 1639 by its own record; 1639 + 116). Suite `230-compliance`: 116,
  covering type rules and presets, upload limits and byte sniffing, who sees what, signed links, four eyes,
  supersede, eligibility (including Auckland local midnight and DST-safe London dates), moved rows, the summary,
  archive, support refused, suspended organisation, every reminder stage, missed runs, timezone, no-login staff,
  deactivated staff, the 15-minute gate, the real `bin/cron.php`, erasure and organisation deletion. The access
  sweep (`099`) covers the new routes as anonymous, a stranger and a user with no organisation.
- Mutation checks (each made the suite fail, then reverted): removing the uploader four-eyes rule; counting
  `awaiting_review` documents as eligible; letting a support session through.
- vitest: `src/lib/compliance.test.ts` (11, the PHP cases mirrored: expiry state, display status, calendar days,
  organisation-local today across the clock change, eligibility on a date, actions) and
  `src/lib/complianceNav.test.ts` (3, the flag hides the row and the tab). Bundle 713.8 KiB of 760.

**NOT TESTED**

- Any compliance screen in a browser against a running API (shapes matched by reading the handlers).
- A 10 MB upload through Apache, PHP and Cloudflare on the host: it needs `post_max_size` (and any
  `LimitRequestBody`) of at least 15 MB; the local tests call the API in process.
- Opening a document through `/api/document-files` in a real tab under the production CSP; HEIC files.
- Migration 015 on MariaDB 11.4 (the live version); only the local 13.0.2 test database ran it.
- Moving existing Supabase `documents` rows and their Storage objects into the private store (a cutover task).
- Reminder emails and pushes through real SMTP and a real device; the job under the host's cron.
- Playwright.

## 2026-10-30: S11 (R2), scheduling: warnings, publish preview, recurring patterns

Branch `r2/s11-scheduling` from `r2/s10-compliance` (2c79fd7), local commits only. Nothing pushed or deployed.
Spec: `docs/RESTRUCTURE-PLAN.md` section 4, "S11 Scheduling". Ported from SiteRelay's `Scheduling` module,
`src/account/time.ts`, `rota-tools.ts` and their tests (read only), re-made for RotaFlow's rotas and staff records.

**What changed**

- Pure logic first (commit S11a): `src/lib/zonedTime.ts` (SiteRelay's time maths, clock-change tests pinned to
  Europe/London), `src/lib/schedulingRules.ts` and `backend/src/SchedulingRules.php` holding the same rules (daily
  rest, weekly hours, leave, declared unavailability, patterns), with mirrored cases in vitest and suite
  `235-scheduling-rules`.
- Migration `backend/migrations/016-scheduling.sql`: only the `scheduling_tools` feature flag, seeded **off**. No
  new tables; the two limits are the existing `organisations.settings` keys `min_rest_hours` and `max_weekly_hours`.
- `backend/src/Mod/Scheduling.php`: `GET /orgs/{o}/rotas/{r}/publish-preview` and
  `POST /orgs/{o}/rotas/{r}/patterns/generate`; `Rotas::publish` refuses a double-booking (409 `shift_overlap`)
  and the leave review response gains `clashing_shifts`, both only while the flag is on.
- Front end: warnings panel in the assign dialog, "Before you publish" (`PublishCheckModal`, lazy), "Generate
  pattern" (`GeneratePatternModal`, lazy), and "Leave approved: shifts to cover" on Leave and Approvals. All of it
  only while the flag is on.

**Decisions where the spec met the code (the safer option taken)**

1. The plan's two "org settings" already existed: S9 whitelisted `min_rest_hours` (0 to 24) and `max_weekly_hours`
   (1 to 168), written by Settings, Policies. They are reused with the plan's defaults (11, 48); nothing new is
   stored, and migration 016 holds only the flag.
2. "Overlap blocks": RotaFlow's shift writes have never refused an overlap on the server (the builder refuses it on
   every write path in the browser). Adding a refusal to every shift write would change existing behaviour, and the
   repeat, amendment and AI paths with it. Instead, with the flag on, **publishing** refuses a double-booking and the
   pattern generator skips one; shift writes are unchanged. Extending the refusal to shift writes is an owner
   decision.
3. The plan names no flag for S11. It ships behind `scheduling_tools`, seeded off, and unlike S10 (whose flag only
   hides screens) the server enforces it too (403 `feature_off`), because S11 changes what publish and a leave
   decision do.
4. The rest rule is SiteRelay's reading of the Working Time Regulations (a continuous 11 hours in the 24 before a
   shift), not the browser assistant's (the gap since the previous shift). A split day with a long overnight rest is
   therefore not flagged by the new rule. The existing assistant warnings tab is untouched and still shows its own
   gap rule, so nothing a manager saw before disappears.
5. Pattern times are "org-local" in the plan; RotaFlow keeps a timezone per site and its grid and repeat already
   use the site's zone, so a pattern uses the rota site's zone, falling back to the organisation's. For a
   single-zone organisation the two are the same.
6. Warnings and overlaps read this rota against committed shifts only (published rotas except the one being
   amended, and shifts with no rota). Other drafts are not counted, so an amendment never clashes with the rota it
   replaces and an abandoned draft cannot raise a warning. The assign dialog reads the shifts on screen; the server
   preview is the authority.
7. SiteRelay's "changed" needs a shift identity that survives publishing; RotaFlow's amendments copy shifts with new
   ids, so the preview compares by person, site, start and end: `new`, `unchanged`, `removed`, `cancelled`.
8. RotaFlow approves leave without a dialog. The clashing shifts are shown in a dialog after the approval, on both
   Leave and Approvals; nothing is changed automatically. Archived history never counts. Half-day leave counts as
   the whole day for warnings and clashes (warns more, never less).
9. A pattern must also fall inside its rota's period (a shift belongs to a rota), as well as the plan's 92 days and
   500 shifts.
10. A clock-change hour: both sides resolve a repeated autumn time to the second (GMT) occurrence and move a skipped
    spring time on an hour. The PHP uses the browser's two-pass method rather than PHP's own default, so the two
    agree.
11. The publish dialog is `PublishCheckModal`, not `...Preview...`: the bundle guard treats any chunk named preview
    as a DEV preview page that leaked into production.
12. Not ported: SiteRelay's templates and copy-week (RotaFlow's `repeat` stays, as planned), its summary and shift
    history views, and its own leave and availability endpoints (RotaFlow has its own).

**Evidence (local, 30 October 2026)**

- `pnpm run check` exit 0 before each commit (ESLint, Biome, `tsc`, vitest, build, bundle, migration safety, doc
  counts, export coverage, PHP lint and suites).
- PHP: 1812 assertions, 0 failed (S10 ended at 1755; + 18 in `235-scheduling-rules`, + 39 in `240-scheduling`).
  `240` covers: flag off (403 `feature_off`, staff 403, stranger 404, nobody 401; a double-booked rota still
  publishes; the leave response unchanged), each warning landing on the right shift (rest, unavailable, leave,
  weekly hours across the March 2029 clock change), limits from Settings (0 rest, 60 hours), overlap in the preview
  and 409 on publish (in-rota and against a published rota elsewhere), a cancelled shift no longer clashing,
  warnings not blocking, amendment comparison (unchanged, new, removed) without clashing with its own original,
  patterns (roles, validation, preview writes nothing, overlap and duplicate skips, open shifts, 06:00 across the
  clock change, a 2-on-2-off cycle, warnings in the result, published rota refused, 92 days and 500 shifts, audit),
  leave clashes (published and draft, rejection empty), flag off again, and a missing flag row reading as off.
  The access sweep (`099`) covers both new routes.
- Mutation checks (each made the suite fail, then reverted): publish no longer refusing an overlap; the PHP rest rule
  looking only at the last gap; the amendment context counting the rota it replaces; the flag gate removed;
  'available' availability counted as unavailable; the TypeScript rest rule looking only at the last gap; pending
  leave counted as a clash in TypeScript.
- vitest: 1719 tests in 120 files (S10 ended at 1690): `zonedTime.test.ts` 8, `schedulingRules.test.ts` 17,
  `SchedulingTools.test.tsx` 4 (assign panel absent while off and present but not blocking while on; publish
  check lets warnings through and stops at a double-booking). Bundle 723.5 KiB of 760 (was 713.9); the two dialogs
  are their own chunks.

**NOT TESTED**

- Any S11 screen in a browser against a running API (shapes matched by reading the handlers). The Generate pattern
  and "shifts to cover" dialogs have no component test.
- Migration 016 on MariaDB 11.4 (the live version); only the local 13.0.2 test database ran it.
- The preview on a large organisation (500 shifts, many people): the context query is capped at 5000 rows and has
  not been timed.
- Two managers generating patterns into one rota at once (the rota row lock serialises them; no concurrency test).
- Playwright.

## 2026-10-31: S12 (R2), cover: absence reports, cover requests, eligibility on claim, swaps that void

Branch `r2/s12-cover` from `r2/s11-scheduling` (df2adc0), local commits only. Nothing pushed or deployed.
Spec: `docs/RESTRUCTURE-PLAN.md` section 4, "S12 Cover". Ported from SiteRelay's `Cover` module, `030-cover` and
`095-workflow` suites (read only), re-made for RotaFlow's rotas, staff records and roles.

**What changed**

- Pure rules first (commit S12a): `backend/src/CoverRules.php` and `src/lib/coverRules.ts` (eligibility reasons,
  candidate ranking, swap fingerprint and staleness), with mirrored cases in suite `245-cover-rules` and
  `coverRules.test.ts`. Leave, availability, rest and weekly hours are S11's `SchedulingRules`, not a second copy.
- Migration `backend/migrations/017-cover.sql` (additive): `cover_absences`, `cover_requests`, `cover_applications`;
  `shift_swaps.shift_fingerprint` and `shift_swaps.void_reason`; the `cover_tools` flag seeded **off**.
- `backend/src/Mod/Cover.php`: the 14 routes of the plan; `Cover::assess` (the eligibility service, which reads
  `Compliance::eligible` for documents); `Cover::cron` (the sweep) in the existing one-minute runner.
  `Swaps`: the claim's eligibility check and the swap voiding, both only while the flag is on. `Gdpr::eraseStaff`
  removes what the person wrote in absence reports and applications.
- Front end: `/app/cover` (staff view and the manager's cover board with candidates), the Open shifts card, and the
  rail row. All of it only while the flag is on.

**Decisions where the spec met the code (the safer option taken)**

1. **The eligibility check on the instant open-shift claim is behind the flag.** It changes existing behaviour (a
   person on approved leave, declared unavailable or without a required document could claim before). Off, the claim
   is exactly as before, proved in suite 250 (a person on leave still takes a shift) and by a mutation that took the
   check out from behind the flag. Making it unconditional is an owner decision.
2. **Swaps did not auto-void in RotaFlow (verified first).** `Swaps::decide` only refused a shift no longer held by the
   requester or on an archived rota; a change of time or site, a cancellation or a started shift went through. With the
   flag on, a swap remembers a fingerprint of its shift (times, site, holder, status, rota) and is cancelled when that
   changes, the shift is cancelled, its rota is archived or it starts: on respond, claim and decide (409 `swap_void`)
   and by the sweep. A voided swap is `status: cancelled` with `void_reason`, not a new status value, so every
   existing swap screen and filter keeps working. The fingerprint is recorded on every new swap (never returned), so
   turning the flag on later protects swaps raised before; swaps from before migration 017 are judged on the rest.
3. **"Only that shift is published."** RotaFlow has no separate published projection: a shift on a published rota is
   what staff see, so a cover write changes that one row and nothing else on the rota (tested by comparing every other
   shift before and after). SiteRelay's "unpublished changes" refusal becomes **409 `open_amendment`**: a published
   week with an open amendment is not changed here, because publishing the amendment would silently undo the cover.
4. **Leave and declared unavailability block cover** (the plan lists them in eligibility); short rest and a long week
   stay warnings, as S11 decided that warnings never block. Candidates and offers show both.
5. Overlap is read against committed shifts (published rotas and shifts with no rota), as S11 does. The claim keeps its
   existing, broader `already_working` check first, so with the flag on a claim is never looser than before.
6. **A shift with an open cover request cannot be instantly claimed** (409 `cover_request_open`): the manager asked to
   choose. Open shifts with no request keep first come, first served (with eligibility).
7. **Lock order.** Every cover writer, the claim (flag on), and swap decide/reassign/voiding (flag on) take the
   organisation row first. A mutation removing it from approval produced a real deadlock (`1213`) under the two-approval
   race, so the rule is load-bearing. Cover never locks rota rows (the person's shifts are locked by id only), because
   publishing locks a rota first.
8. Any member with a staff record may report absence and apply (an owner or manager who works shifts too); owners and
   managers decide, as the plan says. A platform support session keeps its usual manager reach here (the plan names no
   Super Admin exclusion, unlike S10); a `read` session cannot write.
9. The documents check applies whenever the organisation has required document types, whatever the `staff_documents`
   flag says; those types can only be created while that flag is on, so with it off nobody is blocked by documents.
10. Manager writes respect the billing read-only state; staff reports and offers do not (as S10's uploads).
11. Cover notices are type `swap`, so they follow the organisation's existing swap matrix (no new matrix key); offers
    go to at most 50 eligible people with a login.
12. Erasure keeps the cover records with the rota history but replaces absence reasons with `(removed)` and clears
    application notes: a reason for not working can be about health.
13. Not ported: SiteRelay's own two-way swaps (`take_shift`), its swap-options view and its published projection.
    RotaFlow's swaps and claim stay, as the plan says; the swaps UI is unchanged.
14. The plan's cron sweep runs in the existing `bin/cron.php` (no new line). It also closes pending applications on
    shifts that are no longer open, and records `filled_elsewhere` when a shift with an open request was filled by
    another route.

**Evidence (local, 31 October 2026)**

- `pnpm run check` exit 0 before each commit (ESLint, Biome, `tsc`, vitest, build, bundle, migration safety, doc
  counts, export coverage, PHP lint and suites).
- PHP: 1917 assertions, 0 failed (S11 ended at 1812; + 29 in `245-cover-rules`, + 76 in `250-cover`). `250` covers:
  flag off (403 `feature_off`, stranger 404, nobody 401; the claim, a swap whose shift changed, a leave decision and
  the cron job all exactly as before; no new keys in swap responses), absence reports (reason, own shift only, once
  while open, withdraw, dismiss), requests (deadline, only that shift changes, the report closed, offers counted, one
  per shift, draft rota refused, open amendment refused), candidates (each reason, eligible first), the open list,
  applications (leave, absentee, documents refused; apply, withdraw, reapply on the same row), approval (filled,
  others turned down, notices, audit, idempotent 409), eligibility re-checked at approval (leave added after applying),
  assignment (overlap refused, unknown person 422, filled once), reject, cancel, the claim's new refusals, swap voiding
  (changed, answered, claimed after start without a fingerprint, swept by cron, an unchanged swap still approves), the
  sweep closing a started request and its offers, erasure, tenancy with the module on in both organisations, flag off
  again, and a missing flag row reading as off. **Concurrency** (separate PHP processes on their own connections,
  `backend/tests/concurrent-call.php`): three claims on one shift at the same instant (exactly one 200), two approvals
  for one shift at the same instant (exactly one), and a claim and an approval each shown waiting on the organisation
  lock BEFORE touching the shift row (a third connection can still lock the shift with `NOWAIT`), then going through.
  The access sweep (`099`) covers every new route.
- Mutation checks (each made a suite fail, then reverted): the claim without the organisation lock; the approval
  without the organisation lock (deadlock and the wait test); the approval without the eligibility re-check; the claim
  check taken out from behind the flag; swap staleness disabled; the PHP absentee reason removed; the TypeScript leave
  reason demoted to a warning. One did not bite and is recorded as belt-and-braces: removing `staff_profile_id IS NULL`
  from the fill's UPDATE, which the shift lock and the open check already guarantee.
- vitest: 1742 tests (S11 ended at 1719): `coverRules.test.ts` 16, `CoverPage.test.tsx` 2 (dark while off; a report
  becomes a request for that shift), `OpenShiftsCover.test.tsx` 3 (unchanged while off; a requested shift points to
  Cover; an ineligible reader is told why), `coverNav.test.ts` 2. Bundle 728 KiB of 760 (was 723.4); the Cover page is
  its own chunk.

**NOT TESTED**

- Any cover screen in a browser against a running API (shapes matched by reading the handlers). The staff half of the
  Cover page and the candidates dialog have no component test.
- Migration 017 and the concurrency cases on MariaDB 11.4 (the live version); only the local 13.0.2 test database ran
  them. Lock waits and deadlock detection were observed there only.
- A publish racing a cover approval (reasoned: cover never locks rota rows; no test).
- Candidates on a large organisation (300 people cap, one documents query per person; not timed).
- The `respond_by` deadline: applying after it is refused, but nothing closes the request at the deadline (it closes when
  the shift starts).
- Notices through real SMTP and a real device; the sweep under the host's cron.
- Playwright.

## 2026-10-31: S13 (R2), timesheets: tolerance flags beside each line, payroll CSV export

Branch `r2/s13-timesheets` from `r2/s12-cover` (fdc36bd), local commits only. Nothing pushed or deployed.
Spec: `docs/RESTRUCTURE-PLAN.md` section 4, "S13 Timesheets". Ported from SiteRelay's `Timesheets` module
(`compute`, `workedMinutes`, `csvCell`, `csv`, `hours`), its `081-timesheets` suite and `logic.ts` (read only),
re-made for RotaFlow's shifts, clock events and per-person period approvals.

**What changed**

- Pure rules first (commit S13a): `backend/src/TimesheetRules.php` (whole minutes from UTC milliseconds, decimal
  hours by integer rounding, the UTC window of local dates via S11's `SchedulingRules::localTs`, clock-event pairing,
  one segment per shift, the flags at the tolerance, the tolerance setting, the CSV) and `src/lib/timesheetRules.ts`
  (chips, the 31-day range, the hours mirror). Suite `255-timesheet-rules` and `timesheetRules.test.ts`.
- Migration `backend/migrations/018-timesheets.sql` (additive): only the `timesheet_tools` flag, seeded **off**. No
  tables (as the plan says). `OrgSettings` accepts `timesheet_tolerance_minutes` (a new `int` rule, 0 to 120).
- `backend/src/Mod/Timesheets.php`: with the flag on, `GET timesheets` gains `lines` and `tolerance_minutes`;
  new `GET timesheets/export` (the payroll CSV). Suite `260-timesheets`.
- Front end (commit S13c): chips beside each line, "Export payroll CSV" (a range dialog; the server's file
  downloaded as is via a new `apiClient.getFile`), Settings, Policies "Timesheet flags". All only with the flag on.

**Decisions where the spec met the code (the safer option taken)**

1. **The flags live in the list response; the approved figure does not change.** The plan says "flags computed in the
   existing list response", but RotaFlow's list returns per-person period rows, not lines. With the flag on the
   response gains a `lines` array beside the unchanged `timesheets`; off, the response is byte-for-byte the old shape
   (suite 260 checks the keys). The approval figure is still the one the page computes and sends; the server's lines do
   not replace it (changing what goes to payroll is out of scope and would need its own soak).
2. **One CSV row per approved period, not per line.** SiteRelay approves each line; RotaFlow approves a person's period
   (`timesheets.total_minutes`), so that is the figure payroll must get. Each row carries the approved minutes and
   hours, who approved it and when, whether a clock correction after approval needs a recalculation, and counts of
   late, early finish and overtime lines in that period. A period is exported only if it lies wholly inside the range.
3. **"Approved only" includes `exported`** (the S5 status that means approved and sent; nothing sets it yet), and
   **reading the export changes nothing**: a GET does not mark periods exported. Whether exporting should lock or mark
   periods is an owner decision. (Decided 31 Oct 2026: `POST timesheets/export` marks; the GET stays read-only. See
   "S13 follow-ups".)
4. **No money in the CSV.** The plan names minutes and hours, not pay; RotaFlow's pay rates can change inside a period
   and the payroll system applies them. Hours are written from whole minutes by integer rounding (half up to two
   places), so there is no float drift (checked for every minute from 0 to 6000, both sides).
5. **Breaks.** The plan's "scheduled break deducted both sides" is followed, except that an organisation with
   `breaks_are_paid` true (an existing Policies setting) deducts nothing. Clocked breaks (`break_start` / `break_end`)
   are not used for the flags; the page's own paid-hours figure still uses them, as before.
6. **Whole minutes at the tolerance, both ways.** Late means the clock-in is more than the tolerance in whole minutes
   after the start (10 min 59 s is 10, not late at 10); early finish the same before the end; overtime when recorded
   minutes exceed scheduled by more than the tolerance. SiteRelay measured early finish in seconds; the two are made
   consistent here.
7. **Which shifts are lines.** Not cancelled, with a staff record, on a published or archived rota or on none: what
   staff are working to. Draft-rota shifts get no line (and no chip) even though the manager's page lists them.
8. **Matching clock events to shifts** follows the page's existing rule (a clock-in from three hours before the start
   to the scheduled end, closest to the start), with one tightening: a clock-in answers for one shift only, so a split
   day cannot make the second shift look on time. Events are read up to 12 hours after the last shift ends.
9. **A platform support session cannot export payroll** (403), as S10 refused documents: the file is pay data leaving
   the product. It can still read the timesheet list, as before.
10. **The old browser "Export CSV" is unchanged** (flag on or off): it exports the visible day's rows. The payroll
   export is a separate button. The shared `csv.ts` download code was split (`downloadBlob`) without changing what
   `downloadFile` or `downloadCsv` produce (their tests unchanged and passing). The browser CSV has no BOM; only the
   payroll file has one, as the plan says.
11. Two "late" readings now sit side by side with the flag on: the row status "Late" (the page's existing 5-minute
   rule) and the chip (the organisation's tolerance, default 10). Left as is; aligning them is an owner decision.
   (Decided 31 Oct 2026: with the flag on the row follows the tolerance by the chip's rule; off, unchanged. See "S13
   follow-ups".)
12. Not ported: SiteRelay's per-line approve, adjust (with reason) and unlock, its `ts_approvals` / `ts_events`
   tables, `mine` and `summary` routes, and its "recorded offline" flag (RotaFlow's offline clock events are already
   labelled where they are recorded).

**Evidence (local, 31 October 2026)**

- `pnpm run check` exit 0 before each commit (ESLint, Biome, `tsc`, vitest, build, bundle, migration safety, doc
  counts, export coverage, PHP lint and suites).
- PHP: 2037 assertions, 0 failed (S12 ended at 1917; + 63 in `255-timesheet-rules`, + 57 in `260-timesheets`).
  `255`: worked minutes (break, never negative, floor of the exact milliseconds), instants with milliseconds and
  offsets, hours for known cases and every minute 0 to 6000, the window of a London day on both clock changes (25 and
  23 hours) and a 169-hour week, another zone, the 31-day range, lines across both clock changes (510 and 420 minutes),
  paid breaks, unfinished shifts, every tolerance boundary (10 min, 10:59, 11 min; zero tolerance; early finish;
  overtime; early arrival), the tolerance setting, pairing, matching (split day, once only, the 3-hour and end
  boundaries, closest wins), CSV cells (`=`, `+`, `-`, `@`, tab, CR, comma, quote, newline, leading space, UTF-8,
  `-5` as text and as a number), BOM and CRLF, the column list. `260`: flag off (list keys exactly `timesheets`;
  export 403 `feature_off`, stranger 404, nobody 401; approval unchanged); the tolerance setting (whole number, owner
  only); flag on: the week of 19 to 25 October 2026 by local dates (00:30 BST Monday and 23:30 GMT Sunday in; the
  Sunday before and the Monday after out), cancelled and draft-rota shifts left out, break deducted both sides, the
  3-hour overnight shift across the clock change, late with no clock-out, overtime, no clock-in, early finish, a
  clock-out after the last shift still pairing, 11 minutes late flagged at 10 and not at 15, paid breaks; a person sees
  only their own lines (a filter cannot widen it), no staff record gives none, the other organisation sees none, more
  than 31 days gives `null` lines; the export (MIME, file name, no-store, BOM, CRLF, header equals the documented
  columns, only approved or exported periods wholly inside the range, not other organisations, sorted by last name,
  2430 = 40.50, 7 = 0.12, 61 = 1.02, payroll id, approver name, approved at in local time, recalculation required
  after a correction, flag counts per person and per period, injection neutralised in names and payroll ids, no cell
  in the file starting with a formula character, read-only, audited without personal data, an empty range is the
  header alone); owner may, staff 403, stranger 404, nobody 401, validation 422, 31 days allowed, a live support
  session 403; flag off again. Suite `115-timesheets` (S5) unchanged and passing proves the old behaviour.
- Mutation checks (each made a suite fail, then reverted; 29 in all): pure: late, early finish and overtime `>` to
  `>=`; the hours rounding term removed; minutes rounded instead of floored; the window end as start + 24 h (fails
  both clock changes); `-` and tab removed from the formula characters; paid breaks ignored; the tolerance upper
  bound removed; segment reuse allowed; the 3-hour boundary inclusive; the 31-day cap off by one; no clock-in flagged
  before the end; the BOM removed. Endpoint: the export's role check removed; the support refusal removed; the
  export's flag check removed; the list's flag check removed; `submitted` added to the exported statuses; the range
  test widened to overlap; a member's `staff_profile_id` honoured; the draft-rota filter removed; the cancelled
  filter removed; no-staff-record lines widened; the per-period flag count made per-person; recalculation Yes/No
  swapped; the late clock-out read window removed; the `int` settings rule loosened to accept fractions. Two survived
  on the first run and got tests (per-period counting; the late clock-out window).
- vitest: 1760 tests (S12 ended at 1742): `timesheetRules.test.ts` 12, `TimesheetFlags.test.tsx` 4 (no chips and
  only the old Export CSV without the flag props; chips in order; the range dialog refuses 32 days and exports the
  chosen dates), `apiClient.test.ts` + 2 (`getFile`). Bundle 728.6 KiB of 760.

**NOT TESTED**

- Any timesheet screen in a browser against a running API, and the CSV opened in Excel, Numbers, LibreOffice or a
  payroll importer (the file was checked byte by byte and parsed with PHP's `str_getcsv` only).
- `Content-Disposition` is `inline` (the shared raw responder); the browser download names the file itself, so this
  is cosmetic, but a direct link would open rather than save. (Fixed 31 Oct 2026: `attachment`, see "S13
  follow-ups".)
- Migration 018 on MariaDB 11.4 (the live version); only the local 13.0.2 test database ran it.
- Lines for a large organisation (5000-line cap, one events query; not timed) and a 31-day export near that cap.
- A shift whose site is in a different timezone from the organisation: windows and the CSV use the organisation's zone.
- Playwright.

## R2 gate: S10 to S13 (summary for the owner)

All four R2 slices are built on stacked local branches (`r2/s10-compliance` -> `r2/s11-scheduling` -> `r2/s12-cover`
-> `r2/s13-timesheets`), local commits only, nothing pushed or deployed. Each ships dark behind its own feature flag,
seeded **off** and enforced on the server (403 `feature_off` after the membership check; existing routes answer
exactly as before while off, each proved by tests). The release decision (once per module or once for all) is the
owner's, per `docs/RESTRUCTURE-PLAN.md` ("R2 gate").

| Slice | Flag (seeded off) | Migration (additive) | New routes | Suites |
| ----- | ----------------- | -------------------- | ---------- | ------ |
| S10 Compliance | `staff_documents` | `015-compliance.sql`: `document_types`, `document_reminders`, `documents` review columns (default approved) | 13 org routes + the signed `/document-files` link | 230 |
| S11 Scheduling | `scheduling_tools` | `016-scheduling.sql`: the flag only (limits are existing settings keys) | `rotas/{r}/publish-preview`, `rotas/{r}/patterns/generate`; publish and leave decision changed with the flag on | 235, 240 |
| S12 Cover | `cover_tools` | `017-cover.sql`: `cover_absences`, `cover_requests`, `cover_applications`; `shift_swaps.shift_fingerprint`, `void_reason` | 14 cover routes; swaps changed with the flag on; the open-shift claim's eligibility check **always** on (owner decision) | 245, 250 |
| S12d Two-way swaps | `two_way_swaps` (needs `cover_tools` too) | `019-two-way-swaps.sql`: `shift_swaps.take_shift_id`, `take_fingerprint`, index, FK | `swaps/options`; `POST swaps` gains `take_shift_id`; decide moves both shifts | 245, 265 |
| S13 Timesheets | `timesheet_tools` | `018-timesheets.sql`: the flag only (tolerance is a settings key) | `GET timesheets/export` (read-only) and `POST timesheets/export` (marks exported); the list gains `lines` with the flag on | 255, 260 |
| Follow-ups (31 Oct) | none new | `020-timesheet-reopenings.sql`: `timesheet_reopenings` | `GET open-shifts` gains `my_eligibility` (always); with `timesheet_tools` on an exported period is final (approve and submit 409 `already_exported`), owner reopen with a reason | 099, 255, 260, 270 |

Migrations 015 to 020 are all additive (019 sits after S13's 018 because S12d was decided after S13; 020 adds
`timesheet_reopenings` for the S13 follow-up "1b"). One behaviour is not behind a flag, by the owner's decision: the
instant open-shift claim refuses a person who is not eligible (approved leave, declared unavailability, a missing
required document, the absentee, a clash) whatever `cover_tools` says, and platform support sessions are refused on
every cover route. Following from it (owner decision, 31 Oct 2026), the open-shifts list carries the caller's own
eligibility (`my_eligibility`) whatever `cover_tools` says, and the card shows the reasons with Take it disabled.

No new cron line and no new private config in any R2 slice: S10's reminders and S12's sweep run in the existing
`bin/cron.php`.

**Owner decisions still open across the four slices**

- When to turn each flag on (after the local-live walk below), one at a time or together.
- S10: confirm the host's PHP `post_max_size` and `upload_max_filesize` are at least 15M (10 MB documents); decide how
  long withdrawn and rejected documents are kept (`docs/SECURITY.md`); at cutover, move Supabase `documents` rows and
  their Storage files into `~/rotaflow-private/uploads/staff-documents/<org>/<staff>/`.
- S11: whether ordinary shift writes (not only publish and patterns) should refuse a double-booking on the server;
  confirm the daily-rest reading (a continuous 11 hours in the 24 hours before a shift, SiteRelay's).
- S12: the three questions are decided and built (eligibility on the claim always on; platform support refused on
  cover; two-way swaps ported behind their own flag): see "S12 follow-ups" below.
  **Decided 31 Oct 2026 and built** (see "S13 follow-ups" below): the reasons a claim would be refused for show
  before the click, with `cover_tools` on or off (`my_eligibility` on the open-shifts list); `two_way_swaps` **keeps
  its own flag** (no change: it works only with `cover_tools` on as well, as migration 019 records).
- S13: confirm the CSV columns with the payroll system in use (still open). **Decided 31 Oct 2026 and built** (see
  "S13 follow-ups" below): exporting marks the approved periods `exported` (`POST timesheets/export`; the GET stays a
  read-only preview); the row status "Late" follows the tolerance (default 10) only while `timesheet_tools` is on,
  the old 5 minutes while it is off; the file downloads as an attachment named
  `rotaflow-timesheets-<org-slug>-<start>-<end>.csv`; with the flag on an exported period cannot be approved or
  submitted again until an owner reopens it with a reason ("1b").
- All: migrations 015 to 020 rehearsed against the live MariaDB 11.4 structure at cutover prep (only the local 13.0.2
  test database has run them).

**What the local-live walk-through must cover** (the branch against the live API on `https://local.rotaflow.space`,
real Clerk sign-in, one organisation with each flag turned on in the console in turn, as owner, manager, staff and a
platform admin with a support session)

- Every R2 screen with its flag off first (nothing new visible, old screens unchanged), then on.
- S10: upload, submit, review (four eyes: the uploader cannot approve; owner can), withdraw, supersede, the queue and
  summary, the eligibility chip; a real 10 MB file; a reminder after moving a test document's expiry near.
- S11: assign warnings as you type, Before you publish with a double-booking (refused), Generate pattern across the
  last Sunday of March or October, leave approval listing shifts to cover.
- S12: report absence, open a cover request, offers and candidates with reasons, approve and assign, two people taking
  one open shift at once, a swap voided by moving its shift, the support session refused on every cover screen; with
  `cover_tools` off, a person on leave sees the reason on the open-shift card with Take it disabled, before any click.
- S12d: offer a shift asking for one in return, the colleague accepts, a manager approves and both rota cells change;
  move one of the two shifts and see the swap cancelled; turn the flag off with one waiting and approve it.
- S13: chips on a week with late, early and over lines, the tolerance changed in Policies (the row status "Late" moves
  with it; with the flag off it is the old 5 minutes), the payroll CSV opened in the real spreadsheet and payroll
  importer (check the BOM, names with accents, a name starting with `=`), a period corrected after approval showing
  "Recalculation required"; approve an exported week (refused with the sentence), reopen it as a manager (refused) and
  as the owner with a reason, approve the corrected figure and export again; export twice and read the two messages
  (marked, then none new), the second file's Status column saying `exported`; `curl -OJ` with a bearer token against
  `GET timesheets/export` saving the file under its `rotaflow-timesheets-...csv` name, and the in-app download keeping
  that name in Safari, Chrome and Firefox.
- Platform support session: the documents, cover and payroll export refusals.
- Shapes: any screen whose request or response does not match the PHP handler (matched by reading, never in a browser).

## 2026-10-31: S12 follow-ups (owner decisions), on branch `r2/s13-timesheets`

The owner decided three S12 questions on 31 October 2026 (relayed by the coordinator). Each is its own commit on
`r2/s13-timesheets`, after the S13 commits.

**1. The instant open-shift claim checks eligibility whatever the `cover_tools` flag says.**

- `Swaps::claimOpenShift` always takes the organisation lock first (the S12 order), then runs the existing checks,
  then `Cover::assess` (active, not double-booked, not the absentee, approved leave, declared unavailability,
  documents via `Compliance::eligible`, which only blocks when the organisation has required document types):
  409 `not_eligible` with every reason in one sentence. `cover_request_open` stays behind the flag (cover requests
  only exist while it is on).
- Suite 250's flag-off cases now prove the new behaviour: with the flag off, a person on approved leave and a person
  missing a required document are refused and the shift stays open; an eligible person takes it even with an open
  cover request on it; at the end ("off again") the same; and a flag-off claim is shown waiting on the organisation
  lock before it touches the shift row (a third connection can still lock the shift with `NOWAIT`). Suite 110 (open
  shifts, S5) passes unchanged: nobody there is ineligible.
- Mutation checks (each failed suite 250, then reverted): the eligibility check put back behind the flag; the
  organisation lock put back behind the flag (caught only by the new flag-off wait test, which was added after it
  first survived); `cover_request_open` taken out from behind the flag.
- The Open shifts page shows the server's sentence on a refused claim (as it already did for `already_working`);
  with the flag off it does not show the reasons before the click (that view reads the cover routes). NOT TESTED in a
  browser. (Since 31 Oct 2026 it does, flag on or off: `my_eligibility`, see "S13 follow-ups".)

**2. Platform support sessions are refused on every cover route.**

- `Cover::access` (which every one of the 14 cover routes goes through, reads and writes) refuses a support session
  with **403 `forbidden`** right after the membership check and before the flag, so it holds with the flag on or off.
  Same code as S10's staff documents; the sentence names cover ("Platform support has no access to cover or absence
  records") rather than repeating S10's "staff documents", which would mislead the reader. A support session still
  reaches ordinary routes (the sweep checks `GET locations` answers 200 in the same session).
- Access sweep (`099`) rows: with a live `read_write` support session and the flags on, every org route under
  `/cover`, `/documents`, `/compliance` and `/timesheets/export` (24 routes) answers 403 `forbidden`; with
  `cover_tools` off, cover still answers `forbidden`, not `feature_off`.
- Mutation checks (each failed suite 099, then reverted): the refusal removed; the refusal moved after the flag.

**3. Two-way swaps (S12d), ported from SiteRelay.**

Four commits: pure rules (S12d-a), backend (S12d-b), front end (S12d-c), docs (S12d-d). SiteRelay's model
(`shift_swaps.take_shift_id`, `swap-options`, `approveSwap` moving both shifts with `requireEligible` both ways and
`staleReason` on both) re-made on RotaFlow's own swaps.

- **Flag: its own, `two_way_swaps`, seeded off, and it works only with `cover_tools` on as well** (the safer of the
  two choices offered): cover can go live without two-way swaps getting their soak, and two-way swaps never run
  without the organisation lock, eligibility and staleness rules they rely on. Recorded in migration 019.
- **The data decides once one exists.** A two-way swap raised while the flags were on is always guarded (either shift
  changed or started cancels it, on the colleague's answer and the decision) and always moved whole, even if a flag is
  turned off afterwards; `reassign` refuses it (`swap_two_way`). Without that, turning a flag off could have moved one
  shift and not the other. With the flags off a new swap cannot ask for a shift in return (403 `feature_off`), the
  options route is 403, and one-way swaps answer exactly as before (no new keys; suites 110, 250 and 265).
- Raising one locks the organisation, then both shifts in id order (the same order as approval, so two writers never
  deadlock on a pair). Both shifts must be on a published rota, not started or cancelled, held by the right people;
  neither may already be in a waiting swap. Eligibility is checked both ways, each person ignoring the shift they give
  up (`Cover::assess` gained an ignore list), so two overlapping shifts can be exchanged. It is re-checked at approval.
- Not ported: SiteRelay's swap screens (RotaFlow's Swaps page gains one optional field and a second shift on the row),
  its `withdrawn` / `declined` / `void` statuses (RotaFlow keeps `cancelled` with `void_reason`, as S12 did), and
  two-way swaps on the open board (an exchange needs a named colleague).
- Evidence: suite 265 (50 assertions): flags off (403, nothing written; one-way swaps unchanged with no new keys); one
  flag on is not enough; options (colleagues, never own, draft, cancelled or started shifts, only times, site and
  holder, no staff record); raising (colleague required; six invalid asks 422; another organisation's shift 422;
  nothing written by refusals; 201 with the shift asked for and no fingerprints; the colleague told; swap_pending on
  either shift; options drop a shift in a waiting swap; ineligible colleague and ineligible requester 409; overlapping
  shifts exchanged); visibility (the colleague and the manager see it, a third person does not, nobody claims it);
  approval moves both, both audited, idempotent; reassign refused; the requester finalises an accepted one; staleness
  of the shift asked for (changed, given to someone else), of the shift offered, and the sweep (started); eligibility
  re-checked at approval (leave approved since); with the flags turned off afterwards an existing one still moves both,
  is still voided, is guarded on the colleague's answer, and can be rejected; two managers approving at once (one
  approves, one finds it decided, moved exactly once); tenancy. Suite 245 + 4 (pure), `coverRules.test.ts` + 4,
  `TwoWaySwaps.test.tsx` 4 (the dialog without options submits exactly the old draft; with them, the shift in return;
  rows with and without `takeShift`).
- Mutation checks (each failed a suite, then reverted; 14): pure: a change on the take side not winning; the holder
  check; the published-rota check. Backend: the second shift not moved; the eligibility re-check at approval removed;
  the take shift's staleness ignored; the decision's organisation lock and guard tied back to the flag; the flag check
  on raising removed; the reassign refusal removed; the options' "already in a swap" filter removed; the ignore list
  dropped; `twoWayOn` without cover; the swap_pending refusal removed; the respond guard tied back to the flag (the
  last two survived first and got tests). The organisation lock on raising has no test of its own (approval's lock and
  the two-approvals race are tested).
- NOT TESTED: any of it in a browser against a running API; two people raising exchanges over the same pair of shifts
  at the same instant (the organisation lock serialises them; not raced in a test); offline queueing of a two-way
  request (the queued item carries `take_shift_id` and replays through the same call, by reading only); MariaDB 11.4
  for migration 019 (`ADD CONSTRAINT ... FOREIGN KEY IF NOT EXISTS` ran on the local 13.0.2 only).

## 2026-10-31: S13 follow-ups (owner decisions), on branch `r2/s13-timesheets`

The owner said yes to five follow-ups on 31 October 2026 (relayed by the coordinator). Local commits on
`r2/s13-timesheets` after the S12 follow-ups; nothing pushed. No migration (019 is still the last), no new flag.

**1. Exporting payroll marks the periods it contains `exported`, so payroll is not paid twice.**

- Choice: **`POST /orgs/{o}/timesheets/export`** `{period_start, period_end}` beside the unchanged GET (the cleaner of
  the two offered: the method says it writes, the path and the file stay one thing; a `mark=1` flag on a GET-shaped
  route would have made a write depend on a query parameter). The GET stays a read-only preview.
- One transaction: the organisation row locked first (the R2 lock order, `Cover::lockOrg`), then the included
  timesheet rows (`FOR UPDATE`, id order), then the file is built and **exactly the included `approved` periods**
  become `exported`. Already-exported periods stay so and are still in the file.
- Choice for flagging what was exported before: **the existing Status column**, read as the period stood when the
  export began (`approved` = marked by this file, `exported` = sent before), so the column list payroll imports is
  unchanged; plus two response headers, `X-RotaFlow-Marked-Exported` and `X-RotaFlow-Already-Exported`, which the page
  uses for its message ("Payroll CSV downloaded. 3 periods marked as exported. 1 period in the file had been exported
  before.").
- Owners and managers with a writable membership; a platform support session 403 `forbidden` (as the GET); behind
  `timesheet_tools` (403 `feature_off`, a stranger 404). Not refused for read-only billing: staff still have to be paid.
  Audited `timesheet.exported` with `{period_start, period_end, rows, marked, already_exported}`, no names or ids.
- Front end: the payroll button uses the marking route (`apiClient.postFile`, the POST twin of `getFile`, which also
  exposes response headers), the dialog says that downloading marks the periods, and the page reloads after marking.
  An `exported` period now counts as signed off on the Timesheets page (`isSignedOff`), so it is never offered for
  approval again (before, nothing set `exported`, so this changes nothing with the flag off).
- Unchanged and worth knowing: an exported period stays locked against a new submission (`timesheet_locked`) and is
  still flagged by a clock correction (`Clock` already covered `exported`). `POST timesheets/approve` on an exported
  period still puts it back to `approved` with `version + 1` (the S5 behaviour, through the API only; the page no
  longer offers it), so the next export includes it again with the new version. Whether approve should refuse
  exported periods is left for the owner. (Closed the same day, "1b" below: with the flag on it refuses them.)

**2. The row status "Late" follows the tolerance, only with `timesheet_tools` on.**

- `TimesheetRules::isLate` / `lateMinutes` (PHP) and `isLate` / `lateMinutes` (`src/lib/timesheetRules.ts`): more than
  the tolerance in whole minutes, the floor of the exact difference; the server's late flag now goes through it. The
  page passes the organisation's tolerance to `buildTimesheetDayRows` only while the flag is on
  (`lateToleranceFor`); off, nothing is passed and the old rule runs untouched (rounded minutes, more than 5). With the
  flag on the "N min late" label is the same whole-minute figure as the chip. The page reads the tolerance from the
  organisation as well as from the lines response, so a failed lines read does not fall back to 10 silently.

**3. Staff see why a claim would be refused before they click, whether or not `cover_tools` is on.**

- Choice: **a field on the existing list**, `my_eligibility{eligible, reasons[{code, message}]}` on every row of
  `GET /orgs/{o}/open-shifts` (no new endpoint, no second round trip). The reasons are the claim's own
  (`inactive`, `absent`, `overlap`, `leave`, `unavailable`, `documents`, with the same sentences); `null` for a member
  with no staff record (a support session included). `clashes_with_mine` stays as it was.
- `Cover::assessShifts` reads only the caller's records (their shifts, leave, availability, active flag, absences and
  documents), one query per kind of fact for up to 500 shifts, documents once per local date; the pure rules then
  filter by person again. It never locks: the claim re-checks under its locks.
- The open-shift card shows the reasons and disables Take it (the reason is also on the button's title). A shift that
  only clashes keeps its "Clashes with your rota" badge as before; with `cover_tools` on, the cover row still wins.

**4. Two-way swaps keep their own `two_way_swaps` flag.** No change to code: it works only with `cover_tools` on as
well (S12d, migration 019). Recorded here and in the R2 gate.

**5. The CSV downloads as an attachment.** Both export routes send `Content-Disposition: attachment;
filename="rotaflow-timesheets-<org-slug>-<start>-<end>.csv"` (`TimesheetRules::exportFilename`: the stored slug
lower-cased, anything but `a-z`, `0-9` and `-` becomes `-`, runs collapse, at most 60 characters, `organisation` when
empty; mirrored by `payrollFilename` for the browser's fallback). The raw-response headers are now built by
`Api::rawHeaders`, which `backend/public/api/index.php` writes as is, so the suites test the real header lines. Every
other raw file (calendar feed, photos, documents) stays `inline` exactly as before; the file name keeps the old
character rule; extra headers pass only as `X-RotaFlow-*` with plain ASCII values.

**Evidence (local, 31 October 2026)**

- `pnpm run check` exit 0 before each commit (ESLint, Biome, `tsc`, vitest, build, bundle, migration safety, doc
  counts, export coverage, PHP lint and suites). PHP 2149 assertions, 0 failed (2097 before: `255` + 6, `260` + 23,
  new `270-open-shift-eligibility` 18, `099` + 5). vitest 1788 (1768 before). Bundle 731.6 KiB of 760 (730.9 before).
- `260`: the POST off (403 `feature_off`, stranger 404, nobody 401) and off again; staff 403; validation 422 with
  nothing marked; the GET still read-only; the POST returns byte for byte the file the GET gave a moment before;
  Status `approved, exported, approved`; the headers exactly (attachment, name, both counts); exactly the included
  approved periods marked and nothing else (a fortnight starting before, later weeks, a submitted period, another
  organisation); figures, versions and approvers untouched; audit metadata exactly the five keys; idempotent (0
  marked, all `exported`); the exported period locked against submission; the owner may; an empty range; **two
  marking exports at the same instant** on their own connections (both 200 with both periods, one marks 2 and the
  other 0, each period exported once, two audits); the export **waiting on the organisation lock before it locks any
  timesheet row** (a third connection locks the period with `NOWAIT` while it waits), then marking; a support session
  refused with nothing marked. `Api::rawHeaders`: an attachment for the export, `inline` for the calendar feed and a
  photo, a file name that cannot break its quotes, extra headers filtered.
- `255`: `isLate` and `lateMinutes` at every boundary (mirrored case for case in `timesheetRules.test.ts`); file
  names (clean slug, hostile slug, none, all non-ASCII, the 60-character cap).
- `270`: with `cover_tools` off, leave, declared unavailability, a missing document (on every shift), a clash, the
  absentee and an inactive record each give their reason; for every person and every shift the reasons equal
  `Cover::assess` (the claim's own check); the claim refuses with the same sentence; an eligible colleague's list
  carries no other person's id, name, leave, unavailability, documents or absence (searched in the raw JSON), nor
  does pat's beyond her own leave; a member without a staff record gets `null`; a manager with one sees only their
  own; stranger 404, nobody 401; flag on gives the same answers as flag off. Suites 110, 250 and 265 pass unchanged.
- `099` (access sweep): `open_shifts` never appears in a stranger's or no-organisation user's answer to any route;
  a live support session sees a real open shift with `my_eligibility` `null`; the owner sees one eligibility object;
  stranger, no-organisation user and nobody refused. The support-refusal sweep picks up `POST timesheets/export`
  automatically (25 routes now).
- vitest: `timesheetDayRows.test.ts` + 5 (flag off: exactly the old rule incl. 5 min 30 s rounding to late; flag on
  at 10, 15 and 0; the label; `lateToleranceFor`), `timesheetRules.test.ts` + 2, `timesheetService.test.ts` 5 (new:
  the marking route, the file name fallback, the counts, the message, `isSignedOff`), `apiClient.test.ts` + 3
  (`postFile`; the GET still sends no body), `openShiftService.test.ts` 2 (new: parsing, malformed input),
  `OpenShiftsCover.test.tsx` + 3 (cover off: the reasons and a disabled Take it; eligible as before; a clash only
  keeps its badge).
- Mutation checks (36 tried; each of these 33 made a suite fail, then was reverted). Late: TS `isLate` `>` to `>=`; TS
  `lateMinutes` rounding; the flag-off threshold moved to 10; the flag-off branch flooring; the tolerant branch
  ignoring the tolerance; `lateToleranceFor` ignoring the flag; PHP `isLate` `>=`; PHP `lateMinutes` rounding. Export:
  the organisation lock removed; the lock moved after the period lock; the GET marking; the POST marking nothing; the
  POST marking every approved period of the organisation; the Status column read after marking; the role check, the
  support refusal and the flag check removed; the disposition back to inline; the two count headers swapped; names
  added to the audit; `rawHeaders` always inline, extras unfiltered, the file name unsanitised; `exportFilename`
  without slug cleaning or the length cap. Eligibility: the absentee read for anyone; documents not checked; inactive
  ignored; always eligible; an object for a member without a staff record; the card ignoring the list's eligibility;
  the clash-only overlap filter removed; the service dropping the field. Three did not bite and are recorded as
  belt-and-braces: removing the person filter from `assessShifts`' leave, availability and shift queries (the pure
  rules, `SchedulingRules::leaveHit` / `unavailableHit` and `CoverRules::assess`, filter by person again, so no other
  person's data reaches the answer either way).

**NOT TESTED**

- Any of it in a browser against a running API: the payroll button's message and reload, the open-shift card with the
  reasons, the "Late" row with a changed tolerance.
- The real HTTP headers through Apache/LiteSpeed (`index.php` writes `Api::rawHeaders` exactly, by reading; the suites
  call the API object, not the entrypoint). A **plain link** to the export in a browser carries no bearer token (the
  API's only credential), so it answers 401; `attachment` takes effect for any authenticated client (the app's own
  download, `curl` with a token, or a signed link if one is ever added).
- Two marking exports over **overlapping but different** ranges at once (the organisation lock serialises them; only
  the same range was raced). A marking export racing an approval of a period in its range (row locks order them;
  reasoned, not raced).
- `my_eligibility` timing for an organisation with 500 open shifts (one query per kind of fact plus one documents
  read per local date; not timed). Shifts whose site is in another timezone than the organisation: the same zone rule
  as the claim (the site's zone, else the organisation's), checked only for London.
- The local MariaDB 13.0.2 only; MariaDB 11.4 (live) did not run these suites. Playwright.

**1b. Closing the gap: with `timesheet_tools` on, an exported period is final until an owner reopens it** (coordinator
follow-up, the same day; the owner's reason for item 1 was "stop payroll being paid twice").

- Every route that could change an exported period's status or figures was checked. `POST timesheets/approve` and
  `POST timesheets/submit` now refuse it with **409 `already_exported`**, "This period has been exported to payroll. Ask
  an owner to reopen it if it must change." (a batch with one exported period is refused whole). Approval takes the
  organisation lock first while the flag is on, as the marking export does, so the two are ordered. `POST
  timesheets/{t}/reopen` on an exported period is owner only (a manager gets the same 409; a support session 403).
  A clock correction (`clock-events/{e}/correct`) does not recompute a period: it only sets
  `recalculation_required_at`, as before, and leaves the status and figure alone (tested). Clock-event deletion does
  not touch timesheets; retention deletes whole old periods (not a change of figure).
- The deliberate path (choice: **the existing reopen route**, not a second one, since `POST timesheets/{t}/reopen`
  already exists for managers): on an exported period, with the flag on, it needs `{reason}` (3 to 500 characters)
  and moves it `exported` -> `approved` with `version` + 1, the approval kept, in one transaction with the
  organisation lock first; 409 `not_exported` if someone reopened it meanwhile. The reason is kept in the new table
  `timesheet_reopenings` (migration 020, additive) and not in the audit log; the audit row
  `timesheet.export_reopened` carries `{period_start, period_end, from, to, version}` only. The corrected figure is
  then approved again (version + 1) and the next marking export sends it under the new version. On any other status,
  and with the flag off, the route is unchanged.
- With the flag off nothing changes (proved in `260`): approving an exported period puts it back to `approved` with
  `version` + 1; submitting over it answers `timesheet_locked`; a manager reopens it to `open` without a reason; and
  approval does not take the organisation lock (it answers while another connection holds a shared lock on the row,
  which a flag-on approval waits for).
- Evidence: PHP 2169 assertions, 0 failed (`260` 80 -> 98, `099` 13 -> 15, `115` unchanged). `260` adds: approve
  again 409 with the exact sentence and nothing changed; a mixed batch refused whole even for the owner; a
  non-exported period still approved; manager reopen 409; staff 403, stranger 404; reasons missing, 2 or 501
  characters 422 with nothing written; a clock correction leaving the period exported with its figure and the
  recalculation flag set; the owner's reopen (approved, version 2, approval kept), its reason row, its audit metadata
  exactly; the corrected figure approved (version 3) and exported again; a flag-on approval waiting on the
  organisation lock; an approval and a marking export at the same instant (either order, the period ends exported
  with the figure the file carried); a support session refused; the four flag-off cases. `099`: a support session
  cannot reopen (403) or re-approve (409) an exported period; stranger and no-organisation user 404, nobody 401.
- Mutation checks (12, each made a suite fail, then reverted): the approve refusal removed; the refusal not tied to
  the flag; the approval's organisation lock removed; the submit refusal not tied to the flag; the reopen's exported
  path not tied to the flag; that path removed (managers reopen to open); the owner check removed; the support
  refusal removed (099); the reason not required; the version not bumped; reopen to `open`; the reason put in the
  audit.
- NOT TESTED: an owner reopen screen (there is none: the API takes it; `reopenTimesheet` in the browser service has
  no caller); two owners reopening the same period at the same instant (the organisation lock and the re-read make
  the second answer 409 `not_exported`, or, if it reads after the first committed, the old reopen to `open`; not
  raced); migration 020 on MariaDB 11.4.

## 2026-10-31: Local-live walk (Phase 5), on branch `release/cutover`

**Decision recorded: the cutover ships the full stack with every R2 flag off.** A new branch `release/cutover`, cut
from `r2/s13-timesheets` (f629684: R1, S9 to S13 and every owner follow-up), is what the R1 cutover deploys, with
`staff_documents`, `scheduling_tools`, `cover_tools`, `timesheet_tools` and `two_way_swaps` seeded off, instead of
`move/cpanel-clerk` alone. The flags already give "behaves as before" (each slice is dark on the server while off), and
carrying fixes back across five stacked branches would add risk. Every fix below is on `release/cutover`, local commits
only. The same decision is in `docs/RESTRUCTURE-PLAN.md`, section 2.

**Set-up (local only; nothing reached the server, live Clerk, Stripe or Supabase)**

- Database: the test harness's throwaway MariaDB 13.0.2 on 127.0.0.1:3308, its own database `rotaflow_walk` and user
  `rf_walk`, migrations 001 to 020 applied by the real runner (`backend/bin/migrate.php`). Private config (gitignored)
  in `.local-state/walk-private/config/` names the Clerk DEVELOPMENT issuer `https://discrete-walrus-17.clerk.accounts.dev`
  and the authorised parties `http://localhost:5042` and `http://localhost:5041`.
- Demo data: `backend/bin/seed-demo.php` (LOCAL/DEMO ONLY: refuses a host other than 127.0.0.1/localhost, a database
  whose name lacks walk, demo or test, and a database that already has an organisation). One organisation (Demo Care
  Group, business plan, trial), three sites, five departments, six job titles, fifteen staff with two pay rates each
  (one name starts with `=` for the CSV check, several have accents), four weeks of rotas per care site (the previous
  week holds the clock change on Sunday 25 October 2026; two published, one more published, one draft), open shifts,
  a shift under way at the time of seeding with its clock-in, clock events for last week and this week so far (on time,
  12 minutes late, 20 minutes early, 25 minutes over), last week's timesheets (approved, submitted, open), approved,
  pending, rejected and sick leave, overtime, two pending swaps, availability, three document types and four stored PDF
  documents, an announcement and notifications. `--anchor=YYYY-MM-DD` moves the weeks.
- Sign-in: six Clerk test-mode users on the RotaFlow DEVELOPMENT instance (`owner`, `manager`, `staff`, `staff2`,
  `admin`, `noorg` `+clerk_test@example.com`, code 424242), created once with the Clerk backend API, because Clerk's
  sign-up form never completed headless (its bot protection spinner). The API links each to the seeded user by the
  verified email on first sign-in. `admin` was made platform owner with `backend/bin/grant-platform-owner.php` against
  the local database.
- Servers: `scripts/walk.sh api` (PHP built-in server on 127.0.0.1:3042 through `scripts/walk-router.php`, four
  workers), `scripts/walk.sh web` (Vite on 5042 with `/api` proxied there by `ROTAFLOW_API_PROXY`, the dev Clerk key,
  no Sentry DSN), `scripts/walk.sh preview` (a production build in `.local-state/walk-dist`, never `dist/`, served on
  5041 with the same proxy, for the CSP walk).

**How to run it again**

```
scripts/test-db.sh up && scripts/walk.sh db     # recreate, migrate, seed, grant the admin
scripts/walk.sh api                             # terminal 1
scripts/walk.sh web                             # terminal 2
scripts/walk.sh preview                         # terminal 3, only for csp.walk.ts (it skips itself without it)
pnpm run e2e:walk                               # reseeds first unless WALK_KEEP_DB=1; WALK_FRESH_AUTH=1 signs in again
```

The specs are `e2e/walk/*.walk.ts` with their own config (`e2e/walk/playwright.walk.config.ts`), alongside the
Supabase-era specs in `e2e/` (left as they were: they need a live Supabase and are not part of this release's evidence).
`screens.walk.ts`: every screen as owner, manager and staff (37 each) and as platform admin (16), all flags off and then
all on: no console error, no failed API call, no failure text, one page load per role (client-side navigation).
`actions.walk.ts`: the main actions with flags off. `flags.walk.ts`: each flag off (dark on the server) then on (its
main path in the browser). `csp.walk.ts`: the production policy from `.htaccess` on a production build.

**Results** (Chromium 1248 headless, 31 October 2026; screen x role x flag state)

| Screen | Owner off/on | Manager off/on | Staff off/on | Admin off/on | Evidence |
| ------ | ------------ | -------------- | ------------ | ------------ | -------- |
| Every signed-in screen (first request after sign-in) | FIXED | FIXED | FIXED | FIXED | "We could not load your account": PHP 8.5 prints `curl_close()` E_DEPRECATED before the JSON of the first JWKS fetch. All six `curl_close` calls removed; the entrypoint sets `display_errors` off. Suite `001` (2 checks, failed first) |
| Sidebar on every screen (nav badges, polled each minute) | PASS | PASS | FIXED | n/a | Staff got 403 `GET attention` every minute, reported as errors. On Supabase RLS scoped the count to the caller; now staff get their own counts. Suites `105` (+3), `110` (+2), failed first |
| Support access banner on every screen | PASS | PASS | FIXED | n/a | Staff got 403 `GET support-sessions` every minute. The banner now asks only as owner or manager (the API's rule since S8a). vitest `SupportAccessBanner.test.tsx`, failed first. OPEN decision below |
| Dashboard, Team, Locations, Departments, Rota, Set up, Schedule, Attendance, Clock, Timesheets, Availability, Leave, Swaps, Overtime, Open shifts, Compliance, Cover, Notifications, Help, Approvals, Reports | PASS | PASS | PASS (refusals where the role may not: own views or the app's "not for your role" notice, no failed call) | n/a | `screens.walk.ts` |
| Announcements | PASS | PASS | FIXED | n/a | Staff caused one 403 per announcement (`GET announcements/{a}/reads`, probed then fallen back). The page now says whether the reader manages. vitest `announcementReads.test.ts`, failed first |
| Settings: Organisation, Permissions, Roles, Policies, Document types, Notifications, Billing, Audit | PASS | PASS | PASS (staff sent to their account) | n/a | `screens.walk.ts` |
| Settings: Integrations | PASS | FIXED | PASS | n/a | A manager got "Could not load SMTP settings" and a reported error: the page asked the owner-only `GET smtp` before checking the role (on Supabase RLS returned no row). vitest `SettingsIntegrationsPage.test.tsx`, failed first |
| Account: Profile, Preferences, Security, Tokens, Activity, Your data | PASS | PASS | PASS | n/a | `screens.walk.ts` |
| Console: Overview, Organisations, Users, Subscriptions, Billing, Support, Enquiries, Support access, Audit, Platform health, Incidents, Integrations, Notifications, Feature flags, GDPR | n/a | n/a | n/a | PASS | `screens.walk.ts` |
| Console: Settings | n/a | n/a | n/a | FIXED | Every visit logged an error: the page asked for "my MFA status", which since S9 always rejects (MFA is Clerk's), and showed a Supabase-era second-factor switch. The panel now says two-step is set in the Clerk dashboard; the dead calls are gone |
| Staff documents routes (flag off) | FIXED | FIXED | FIXED | n/a | The R2 gate said every slice is dark on the server while off; S10's routes answered with the flag off (only screens hid). Now 403 `feature_off` after membership, except `GET documents` (the pre-S10 read the rota builder, staff list and rota assistant use for expiring-document warnings with the flag off). Suite `230` (+4, failed first); `flags.walk.ts` |

Actions (`actions.walk.ts`, flags off), all PASS: sign-in with the emailed code and sign-out from the account menu (and
`/app` then sends to `/login`); the no-organisation screen (invitation sentence with the person's address); clock-in made
offline waits ("Offline, 1 waiting"), nothing reaches the server, then it syncs ("Synced") and one event lands; taking an
eligible open shift (confirm dialog, the shift is theirs in the database); staff asking for leave (201) and seeing it on
Leave, refused Reports (the role notice) and refused a leave decision (403); the owner approving leave from Approvals;
the timesheet CSV downloading as a `.csv`.

Flags one at a time (`flags.walk.ts`), all PASS: each off answers 403 (`feature_off`) on its routes; on:
`staff_documents` a person uploads a PDF in the Documents window, cannot approve their own (four eyes), the owner opens
it from the review queue (a new tab on the signed `/api/document-files` link answers 200 `application/pdf`), approves it,
and a tampered signature is refused; `scheduling_tools` the draft week's publish preview answers and the rota builder
loads clean; `cover_tools` staff report they cannot work and the manager's board shows "1 cannot work";
`timesheet_tools` `GET timesheets/export` answers `text/csv` as an attachment named
`rotaflow-timesheets-demo-care-group-2026-10-19-2026-10-25.csv` with a byte-order mark and no cell starting `=Ivan`, and
the in-app "Export payroll CSV" downloads the same name; `two_way_swaps` (with `cover_tools`) `GET swaps/options`
answers; a platform `read_write` support session (consented by the owner) is refused 403 on documents, cover and the
payroll export with the flags off and on, while `GET locations` still answers.

CSP (`csp.walk.ts`), all PASS: the `.htaccess` policy, word for word except `https://clerk.rotaflow.space` replaced by
the development Clerk host, added to every document response of the production build. No violation (the
`securitypolicyviolation` event and the console) while signing in through Clerk, across eight owner screens with the
flags off and on, and on five public pages. The check was shown to bite: with the Clerk host left out, clerk-js is
refused. In dev (Vite) the policy is not served at all, and cannot be: Vite injects an inline script the production
policy rightly refuses. Review of the production policy against what the app loads: the Clerk frontend API (script and
connect), `cdn.protect.clerk.com` and Cloudflare's challenge (script and frame) for Clerk's bot protection, Clerk
telemetry, Sentry's ingest host and `blob:` workers are all named; avatars from `img.clerk.com` fall under `img-src
https:`; documents open in a new tab on the same origin, so no `frame-src 'self'` is needed; nothing else is fetched
cross-origin. No change made to `.htaccess`.

**OPEN (owner decisions)**

- Staff and the support banner: on Supabase every member saw that RotaFlow support was inside their organisation; the
  API has answered that list to owners and managers only since S8a (suite `150` asserts it), so staff no longer see the
  banner. Either restore the member read (one line in `Console::orgSessions` and the `150` check) or keep it.
- Required documents with `staff_documents` off: the open-shift claim's eligibility (always on, by decision) refuses a
  person missing a required document. Document types only exist once the flag has been on; if it is turned off again
  with required types defined, staff cannot upload but are still refused (the card shows "Missing or expired: ...").
  Archive the types before turning the flag off, or make the documents check follow the flag.

**Remaining owner checks (only possible live)**

- Real Stripe: a test-mode checkout, the portal and the webhook at `https://rotaflow.space/api/stripe/webhook` (local
  had no Stripe keys; the billing screens loaded on the seeded trial state only).
- Web push on a real phone (no VAPID keys locally; nothing was sent).
- GPS clock-in on a phone inside and outside a site's geofence (locally: the manual clock-in, and seeded GPS events).
- Real email: invitations, notifications and SMTP test through the platform account and an organisation's own account.
- Google sign-in (off on both Clerk instances; the walk used email codes only).
- `.htaccess` behind Apache and Cloudflare: the `/api` pass-through with the Authorization header and the CSP as served
  (locally the policy was injected by Playwright, and `/api` was proxied by Vite).
- Download names and the CSV in Safari and Firefox and in the payroll importer; a real 10 MB document; PHP
  `post_max_size` and `upload_max_filesize` on the host.

**NOT TESTED**

- Browsers other than Chromium; phone layouts; the PWA service worker and offline cache (the walk ran on Vite dev; the
  existing `pwa-*` specs were not run).
- Clerk's sign-up form (its bot protection never completed headless; the test users were created on the development
  instance through Clerk's API). Invitation acceptance by email link.
- Flows beyond the main path of each R2 module: S11 pattern generation across a clock change and the assign warnings as
  you type; S12 offers, candidates, approve and assign, two people taking one shift at once; S12d accept, approve and the
  void on a moved shift; S13 chips against the tolerance, the reopen with a reason, exporting twice.
- Platform console actions other than opening a support session (pages loaded and were clean).
- The AI assistant (no OpenRouter key locally), reminders and other cron jobs (cron was not run).
- MariaDB 11.4 (the walk used 13.0.2), the live data move from Supabase.
- One PHP test (`210-photos-templates`) prints a PHP 8.5 deprecation for `ReflectionMethod::setAccessible()`; test code
  only, left alone.

**Evidence**: the full walk, `pnpm run e2e:walk` from a fresh seed with the preview server up: **271 passed, 0 failed,
0 skipped** in 6.1 minutes (actions 7, csp 4, flags 6, screens 254 = 37 screens x 3 roles + 16 console screens, each
with the flags off and on). `pnpm run check` exit 0 on the final tree (PHP 2179 assertions, 0 failed). Each fix has a
test that failed before it (named in the table) except the console Settings page, whose fix removes the calls.

## 2026-10-31: Walk follow-ups (owner decisions), on branch `cutover/data-move`

Two OPEN decisions from the local-live walk above, decided by the owner on 31 October 2026 (relayed by the coordinator), each
its own commit.

**1. Staff see the support banner again, as on Supabase.** `GET /orgs/{o}/support-sessions` answers staff (any member below
manager) with the live sessions only: `id, org_id, admin_name, case_ref, reason, scope, granted_at, expires_at`, where
`admin_name` is the agent's name, else their address, exactly what the old banner showed. No history, no agent id or address
field, no revoke reason, no consent switch; owners and managers get the full history as before (now with `admin_name` too,
so the banner names the agent rather than showing an address). The banner asks for every role again; only an owner sees
"End this session". Evidence: suite `150` (+4 checks: staff see the live session, only the banner's fields, an ended
session disappears for staff while managers keep the history, another organisation's member still gets 404); vitest
`SupportAccessBanner.test.tsx` (owner, manager and staff each see it; the end button for the owner only). Mutation checks:
dropping the live-only filter fails "an ended session disappears"; adding `admin_user_id`/`admin_email` to the staff
shape fails "only what the banner shows".

**2. The document check follows the `staff_documents` flag.** `Compliance::eligible` (used by the instant open-shift claim,
`my_eligibility` on the open-shifts list, cover candidates, applications and approvals, and two-way swap eligibility) returns
eligible with no missing documents while `staff_documents` is off for the organisation; with it on, required documents are
checked as before. Every other check (inactive, absent, overlap, leave, unavailable) is unchanged and still always applies.
This closes the walk's OPEN item "required documents with `staff_documents` off": turning the flag off no longer leaves staff
refused for documents they cannot upload. Evidence: suite `250` (+3: a claim with staff_documents off succeeds for a person
missing a required document; leave still refuses with it off; cover candidates show that person eligible with it off and the
other reasons unchanged; the document cases now run with the flag on), suite `270` (+3: my_eligibility clean with it off,
other reasons unchanged, then the document reason with it on). Mutation check: ignoring the flag fails 3 of those checks
(250 x2, 270 x1).

## 2026-10-31: Cutover preparation (Phase 6): the data move, its rehearsal, the runbook, on branch `cutover/data-move`

Prepared, **not run**: nothing reached the server, live Clerk, Stripe, Supabase (no connection at all, not even read),
Cloudflare or GitHub settings. `docs/CUTOVER.md` is the owner's runbook (go/no-go list, steps with checks and rollbacks,
the table map and what does not carry over).

**What was built**

- `backend/bin/datamove.php` + `backend/src/DataMove/` (PHP CLI, chosen because the repo's server code, config loader
  (`Bootstrap::config`), `Db`, `Secret` and `FileStore` are PHP, so the move writes through the API's own private config and
  encrypts and lays out files exactly as the API reads them; PHP on the Mac has pdo_pgsql and pdo_mysql). `plan` (dry run,
  default), `apply` (one transaction per group, FK order, refuses a non-empty target unless `--resume`, never overwrites a
  row that differs), `verify` (counts, SHA-256 per table over every row canonicalised against the target column types, a
  field-by-field sample), `files` (Storage into `<private root>/uploads`, size + MD5 checked, SHA-256 manifest, resumable;
  `--backup=DIR` for the full Storage backup). Source read in one `REPEATABLE READ READ ONLY` transaction; URI and keys from
  0600 files or env, never printed (messages scrubbed). Every value is checked against the target's own column metadata
  (length, enum, range, precision) and every target unique key and foreign key is checked in the dry run.
- `Users::resolve` refuses a session whose optional `email_verified` claim is not true (suite 030 +6: verified only,
  case-insensitive, one account per email, placeholder rows never linked).
- `scripts/cutover/supabase-freeze.sql`, `supabase-freeze-final.sql`, `supabase-unfreeze.sql` (statement triggers that
  refuse writes on every public table; cron jobs paused with their state remembered; exact undo).
- `release.json`, `scripts/release.mjs` (the kit's, byte for byte; excluded from Biome formatting), `.github/workflows/deploy.yml`
  (manual only: push-to-deploy stays off; how to turn it on is in the file and the runbook).

**Evidence** (local, 31 October 2026)

- `pnpm run test:datamove` (`scripts/datamove-test.sh all`, `backend/tests/datamove/run.php`): **64 passed, 0 failed**.
  Source: a throwaway PostgreSQL 17 built from all 164 `supabase/migrations` over a Supabase shim (auth, storage, cron, net,
  vault), seeded by `seed-source.sql` (10,002 shifts across both 2026 clock changes, 1,924 clock events with microseconds,
  3,000 audit rows, 51 people incl. unicode/emoji/`=` names, mixed-case, unconfirmed, Google-only, deleted, banned,
  pending-erasure, legacy-admin; 3 organisations incl. demo and suspended; money in pence; unsafe Storage names; pending
  deletions; rows in skipped tables). Target: MariaDB 13.0.2 on 127.0.0.1:3308, migrations 001-020. Results: plan 0
  errors (4 expected warnings); apply 15,000+ rows; verify every table checksum match, 0 missing, 0 of 3,000+ sampled fields
  differ; second apply refused; `--resume` changes nothing; an interrupted move finished by `--resume` verifies; a tampered
  row is caught by verify and left alone by `--resume`; independent SQL checks on both sides (DST nights 11 h / 9 h, ms
  cut, pence, Stripe ids, unicode, lower-cased emails, SMTP password decrypts, invite token hash, audit mapping, R2 flags off,
  no maintenance mode); first sign-in links by verified email (case-insensitive), a deleted person gets a new empty account;
  `--exclude-demo-orgs`; files: dry run, wrong key, corrupt download refused, resume, re-run, modes 0700/0600, the API reads a
  renamed document byte for byte, verify catches a changed file; the full Storage backup and its resume; a `pg_dump` of the
  data restored into a schema built from the migrations verifies against the moved data; freeze, final freeze, read while
  frozen, unfreeze (cron states restored), unfreeze twice.
- `scripts/datamove-test.sh mariadb-11.4`: the same move on **MariaDB 11.4.13** (Homebrew, the live version) on 3309:
  migrations 001-020 done, plan/apply/verify OK, a second `apply --resume` changes 0 tables.
- Walk on moved data (`scripts/datamove-test.sh walk-db`, then `scripts/walk.sh api` / `web`, `WALK_KEEP_DB=1`):
  `screens.walk.ts` **254 passed, 0 failed** (37 screens x owner, manager, staff + 16 console screens, flags off and on) on
  data that came through the move instead of `seed-demo.php`. `actions.walk.ts`: 4 passed, 1 skipped (no open shift that
  person is eligible for), 2 failed on seed-demo fixtures, not on the move: one expects the leave type text "annual"
  (seed-demo's wording; the synthetic data says holiday/sick), one picks `leave_requests ... LIMIT 1` across all
  organisations and got another organisation's request (404 instead of 403). `flags.walk.ts` and `csp.walk.ts` not run
  (they need seed-demo's documents and the preview build; unchanged code paths). The first run also failed five screens
  on synthetic photo URLs that do not resolve: the overlay now clears them (no app defect).
- Suite `275-datamove-map` (34, in `pnpm run check`): conversion rules, safe storage names, URI parsing and scrubbing, the
  map against the migrated schema and FK order. `pnpm run check` exit 0 on every commit (PHP 2,227+, vitest 1,796).

**Lossy or derived mappings** (also in `docs/CUTOVER.md`, "Table map"): audit ids renumbered (source uuid kept in
metadata), severity `notice` -> `info`, visibility `both` -> `org`; pay-rate `note`/`created_by`; `incidents.is_public`;
platform announcement `channel`; most `platform_settings` columns (branding, MFA/session settings: Clerk's now);
`organisations.last_activity_at`/`is_demo`; invite `accepted_by`; clock times cut to milliseconds, other times to seconds;
`calendar_feed_tokens` (people subscribe again); outbox, deliveries, jobs, health, integrations, IP allow-list, rate-limit
and retention-run logs not moved; deleted/erased/profile-less people kept under unverifiable placeholder addresses;
pending Supabase login deletions closed as abandoned; enquiries marked notified; unsafe file names renamed.

**NOT TESTED**

- Against the real Supabase project (no connection made): its real `auth.users` / `storage.objects` columns (the shim
  follows GoTrue/Storage as of 2026; the dump restore path fails loudly on a column the shim lacks), the session pooler, TLS,
  the real Storage API and service key, the real data's warnings.
- The SSH tunnel to the cPanel MariaDB (the runbook gives the server-side alternative), the live 11.4 server itself (11.4.13
  locally), the runtime user's privileges for the move (SELECT/INSERT/UPDATE on the live grants), cPanel `mysqldump`.
- The freeze scripts in the Supabase SQL editor (tested on PostgreSQL 17 with the shim's cron table; real pg_cron and the
  Supabase roles may differ), the drain finishing within 5 minutes.
- `pnpm release` against the server (release.json is the kit format; its build, parts and smoke were read, not run), the
  composed `.htaccess` behind Apache and Cloudflare, `deploy.yml` (never run; push-to-deploy off).
- Clerk production: the `email_verified` claim shortcode (optional; the API only refuses an explicit false), a real sign-in
  linking a moved person, Google-only people receiving codes.
- Stripe webhook switch (test and live), the cron line, web push to subscriptions moved from Supabase (same VAPID keys assumed).
- The walk's `flags`, `csp` specs and two `actions` cases on moved data (seed-demo fixtures); browsers other than Chromium.

## 2026-11-01: The data move reads the live source at 0156, on branch `release/cutover`

**Why.** The first live dry run (step 0.5) stopped on `relation "public.account_deletions" does not exist`. Metadata read
through Supabase's API (no data) showed production's `supabase_migrations` at **0001 to 0156**; the repo's
`supabase/migrations` goes to 0164, and 0157-0164 were never applied there. The map had been written against 0164.
Nothing was connected to the real Supabase or the cPanel database for this work; everything below ran on throwaway local
databases.

**What changed.** `backend/src/DataMove/SourceSchema.php` reads the source's own record
(`supabase_migrations.schema_migrations`, highest four-digit version) for the report, and probes `information_schema`
for every public table and column; the probe decides what the SQL may name. `Map.php` reads the five later additions
through `{src:table.column;expr;default}`; `Mover` leaves a mapped table the source lacks out of the plan, and `Files` and
`blockedObjects` skip what is not there. A schema difference is one plain warning in the plan report
(`source at 0156: <feature> not present, nothing to move; <what the move does>`), never an error. A record older than 0156
is an error (not rehearsed); newer than 0164, or a record that disagrees with the schema, is a warning. The report header
gains a `Source schema:` line and the CLI prints the version above its result line. The only differences between a 0156 and
a 0164 schema (diffed column by column on two local builds) are the ones below; 0157, 0158, 0160 and 0161 change functions
and policies only.

**Decisions, one per difference** (privacy first; the same rule as the migration that introduced the change):

- **A-DM-1, private document store (0159).** At 0156 `documents` has no `storage_path`, `file_url` is required, and there is
  no `staff-documents` bucket: every document is a pasted link to a host nobody here controls. The move carries the link
  as it is (the target keeps such rows as "moved from before stored files", migration 015), exactly the exposure the old site
  had; a Supabase-hosted link is still a warning. No file to copy; any Storage object is reported as orphan or other bucket
  and stays only in the step 2 backup. Live: 0 documents.
- **A-DM-2, medical notes (0164).** At 0156 `emergency_contacts.medical_notes` still exists. 0164 drops it under decision
  D5 (Article 9 data about someone with no rights channel here). The move applies the same rule: the column is listed as
  dropped (NEVER moved), the target has no such column, and the plan reports only a **count** of non-blank notes, never a
  value. If the count is above 0, the notes stay behind on the frozen Supabase project; exporting them first is the owner's
  call (O11). Live: 0 emergency contacts.
- **A-DM-3, a login goes with a completed erasure (0162).** Before 0162 closing an erasure case as `completed` left the
  subject's login in place, so at 0156 such a person is still an ordinary account. The move applies 0162's rule at every
  source version: a user whose login existed when an erasure case for their address was closed `completed` is moved only
  under `<id>@removed.rotaflow.invalid`, with no name or avatar (never linkable to a Clerk sign-in), like a pending erasure.
  Someone who signed up again after the case closed is not caught (their login is newer than the closure). 0162 refuses to
  close a case for the only owner of an organisation or a platform-role holder; at 0156 nothing refused, so such a person
  is moved unlinkable **and** reported as a warning (the role needs a new holder after the move). Live: 0 requests.
- **A-DM-4, erasure and storage queues (0159, 0162).** `storage_deletions` and `account_deletions` do not exist at 0156:
  nothing to move, one warning each; no file is held back as queued for deletion (none can be queued at 0156).
- **A-DM-5, staff photos (0162).** No `photo_path` at 0156: photos are pasted links (`photo_url`), moved as before; no
  photo file to copy.
- **A-DM-6, personal preferences (0163).** No `time_format`, `week_start`, `digest_frequency` at 0156: everyone gets the
  values the app showed before they existed (24h, monday, immediate), which are also the target's defaults.

**Evidence** (local, 1 November 2026)

- `pnpm run test:datamove` exit 0, ending `DATAMOVE: all rehearsals passed`. `scripts/datamove-test.sh` builds a source
  from migrations 0001 to N (`build_schema db N`, recording each in `supabase_migrations.schema_migrations` as the
  Supabase CLI does) and runs:
  - the full synthetic source at 0164 (`run.php`, unchanged cases plus "at 0164 by its own record, nothing absent"):
    **65 passed, 0 failed**;
  - the **live-shaped** source (`seed-live-shape.sql`: 1 organisation, 2 logins, 21 staff of whom 20 have no login, 2
    sites, 6 rotas, 311 shifts across the October clock change, 8 clock events and timesheets, 1 correction, 1,006
    notifications, 381 audit rows, and 54,696 health samples, 3,018 delivery-log rows, 370 retention runs, 215 drained
    outbox rows that are not moved) at **0156: 28 passed, 0 failed** (plan with exactly the six version warnings and the
    seeded `rotaflow.app` one, 0 errors; apply; plain-SQL counts; preferences defaulted; verify every checksum; second apply
    refused; `--resume` changes nothing; an interrupted move finished by `--resume` verifies; then `seed-before-0164.sql`:
    2 of 3 contacts with notes counted and the text nowhere in the plan, report or target; two closed-erasure people moved
    unlinkable, the owner among them reported; a later sign-up with an erased address left alone; a pasted document link
    moved as a link; verify; a files dry run counting a legacy-bucket object and copying nothing) and at **0164: 18 passed,
    0 failed** (no version warnings);
  - a dry run of the live-shaped source at **each of 0157 to 0163: 8 passed, 0 failed** each (the expected warnings for
    exactly the features each version lacks, the queue tables planned from the version that adds them).
- Mutation check: disabling the closed-erasure rule fails 2 checks at 0156 (the owner warning and the unlinkable
  placeholders).
- Suite `275-datamove-map` 34 -> **45** (+11): the newest repo migration matches `SourceSchema::REPO_LATEST`; every
  optional table or column is named by the migration said to add or purge it; every `{src:...}` in the map names a listed
  feature; at 0156 the preferences expand to defaults and nothing reads `account_deletions`; exactly six warnings at 0156,
  none at 0164; a non-zero medical-notes count is reported without values; older than 0156 refused, newer warned; no
  record read from the schema; a record that disagrees reported.
- `pnpm run check` exit 0.

**For the owner**

- The live listing's row counts are estimates: it showed 0 `plans`, `feature_flags` and `platform_settings` beside 1
  `feature_flag_changes` and 1 `platform_announcement_deliveries` row, which their foreign keys (ON DELETE CASCADE, NOT NULL)
  make impossible. The plan's `source` counts are exact; read them in step 0.5.
- Do not apply 0157-0164 on Supabase for the move. If someone does, the move still works (rehearsed at every version).

**NOT TESTED**: the real live schema beyond the metadata above (a hand-made column would show as a coverage warning or a
record/schema mismatch); real erasure cases, medical notes or documents (live has none).

## 2026-11-01: Design gaps, phase 1 (colour and text)

Branch `design/gap-fixes` (worktree `.local-state/worktrees/design`), local commit only. Closes F14, F15, F16, F17,
F25 and F26 from the design review file (artifact "RotaFlow design gaps", v2).

**What changed**

- Text in brand and status colours uses the `-ink` shades with dark variants (140 places in `src/`). Fills unchanged.
- New `field` token for input and select borders: `#80858e` (3.37:1 on `#f4f4f4`), dark `#6b7079` (3.50:1 on
  `#171a20`). The planned `#8a8f98` was rejected during the build: it is 2.95:1 on the canvas the fields sit on.
- 34 sizes under 11 px raised to 12 px; opacity removed from text on the plan step and the dashboard alert.
- Dates: `formatCoverRiskRange` and `formatLeaveRange` write day first with en dashes; leave type labels in sentence
  case; "Updated HH:mm" without seconds; the leave preview's hard-coded "Aug 25-29" corrected.

**Evidence**

- axe-core at 1440 and 390 on 24 screens (13 workspace previews, dashboard, 4 settings, onboarding plan step, home,
  pricing, login), dev server on port 5043: zero violations. Before, 24 of these captures failed colour contrast.
- `pnpm run check`: lint, format, typecheck, 132 test files / 1796 tests, build, bundle, migrations, docs and export
  checks pass.

**Not tested**

- `check:php`: the local test database could not create its socket in this sandbox. No PHP changed.
- Dark mode by eye; Playwright and pgTAP (need Docker).

## 2026-11-01: Design gaps, phase 2 (consent and sign in)

Branch `design/gap-fixes`, local commit only. Closes F01, F11, F12, F13, F18, F27 and the marketing half of F08.

**What changed**

- `ConsentBanner`: compact one-line layout; same accessible name, focus and inset behaviour; Reject and Accept share
  one class (the equal-weight e2e test checks it).
- `ClerkAuthPanel`: appearance as style objects (Clerk's CSS outranked the Tailwind classes it was given): full width,
  no inner card, Clerk's header and sign-up footer hidden. `AuthSplitLayout` column gains `min-w-0`.
- Login: "Sign in to RotaFlow", one secondary link to `/contact`. Sign-up padding matches.
- Copy: Pricing FAQ, Home commitments, Features, About and the auth trust strip no longer name Postgres, row-level
  security or the EU. The legal pages (Trust, Privacy, `subprocessors.ts`) still do; they belong to the cutover
  privacy decisions and were not touched.
- `AppShellPreviewPage`: catch-all route to `NotFoundPage`.

**Evidence**

- Dev server on 5043 with the Clerk development key: `/login` and `/signup` at 1440, 834, 390 and 320 have no
  sideways scroll and no axe violations (390 overflowed 82 px before). Home, Pricing, About, Features and the preview
  404 clean at the same widths.
- Playwright (`consent`, `marketing`, `responsive-and-motion`), `E2E_PORT=5043`: 81 passed, 3 failed. The same 3 fail
  on the unchanged code (port 5042): two expect the deleted `/forgot-password` page, one expects non-submit buttons in
  the old Supabase form. Left for the cutover owner.
- `consent.spec.ts` "a declined preference still works" fails intermittently on both old and new code: Clerk writes
  `__clerk_environment` to localStorage. Recorded as finding F38; the owner decides whether it counts as strictly
  necessary.
- `pnpm run check` passes to `check:php` (test database socket refused in the sandbox; no PHP changed).

## 2026-11-01: Design gaps, phase 3 (landing site) and two owner decisions

Branch `design/gap-fixes`, local commit only. Closes F02 to F07, F09, F38 and F39.

**Decisions taken (owner: "make the right decision")**

- F38: Clerk's `__clerk_environment` local-storage entry is strictly necessary (sign-in cannot load without it).
  Named in the Cookie Notice (`src/lib/legalFacts.ts`); the consent e2e counts only RotaFlow's own keys.
- Legal pages: Trust, Privacy and `src/lib/subprocessors.ts` still say Supabase and eu-west-1. Not changed here:
  they need the confirmed server location and belong to the cutover privacy decisions (A-DM-1 to A-DM-6). No cutover
  session was running to hand over to; this entry is the hand-over.
- F39, found while building: "Join the beta" went to `/signup`, which under invitation-only organisations gives a
  prospect an account with no organisation. Every such link now uses `JOIN_BETA_PATH` (`/contact`); sign-up remains
  for invitees.

**Evidence**

- Home, Pricing, Contact, Features, Solutions, About, Resources at 1920, 1440, 834, 390 and 320: no sideways scroll,
  zero axe violations (dev server 5043). Hero, pricing and footer checked by eye; the four prices align.
- Playwright `marketing`, `consent`, `responsive-and-motion` on 5043: 81 passed, 0 failed (3 stale auth tests
  replaced by a redirect check). `consent.spec.ts` 72 of 72 across four repeats.
- `pnpm run typecheck`, `lint`, `format:check`, 132 files / 1796 tests pass. `check:php` not run (sandbox).

## 2026-11-01: Design gaps, phase 4 (dashboard and publishing)

Branch `design/gap-fixes`, local commit only. Closes F19 to F24.

**Decisions taken while building**

- Focused repair, not the review file's full redesign: the dashboard's drill-down links, attendance semantics and
  `src/lib/attendance.ts` counting are unchanged; only the presentation moved (4 tiles + a linked summary line).
- F24 corrected: the "nine days" in Week view are the deliberate three-week scrolling canvas (`src/lib/rotaCanvas.ts`
  explains why), not a clipping bug. Kept; only the range label changed.
- F22: the nav order and its reasons are kept; managers get section headings over contiguous runs. Staff rows (12)
  get none. The blank profile only occurred in the preview, which has no signed-in user: no change.
- The issue list in the publication panel shows from `sm` up; on a phone the panel keeps to the summary so the grid
  still starts in the top two-thirds of the screen (`e2e/rota-grid.spec.ts`).

**Evidence**

- Playwright on 5043: `app-surface`, `rota-grid` 56 passed; `owner-workforce`, `staff-dashboard`, `a11y-fixes`,
  `reports-responsive`, `responsive-and-motion`, `marketing`, `consent` 86 passed. No failures.
- axe and overflow at 1440, 834 and 390 on the dashboard, rota builder, schedule, timesheets, leave, swaps and
  settings previews: clean. Dashboard and rota builder checked by eye at 1440.
- typecheck, lint, format and 132 files / 1796 unit tests pass.

