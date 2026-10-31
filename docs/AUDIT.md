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
   periods is an owner decision.
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
  is cosmetic, but a direct link would open rather than save.
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
| S12 Cover | `cover_tools` | `017-cover.sql`: `cover_absences`, `cover_requests`, `cover_applications`; `shift_swaps.shift_fingerprint`, `void_reason` | 14 cover routes; claim and swaps changed (see the S12 follow-ups below) | 245, 250 |
| S13 Timesheets | `timesheet_tools` | `018-timesheets.sql`: the flag only (tolerance is a settings key) | `timesheets/export`; the list gains `lines` with the flag on | 255, 260 |

No new cron line and no new private config in any R2 slice: S10's reminders and S12's sweep run in the existing
`bin/cron.php`.

**Owner decisions still open across the four slices**

- When to turn each flag on (after the local-live walk below), one at a time or together.
- S10: confirm the host's PHP `post_max_size` and `upload_max_filesize` are at least 15M (10 MB documents); decide how
  long withdrawn and rejected documents are kept (`docs/SECURITY.md`); at cutover, move Supabase `documents` rows and
  their Storage files into `~/rotaflow-private/uploads/staff-documents/<org>/<staff>/`.
- S11: whether ordinary shift writes (not only publish and patterns) should refuse a double-booking on the server;
  confirm the daily-rest reading (a continuous 11 hours in the 24 hours before a shift, SiteRelay's).
- S12: three decided by the owner on 31 October (eligibility on the claim always on; platform support refused on
  cover; port two-way swaps): see the S12 follow-up sections below for what was built and what remains.
- S13: confirm the CSV columns with the payroll system in use; whether exporting should mark periods `exported`;
  whether the row status "Late" (5 minutes) should follow the tolerance (default 10).
- All: migrations 015 to 018 rehearsed against the live MariaDB 11.4 structure at cutover prep (only the local 13.0.2
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
  one open shift at once, a swap voided by moving its shift, the support session refused; the two-way swap flow if
  built.
- S13: chips on a week with late, early and over lines, the tolerance changed in Policies, the payroll CSV opened in
  the real spreadsheet and payroll importer (check the BOM, names with accents, a name starting with `=`), a period
  corrected after approval showing "Recalculation required".
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
  browser.
