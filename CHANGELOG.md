# Changelog

What changed, one entry per merged pull request, newest first. This file owns that
history in brief; the pull request holds the detail and `docs/SAAS.md` holds
capability status. Started on 11 October 2026 with the ten most recently merged
pull requests, read from `gh pr list --state merged`. Earlier history is in
`git log --merges` and the pull requests themselves.

**The rule: one entry per merged pull request**, added in that pull request, under
"Unreleased" until it merges, then dated with its merge date. Dependency bumps from
Dependabot may be grouped into one line per week. The rule sits under
"Documentation stays current" in `AGENTS.md`.

## Unreleased

- **Phase 1, live safety (8 November 2026).** There was no database backup for the live site: `backend/bin/backup.php` now makes a
  private, checksummed, pruned MariaDB dump and `--restore-check` proves the newest one loads into a scratch database (suite
  `300-backup`, 82 checks). Installed on the live host on 2026-11-08 (read-only backup account, every six hours, restore proven into a scratch database); the encrypted off-site copy and a failure alert are still open. `pnpm htaccess compose|diff|push` composes and
  ships the live root `.htaccess` (origin-lock block plus the repo file) with a backup first and an automatic restore if the smoke
  checks fail or cannot run, so the banner hardening no longer needs a hand edit on the server. `release.json` names `main`, with a test.
- **Security audit and fixes (2 November 2026).** Seventeen confirmed findings fixed, none critical or high. Access:
  delegated cover can no longer invite a permanent manager; managers cannot approve their own timesheets or leave;
  a calendar feed stops when the person is suspended. Server requests: push endpoints limited to browser push
  services (10 devices each); an organisation's SMTP host must be public and on a mail port, with no banner echoed.
  Files: photos re-encoded (location data stripped, 4096 px cap); staff can no longer link their own photo; uploads
  keep 1 GiB of disk free and stop at 500 per organisation per day; signed links refuse to work without a real key.
  Browser: a kept calendar link is shown only to its owner; document links must be https; invite tokens and
  navigation URLs are scrubbed before Sentry; Clerk redirects stay on this site. Web server: `X-Powered-By` removed,
  directory listing off in `assets/`, `icons/` and `fonts/`. Fixed while there: the contact form refused every
  submission (headers were not passed to the API), and every prerendered page said "You're offline". CI: every
  workflow action pinned to a commit, gitleaks and Semgrep added. Dependencies: minor updates and a
  `serialize-javascript` override. Report: `docs/AUDIT.md`.

- **Legal pages follow the cutover: data in the UK, Clerk named, cookies told truthfully (1 November 2026).** The owner
  confirmed the server is in Namecheap's UK data centre. The Trust page and the Privacy FAQ now say the data lives in
  the United Kingdom (was the EU, Supabase eu-west-1), name all three US sub-processors (OpenRouter, Stripe and Clerk)
  and say what Clerk receives. "RotaFlow sets no cookies" was untrue since sign-in moved to Clerk: the consent bar, the
  storage window, the Cookie Notice and the Privacy Notice now say the only cookies are the two that keep you signed
  in. `docs/SECURITY.md` residency and processor tables updated to match.
- **Design gaps, phase 6: self-service (branch `design/gap-fixes`, 1 November 2026).** Staff can now manage their own
  emergency contacts from My account → Profile, in the Contact details card's empty second column, through the same
  window a manager uses (the API always allowed it). The Profile email field points to Security, where Clerk changes
  the sign-in address, instead of telling people to ask an administrator. UX-SPEC §7 corrected: uploads (photos and
  documents) and email change were already built. QR clock-in is deferred to a planned slice after the cutover (it
  needs a migration, a route and a camera scanner). Findings F32 to F35, F10.
- **Design gaps, phase 5: module match pass (branch `design/gap-fixes`, 1 November 2026).** The review file is now in
  the repository as `docs/design/RF-GAPS.html`, the design reference UX-SPEC §7a to §7d point to. Matched in code:
  Compliance's disabled Approve and Not accepted, and Open shifts' "clashes with your rota" Take it, now state their
  reason as text under the button (a title shows only on hover, never on a phone). Cover, the scheduling dialogs,
  timesheet flags and the global states (404, error, offline, install, update) already met the rules: no change.
  Findings F28 to F31, F36.
- **Design gaps, phase 4: dashboard and publishing (branch `design/gap-fixes`, 1 November 2026).** The operations
  dashboard leads with four tiles (Clocked in now "of N scheduled today", Late start, Open shifts, Pending approvals);
  scheduled, on break, completed and tomorrow uncovered sit on one linked line beneath. Each item that needs a look is
  a row with its own Open button. The attendance table (dashboard and Team Attendance) folds name, job title and site
  into one Person column so it fits a 1440 screen without its last column scrolling away; sortable headers match the
  others in capitals; the source reads "GPS". A manager's sidebar has section headings (Scheduling, Requests, People,
  Updates), with Approvals first in Requests. The rota builder names each issue blocking publication with "Go to
  shift", and Publish and its options are disabled with "Fix N first" beside them instead of failing after a click.
  The week range reads "26 Oct – 1 Nov 2026". Findings F19 to F24, F26.
- **Design gaps, phase 3: landing site (branch `design/gap-fixes`, 1 November 2026).** Every "Join the beta" now goes
  to the contact form instead of open sign-up: organisations are by invitation, so a prospect who signed up got an
  account with no organisation (F39). The contact page explains how joining works, and the closing call to action and
  the setup guide say "we set it up and invite you". The hero's three facts sit on one row with ticks; on a phone the
  hero shows the staff schedule card instead of a week grid too narrow to read; less empty space under it. "Why teams
  choose RotaFlow" shows a worked warning card beside the list, and the point repeated in the commitments band is
  gone. The footer's six columns sit on one row. Pricing: the four prices share a baseline, each says "After 30 days
  free", and the questions are one accordion. The Cookie Notice now names Clerk's `__clerk_environment` as strictly
  necessary (F38), and the auth e2e tests that still expected the Supabase forms were replaced. Findings F02 to F07,
  F09, F38, F39.
- **Design gaps, phase 2: consent and sign in (branch `design/gap-fixes`, 1 November 2026).** The storage question is
  now one line of text and one row of controls (about 64 px instead of 205 px), with Reject and Accept the same button
  and "Choose what to keep" as a link; it still pads the page so it never covers content. Sign in and sign up no longer
  scroll sideways on a phone (82 px at 390 before: a fixed-width Clerk card and a column with no `min-w-0`), show one
  card instead of Clerk's card inside ours, and offer one secondary route: "Setting up a new organisation? Ask for
  access" (organisations are by invitation). Public copy that stops being true at cutover is gone: "Data held in the
  EU", "managed Postgres", "row-level security" on Home, Features, About, Pricing and the sign-in strip; no location is
  claimed until the owner confirms the server's. A mistyped `/app-preview/*` address shows the 404. Findings F01, F08
  (marketing copy), F11 to F13, F18, F27.
- **Design gaps, phase 1: colour and text (branch `design/gap-fixes`, 1 November 2026).** Every text use of the
  bright status and brand colours now uses its `-ink` shade with the matching dark variant (`text-primary`,
  `text-danger`, `text-success`, `text-warning`, `text-info` as text: 140 places), so blue, red, green, amber and info
  text meet 4.5:1; the fills are unchanged. Inputs and selects get a new `field` border token (`#80858e`, 3.37:1 on
  the canvas; `#6b7079` dark), replacing the 1.53:1 card line. No text under 11 px (34 places raised to 12 px), no
  opacity on text. Dates read day first with en dashes ("25–29 Aug", "9–13 June 2025", "Fri–Sun"), leave types in
  sentence case ("Annual leave"), and the dashboard's updated time drops its seconds. Findings F14 to F17, F25, F26
  in the design review file.
- **Local-live walk and the cutover branch (branch `release/cutover`, 31 October 2026).** The cutover now ships the
  whole stack from `release/cutover` with every R2 flag off. A repeatable local walk of every screen as owner, manager,
  staff and platform admin (`pnpm run e2e:walk`, `scripts/walk.sh`, demo data from `backend/bin/seed-demo.php`) found
  and fixed: the API's first answer after sign-in being unreadable on PHP 8.5; staff hitting refused requests every
  minute for the sidebar badges (now their own counts) and the support banner; a manager's Integrations tab and staff
  Announcements asking for owner or manager data; the console Settings page calling a removed MFA check; and the staff
  documents routes answering while their flag was off (now refused on the server, except the plain read the expiring-
  document warnings use).
- **Timesheet and open-shift follow-ups (owner decisions on S13, branch `r2/s13-timesheets`, 31 October 2026).**
  Exporting payroll now marks the approved periods in the file as exported (a new `POST timesheets/export`; the page
  says how many were marked, and a period sent before still appears with Status `exported`), so nothing is paid twice
  without anyone seeing it. The file downloads as `rotaflow-timesheets-<organisation>-<start>-<end>.csv`. With
  `timesheet_tools` on, a timesheet row's "Late" follows the organisation's tolerance instead of a fixed 5 minutes
  (off, unchanged). The Open shifts board tells a person why they cannot take a shift before they press Take it,
  whether or not cover is on. Two-way swaps keep their own flag. With `timesheet_tools` on, an exported period can no
  longer be approved or submitted again (409 `already_exported`); an owner reopens it deliberately, with a reason kept
  in the new `timesheet_reopenings` table (migration `backend/migrations/020-timesheet-reopenings.sql`).
- **Cover follow-ups and two-way swaps (owner decisions on S12, branch `r2/s13-timesheets`, 31 October 2026).** The
  instant open-shift claim now refuses someone on approved leave, declared unavailable, missing a required document or
  already working, whether or not the cover module is on. Platform support sessions cannot open any cover screen
  (absence reasons can be health data). And a swap can now ask for one of the colleague's shifts in return: approving
  moves both shifts or neither, each person is checked against the other's shift, and the swap cancels itself if
  either shift changes or starts. Two-way swaps ship off behind their own `two_way_swaps` flag (needs `cover_tools`).
  Migration `backend/migrations/019-two-way-swaps.sql`.
- **Timesheet flags and the payroll CSV, behind the `timesheet_tools` flag (R2 slice S13, branch
  `r2/s13-timesheets`, 31 October 2026).** Each timesheet line shows Late, Early finish and Overtime chips beyond the
  organisation's tolerance (default 10 minutes, Settings, Policies), worked out on the server from UTC instants so a
  night shift across a clock change is exact, with the scheduled break deducted from both sides. Owners and managers
  export a payroll CSV of approved periods (at most 31 days; UTF-8 with a BOM; sixteen fixed columns; exact minutes
  and hours; cells that would run as a formula are made text). Migration `backend/migrations/018-timesheets.sql` (the
  flag only). Ships off; with it off the Timesheets page and its existing Export CSV are unchanged.
- **Compliance, behind the `staff_documents` flag (R2 slice S10, branch `r2/s10-compliance`, 30 October
  2026).** Document types with UK examples; staff upload documents against a type and they count only once an
  owner or manager approves them (never the person themself; a manager cannot approve what they uploaded for
  someone, an owner can); approving replaces the earlier one and keeps it as history; expiry is judged in the
  organisation's timezone; reminders at 30, 14 and 7 days and on expiry, once each, to the person and the managers
  (the old expiring-document alert, folded in). New Compliance / My documents page, Settings Document types, and an
  eligibility chip on the rota builder and open shifts. Migration `backend/migrations/015-compliance.sql`. Ships off.
- **`@vitejs/plugin-react` 6 (22 October 2026).** The plugin no longer depends on
  Babel; an `overrides` pin keeps npm from resolving its unused optional Babel 8
  peer chain. eslint 10 and TypeScript 7 stay held: their plugins' latest releases
  still peer to eslint 9 and TypeScript below 6.1. GAP-037.
- **The public pages are prerendered, and an unknown path is a real 404 (22 October
  2026).** `npm run build` now writes the fourteen sitemap pages and a not-found
  page to `dist/prerendered/` (`scripts/prerender.mjs`), each with its own title,
  description and canonical, and `src/main.tsx` hydrates them in place rather than
  re-rendering. `.htaccess` serves those files, sends known app routes to
  `index.html`, and answers everything else with HTTP 404; `htaccessRoutes.test.ts`
  fails if a route in `App.tsx` and the `.htaccess` list drift apart. Live only
  after a deploy with a composed `.htaccess` (`docs/DEPLOYMENT.md`).
- **Every designed screen is matched (22 October 2026, GAP-088 closed).** From
  `xl` the marketing hero sets the copy left and the product shot right, as its
  reference does, and the website's headings take the two-weight rule. The
  manager's availability view and six workspace screens are recorded as matched
  against `docs/design/ORGANISATION_WORKSPACE.html`, whose PNGs it supersedes. Two
  fixes from the re-check: the onboarding panel's wave no longer sits behind the
  last feature's text, and the onboarding preview's location count agrees between
  steps.
- **Medical notes are gone from the database (22 October 2026, `0164`).** The
  retired `emergency_contacts.medical_notes` column is dropped (GAP-058, decision
  D5). A count-only read of production, approved by the owner, found no row in the
  table, so the planned export to owners (O11) had nothing to export. The privacy
  notice now names sickness absence as the only Article 9 data.
- **Integrations lists what exists, and Preferences keeps three choices (22 October
  2026, owner decisions, `0163`).** Settings, Integrations adds an "Also connected"
  card (payroll CSV, calendar feed, Stripe billing state) and says direct payroll
  and HR connections come later. My account, Preferences stores the clock format,
  the first day of the person's own week (My rota only; rota weeks stay Monday to
  Sunday) and an email summary choice, which is labelled as not sent yet. GAP-088.
- **Unpaid Stripe invoices reach the Billing screen (22 October 2026).**
  `stripe-webhook` handles `invoice.finalized`: an open invoice is listed with its
  links before it is paid or fails. A status already held is never changed, and a
  test-mode invoice never lands on a live organisation. Needs `stripe-webhook`
  deployed and the endpoint subscribed to the event (O3). GAP-129.
- **A staff photo and a login go with an erasure (GAP-056, GAP-057, `0162`).** A
  staff photo is now an upload to a private `staff-photos` bucket from My account,
  Profile, shown to colleagues through a signed link; replacing it or erasing the
  person queues the file for `purge-storage`, which now handles both buckets.
  Closing an erasure case as completed queues the person's login for the new
  `delete-account` Edge Function, which removes it through the Auth Admin API, and
  refuses to close while the person is an organisation's last owner or holds a
  platform role. Both functions need deploying by hand (O3).
- **The release gate re-run on every work-queue pull request merged together
  (21 October 2026).** #344 to #354 merged into the work-queue branch: every local
  gate passes, including 781 pgTAP assertions and the authenticated, offline and
  service-worker browser specs. Two defects only the combination showed were fixed:
  the motion chunk no longer loads on every page under Vite 8, and a sync-queue
  test is no longer timing-dependent under React 19. The decision in
  `qa/LAUNCH-CHECKLIST.md` is NOT READY FOR PRODUCTION on owner actions alone,
  including O14: GitHub Actions has run nothing since 18 October.
- **chore(deps): the framework majors (GAP-037).** React 19 with its types (the
  global `JSX` namespace is gone, so 305 files import the type from `react`), Vite 8
  with Rolldown (vendor chunks move to `codeSplitting.groups`; the entry chunk falls
  from 97 to 51 KiB gzip), `vite-plugin-pwa` 2, `@vitejs/plugin-react` 5, TypeScript
  6, vitest 5 with `@vitest/coverage-v8` 5 (moved together, which is why Dependabot
  #342 failed), `eslint-plugin-react-refresh` 0.5 and the in-range updates. Still
  held back, each with its reason in GAP-037: eslint 10, TypeScript 7,
  `@vitejs/plugin-react` 6 and Sentry 11.
- **feat(staff): documents are kept privately and deleted with their record (D4,
  GAP-056, GAP-084).** `0159` adds a private `staff-documents` bucket with policies
  that admit the person and their organisation's owners and managers, a
  `storage_path` column (legacy pasted links still open), and a `storage_deletions`
  queue filled by triggers when a document, person or organisation is deleted. The
  new `purge-storage` Edge Function removes queued files, drained by a pg_cron job
  every five minutes. The Documents dialog uploads a file and opens it through a
  60-second signed link. Needs `supabase functions deploy purge-storage` before
  files are actually removed.
- **fix(calendar): a feed nobody reads stops working, and one read too often is
  refused (GAP-052).** `0158` makes `calendar_feed_shifts` return nothing for a
  token no calendar has read for 90 days, and revoke it, and limits reads to 120 an
  hour per staff record through `consume_rate_limit`. `calendar-feed` answers the
  refusal with 429 and `Retry-After`, and its iCalendar code moved to a tested
  module. "My rota" shows when a calendar last read the feed and gains a Reset
  link, so rotating no longer depends on support. The migration applies on merge;
  the Edge Function needs a manual deploy.
- **feat(account): a "Your data" tab, and one formatting module.** My account gains
  Your data (`/app/account/data`): a signed-in person can ask for a copy, a portable
  file, a correction or for their account to be closed, and see their own requests
  with the date each will be answered. Each button files a case in the existing GDPR
  register through `request_my_data` (`0160`), which takes the subject from the
  account so it cannot name anybody else and returns an open case rather than
  starting a second clock. Deleting the login behind an erasure is still open
  (GAP-057). Dates on the account screens now come from `src/lib/format.ts`.
- **feat(billing): a trial reminder, the billing contact in Stripe and fresh
  invoice links (GAP-127, GAP-128, GAP-129).** `0157` adds a free trial ending
  within three days to `enqueue_scheduled_alerts`: the owners of an organisation
  still on its own trial get one "Your free trial ends on" notice naming the date, in the app
  and by email, and nothing once a plan is chosen. A new owner-only Edge Function,
  `billing-account`, writes the organisation's contact email to the Stripe customer
  ("Use for Stripe invoices") and returns an invoice's current hosted page and PDF
  links ("Refresh links"), because Stripe expires a stored link within 120 days.
  `0157` applies to production on merge; `billing-account` needs deploying by name.
- **test(offline): the queue, the service worker and the update prompt, in a
  browser and in CI (GAP-049, GAP-050, GAP-054, GAP-086).**
  `e2e/offline-clock-in.spec.ts` queues a clock-in with the network off and checks
  the database: nothing arrives while offline, exactly one row after, and none
  more on reload. A session that ends while the write waits holds it for the same
  person and never sends it for a colleague who signs in on the same phone.
  `e2e/pwa-offline.spec.ts` loads the manifest and its icons, opens the app from
  its precache with no network, and installs a second worker to see the update
  prompt appear and wait. `pwa-cache-teardown.spec.ts` runs in CI for the first
  time. The clock screen opened cold with no signal now says what is missing and
  reloads by itself when the signal returns. Fixed on the way: the clock screen kept saying
  "Sending 1 entry" after the shell had already sent it, because each
  `useSyncQueue` instance held its own list; they now announce changes to each other.
- **test: the recovered defects re-tested (GAP-115).** BUG-010's form-to-row
  mapping moves to `src/lib/staffForm.ts` with a test naming every column it
  writes, and the pgTAP grant invariants now cover those `staff_profiles` columns.
  `send-invite`'s refusals and message move to `sendability.ts` under vitest
  (behaviour unchanged). The only step left on GAP-115 is owner action O13: one
  invitation sent into a real inbox.
- **fix(design): the thirteen unmatched workspace screens compared (GAP-088).** A
  development-only `/settings-preview/*` harness mounts the real Settings and My
  account pages against fixtures, so the nine screens that needed a session can be
  captured at last. Each of the thirteen was compared with its mockup and with
  `docs/design/ORGANISATION_WORKSPACE.html`, and its result recorded in
  `docs/UX-SPEC.md`. Fixes from the pass: the audit trail's note no longer claims
  only anonymisation is recorded, and the trail gains Area and Severity columns;
  Settings and My account titles name the section; Profile shows recent account
  activity; the boot screen's lockup matches the reference's size. The nine screens
  joined the accessibility scan, which found two contrast failures used across the
  app and now fixed: the active tab and the danger button were both 4.2 : 1.
- **perf(db): shift and rota reads stop paying for the write rule (`0161`).** The
  load test now times each screen at the acceptance size (20 sites, 250 staff,
  10,000 shifts, 50,000 clock events) and found shifts five times slower per row
  than clock events. The `FOR ALL` write policies on `shifts` and `rotas` also
  applied to every read, one `has_org_role` call per scanned row. They are now one
  policy per command, and `rotas_select` uses `my_readable_rota_ids()`. Five months
  of shifts fell from 1,973 ms to 158 ms; every screen read is under 250 ms. The
  supported size is published in `docs/PRODUCT-SPEC.md`. Merging applies `0161` to
  production. GAP-071, HARDEN-007.
- **docs(saas): one work queue, and the 2026 plan pack retired.** `docs/SAAS.md`
  opens with a work queue: owner actions, the ranked next items, what is built but
  never proved on real infrastructure, an index of the `qa/` evidence, operating
  lessons, the thirteen approved plan decisions with where each now lives, and the
  unbuilt feature candidates. The pack's release gate and billing scenarios moved to
  `qa/LAUNCH-CHECKLIST.md`, its alerting gaps to `docs/DEPLOYMENT.md` and its offline
  promise to `docs/ARCHITECTURE.md`; then `docs/Plans 2026/` was deleted, on the
  owner's approval. The register's contradictions with itself were settled (Stripe
  test key, backup secrets, decisions 7 and 11, BUG-014, struck and unstruck rows,
  the roadmap).
- **feat(seo): honest JSON-LD in `index.html`.** One `Organization` and one
  `SoftwareApplication` node, with no ratings, reviews, awards or prices, guarded
  by `src/lib/structuredData.test.ts`. README's tech-stack table now lists GSAP
  and Lenis. The not-found screen already existed (`*` route, `noindex`), so it is
  unchanged.
- **feat(marketing): scroll motion on the public pages (GSAP + Lenis).** The home
  hero and `PageHero` now enter line by line on CSS `fade-up`, the hero rota chips
  fill in on a new `pop-in` keyframe, and the sections below rise in as they reach
  the viewport. The phone in the product shot drifts over the dashboard on
  scroll, the header firms up once the page moves, and scrolling is smoothed by
  Lenis.
  - It all loads as one 49.3KiB chunk after first paint, only without reduced
    motion, only on marketing pages, and outside the precache.
  - The mobile menu now locks the page behind it, marketing pages open at the
    top, and `bundle-budget.json` is re-measured, with shipped raised from 700
    to 760KiB.
  - Reverses the "CSS only" motion rule under the conditions in
    DESIGN-SYSTEM §4.
- **feat(billing): invoices in the app (plan F3, CAP-127).** `0156` adds
  `hosted_invoice_url` and `invoice_pdf` to `invoices`, each constrained to https
  on `invoice.stripe.com` or `pay.stripe.com`. `stripe-webhook` writes them on
  `invoice.paid` and `invoice.payment_failed`, retrieving the invoice when the
  event lacks them. Settings, Billing gains an Invoices section for the owner:
  the last 12, with date, number, amount, status in words, and View and Download
  PDF links. Not deployed; the billing contact is not yet sent to Stripe
  (GAP-128) and stored links expire within 120 days (GAP-129).
- **feat(design): flat, monochrome tokens and primitives (decision D10).** The
  neutral and dark ramps move to true neutrals under the same token names
  (canvas `#F4F4F4`, ink `#171A20`, muted `#5C5E62`; dark canvas `#171A20`).
  Two radii (4px controls, 12px cards), no resting shadows, 330ms colour-only
  transitions on one easing curve. Button, Card, Modal, Input, Select, Badge,
  IconButton and HeaderBar follow; Button no longer scales on hover. Status
  colours, dark mode, 44px targets and dense tables are unchanged. New tests:
  `themeContrast.test.ts` (every text token on every surface, both themes) and
  `designRatchet.test.ts` (alpha status fills, stray hex, hover scale and
  `shadow-lg` may not rise). Page layouts are not restyled here.
- **feat(billing): a 30-day trial, then a plan or read-only (decision D2).**
  `0154` gives every organisation a server-set 30-day trial on Professional
  limits and removes the free Starter fallback. Without a trial, a paid or
  trialing subscription or a grace window, rotas, shifts and invites refuse
  writes with `BILL1`, while clock-in, leave, reads and exports keep working.
  Checkout passes the trial end to Stripe, and the webhook queues "Your trial
  ends in 3 days" and "Payment failed" through the outbox. Settings, Billing
  shows "Trial, N days left", owners and managers of a read-only organisation
  see a banner, and the onboarding plan step and pricing FAQ state the trial
  terms (CAP-125, GAP-126, GAP-127).

- **feat: website enquiries are stored, and the console has an Enquiries inbox
  (CAP-126, Plans 2026 F2).** `/contact` posts to a new public Edge Function,
  `public-enquiry`, instead of opening a `mailto:` link that reached nobody on a
  device with no mail client. The function checks the origin, validates every
  field, ignores a filled honeypot, verifies Cloudflare Turnstile when its secret
  is set, and stores the row through `receive_enquiry` (`0155`), rate-limited per
  hashed address and in total. `anon` holds nothing on the new `enquiries` table;
  operational platform roles triage it at `/admin/enquiries`. Kept 24 months by the
  nightly retention job. "Book a demo" links tick the demo box. Needs
  `supabase functions deploy public-enquiry --no-verify-jwt` before it accepts
  anything (`docs/DEPLOYMENT.md`).
- **fix(billing): Checkout guard, webhook ordering and an honest billing page.**
  Settings > Billing says "No plan yet" instead of "trialing" when there is no
  subscription, shows the entitled plan and formats prices in the plan currency
  (BUG-106). `create-checkout-session` refuses a second Checkout with 409
  `already_subscribed` and the page opens the Billing Portal instead (BUG-107).
  `stripe-webhook` writes the subscription as Stripe holds it now, so an
  out-of-order `customer.subscription.updated` cannot regress it, and a late
  `deleted` cannot suspend a replacement subscription (BUG-108).
- **Settings that saved but did nothing are wired or removed (GAP-116, BUG-011).**
  Minimum rest, maximum weekly hours and maximum consecutive days drive the rota
  warnings; the overtime threshold highlights a staff member's own timesheet.
  Clock rounding, publish lead days, auto-decline clashing leave, working week,
  date format and currency are gone from the screens, with their stored values
  kept. Each Policies setting shows a worked example.
- **docs: restructure to the GEE OS Standard application profile.** Flat `docs/`
  with one file per concern, a new `qa/` folder, `CHANGELOG.md` and
  `KNOWN-ISSUES.md`. Overlapping documents merged; dated records kept as dated
  sections; references rewritten everywhere except applied migrations and the
  plan pack. New: `docs/README.md` (index), `docs/API-SPEC.md`,
  `docs/NOTIFICATIONS-SPEC.md`, `docs/ACCESSIBILITY.md`,
  `qa/ACCESSIBILITY-AUDIT.md`, `qa/PERFORMANCE-AUDIT.md`,
  `qa/REGRESSION-AUDIT.md`, `.agent/MCP-PROFILE.yml`. The path map is below.

### Path map, 11 October 2026

| Old path                                                     | New home                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| docs/PRD.md                                                  | `docs/PRODUCT-SPEC.md`                                                  |
| docs/OBSERVABILITY.md                                        | `docs/PRODUCT-SPEC.md`, "Metrics and events"                            |
| docs/OFFLINE-SPEC.md                                         | `docs/ARCHITECTURE.md`, "Offline and PWA"                               |
| docs/HOOKS.md                                                | `docs/ARCHITECTURE.md`, "Hook contracts"                                |
| docs/ARCHITECTURE.md §9c and §10 (Edge Functions)            | `docs/API-SPEC.md`                                                      |
| docs/SCHEMA.md                                               | `docs/DATA-MODEL.md`                                                    |
| docs/SCHEMA.md §6, client RPC bullets                        | `docs/API-SPEC.md`, "RPC contracts"                                     |
| docs/SCHEMA.md §6, notification bullets                      | `docs/NOTIFICATIONS-SPEC.md`                                            |
| docs/DATA_LIFECYCLE.md                                       | `docs/SECURITY.md`                                                      |
| docs/PRIVACY-DATA-MAP.md                                     | `docs/SECURITY.md`, "Privacy data map"                                  |
| docs/DESIGN.md                                               | `docs/DESIGN-SYSTEM.md`                                                 |
| docs/DESIGN.md §5 (Accessibility)                            | `docs/ACCESSIBILITY.md`                                                 |
| docs/BRAND.md                                                | `docs/DESIGN-SYSTEM.md`, "Brand and voice"                              |
| docs/DESIGN_EXPLORATION.md (rejected)                        | Deleted; recorded in `docs/DESIGN-SYSTEM.md`, "Rejected exploration"    |
| docs/SCREENS.md                                              | `docs/UX-SPEC.md`                                                       |
| docs/LOOP.md                                                 | `docs/UX-SPEC.md`, "Design-match loop"                                  |
| docs/GEE-OS.md                                               | `docs/README.md`, "How GEE OS is applied"                               |
| docs/Working-Agent.md                                        | `qa/README.md`, "Full QA audit method"                                  |
| docs/QA-AUDIT-REPORT.md                                      | `qa/FUNCTIONAL-AUDIT.md`                                                |
| docs/PLATFORM-CONSOLE-REPAIR-2026-09-07.md                   | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/PLATFORM-CONSOLE-REPOLISH-2026-09-07.md                 | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/design-review/2026-09-06-rota-builder.md                | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/design-review/2026-09-10-full-ux-pass.md                | `qa/FUNCTIONAL-AUDIT.md`, dated section                                 |
| docs/design-review/\*.png                                    | `docs/design/review/` (the four unreferenced operations-\*.png deleted) |
| docs/PRIVACY-READINESS-2026-09-04.md                         | `qa/SECURITY-AUDIT.md`, dated section                                   |
| docs/PWA-RELEASE-GATES.md                                    | `qa/LAUNCH-CHECKLIST.md`                                                |
| docs/ORGANISATION_WORKSPACE.html, docs/PLATFORM_CONSOLE.html | `docs/design/`                                                          |
| `.agent/PROJECT.yml` `mcp_profile`                           | `.agent/MCP-PROFILE.yml`                                                |

## 2026-10-10

- **#335** chore(gitignore): ignore demo credentials and loop scratch in any docs
  folder.

## 2026-10-09

- **#334, #333, #332, #326** Dependency bumps: the dev-dependencies group (eight
  updates), `lucide-react` 1.38.0 to 1.50.0, `@supabase/supabase-js` 2.112.4 to
  2.117.2, and `github/codeql-action` 4.37.9 to 4.38.2.
- **#330** chore(tailwind): migrate to Tailwind 4 and tailwind-merge 3. Tokens moved
  from `tailwind.config.ts` to the `@theme` block in `src/index.css`. Removes the
  `braces` advisory chain, so `npm audit` reports no vulnerabilities (GAP-037).
- **#328** fix: exclude local environment variants from Git.
- **#317** fix: a verification pass and a whole-product UX pass, 23 defects. Staff
  sign-in reached an error boundary on the dashboard; an open amendment doubled
  timesheet rows. Recorded as GAP-118 to GAP-123 and BUG-088 to BUG-105; `0152`
  refuses a second booking of the same leave day.

## 2026-09-09

- **#316** fix(export): the organisation export lost its workforce after `0150`
  revoked five `staff_profiles` columns; `0151` repairs the read.

## 2026-09-08

- **#315** fix(privacy): a colleague is not a payroll record. `0150` revokes five
  payroll columns of `staff_profiles` from `authenticated` (GAP-117).
