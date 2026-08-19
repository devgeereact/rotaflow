# Commit History

Full commit log, oldest → newest, subject + body. 201 commits total.

## `01feec5` 2026-07-29 — devgeereact

Initial commit: RotaFlow PWA scaffold

pwa-forge-generated foundation for the multi-tenant workforce
scheduling PWA — React/Vite/Tailwind static build, Supabase client
wiring, and full product/architecture/schema docs.

---
## `ce0cec9` 2026-07-29 — devgeereact

Add AI rota assistant, regenerate DB types, wire VAPID/Sentry/OpenRouter

- Regenerate database.types.ts from the live schema (was scaffold-only
  profiles/app_settings) and add domain type aliases.
- Add org/staff/rota/shift services and an OrgContext for tenant bootstrap.
- Add ai-rota-assistant Supabase Edge Function: runs as the calling user
  (RLS-scoped, no service-role key), grounds OpenRouter suggestions in
  real staff/shift/leave data, validates every returned id server-side.
- Add AIRotaAssistantPage + route, linked from the dashboard.
- Exclude supabase/functions (Deno runtime) from ESLint/tsc.
- Document the feature in ARCHITECTURE.md and PROJECT-MEMORY.md.

---
## `b4e7068` 2026-07-29 — devgeereact

Update README/AGENTS/CLAUDE.md for the AI rota assistant

Docs had drifted from the codebase: README was missing the assistant
entirely and only listed migration 0001; AGENTS.md still said AI
scheduling was deferred to Phase 2 despite the ai-rota-assistant Edge
Function already shipping. Also codify the JWT-forwarding (not
service_role) pattern that function established, for future agents
writing more Edge Functions.

---
## `fb898e1` 2026-07-29 — devgeereact

Adopt the light-first design system from design/*.png

docs/DESIGN.md is fully rewritten from designsystem.png/rotaflowui.png/
authscreen.png/splashscreen.png — new brand palette (#3B6FE0 primary),
shift-type colour palette, explicit type scale, shadow levels, and the
Lucide icon system. Critically, the reference is light-first (dark is
a supported but secondary user choice), a full reversal of the old
dark-canvas-only build.

- tailwind.config.ts: new token values, light as the base with -dark
  suffixed pairs for dark mode.
- ThemeContext now defaults to light unconditionally instead of
  dark/prefers-color-scheme — also fixes a latent bug where light mode
  previously did nothing, since no component had dark: variants at all.
- index.html, index.css, offline.html, manifest, forge.config.json
  updated to match.
- Every existing component/page got dark: variants; Button's
  secondary/ghost variants redesigned to match the reference.
- Added lucide-react per the icon spec.
- Corrected stale docs (ARCHITECTURE.md's theme-state description,
  PROJECT-MEMORY.md's design section).
- Added docs/SCREENS.md — full screen inventory reconciled against the
  current codebase and schema, with known gaps flagged.

---
## `a110efb` 2026-07-29 — devgeereact

feat: add RotaBuilder and Staff management pages

- Implement RotaBuilderPage for managing weekly staff shifts with drag-and-drop functionality.
- Create StaffPage for viewing and managing staff profiles, including adding, editing, and toggling active status.
- Introduce location and department services for better organization management.
- Enhance shift management with new services for creating, updating, and deleting shifts and shift types.
- Update types to include insert and update definitions for staff, shifts, locations, and departments.
- Fix row-level security policy for organizations to prevent bootstrap issues during creation.

---
## `617aeb3` 2026-07-29 — devgeereact

feat: update database migrations and improve error handling in various components


---
## `5510f0f` 2026-07-29 — devgeereact

feat: enhance accessibility and focus management in Sidebar and Modal components; update error message roles in RotaBuilder and Staff pages; improve SQL migration for unique draft rotas


---
## `ba07f3a` 2026-07-29 — devgeereact

feat: add new design assets and update LOOP.md; refine Sidebar component accessibility; enhance SQL migration for unique draft rotas


---
## `d6250a3` 2026-07-29 — devgeereact

ci: add build/typecheck/lint gates and PWA output check

The repo had no CI. Runs typecheck, lint (--max-warnings 0) and a build with
no .env present, so a missing VITE_* var fails here rather than in production —
src/lib/env.ts is written to degrade rather than throw, and this keeps that true.
Pins TZ=UTC because shift wall-times resolve through a location timezone, and
that class of bug is invisible on a UK machine. Asserts sw.js and
manifest.webmanifest are emitted: a PWA that builds but ships no service worker
keeps working online and silently stops working offline.

Format check is report-only until the existing 37-file backlog is cleared.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `153890f` 2026-07-29 — devgeereact

fix: Phase 1.5 hardening — published rotas, session teardown, error surfacing

A re-smoke-test of the Phase 1 core loop found one blocker and two high-severity
gaps that typecheck, lint and build all reported as clean.

Publishing a rota orphaned it. getOrCreateDraftRota filtered on status='draft',
so reopening a published week found no draft, created an empty one, and the grid
rendered as if the week had been wiped — the shifts were still attached to the
published rota, which nothing ever read back (listRotas was dead code). Replaced
with findRotaForPeriod / getOrCreateRotaForPeriod, which ignore status and prefer
a published rota over a draft. Adds unpublishRota so publish is no longer a
one-way door, and blocks publishing an empty rota.

signOut cleared only the Supabase token. The supabase-api (authenticated REST,
5 min) and imagekit-media (staff photos, 30 days) Workbox caches are not keyed by
user, so on a shared device — a ward tablet, a warehouse terminal — the next
person to sign in could be served the previous tenant's data. Adds
lib/session.ts#clearTenantState, called from signOut in a finally block so it
still runs when signing out offline.

OrgContext swallowed query failures to Sentry, and AppShell read the resulting
empty memberships list as a new user and redirected to /onboarding, where an
existing owner could create a duplicate organisation. Adds useOrg().loadFailed;
AppShell and OnboardingPage now offer a retry. OnboardingPage is guarded too
because it is reachable by direct URL.

No toast system existed, so drag-and-drop shift failures went to Sentry only and
the manager believed the shift saved. Adds ToastProvider/useToast, wired into
every rota write plus the previously uncaught reloadShifts rejection.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `4ffeefd` 2026-07-29 — devgeereact

fix: point the app at rota.gakinz.com — rotaflow.app is not our domain

rotaflow.app was the scaffold placeholder. It resolves to Vercel and serves an
unrelated, already-shipped shift-scheduling product (App Store id6758777908), so
it was never ours to use. It had reached VITE_APP_URL, which is the auth
redirectTo in LoginPage — every magic-link and OAuth sign-in was asking Supabase
to return users to a third party's website. The VAPID and SMTP identities pointed
at mailboxes on that domain and could never have delivered.

Canonical URL is now https://rota.gakinz.com, a subdomain of the gakinz.com
cPanel account with its own docroot. Verified live end to end: DNS
(Cloudflare-proxied, DNSSEC valid), wildcard TLS, SPA routing, PWA assets, and a
real Google sign-in round-trip — the redirect allowlist can only be proven that
way, since /auth/v1/authorize echoes any redirect_to.

OAuth gating is now per-provider (VITE_ENABLE_OAUTH="google,github") rather than
a single boolean: providers are enabled independently in Supabase, so one flag
for both is necessarily wrong for one of them whenever they differ. Unknown or
legacy values match nothing, so a misconfiguration hides the buttons rather than
shipping dead ones.

DEPLOYMENT.md now records the two traps hit on the first deploy: cPanel's
Document Root field is relative to $HOME, and rsync -a preserves local file modes
(a 600 .htaccess is unreadable by the web server, which silently disables SPA
routing and leaves directory listing on).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `bd454ae` 2026-07-29 — devgeereact

ci: promote format gate, add CodeQL and Dependabot now the repo is public

The repo is public, so Actions minutes are no longer the constraint and CodeQL
and Dependabot are free. Both are worth having here specifically: RotaFlow is
multi-tenant and holds staff personal data, so a compromised transitive
dependency or a tainted redirect runs in the same context as the session token.
CodeQL is also the only automated check that reads supabase/functions/**, which
is Deno and excluded from npm typecheck/lint.

Cleared the 37-file Prettier backlog with `npm run format` and removed
continue-on-error, so format:check is now a hard gate — the workflow was written
waiting for exactly that.

Formatting shifted an eslint-disable-next-line in useOptimizedImage.ts away from
the line it suppressed, which turned a working directive into an "unused disable
directive" error under --report-unused-disable-directives. Anchored it directly
above the dependency array, where Prettier cannot detach it.

Dependabot batches dev and patch updates into single PRs and ignores React and
Vite majors, which are deliberate migrations rather than its call.

Verified locally: format:check, typecheck, lint and build all clean; all three
YAML files parse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `8b07150` 2026-07-29 — devgeereact

feat: invites, signup, and password reset (Phase 2 — access & identity)

Onboarding was create-only: there was no mechanism to add a second user to an
org, which made every staff-facing screen untestable with a real staff account.
This adds the missing link plus the auth screens that surround it.

Two parts of the invite design are security-load-bearing.

Only a sha256 hash of the token is stored; create_invite() returns the raw token
exactly once, for the link. A dump of the invites table therefore yields no
usable invitations. sha256() is core Postgres, so this needs no extension.

Redemption cannot go through RLS. The invitee is authenticated but is not yet a
member of the org, so any org-scoped policy on invites correctly hides the row
from the one person who needs it — the same bootstrap problem that broke org
creation in 0003. Redemption runs in SECURITY DEFINER functions while the table
stays restricted to owners/managers, and accept_invite() additionally requires
the signed-in email to match the invited address, so a forwarded link is not a
free pass into the tenant. Adding a permissive select policy to "make it work"
would expose every pending invite in the system.

Screens: /invite/:token (public — preview_invite is granted to anon so an
invitee can see who invited them before signing up), /app/team for managers to
issue and revoke, standalone /signup, /forgot-password and /reset-password.

The invite token is carried through signup so the email-confirmation link
returns to the invitation rather than the dashboard; confirming otherwise
strands the invitee with no route back. The forgot-password confirmation is
identical whether or not the account exists, so the form cannot be used to
enumerate accounts.

database.types.ts is hand-extended for the new table and functions because the
Supabase CLI is not linked and types cannot be regenerated yet.

Migration 0006 is NOT yet applied — see the follow-up note.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `dd2d064` 2026-07-29 — devgeereact

feat: 5-step onboarding wizard and real app-boot screen (Phase 2 complete)

Replaces the single-field create-only onboarding stub with the five-step wizard
from design/Organisation-Onboarding.png → design/Onboarding-Complete.png:
create organisation, about, invite team, choose plan, done.

The organisation is created at the end of step 1 rather than the end of the
wizard. Steps 2-4 need an org id to write against, and a user who abandons
halfway then still has a usable workspace instead of nothing. Every later step
is an update and every later step is skippable.

The design's subdomain field offered "<name>.rotaflow.app". That domain is not
ours and the architecture is one app with an org switcher, not per-tenant
subdomains, so it is presented as the organisation identifier that `slug`
actually is. Live availability needs 0007: the RLS policy on organisations only
exposes orgs the caller belongs to, so a taken slug looks free to everyone
outside that org and the clash only surfaces as a failed insert. The new
slug_available() returns a boolean and nothing else, so confirming availability
does not become a tenant-enumeration endpoint. If 0007 is absent the check
degrades to "unknown" rather than blocking the user.

Two places where the design promises more than the system does, stated plainly
in the UI rather than implied away: invitations are not emailed (that needs the
SMTP Edge Function) so each produces a link to send manually, and choosing a
plan takes no payment — it records intent so the right features are enabled.
Enterprise is enquiry-only because the plan check constraint has no such value.

AppBootScreen implements design/appboot.png and replaces the bare splash in
ProtectedRoute and AppShell. Its stages and progress bar are computed from real
signals — connectivity, auth session resolution, membership resolution — not a
timer. A bar that advances on a timer claims progress the app may not be making,
which misleads exactly when it matters most: a staff member on bad ward wifi
trying to see today's shift.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `3779481` 2026-07-29 — Gideon Akinlotan

Merge Phase 1.5 hardening and Phase 2 access & identity

Phase 1.5 hardening (published-rota reload, session teardown, load-failure vs
empty state, toasts, OAuth gating), the rota.gakinz.com domain migration, CI +
CodeQL + Dependabot, and Phase 2 access & identity (invites, /signup, password
reset, 5-step onboarding wizard, real app-boot screen).

Outstanding: migrations 0006_invites.sql and 0007_slug_available.sql are written
but NOT applied — the invite flow does not work until they are.
---
## `d0ce1d6` 2026-07-29 — devgeereact

feat: /app/schedule — published rota views with ICS export (Phase 3)

The first genuinely staff-facing screen, and the one the Phase 1.5 fix made
possible: published rotas were previously unreadable by anything, because
nothing ever loaded a rota by any status other than draft.

Shows only shifts attached to a PUBLISHED rota. A draft is a manager's working
copy, and surfacing it here would tell a staff member they are working a shift
that is still being moved around. listShiftsForPeriod defaults publishedOnly to
true so a caller has to ask for drafts deliberately.

Filtering is by instant rather than date string. A night shift starting 23:00
local belongs to the day it starts, and comparing dates as text gets that wrong
across a timezone boundary. Period boundaries convert through the location's
zone, not the browser's, so a London rota viewed from a laptop set to New York
still starts at midnight in London.

Managers get a staff x date grid grouped by location; staff get a date-grouped
agenda, which is what someone checking their phone actually wants and the only
readable option for a 31-day month. Staff are grouped by where they are actually
rostered this period rather than a home location, because staff_profiles has no
location column and anything else would be invented.

Deliberately omitted from the design references, because the data does not exist
and rendering it would be fiction: coverage % (no required-staff target), labour
cost (no pay rates), open requests (leave/swaps/overtime are a later phase),
announcements, publishing history, auto-publish, and change history. The stats
row shows only what the schema can answer — people, shifts, scheduled hours,
unfilled.

ICS export emits UTC instants with stable per-shift UIDs, so re-subscribing
updates events rather than duplicating them, and folds lines at 75 octets
because Outlook is not always lenient about it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `0bb32b4` 2026-07-29 — devgeereact

design: splash screen matched to design/splash-screen.png

Design-match loop output for the splash screen: a BrandMark component, a
SplashWaves background, and the splash rebuilt against the reference.

Adds a `brand`/`ink` colour namespace rather than bending the existing tokens.
The brand-expression surfaces — logo mark, wordmark, splash waves — run hotter
and cooler than the muted product `primary`/`content` tokens, and sharing one
scale would mean restyling the splash silently restyles the rota grid.

The version now comes from package.json via a Vite `define`, so the splash
cannot drift from the actual shipped version the way a hardcoded string would.

Two things this needed on top of the loop output:

Prettier had not been run, which fails CI — `format:check` became a hard gate
when the backlog was cleared, so this would have gone red on push.

design/.loop/ is gitignored. It holds a ~250 KB screenshot per iteration, and
committing them would bloat the repo for artefacts that are regenerated on
every run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `746d5ed` 2026-07-29 — Gideon Akinlotan

Phase 3: /app/schedule — published rota views with ICS export

Merging PR #10 into main per user request.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
---
## `fe66bdc` 2026-07-29 — devgeereact

design: refine splash waves and brand token contrast

Follow-up pass on the splash design-match loop (see 0bb32b4): adjusts
SplashWaves proportions and BrandMark contrast against the reference render.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `0e01068` 2026-07-29 — devgeereact

feat: real marketing homepage, replacing the pwa-forge scaffold placeholder

/ was still the unmodified scaffold: "Ship a PWA today", generic starter copy,
a "View docs" link to raw github.com. That is what has been live at
https://rota.gakinz.com. Replaces it with an actual RotaFlow homepage: nav,
hero, industries strip, feature grid, closing CTA, footer.

Every claim on this page is checked against what is actually built, not the
full PRD scope. The PRD's Phase 1 lists ~14 feature families and most are not
built yet (conflict detection, GPS clock-in, leave, swaps, timesheets, reports,
notifications). A pre-launch product's homepage should not advertise ahead of
the build, so FeatureGrid lists six things that genuinely exist today: the
drag-and-drop rota builder, AI-assisted auto-fill, staff/locations directory,
the published-only schedule view with calendar export, secure email invites,
and installable-PWA support. Its own comment states the rule for future edits:
check docs/SCREENS.md's `[Built]` column before adding an entry.

No fabricated stats, testimonials, or customer logos anywhere — none exist yet,
and inventing them is worse than a page that undersells. IndustryStrip uses the
target-industry list verbatim from docs/PRD.md's positioning section (who the
product is designed for), not a claim that organisations in them are customers.
PublicFooter has no social links or contact address for the same reason: an
unmonitored mailto or a link to a nonexistent account is worse than the row not
existing.

Also fixes index.html's meta description, which claimed clock-in, shift swaps
and leave management — none of which are built. Same public-honesty concern as
the page itself, and it feeds search snippets and social share previews
directly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `b5329e7` 2026-07-29 — devgeereact

feat: real marketing homepage, replacing the pwa-forge scaffold placeholder

/ was still the unmodified scaffold: "Ship a PWA today", generic starter copy,
a "View docs" link to raw github.com. That is what has been live at
https://rota.gakinz.com. Replaces it with an actual RotaFlow homepage: nav,
hero, industries strip, feature grid, closing CTA, footer.

Every claim on this page is checked against what is actually built, not the
full PRD scope. The PRD's Phase 1 lists ~14 feature families and most are not
built yet (conflict detection, GPS clock-in, leave, swaps, timesheets, reports,
notifications). A pre-launch product's homepage should not advertise ahead of
the build, so FeatureGrid lists six things that genuinely exist today: the
drag-and-drop rota builder, AI-assisted auto-fill, staff/locations directory,
the published-only schedule view with calendar export, secure email invites,
and installable-PWA support. Its own comment states the rule for future edits:
check docs/SCREENS.md's `[Built]` column before adding an entry.

No fabricated stats, testimonials, or customer logos anywhere — none exist yet,
and inventing them is worse than a page that undersells. IndustryStrip uses the
target-industry list verbatim from docs/PRD.md's positioning section (who the
product is designed for), not a claim that organisations in them are customers.
PublicFooter has no social links or contact address for the same reason: an
unmonitored mailto or a link to a nonexistent account is worse than the row not
existing.

Also fixes index.html's meta description, which claimed clock-in, shift swaps
and leave management — none of which are built. Same public-honesty concern as
the page itself, and it feeds search snippets and social share previews
directly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `87bebbf` 2026-07-29 — devgeereact

design: app-boot screen matched to design/appboot.png

Rebuilds AppBootScreen against the reference pixel-for-pixel: header lockup,
5-stage tracker with a new StepRing primitive, progress card, and a single-row
feature grid (previously wrapped 3-then-1).

StepRing (src/components/ui/StepRing.tsx) draws the per-stage circle as an SVG
ring — a checkmark badge for done, a fixed ~40% arc for active (the reference
itself shows a 40% ring next to a 60% card figure for the same stage, so the
ring is decorative "in motion" rather than a literal readout), and a muted
uniform ring for pending. Pending's icon colour is a new brand-faint token,
sampled directly since it isn't reproducible as a brand/opacity blend over
white.

StatusPill (src/components/ui/StatusPill.tsx) is extracted from SplashScreen,
which had the identical "Online | v1.0.0" pill inlined — both screens share it
now instead of a second copy.

Adds a /appboot preview route, same pattern as the existing /splash route: the
real component only ever renders inline from ProtectedRoute/AppShell while
auth or org membership is resolving, so a fixed-props route is needed to see
and screenshot the mid-boot state the reference shows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `3725a8e` 2026-07-29 — devgeereact

style: format app-boot screen files with prettier

format:check is a hard CI gate on this repo; StepRing/StatusPill/AppBootScreen
weren't run through it before the previous commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `d7f0d6f` 2026-07-29 — Gideon Akinlotan

Merge real marketing homepage

Replaces the pwa-forge scaffold placeholder at / with an actual RotaFlow homepage. See PR #14 for details.
---
## `deff23c` 2026-07-29 — devgeereact

feat: offline write outbox — useSyncQueue infrastructure (Phase 4, part 1)

Builds the IndexedDB write outbox documented in docs/HOOKS.md §8 and
docs/ARCHITECTURE.md §4/§6, to the exact approved useSyncQueue contract.

No screen calls enqueue() yet — clock-in, leave requests and swap requests are
Phase 5/6, not built. This lands the outbox now so those phases have a tested,
working queue to write against on day one, the same way inviteService landed
before onboarding's team step first called it (Phase 2).

Offline READS needed no new work here: ARCHITECTURE.md already assigns reads to
the service worker's NetworkFirst Supabase cache (shipped in Phase 1), which is
transparent to the app's fetch calls — a cache hit returns successfully with no
error path to handle. The real gap was the write side, which is what this adds.

No new dependency: one IndexedDB object store, four operations, doesn't justify
idb/dexie. flushQueuedWrites() replays queued items sequentially, oldest first,
and stops at the first failure rather than racing every item in parallel —
parallel replay could land writes out of order (e.g. a leave request cancelled
offline then re-requested must apply in that order, not whichever round trip
finishes first), and if the failure is a dropped connection, every later item
would fail too.

clockService/leaveService/swapService are data-layer only (insert functions,
no UI) — clock_events, leave_requests and shift_swaps already exist with RLS
from 0002_rotaflow.sql, so the replay path has something real to call.
swapService is scoped to the requester creating a request; the RLS gap that
blocks the *target* colleague from writing an acceptance is real but belongs to
Phase 6's swap workflow, not bundled in here — noted in the service's comment
rather than silently worked around.

Verification: typecheck, lint, format, build clean; every new module confirmed
to transform cleanly in dev. Real IndexedDB behavior could not be exercised —
no browser driver is available in this environment and the project has no test
runner — so this is verified by type-safety and code review of the
open/transaction/close pattern, not by a passing test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `a3e0719` 2026-07-29 — Gideon Akinlotan

Merge Phase 4 (part 1): offline write outbox

useSyncQueue infrastructure — IndexedDB outbox + clock/leave/swap replay targets. See PR #15 for details.
---
## `0872048` 2026-07-29 — devgeereact

feat: time & attendance — GPS/manual clock-in, hours, manager review (Phase 5)

Adds /app/clock (GPS + manual, offline-queued) and /app/timesheets (staff
"My hours" / manager "Team" toggle), and gives Phase 4's sync-queue
infrastructure its first real consumer.

QR clock-in is deliberately deferred: it needs a per-location code to scan,
and nothing in the product generates one yet. Building the scan side without
the generation side would ship a screen with no way to actually use it.

Hours are computed client-side from clock_events (lib/hours.ts pairs
in/break_start/break_end/out into worked segments), not read from the
timesheets table. That table exists with RLS but no automation populates it —
no trigger, no cron — and its submit/approve/export lifecycle needs product
decisions (what period? who submits? who approves?) that were never specified.
Inventing that workflow here would be guessing at business rules Phase 5
wasn't given; showing real worked hours computed from the actual event log is
what's actually buildable and honest right now.

The offline path is why this screen exists in Phase 5 rather than any other
phase: a failed insert while offline enqueues via useSyncQueue's 'clock' kind
(built in Phase 4 with no caller) instead of failing the action. GPS clock-in
is soft-checked against a location's geofence (haversine distance in
lib/geo.ts) when the location has coordinates — most won't yet, since address
is optional at onboarding and lat/long aren't collected there at all — so a
missing geofence is treated as "not configured", not a false rejection that
would make GPS clock-in unusable for most orgs.

clock_events.type is a `text` + check-constraint column, so Supabase's
generated ClockEvent['type'] is plain `string`, not a literal union — too wide
to safely index the status/label lookups. ClockInPage defines its own narrower
ClockEventType matching the same constraint, with a toClockEventType() guard
rather than casting.

Also updates docs/SCREENS.md: Phase 3 (schedule) and Phase 4 part 1 (outbox)
entries were missing since their PRs landed; the invites migrations note is
corrected to reflect they were applied 2026-07-29.

Verification: typecheck, lint, format, build clean; every new module confirmed
to transform cleanly in dev.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `fb0c26e` 2026-07-29 — Gideon Akinlotan

Merge Phase 5: time & attendance

GPS/manual clock-in, hours, manager review. See PR #16 for details.
---
## `3428770` 2026-07-29 — devgeereact

design: sign-up screen matched to design/signup.png

Rebuilds SignupPage against the reference: split marketing/form layout,
first/last name + work email + password fields with leading icons, a live
password-requirements checklist, Google/GitHub OAuth buttons, a magic-link
option, and a trust-badge strip.

GitHub replaces the reference's Microsoft button per request — this also
aligns with what the codebase already expected: src/lib/env.ts already typed
OAuthProvider as 'google' | 'github' and .env.example already configured
VITE_ENABLE_OAUTH="google,github", so GitHub was the intended second provider
already, just not wired into any screen's UI yet.

Two content decisions, both because RotaFlow is pre-launch with no real
customers and HomePage.tsx already has a stated policy against fabricated
social proof:
- Dropped the reference's testimonial (name/role/photo) — asked the user
  first since this directly matches a case that policy already covers; they
  chose to omit it.
- Dropped the reference's "99.9% uptime" trust badge (an SLA nobody has
  committed to), keeping "Secure & encrypted" and "GDPR compliant", which
  describe the actual architecture.

New shared primitives (this shell is visibly also design/signin.png's shell,
so building it as reusable now isn't speculative):
- AuthSplitLayout, OAuthButtons, PasswordRequirements, AuthTrustStrip
  (src/components/auth/)
- GoogleIcon, GithubIcon (src/components/ui/icons/) — brand logos as inline
  SVGs since lucide-react is a single-colour outline set with no brand marks
- Input gained icon/endAdornment/wrapperClassName props, backward-compatible
  with every existing call site
- Password rule evaluation lives in src/lib/password.ts, not colocated with
  its component (colocating tripped the react-refresh lint rule)

Auth-screen CTAs and links use the vivid `brand` blue token (from the splash
screen work), not the product's muted `primary` — sampled directly from the
reference, applied via a className override rather than changing Button's
primary variant globally.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `4a6c92f` 2026-07-29 — Gideon Akinlotan

Merge pull request #11 from devgeereact/design-splash-match

Design: splash, marketing homepage, and app-boot screens matched to reference
---
## `8b14230` 2026-07-29 — Gideon Akinlotan

Merge pull request #17 from devgeereact/design-signup-match

Design: sign-up screen matched to design/signup.png
---
## `17b008a` 2026-07-29 — devgeereact

feat: requests workflow — availability, leave, shift swaps (Phase 6)

Adds /app/availability, /app/leave and /app/swaps, and gives leaveService and
swapService (data-layer only since Phase 4) their first screens, and
useSyncQueue its second and third real consumers after clock-in.

Fixes a real RLS gap this session flagged and deliberately deferred to this
phase: shift_swaps_write only ever granted write access to the requester and
managers, so the colleague a swap actually targets could see the row
(shift_swaps_select includes them) but had no way to accept or decline it.
0008_shift_swaps_target_respond.sql adds a narrower, separate policy — only on
a still-pending row, only into 'accepted' or 'rejected', never 'approved' or
'cancelled' — rather than widening shift_swaps_write itself, because the
target's grant has to be much smaller than the requester's or a manager's.
Like 0006/0007 before it, this migration is written but not yet applied.

Approving a swap in the approvals queue marks the row approved only — it does
not reassign the shift on the rota. That write is the same path as any other
reassignment and belongs in the rota builder, which has the conflict/coverage
context an approval click does not; bypassing it from here would skip that
context, not save a step.

Leave entitlement is a real number from real data (holiday_allowance minus
approved days used this calendar year), not a business-rule engine — it counts
inclusive calendar days per request, not working days, since the schema has no
working-pattern data to exclude weekends/off-days correctly. Availability is
recurring weekly-pattern only; a specific date is representable in the schema
but not exposed here, since a one-off exception is closer to a leave request,
which already has its own screen.

Deliberately not built: overtime requests. overtime_requests exists with RLS,
but unlike availability/leave/swaps no route for it was ever named in
ARCHITECTURE.md — genuinely [Gap], not a deferred [V1].

Same clock_events.type issue recurs here: availability.status is text + a
check constraint, so the generated Availability['status'] is plain string, too
wide to index STATUS_STYLE safely. Same fix as ClockInPage — a narrower local
AvailabilityStatus type with a toClockEventType-style guard, not a cast (the
cast was the same-type no-op ESLint's no-unnecessary-type-assertion caught).

Verification: typecheck, lint, format, build clean; every new module confirmed
to transform cleanly in dev.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `d4356f4` 2026-07-30 — Gideon Akinlotan

Merge Phase 6: requests workflow

Availability, leave, shift swaps. See PR #18 for details.
---
## `607f4a8` 2026-07-30 — devgeereact

build(ts): drop deprecated baseUrl from tsconfig

TypeScript 7.0 removes `baseUrl`; 6.0 already errors on it unless
`ignoreDeprecations` is set. Silencing it only defers the work, so migrate
instead: since TS 4.1 `paths` mappings resolve relative to the tsconfig that
declares them, so `baseUrl` was redundant here.

No import needed it — every alias goes through `@/`, and Vite resolves that
independently in vite.config.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `dc3f9eb` 2026-07-30 — devgeereact

design: onboarding wizard matched to the reference screens

Reworks the 5-step onboarding flow against design/Organisation-Onboarding.png,
Organisation-about.png and Onboarding-Complete.png: marketing left panel with a
reusable BuildingIllustration over SplashWaves, restyled step cards/progress,
and a rebuilt "about your organisation" step.

Supporting pieces:
- BuildingIllustration — identical across all three reference screens, so built
  once and reused rather than duplicated per step.
- LanguagePill — the "English (UK)" indicator. Deliberately a div, not a
  button: there is no locale switcher behind it yet, and a focusable control
  that does nothing is worse than a plain indicator.
- OnboardingPreviewPage at /onboarding-preview — /onboarding needs a real
  Supabase session and writes real rows (orgs, locations, invites), so the
  reference-designed steps render against mock local state for screenshotting.
  Follows the existing /splash and /appboot preview-route pattern.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `9190d0f` 2026-07-30 — devgeereact

Merge remote-tracking branch 'origin/main' into design-onboarding-match


---
## `396fd25` 2026-07-30 — Gideon Akinlotan

Merge pull request #19 from devgeereact/design-onboarding-match

design: onboarding wizard matched to reference screens + tsconfig baseUrl migration
---
## `bbb740c` 2026-07-30 — devgeereact

feat: notifications & announcements — in-app, Web Push, org comms (Phase 7)

Completes the comms layer: an in-app notification feed with an unread bell,
org-wide announcements, and optional Web Push so time-critical events (rota
published, swap responded, leave decided) reach staff with the app closed.

- notificationService / announcementService — feed reads and writes, RLS-scoped.
- push_subscriptions (0009) — keyed by user_id, not staff_profile_id: an owner
  or platform admin with no staff record still has an account and still gets
  notified. Unique per endpoint, since one person subscribes separately from
  phone and laptop and both must receive a push.
- send-notification Edge Function — the only place VAPID signing happens, so
  the private key never reaches the client.
- useWebPush — degrades to 'unsupported' rather than throwing where Notification
  or serviceWorker is absent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `90da73f` 2026-07-30 — devgeereact

Merge remote-tracking branch 'origin/main' into phase-7-comms


---
## `96d34d9` 2026-07-30 — Gideon Akinlotan

Merge pull request #20 from devgeereact/phase-7-comms

feat: notifications & announcements — in-app, Web Push, org comms (Phase 7)
---
## `02af9d9` 2026-07-30 — devgeereact

ci: fix Prettier formatting on the merged onboarding design-match files

PR #19 (design-onboarding-match) merged without npm run format having been
run, which put main's format:check hard gate red — CI has failed on every
push since (confirmed on PR #20). No behaviour change, formatting only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `201cd35` 2026-07-30 — Gideon Akinlotan

Merge CI: fix Prettier formatting on onboarding design-match files

Formatting only, unblocks main's format:check gate. See PR #21.
---
## `b425d0b` 2026-07-30 — devgeereact

design: fix onboarding wave illustration and add save-and-exit

Two fixes on top of the onboarding design-match pass:

Replaces the reused SplashWaves illustration with a new OnboardingWave.
SplashWaves is fitted to a wide ~16:9 canvas; stretched with
preserveAspectRatio="none" into the marketing panel's narrow, tall aspect
ratio (~320px wide, full viewport tall), its five layered curves collapsed
into steep, unrecognisable triangles. OnboardingWave is a fresh, simple
percentage-based shape that tolerates the stretch.

Adds a working "Save and exit" button to StepAbout (design/Organisation-
about.png shows one). The organisation already exists by step 2, so exiting
mid-wizard with the current step's answers saved is a real, low-risk action —
OnboardingPage.handleAbout now takes an after: 'continue' | 'exit' parameter
instead of always advancing to step 3. Also removes a `truncate` that was
clipping the stepper's step-2 subtitle text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `b63eb07` 2026-07-30 — devgeereact

Merge remote-tracking branch 'origin/main' into design-onboarding-match

# Conflicts:
#	src/components/onboarding/StepAbout.tsx

---
## `b49dfe4` 2026-07-30 — Gideon Akinlotan

Merge pull request #22 from devgeereact/design-onboarding-match

design: fix onboarding wave illustration and add save-and-exit
---
## `93a1114` 2026-07-30 — devgeereact

feat: org settings + integrations (Phase 8)

Owner-only /app/settings (name, industry, org type, country, timezone,
working week) and /app/integrations for per-org SMTP so notification
emails send from an org's own mailbox instead of a shared sender.

org_smtp_settings has no select policy at all — the password can be
written but never read back through the client, even by the owner who
set it. org_smtp_settings_safe (security_invoker view) is what the UI
queries; test-smtp is the only Edge Function that ever reads smtp_pass,
and only after confirming ownership via has_org_role. send-notification
now prefers an org's own SMTP and falls back to the global SMTP_* secrets.

---
## `9e2a8eb` 2026-07-30 — Gideon Akinlotan

Merge pull request #23 from devgeereact/phase-8-settings

Phase 8: org settings + integrations (per-org SMTP)
---
## `627865a` 2026-07-30 — devgeereact

fix: address CodeRabbit findings on Phase 8 SMTP settings

- Reset verified_at on any connection-affecting edit, not just password
  changes, so the "Verified" badge can't outlive an untested config.
- Surface (don't silently swallow) org SMTP lookup errors in
  send-notification, so a transient failure can't masquerade as
  "no org SMTP configured".
- Set secure:true for port 465 (implicit TLS) and add connection/greeting
  timeouts to both nodemailer transports, so a bad owner-provided host
  fails fast instead of hanging.
- Correct the "no select policy" claim in the migration/type/service/page
  comments: the owner-scoped `for all` policy does permit SELECT — the
  actual protection against reading smtp_pass back is the column-level
  GRANT, not RLS.
- Gate both new pages on `loading` before rendering the form, so a
  pre-filled field can't flash empty/default values while the fetch is
  still in flight.
- Confirm before removing SMTP settings (irreversible, drops to the
  shared sender immediately).
- Fix stale doc rows: Roles & team management already shipped in Phase 2,
  GDPR export/delete is deferred (not "backed by audit_logs" as if built),
  plus a comma nit.

---
## `5f69ed2` 2026-07-30 — Gideon Akinlotan

Merge pull request #24 from devgeereact/phase-8-coderabbit-fixes

fix: CodeRabbit findings from Phase 8 (missed by early merge of #23)
---
## `eb02ffe` 2026-07-30 — devgeereact

feat: host Inngest functions on a Supabase Edge Function

Inngest Cloud has no dashboard-level "route event X to URL Y" webhook
feature — functions are code you host yourself, discovered by syncing
this endpoint. Adds one Inngest function per event dispatched by
useInngestDispatch (leave/reviewed, rota/published, swap/reviewed,
announcement/published), each forwarding the event's data verbatim to
send-notification, which already validates shape and resolves org vs
global SMTP.

Deployed with --no-verify-jwt: Inngest's own request signing
(INNGEST_SIGNING_KEY) authenticates calls into this function, so
Supabase's gateway JWT check would only ever reject them.

---
## `206828c` 2026-07-30 — Gideon Akinlotan

Merge pull request #25 from devgeereact/phase-8-inngest-function

feat: host Inngest functions on a Supabase Edge Function
---
## `a13a900` 2026-07-30 — devgeereact

design: invite-your-team onboarding step matched to reference

Rebuilds StepInviteTeam (step 3 of the onboarding wizard) against
design/Team-onboarding.png: textarea email input, Role/Department/Location
select row, an "About roles" callout, and a real table (avatar, email, role
badge, department, location, status, remove) replacing the previous
single-column list. Adds TeamIllustration for this step's marketing panel
(three people at a table) — OnboardingLayout now takes an optional
`illustration` prop, defaulting to BuildingIllustration, rather than
hardcoding one illustration for every step.

Two content-accuracy decisions, no question asked (same standing policy as
the splash/signup/onboarding work):

- Kept "Create N invitations" over the reference's "Send invites" / paper-
  plane icon. createInvite() only mints a link via RPC; nothing in this
  codebase emails it. Checked whether this session's earlier SMTP-settings
  work (Phase 8) changed that — it didn't, nothing wires SMTP to invite
  creation yet.
- Department/location per invitee are staged locally for the reviewer's own
  planning, not persisted: createInvite() takes org/email/role only, and the
  invites table has no columns for either. Documented directly on the
  StagedInvite type rather than silently dropping the fields (which would
  diverge from the reference) or silently discarding the data on submit
  (which would look like it works but wouldn't). Location options are real,
  pulled from step 2's captured locations; department is a small fixed list
  since no real department data exists this early in onboarding.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `d66e803` 2026-07-30 — Gideon Akinlotan

Merge pull request #26 from devgeereact/design-team-onboarding-match

design: invite-your-team onboarding step matched to reference
---
## `ce0934a` 2026-07-30 — devgeereact

design: sign-in screen matched to design/signin.png

LoginPage was still the pre-design-system scaffold — plain Card, no icons,
an inline "Sign up" button duplicating the real /signup flow. Rebuilds it
against design/signin.png, reusing the auth primitives already built for
/signup: AuthSplitLayout, OAuthButtons, AuthTrustStrip, LanguagePill, and
Input's icon/endAdornment support. Same content decisions as that pass,
already established and not re-asked: no fabricated testimonial (the
reference's "Emma Thompson, Ward Manager" quote), no dashboard-mockup
illustration, and the AuthTrustStrip's existing two-badge set (drops the
reference's unverified "99.9% uptime" claim).

Google + GitHub for OAuth (not the reference's Microsoft), consistent with
OAuthProvider in src/lib/env.ts.

The old "Sign up" button (a second signUp() call inline on this page,
redundant with the real /signup flow) is now a "Don't have an account?
Sign up" link to /signup, matching the reference and removing the
duplicate signup path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `4bbd54f` 2026-07-30 — Gideon Akinlotan

Merge pull request #27 from devgeereact/design-login-match

design: sign-in screen matched to design/signin.png
---
## `aea30b2` 2026-07-30 — devgeereact

design: choose-plan onboarding step matched to reference

WIP checkpoint before the design-loop screenshot pass.

---
## `6b22b55` 2026-07-30 — devgeereact

design: tighten choose-plan card spacing to match reference

Feature list text was wrapping to two lines where the reference stays
single-line; reducing card/grid padding and using the text-xs caption
token (not an arbitrary size) fixes all but the longest 3-word items.

---
## `c9f5cdc` 2026-07-30 — devgeereact

feat: reports (CSV export) + GDPR export/anonymize (Phase 9)

/app/reports: date-range CSV export for timesheets (computed from real
clock_events via the same pairClockEvents math /app/timesheets already
shows), leave, published shifts, and shift swaps. Owner/manager, fully
client-side — RLS already scopes every query to the org.

/app/staff: per-person GDPR actions (owner-only). Export downloads
everything RotaFlow holds on that person as JSON. Anonymize scrubs PII
on staff_profiles (name/phone/photo/payroll_id/user_id) and hard-deletes
emergency_contacts/documents, via a new SECURITY DEFINER RPC
(anonymize_staff_member, 0011) that enforces owner-only server-side.
Deliberately anonymizes rather than hard-deletes shift/timesheet/leave
rows, so payroll and rota history stay consistent. Scoped to one
organisation — does not touch the person's RotaFlow login, which can
span other orgs and needs the Auth Admin API, a platform-level
operation.

---
## `54b0746` 2026-07-30 — Gideon Akinlotan

Merge pull request #28 from devgeereact/design-plan-selection-match

design: choose-plan onboarding step matched to reference
---
## `dedb133` 2026-07-30 — Gideon Akinlotan

Merge pull request #29 from devgeereact/phase-9-reports-gdpr

Phase 9: reports (CSV export) + GDPR export/anonymize
---
## `33504ed` 2026-07-31 — devgeereact

design: manager dashboard matched to design/Workforce-Dashboard.png

Rewrites /app/dashboard from a two-card placeholder stub into the manager's
real operational overview: today's coverage, staffing, pending requests,
compliance, shortages, announcements, upcoming shifts, quick actions and a
monthly calendar.

New src/services/dashboardService.ts computes every number from real
Supabase data — no fabricated stats:
- Today's Shifts / Staff On Shift / Shortages: per-person shift-slot rows for
  the selected day, grouped into (shift type, location, start, end) rows.
- Compliance: 100 * (active staff - staff with an expired document) / active
  staff, from the real `documents` table (DBS/RTW/visa expiry) — no
  compliance metric existed anywhere in this app before this.
- Pending Requests: real leave_requests + shift_swaps where status='pending',
  merged newest-first. Deliberately excludes overtime (the reference shows an
  overtime count) — overtime_requests exists in the schema but has no service
  built on it, and querying it directly here would bypass RULES.md's "all
  Supabase access via src/services/*".
- Announcements / Upcoming Shifts / Monthly Overview: real listAnnouncements
  and forward-looking shift queries; the calendar's dot colour reflects
  whether that day's slots are actually fully filled.

Quick Actions: five of six route to real pages; "View Reports" renders
disabled, matching Sidebar.tsx's own existing "Soon" treatment for the same
nav item, since Reports isn't built yet — a fake link would repeat the
dead-control mistake already avoided on every earlier screen.

Deliberately does NOT touch Sidebar.tsx or Header.tsx, even though the
reference shows a fuller shell (org-info block in the sidebar, a global
search bar and help icon in the header). Both files are shared across every
/app/* route and another session has been actively editing shell-adjacent
code this session; the search bar and help icon each imply a feature that
doesn't exist (global search, a help centre) — same "don't fabricate a
destination" reasoning as every prior screen.

Uses the product's muted `primary` token, not the vivid `brand` blue the
newer marketing/auth screens sample from their references — this screen
sits in the same shell as SchedulePage/RotaBuilderPage/StaffPage, already
built against `primary`, and matching those neighbours matters more than
matching this one reference's exact hue.

Architecture: DashboardView (src/components/dashboard/) holds the markup as
a pure props-driven component; DashboardPage wires it to real hooks/services;
DashboardPreviewPage (/dashboard-preview, design-loop only) wires it to fixed
mock data shaped to match the reference's numbers, since /app/dashboard needs
a live session and a seeded org that no screenshot tool has.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `b0fbcab` 2026-07-31 — Gideon Akinlotan

Merge pull request #31 from devgeereact/design-dashboard-match

design: manager dashboard matched to design/Workforce-Dashboard.png
---
## `84aec6e` 2026-07-31 — devgeereact

fix: link dashboard's View Reports quick action to the real page

ReportsPage merged (main) after the dashboard design-match PR shipped it as
disabled ("Reports isn't built yet"). It is now — point the action at
/app/reports instead of rendering it as a dead, disabled tile.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `8ecc330` 2026-07-31 — devgeereact

style: run prettier on the reports-link fix

format:check is a hard CI gate; the previous commit's one-line change wasn't
run through it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
## `9908767` 2026-07-31 — Gideon Akinlotan

Merge pull request #32 from devgeereact/dashboard-reports-link

fix: link dashboard's View Reports quick action to the real page
---
## `1452caa` 2026-07-31 — devgeereact

feat: account settings + staff emergency contacts/documents (Phase 10)

/app/account: name edit, password change, notification preference —
moved from Dashboard, where it never belonged per docs/SCREENS.md.
Linked from the header user menu. Email change and avatar upload are
deliberately out of scope (need Supabase's confirmation round-trip /
ImageKit, neither wired in this repo).

/app/staff: per-person emergency contacts and documents, via two new
modals (manager/owner). Add + delete only, no edit — same trade-off
locationService.ts already made for locations, just in the other
direction. documents.file_url is a pasted link, not an upload — no
storage integration exists anywhere in this repo yet.

---
## `7608a41` 2026-07-31 — devgeereact

fix: address CodeRabbit findings on Phase 10 staff records

- Critical: validate the document link is http(s) before it's ever
  persisted or rendered as <a href>. The "Add document" button is
  type="button" with a direct onClick, not a form submit, so the
  input's type="url" constraint validation never ran — and even when
  it does, it accepts any scheme, javascript: included. A pasted
  javascript: URI would have been stored XSS the moment anyone clicked
  the link.
- Defense-in-depth: scope emergency-contact/document list and delete
  queries by org_id too, not just staff_profile_id/id. RLS already
  scopes every row by its own org_id regardless of client input, so
  this isn't closing a real hole — it's the same "don't rely on one
  layer" posture used elsewhere in this project.
- Fix a stale doc path (src/pages/DashboardPage.tsx ->
  src/pages/app/DashboardPage.tsx), predates this PR but caught while
  editing that row.

---
## `4cc8b22` 2026-07-31 — Gideon Akinlotan

Merge pull request #30 from devgeereact/phase-10-profile-records

Phase 10: account settings + staff emergency contacts/documents
---
## `fcac63b` 2026-07-31 — devgeereact

design: rebuild Rota Builder to match design/Rota-Builder.png

Multi-location week view (grid grouped by location, per-day staff/shift
mini-counts, daily totals with Optimal/Understaffed status), a real
shift inspector (Shift Details/Coverage/Warnings tabs backed by actual
open-shift data — no fabricated coverage % or headcount targets),
filters (location/department/shift type), and a quick-actions rail.

Coverage/warnings are derived from real schema fields (shifts.status
'open' = unfilled slot) rather than invented metrics — see
design/.loop/rota-log.md for what's real vs. intentionally stubbed.

---
## `d6ccce0` 2026-07-31 — devgeereact

design: polish Rota Builder inert-control styling, add preview page

- Formatted the date-range label and matched the reference's trailing
  chevron.
- Every not-yet-built control (Day/2 Weeks/Month view tabs, More
  filters, action rail buttons) now looks enabled and reports "coming
  soon" on click, instead of a disabled/50%-opacity treatment that read
  as permanently broken.
- Added /rota-builder-preview (mock data, mirrors OnboardingPreviewPage)
  so this screen can be screenshotted without a live Supabase session —
  no seeded demo account exists, and creating test org/staff/shift data
  directly in the shared live project risked polluting real data.

---
## `3d7a57e` 2026-07-31 — devgeereact

style: prettier formatting


---
## `559cb76` 2026-07-31 — Gideon Akinlotan

Merge pull request #33 from devgeereact/design-rota-builder-match

design: rebuild Rota Builder to match design/Rota-Builder.png
---
## `19e56f5` 2026-07-31 — devgeereact

fix: route OAuth/magic-link sign-in into the app, not the homepage

signInWithOAuth/signInWithOtp on Login and Signup redirected to the bare
app origin, landing a returning or newly confirmed user on the marketing
homepage instead of the dashboard (which itself routes on to onboarding
for accounts with no organisation yet). Point redirectTo at /app/dashboard
directly, matching the pattern already used for password reset and invite
acceptance.

Also add the missing active:scale-[0.98] tap state to the four custom
button-styled controls (OAuth buttons, both magic-link buttons, dashboard
quick-action tiles) that only had hover:scale-[1.02] — the shared Button
component already pairs both per docs/DESIGN.md's motion spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `7367ac9` 2026-07-31 — Gideon Akinlotan

Merge pull request #34 from devgeereact/fix-post-auth-routing-and-hover-consistency

fix: route OAuth/magic-link sign-in into the app; standardize hover/active states
---
## `8217005` 2026-07-31 — devgeereact

fix: stop pre-disabling magic-link buttons on empty email

The magic-link button was disabled until an email was typed, while Google/
GitHub stayed fully enabled the whole time. Combined with its outline/
text-colour styling (vs. the solid Sign in button), the disabled opacity
made it look permanently broken rather than "needs input" — confirmed the
backend itself is fine (Supabase's OTP endpoint returns 200 for the app's
actual signInWithOtp call).

Now the button is only disabled while a request is in flight, matching
Google/GitHub, and clicking it with no email shows an inline "Enter your
email address first" error instead of just sitting greyed out.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `c471744` 2026-07-31 — devgeereact

fix: use absolute asset base path; make PublicNav auth-aware

Critical: vite.config.ts's base was './' (relative), which resolves every
asset/manifest URL in index.html against the CURRENT route path rather than
the site root. rota.gakinz.com serves from its domain root, not a cPanel
sub-directory the relative base was written for. Landing directly on any
nested route (e.g. /app/dashboard right after the previous commit's OAuth/
magic-link redirect) requested assets from /app/assets/*, 404'd against
Apache's SPA fallback, got index.html's HTML back for a script/stylesheet
request, failed MIME-type checks, and left a permanently blank page with no
session ever established — explaining both the blank screen and "asks me to
sign in again and again" reports. base: '/' makes every reference absolute
so it resolves correctly regardless of route depth. Confirmed fixed against
the exact failing URL via headless Chrome (app now boots and correctly
falls through to /login for the already-consumed code).

Also: PublicNav (the homepage header) always showed "Sign in / Get started"
regardless of actual auth state, while the hero section right below it
already checked `user` and showed "Go to dashboard" — the inconsistency the
homepage screenshot showed. PublicNav now mirrors the hero's logic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `8e0ab15` 2026-07-31 — Gideon Akinlotan

Merge pull request #35 from devgeereact/fix-magic-link-disabled-state

fix: critical absolute-base-path bug breaking direct nested-route loads; magic-link UX
---
## `3233202` 2026-07-31 — devgeereact

fix: sidebar active-nav soft-tint style; rewrite docs/SCREENS.md

Sidebar active nav item was a white-pill/left-border treatment,
inconsistent with the documented design system (rounded-full is
reserved for pills/badges/avatars, not nav controls). Replaced with
the bg-X/10 text-X soft-tint idiom already used for status badges
elsewhere (AvailabilityPage, LeavePage, SwapsPage), documented in
docs/DESIGN.md so it isn't reintroduced. No screenshot tooling was
available in this session to visually diff against the reference —
flagged rather than claimed.

docs/SCREENS.md rewritten from scratch: verified against the actual
design/ directory contents (not assumed — 7 previously-referenced
filenames don't exist and never have) and the real src/App.tsx route
table, not the doc's own earlier claims, which had drifted from its
own later phase log. Fixed four stale "not built" rows (splash,
signup, forgot/reset password, accept invite — all real) and used
docs/LOOP.md's screenshot-verified tracking to resolve an otherwise
unconfirmable 3-mockups-to-1-screen mapping on /app/schedule.

---
## `02f1df7` 2026-07-31 — Gideon Akinlotan

Merge pull request #36 from devgeereact/phase-11-docs-nav

fix: sidebar active-nav style; rewrite docs/SCREENS.md
---
## `038aaae` 2026-07-31 — devgeereact

fix: validate email addresses before sending auth mail

Supabase warned this project (2026-07-31) about a high bounced-email
rate and threatened to restrict sending. Custom SMTP is now configured,
which protects Supabase's shared pool — but that only moves the bounces
onto our own cPanel mail server, whose reputation matters just as much.
This fixes the source.

Root cause: there is no <form> element anywhere in src/, so all five
type="email" attributes were decorative — native constraint validation
only runs on a real form submit, and every submit path here is an
onClick handler. The only guard on an address that triggered a Supabase
Auth email was `.trim().length > 0`.

- New src/lib/email.ts: isValidEmail (mirrors create_invite's SQL regex
  from 0006, plus a 2+ char TLD so a@b.c is rejected) and an advisory
  suggestEmailCorrection for mistyped domains. Domain typos are matched
  on the whole domain, never a suffix — a suffix match would "correct"
  the real yahoo.co.uk into yahoo.com.
- Hard-block malformed addresses on all four Auth-email paths (signUp,
  both magic links, resetPasswordForEmail) plus both invite paths.
- New EmailSuggestion component offers "did you mean gmail.com?" as a
  one-click fix. Advisory only, never blocking: a mistyped domain is
  still syntactically valid, and wrongly blocking a real address costs
  more than one bounce.
- LoginPage magic link now passes shouldCreateUser: false. Verified in
  the installed auth-js 2.110.9 that the default is true
  (`create_user: options?.shouldCreateUser ?? true`), so every typo on
  the sign-IN page was silently registering an orphan auth user and
  mailing a nonexistent mailbox. Signup via magic link still works on
  /signup, where creating the account is the intent.
- Onboarding's bulk invite textarea holds malformed addresses back for
  correction instead of staging them to be silently rejected later by
  the SQL regex, after the wizard has moved on.

---
## `3ac68f7` 2026-07-31 — Gideon Akinlotan

Merge pull request #37 from devgeereact/fix-email-bounces

fix: validate email addresses before sending auth mail (bounce reduction)
---
## `426f51a` 2026-07-31 — devgeereact

feat: live-update built screens via Supabase Realtime

Twelve screens now refresh themselves when someone else changes the
data behind them — a published rota reaching staff, an approval landing
in a manager's queue, a colleague clocking in — instead of showing
stale data until a manual reload.

- 0012_realtime.sql publishes the 13 operational tables to
  `supabase_realtime`. The publication was empty, so Realtime was doing
  nothing at all. Deliberately excluded: org_smtp_settings (its whole
  design in 0010 is that smtp_pass is unreadable by clients; a change
  payload is another way out of the database) and audit_logs (nothing
  renders it). Only tables a screen actually watches are published —
  every published table streams WAL for every subscriber, and the free
  tier's message budget is finite.

- useRealtimeRefresh (docs/HOOKS.md §11) treats an event purely as a
  "something changed" signal and re-queries through the screen's normal
  RLS-protected path, never rendering the payload. That is a security
  decision: Realtime does apply RLS to postgres_changes, but DELETE
  payloads carry only the primary key and cannot be filtered the way
  INSERT/UPDATE are, so re-querying is what guarantees no row reaches a
  screen that the viewer could not already read.

- Bursts are debounced 300ms: publishing a week's rota inserts every
  shift at once, and that should cost one refetch, not fifty.

- Scope is per-tenant on org_id, except Notifications, which scopes on
  user_id so a manager doesn't receive an event for every notification
  in the organisation.

Failure is non-fatal throughout: if the socket never connects, every
screen loads and refetches exactly as before.

Not wired: RotaBuilderPage — its load path calls getOrCreateRotaForPeriod,
which INSERTs into rotas, so a naive subscription risks a write→event→
refetch cycle and could disturb an in-progress drag. It needs a
mutation-aware guard, which is its own piece of work. ReportsPage is
on-demand only; the config screens (Integrations/OrgSettings/Account)
change too rarely to justify a socket.

---
## `d436995` 2026-07-31 — Gideon Akinlotan

Merge pull request #38 from devgeereact/feat-realtime

feat: live-update built screens via Supabase Realtime
---
## `8d087f0` 2026-07-31 — devgeereact

docs: rewrite SCREENS.md against the 16 newly-added design mockups

design/ grew from 18 screen mockups to 34. The new ones specify two
tabbed areas the app doesn't have — Settings (8 tabs) and My Profile
(6-7 tabs) — plus a full marketing site. Rewrote the inventory against
the real route table and real page code rather than the previous
version's claims.

Status is now three-valued. 🟡 "partial" earns its own state because
several rows would otherwise be misleading: /app/settings exists but
covers 1 of 8 designed tabs; /app/account holds 2 preference fields
against ~20 designed; the marketing home has a hero and feature grid
but none of the pricing/testimonial/demo the design specifies. Calling
any of those "built" would overstate the position.

Recorded which unbuilt features already have a backing table and which
have nothing at all — audit_logs and subscriptions exist but are
unread by any screen (verified: zero `from('<table>')` hits in src/),
while policies, roles, notification templates, MFA, sessions and API
tokens have neither table nor code. That distinction is the difference
between a day's work and a phase.

Also flagged the navigation divergence: the designs drop Clock in and
Team from the sidebar, move Integrations under Settings, and need a
collapsible nav group plus a tab-bar component that don't exist yet.

Counts are machine-verified against `ls design/` — every mockup on
disk appears in exactly one status row.

---
## `b0adc3c` 2026-07-31 — devgeereact

docs: address CodeRabbit review on SCREENS.md

All four findings were valid.

- §8 contradicted §3: it said the UI-less tables "do nothing today"
  while §3 correctly records that anonymize_staff_member writes to
  audit_logs. Internal contradiction is precisely what this rewrite
  existed to remove. Now distinguishes "no UI reads" (all four) from
  "has a server-side writer" (audit_logs only) — the difference decides
  whether an audit viewer would show anything.
- appboot: /appboot is a fixed-prop design-preview route; production
  renders AppBootScreen inline from ProtectedRoute and has no URL. The
  row implied /appboot was the production route.
- Settings/Profile headings mixed counting units ("1 of 8" vs a table
  showing two implemented things). Both now count designed tabs
  explicitly and state built/partial/absent against that.
- The verification invariant now says it applies to screen mockups
  only; designsystem/rotaflowui/logo* are reference assets and
  correctly have no status row.

Counts re-verified after editing: 23/6/5 against 34 mockups on disk,
every file in exactly one row.

---
## `a578176` 2026-07-31 — Gideon Akinlotan

Merge pull request #39 from devgeereact/docs-screens-refresh

docs: rewrite SCREENS.md against the 16 new design mockups
---
## `705d463` 2026-07-31 — devgeereact

design: match Rota Builder to design/Rota-Builder.png

Rebuilds the Rota Builder's grid, shift inspector and page chrome against
the reference. Full diff-by-diff record in design/.loop/rota-log.md
(RotaActionRail already pointed at that file; it had never been written).

Chips
- Add shift-tint-*/-fg and shift-deep-* scales plus paletteTintForColour().
  The reference chip is a pale wash with saturated ink, not the solid fill
  we had; a /10 or /20 of the existing swatches lands too grey-olive to
  match, so moss/violet/indigo were sampled off the PNG. ScheduleShiftChip
  is a separate component, so the Schedule screen keeps its solid chips.
- Time on top, type name beneath, centred. Empty cells get a muted en-dash.

Grid
- One shared ROTA_GRID_COLS template across header, rows and totals footer
  so the three bands stay aligned; previously the totals used their own
  8rem columns and drifted from the day columns.
- Single-line day header, trailing per-row "+" column, one bordered
  "Add staff" under the whole grid, status icons on the daily totals.

Inspector
- Underline tabs, type-coloured icon badge, Staff | Coverage split, skills
  chips, role badges, icons on the footer buttons.
- Coverage % is filled slots over total slots — derived, not a target.
  The skills block is labelled "Skills on Shift" and lists what the
  assigned staff hold, because shifts has no required-skills column;
  fabricating one would repeat the mistake rotaGrid.ts already avoids.

Chrome
- Drop the shift-type palette row (management stays on the toolbar gear and
  moves into a new Actions menu alongside Add shift), move the action rail
  into its own card, put the info icon on the subtitle.
- Legend lists only the three states the grid can render; the reference's
  "Overstaffed" has no required-headcount column behind it.

ShiftTypePalette is deleted — the palette row was its only caller.

typecheck, lint and build clean. Verified light and dark at 1416px, the
reference's content-area width.

---
## `7ae1e21` 2026-07-31 — Gideon Akinlotan

Merge pull request #40 from devgeereact/design-rota-builder-live

design: match Rota Builder to design/Rota-Builder.png
---
## `0e164d3` 2026-07-31 — devgeereact

design: match Schedule to published-schedule / live-schedule / Schedule-dashboard

Merges the three Schedule references into one screen: summary tiles, the
week grid (per-day counts, collapsible location groups, daily totals), the
shift-details rail, and the live-schedule cards (open requests,
announcements, publishing history) as a row beneath the grid — stacking all
of them in the 240px rail left ~1000px of dead space and truncated every
name.

/app/schedule now renders the same tree from real Supabase data via
PublishedScheduleView. Tiles the schema cannot answer are omitted rather
than faked: there is no pay-rate column, so no labour-cost tile; no
scheduled publishing, so no "next auto-publish"; no view tracking, so no
"team last viewed". Overtime compares scheduled minutes against
staff_profiles.weekly_hours and reads "—" outside the week view.

Adds a Badge ui primitive and src/lib/publishedSchedule.ts (view model +
real-data mappers). No new design tokens were needed — the shift-tint
scale from the Rota Builder pass already matches the reference chips.

/schedule-preview is the design-loop route; see design/.loop/schedule-log.md.

---
## `4c4ffad` 2026-07-31 — devgeereact

style: prettier-format the new Schedule files

CI's format:check gate failed on the nine files added by the previous
commit — formatting only, no behaviour change.

---
## `5115d6f` 2026-07-31 — Gideon Akinlotan

feat(seed): reusable 5-org demo dataset for client showcases (#41)

Adds supabase/seed/ — a deterministic, re-runnable demo dataset: five
fully-populated organisations with 5 items in every section, plus eight
sign-in-able accounts covering Super Admin, owner, manager and staff.

Not a migration: migrations auto-apply on merge to main, and demo data
must never ship that way. It is applied deliberately instead.

Ids are md5('rotaflow-demo-v1:' || key) and dates are relative to
current_date, so re-running resets the five demo orgs and re-centres them
on the current week. It only touches rows it derives itself, so
app-created organisations are never affected.

c_password ships as a placeholder and the seed refuses to run until it is
set — this repository is public, so a committed password would be a
working credential for real, email-confirmed accounts.

Includes the CodeRabbit review fixes: ORDER BY alongside LIMIT in the
shift-swap subquery, and the live clock-in event tied to a shift that
genuinely spans now().
---
## `28d133f` 2026-07-31 — Gideon Akinlotan

Merge pull request #42 from devgeereact/worktree-design-schedule-match

design: match Schedule to its three reference screens
---
## `06f5e1a` 2026-07-31 — devgeereact

design: match Timesheets to design/Timesheets-Dashboard.png

Builds the timesheets screen against the reference: status tabs with counts,
six-control filter bar, summary tiles, the selectable timesheet table with
status pills and per-row actions, pagination, the bulk-approve tip banner,
and a rail of summary donut, pending-approval queue, rules and quick actions.

/app/timesheets renders the same tree from real clock_events (team mode).
Figures the schema cannot answer are omitted live rather than invented:
no pay-rate column exists anywhere, so no Total Cost; no premium-rate rule,
so no Double Time; no org_settings table, so no Timesheet Rules card. Both
appear on the design preview only. Overtime splits against each person's
staff_profiles.weekly_hours, and with no contract on file hours count as
regular rather than against a guessed 37.5h default.

Adds src/lib/timesheetRows.ts (view model + hour maths) and
src/lib/timesheetStatus.ts (status token maps, kept out of the component
file so fast refresh works).

/timesheets-preview is the design-loop route; see
design/.loop/timesheets-log.md for the five iterations and every inferred
value.

---
## `078b354` 2026-07-31 — Gideon Akinlotan

design: match Clock In to design/clockin.png (#43)

Builds the Clock In screen against design/clockin.png: policy banner, a hero
card splitting Current Shift from the live clock and its actions, a Today's
Schedule + Recent Activity rail, a Weekly Summary / Attendance Status / Need
Help row, and a security footer.

Nine components under src/components/clockin/, composed by a new
/clockin-preview route rendering page content only on fixed mock data — the
same pattern as the other design-loop previews.

Adds one token group, `clock`, sampled off the PNG: the attendance green is
markedly deeper than `success` (#068D41 vs #1EA06B), which reads too mint
behind a solid fill. Everything else maps onto existing tokens.

Dark mode built alongside and verified by screenshot. No arbitrary Tailwind
values. typecheck, lint, format:check and build all clean.
---
## `35d5d3a` 2026-07-31 — devgeereact

Merge remote-tracking branch 'origin/main' into worktree-design-timesheets-match

# Conflicts:
#	src/App.tsx

---
## `d3173cf` 2026-07-31 — Gideon Akinlotan

Merge pull request #44 from devgeereact/worktree-design-timesheets-match

design: match Timesheets to design/Timesheets-Dashboard.png
---
## `88a3a16` 2026-07-31 — Gideon Akinlotan

ci: stop Dependabot proposing toolchain major migrations (#12)

The first run of the Dependabot config opened PRs for TypeScript 5 -> 7,
Tailwind 3 -> 4 and eslint-plugin-react-hooks 5 -> 7. Tailwind 4 alone replaces
the config format, and tailwind.config.ts now carries the whole design system
plus the new brand tokens — merging that PR does not upgrade the project, it
breaks the build and leaves someone to reconstruct the design system from a
diff. The original ignore list covered React and Vite but not the rest of the
toolchain, which is the same class of change.

Scope is deliberately narrow rather than a blanket major ignore. Majors for
runtime dependencies (@supabase/supabase-js, @sentry/react, react-router-dom,
date-fns) still open PRs: those are where a security fix is most likely to land
major-only, and this app holds staff personal data. Suppressing every major
would hide exactly the updates worth seeing.

Also groups the GitHub Actions ecosystem, which opened three separate PRs for
three routine bumps. Action majors keep flowing — they are usually mechanical,
and surfacing a deprecated or compromised action is why that entry exists.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `8be6abb` 2026-07-31 — dependabot[bot]

chore(ci): bump github/codeql-action from 3 to 4 (#4)

Bumps [github/codeql-action](https://github.com/github/codeql-action) from 3 to 4.
- [Release notes](https://github.com/github/codeql-action/releases)
- [Changelog](https://github.com/github/codeql-action/blob/main/CHANGELOG.md)
- [Commits](https://github.com/github/codeql-action/compare/v3...v4)

---
updated-dependencies:
- dependency-name: github/codeql-action
  dependency-version: '4'
  dependency-type: direct:production
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
---
## `8104716` 2026-07-31 — dependabot[bot]

chore(ci): bump actions/checkout from 4 to 7 (#3)

Bumps [actions/checkout](https://github.com/actions/checkout) from 4 to 7.
- [Release notes](https://github.com/actions/checkout/releases)
- [Changelog](https://github.com/actions/checkout/blob/main/CHANGELOG.md)
- [Commits](https://github.com/actions/checkout/compare/v4...v7)

---
updated-dependencies:
- dependency-name: actions/checkout
  dependency-version: '7'
  dependency-type: direct:production
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
---
## `a538066` 2026-07-31 — dependabot[bot]

chore(ci): bump actions/setup-node from 4 to 7 (#2)

Bumps [actions/setup-node](https://github.com/actions/setup-node) from 4 to 7.
- [Release notes](https://github.com/actions/setup-node/releases)
- [Commits](https://github.com/actions/setup-node/compare/v4...v7)

---
updated-dependencies:
- dependency-name: actions/setup-node
  dependency-version: '7'
  dependency-type: direct:production
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
---
## `03544a0` 2026-07-31 — dependabot[bot]

chore(deps): bump @supabase/supabase-js from 2.110.9 to 2.111.0 (#8)

Bumps [@supabase/supabase-js](https://github.com/supabase/supabase-js/tree/HEAD/packages/core/supabase-js) from 2.110.9 to 2.111.0.
- [Release notes](https://github.com/supabase/supabase-js/releases)
- [Changelog](https://github.com/supabase/supabase-js/blob/master/packages/core/supabase-js/CHANGELOG.md)
- [Commits](https://github.com/supabase/supabase-js/commits/v2.111.0/packages/core/supabase-js)

---
updated-dependencies:
- dependency-name: "@supabase/supabase-js"
  dependency-version: 2.111.0
  dependency-type: direct:production
  update-type: version-update:semver-minor
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
---
## `6c5f93a` 2026-07-31 — dependabot[bot]

chore(dev-deps): bump the dev-dependencies group with 2 updates (#5)

Bumps the dev-dependencies group with 2 updates: [eslint-plugin-react-refresh](https://github.com/ArnaudBarre/eslint-plugin-react-refresh) and [postcss](https://github.com/postcss/postcss).


Updates `eslint-plugin-react-refresh` from 0.4.26 to 0.5.3
- [Release notes](https://github.com/ArnaudBarre/eslint-plugin-react-refresh/releases)
- [Changelog](https://github.com/ArnaudBarre/eslint-plugin-react-refresh/blob/main/CHANGELOG.md)
- [Commits](https://github.com/ArnaudBarre/eslint-plugin-react-refresh/compare/v0.4.26...v0.5.3)

Updates `postcss` from 8.5.24 to 8.5.25
- [Release notes](https://github.com/postcss/postcss/releases)
- [Changelog](https://github.com/postcss/postcss/blob/main/CHANGELOG.md)
- [Commits](https://github.com/postcss/postcss/compare/8.5.24...8.5.25)

---
updated-dependencies:
- dependency-name: eslint-plugin-react-refresh
  dependency-version: 0.5.3
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: dev-dependencies
- dependency-name: postcss
  dependency-version: 8.5.25
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: dev-dependencies
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
---
## `66fb1ce` 2026-07-31 — Gideon Akinlotan

feat: build the Staff Directory and Staff Profile screens (#51)

Matches design/staff.png and design/Staff-Profile.png.

Directory (/app/staff): summary tiles, filter bar, sortable roster table with
a six-dot availability meter and skill chips, pagination, and the selected
person's details panel. Wired to Supabase — stats derive from today's shifts,
approved leave and availability; the row kebab keeps every existing capability
(edit, emergency contacts, documents, activate/deactivate, GDPR export/erase).

Profile (/app/staff/:staffId): identity header, tab strip, personal/work facts,
metric tiles, upcoming shifts, shift summary and the skills/qualifications/
documents rail. Cards docs/SCHEMA.md cannot back — competency levels, the
qualifications register, shift ratings, the activity feed — are omitted rather
than filled with placeholders.

Both screens also render as design-loop previews at /staff-preview against
fixtures, since the live routes need a session and a seeded org.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `314cd13` 2026-07-31 — Gideon Akinlotan

audit01: full-repo audit + production hardening (source maps, precache, tracked design refs) (#52)

* fix: stop leaking source maps, cut precache 44%, track the missing design refs

Findings from a full-repo audit (docs/audit01.md). Five things, none of which
any existing gate would have caught.

1. Source maps were public. `sourcemap: true` put a //# sourceMappingURL on
   every shipped chunk and the host served them —
   https://rota.gakinz.com/assets/index-*.js.map returned 200 and handed out
   the app's complete original TypeScript. docs/DEPLOYMENT.md §4 already said
   not to ship them; nothing enforced it. Now 'hidden' (maps still emitted for
   Sentry, no link from the bundle) plus an .htaccess rule that refuses to
   serve *.map at all, so a future deploy that copies them up is still safe.

2. src/assets/logo.png was a 1024x1024, 1.2 MB PNG rendered at 24-56 CSS px in
   four places. It was 46% of the entire precache — every install and every
   service-worker update pulled it down. Resized to 256x256 (29 KB), which
   still covers h-14 at 4x DPR. Precache 2682 KiB -> 1495 KiB.

3. 18 design mockups were untracked. docs/SCREENS.md and docs/LOOP.md both
   reference them by path, so a fresh clone had 22 of 40 and a broken
   inventory. Includes every remaining Settings and Profile screen.

4. .claude/worktrees/ held 84 MB of nested checkouts of this repo in the
   project root, untracked and one `git add -A` from being committed into
   itself. Ignored, with settings.local.json.

5. dependabot: ignore tailwind-merge majors. Its major track is coupled to
   Tailwind's (v2 = Tailwind 3, v3 = Tailwind 4). PR #45 proposed 2.6.1 ->
   3.6.0 against Tailwind 3.4.19 and would have passed typecheck, lint,
   format and build — same export, same signature, silently wrong class
   resolution. Closed with that reasoning.

Also rewrites docs/LOOP.md, which had drifted badly: it still described
signup, all five onboarding steps and the whole schedule screen as unbuilt
gaps, and pointed at design/splashscreen.png (the file is splash-screen.png).
It now carries a matched/not-matched/not-built status per screen, the
preview-route convention, and all 34 screen refs instead of 14.

Security headers: adds HSTS (no preload, no includeSubDomains — gakinz.com has
siblings this deploy does not own) and Permissions-Policy. Geolocation is
deliberately NOT denied; /app/clock needs it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* docs: add audit01 — full-repo audit, findings and build order

docs/audit01.md is the report: verdict, what shipped this session, findings
graded P0-P3 by consequence, what is actually left to build in three tiers,
a risk register, and the three things to do next.

Headline findings, none of which any existing gate catches:

- P0-1 The offline outbox deadlocks permanently and silently. flushQueuedWrites
  breaks on the first failure and leaves the item queued, which is right for a
  dropped connection and wrong for a permanent rejection — there is no attempt
  counter, no dead-letter and no error classification. One 4xx (revoked
  membership, deleted shift, CHECK violation) blocks that user's every
  subsequent clock-in forever, with the UI still reporting success. The
  timesheet that drives their pay goes quietly wrong.
- P0-2 Zero automated tests across 28,241 lines. CI's four gates are all shape
  gates; every one passes on an app that computes overtime wrong or publishes a
  rota to the wrong tenant. ci.yml pins TZ: UTC because a predecessor repo
  shipped a timezone bug — a bug the build cannot detect.
- P0-3 send-notification and inngest both carry their own author's
  "NOT VERIFIED END TO END" header, and supabase/functions/** is excluded from
  typecheck and lint. Nobody has watched a notification arrive.
- P1-1 Seven design-preview routes answer 200 unauthenticated in production.
- P1-2 react-router-dom 6.30.4 has two open-redirect advisories with no 6.x
  fix; 6.30.4 is the last 6.x. Exposure is currently limited — no navigation
  target comes from user input — so it is accepted risk with a stated
  compensating control until the v7 migration.
- P1-5 audit_logs has exactly one writer (anonymize_staff_member), so the Audit
  tab would be built against an effectively empty table.

Also corrects docs/SCREENS.md, which violated its own stated invariant: it
counted 34 screens and filed Clock in under "built with no design mockup",
but design/clockin.png exists and #43 matched the screen to it. The cause was
that clockin.png was one of 18 mockups sitting untracked, so git ls-files
disagreed with ls. Now 35 screens, 24 built.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix: unbreak main's npm ci, gate design-preview routes to DEV

Two fixes that CI itself surfaced while this branch was open.

1. main was red. PR #5 (dev-dependencies group) bumped
   eslint-plugin-react-refresh 0.4.26 -> 0.5.3, which requires eslint ^9 || ^10
   against this project's eslint 8.57.1, so `npm ci` failed with ERESOLVE on
   every run after it merged — including #51's.

   The group filter could not have caught it. eslint-plugin-react-refresh is
   0.x, where the MINOR slot carries the breaking change, so Dependabot
   classified 0.4 -> 0.5 as a minor and the dev-dependencies group's
   `update-types: [minor, patch]` waved it through; the `eslint-plugin-*`
   major-ignore rule never applied. Pinned back to ^0.4.26 and added an
   explicit minor+major ignore for this one package, to be lifted in the same
   PR that moves to ESLint 9.

2. The seven design-preview routes are now behind `import.meta.env.DEV`.
   They answered 200 unauthenticated on rota.gakinz.com — anyone who guessed a
   URL got a page of invented staff names and metrics — and every preview page
   plus its mock dataset shipped in the production bundle.

   Vite statically replaces import.meta.env.DEV with false at build time, so
   Rollup drops the branch and tree-shakes the modules. Verified against the
   built output: no preview route string survives in dist/assets/index-*.js
   while the real routes do. The design loop is unaffected — it drives the dev
   server, where DEV is true.

   Deferred earlier in this branch to avoid conflicting with design-staff-match,
   which was mid-flight in this exact region of App.tsx. That merged as #51, so
   this now also covers its two new /staff-preview routes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `fec3fb9` 2026-07-31 — Gideon Akinlotan

docs(audit01): correct the source-map finding; add P1-7 and P0-4 (#55)

The source-map leak reported in audit01 was wrong. Production is not, and
was not, serving source maps: `find ~/rota.gakinz.com -name "*.map" | wc -l`
returns 0, and the deploy tooling has always excluded them. The HTTP 200 the
audit measured came from .htaccess's SPA rewrite — any path that is not an
existing file is rewritten to index.html and answers 200, so a request for a
map that does not exist returns the app shell. `/assets/definitely-not-a-real-
file-xyz.js` behaves identically, content-type: text/html.

The commit message and PR body for a075208 / #52 repeat the error; this is the
correction of record. The change itself stands — `sourcemap: 'hidden'` plus the
.htaccess deny means a map cannot leak even if the deploy exclusion is changed
or a file is copied up by hand — but it closed a latent hole, not an open one,
and the report now says so.

The reason the probe lied is now P1-7, and it is the more useful finding: on
this origin a 200 is not evidence that a file exists. That defeats uptime
monitors, link checkers, any CI step asserting an asset deployed, and any agent
verifying its own deploy. It is also the exact failure mode vite.config.ts warns
about under `base: '/'` — a script request answered with HTML, failing the MIME
check and leaving a blank page with a 200 in the access log and nothing in
Sentry. Fix drafted: exclude assets/ and icons/ from the fallback so a missing
asset 404s honestly. Not shipped tonight — it is a live-traffic rewrite change
and this session had already deployed once.

Also records P0-4 (main was red — eslint-plugin-react-refresh 0.4.26 -> 0.5.3
via the dev-dependencies group; 0.x minors carry breaking changes, so neither
the group's minor/patch scope nor the eslint-plugin-* major ignore applied) and
promotes P1-1 to fixed, since design-staff-match merged as #51 mid-audit and
freed src/App.tsx. Nine preview routes are now DEV-gated and verified absent
from the production bundle.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `3933b77` 2026-07-31 — dependabot[bot]

chore(ci): bump github/codeql-action (#50)

Bumps the github-actions group with 1 update in the / directory: [github/codeql-action](https://github.com/github/codeql-action).


Updates `github/codeql-action` from 4 to 4.37.3
- [Release notes](https://github.com/github/codeql-action/releases)
- [Changelog](https://github.com/github/codeql-action/blob/main/CHANGELOG.md)
- [Commits](https://github.com/github/codeql-action/compare/v4...v4.37.3)

---
updated-dependencies:
- dependency-name: github/codeql-action
  dependency-version: 4.37.3
  dependency-type: direct:production
  update-type: version-update:semver-minor
  dependency-group: github-actions
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
---
## `b93af5a` 2026-08-01 — Gideon Akinlotan

P0: unblock the offline outbox, add a test floor, verify Edge Function auth (#56)

* fix: unblock the offline outbox, add a test floor, verify the Edge Function auth

Closes P0-1 and P0-2 from docs/audit01.md and narrows P0-3.

## P0-1 — the outbox deadlocked permanently and silently

flushQueuedWrites broke on the first failure and left the item queued. Right
for a dropped connection; wrong for a permanent rejection. A revoked
membership, a deleted shift or a CHECK violation failed on every reconnect
forever and blocked every write queued behind it — while the UI kept reporting
those writes as accepted, because they had been, into IndexedDB. Someone's
clock-ins stopped reaching the database and the first anyone knew was a wrong
payslip.

Failures are now classified. Permanent (RLS denial, constraint violation) moves
the item to a new dead_letters store and CONTINUES the loop. Transient
(offline, 5xx, rate limited, expired JWT) counts an attempt and stops, then
dead-letters after MAX_ATTEMPTS=5. Anything unrecognised defaults to transient
on purpose: a transient item is still bounded so it is never lost, whereas
defaulting to permanent would set aside a write a retry would have delivered.

Nothing is deleted on failure, and FailedWritesNotice renders what did not send
on the clock, leave and swap screens. Setting the write aside fixes the
deadlock; only showing it fixes the silence — the person was already told it
worked, so the wording has to correct that belief.

IndexedDB v1 -> v2 migrates in place and backfills `attempts`. Without it
`undefined + 1` is NaN, NaN >= MAX is false, and the ceiling never trips for
exactly the users who were mid-queue during the upgrade.

## P0-2 — 95 tests, and three real bugs they found

Vitest, wired into ci.yml between format-check and build. Money paths only:
clock events -> hours, the overtime split, leave entitlement, the schedule
window, the outbox.

The suite runs in Europe/London, NOT UTC. ci.yml pins TZ=UTC for the build and
that stays, but UTC has no DST, so a UTC-only run cannot see day-arithmetic
bugs that only exist when the clocks change. Two zones, two bug classes.

That caught the first bug immediately: resolvePeriod computed its window end as
local-midnight + 86_400_000ms. A fall-back day is 25 hours, so midnight + 24h
landed at 23:00 the SAME day and formatted back to the same date — toIso ===
fromIso, a zero-length window, and NO SHIFTS AT ALL on 25 Oct 2026 in
Europe/London. The arithmetic ran in the browser's zone, so a New York
location's window collapsed on the UK's transition date too. Fixed with addDays.

Two more in pairClockEvents, both silent and both costing money:
  * A second `in` while one was open overwrote the first, deleting a whole
    shift — a day worked and never paid, no error, no trace.
  * A break_start with no break_end deducted nothing, paying through the break.

Rather than pick a silent answer, that module now follows one rule: where the
events are ambiguous, produce the reading the evidence supports AND set
`reviewReason`. /app/timesheets shows a badge; a human decides. A timesheet row
feeds someone's pay and must not present a guess as a fact.

The tests were checked against the old code, not assumed useful: 9 of the 24
outbox tests fail on the previous implementation, plus 3 hours and 3 schedule
tests. A test that cannot fail is decoration.

One behaviour is pinned but deliberately NOT fixed: leave spanning new year is
counted in full against both entitlement years (14 days for a 7-day holiday).
Clamping changes every existing figure the moment it ships, and which year a
straddling day belongs to is a product decision. The test stops it drifting
before that call is made.

## P0-3 — auth verified against the live project, delivery still unproven

All four Edge Functions are ACTIVE and every secret they read is set. Probed,
not assumed:

  send-notification, no auth header            -> 401 UNAUTHORIZED_NO_AUTH_HEADER
  send-notification, anon JWT, no secret       -> 401 Unauthorized
  send-notification, anon JWT, wrong secret    -> 401 Unauthorized
  ai-rota-assistant, no auth                   -> 401
  inngest, unsigned POST (verify_jwt: false)   -> 401 Unauthorized

So the shared-secret guard is real, the public anon key is not enough to write
into someone's notification inbox, and the one function with the platform JWT
gate off is genuinely protected by Inngest request signing.

Delivery is NOT verified — nobody has watched a push land on a device or an
email arrive, and proving it needs an owner session and sends real messages to
real people. Both function headers now say precisely that instead of a blanket
"NOT VERIFIED END TO END".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix: move leave entitlement out of the service layer so tests run on Node 20

CI caught this, and it is a layering bug rather than a test bug.

`sumApprovedLeaveDays` is pure — rows in, number out — but it lived in
`src/services/leaveService.ts`, which imports `@/lib/supabase`, which calls
`createClient` at module scope, which initialises Realtime, which needs a
global `WebSocket`. Node 20 (what CI runs) does not have one, so merely
importing the module to reach a pure function killed the whole file with
"Node.js detected but native WebSocket not found". Local runs passed because
this machine is on Node 26, which does have it.

Moved to `src/lib/leaveEntitlement.ts`, which is where CLAUDE.md says pure
logic belongs. The test imports that instead and constructs no client at all.
`leaveService.ts` keeps only its Supabase calls.

Verified rather than assumed: the whole suite re-run with `globalThis.WebSocket`
deleted — reproducing the Node 20 environment — is 95/95 green, so nothing else
in the suite reaches the Supabase client.

vitest.config.ts keeps the fake VITE_SUPABASE_* values as a backstop, now with
a comment saying they are NOT a licence to import a service in a test, and why.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `deea1bf` 2026-08-01 — Gideon Akinlotan

test: cover the outbox v1 -> v2 migration, which nothing exercised (#57)

Found while verifying P0-1 was actually complete. It was not.

Every test in syncQueue.test.ts starts from a fresh IDBFactory, so the database
is created at v2 directly and `oldVersion` is 0 — the migration branch in
openDb never ran in the suite at all. That is the one code path that executes
for every existing user who has writes queued right now.

The consequence of it being wrong is not a missing field. A v1 record arrives
with `attempts: undefined`, so `undefined + 1` is NaN, `NaN >= MAX_ATTEMPTS` is
false, and the item is never dead-lettered — the block-the-queue-forever bug
that v2 exists to remove, reintroduced for exactly the people already hit by it.

These build a real v1 database with the raw IndexedDB API (not through this
module — the point is to reproduce what is on a device) and upgrade it. They
cover: queued writes survive, attempts is backfilled to 0, the resulting counts
actually increment rather than going NaN, the dead-letter store is created,
a migrated record can move into it, the backfill is idempotent, and a
partially-migrated record keeps its existing count.

Checked against a broken migration rather than assumed useful: deleting the
backfill (keeping the store creation — the slip a reviewer would miss) fails 3
of them, one reporting "expected NaN to be 1", which is the failure mode
spelled out.

Also covers the plain store operations: ordering is by queuedAt not insert
order, single removal, empty dead-letter store.

105 tests, all gates green.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `3e7eb86` 2026-08-01 — Gideon Akinlotan

docs(audit01): verify the notification delivery legs — P0-3 infrastructure proven (#58)

Closes the verifiable half of P0-3's remainder. The two failure modes that
would have been hardest to diagnose are both now ruled out, and one real
config divergence turned up.

VAPID keypair is genuinely a pair. Derived the public point from the private
scalar (P-256) and compared: MATCH, 65-byte public, 32-byte private, valid
mailto: subject, web-push accepts the details. A mismatch would have made every
push 403 forever while presenting as an empty subscriber list, with no error
anywhere. Also confirmed the DEPLOYED private key and the deployed
VITE_VAPID_PUBLIC_KEY are those same values, by comparing sha256 digests
against the ones Supabase reports.

SMTP genuinely delivers. Using the function's exact nodemailer transport and
the real credentials: connect + auth ok, and a real send accepted with
250 OK, accepted:[owner], rejected:[]. Sent only to the owner's own mailbox.

Inngest is synced — this was a genuine unknown. GET /v1/events returned ZERO
events ever, so the notification path had never run once in production. A probe
event was accepted and produced a function run 0.6s later, which rules out
"deployed but never synced, so nothing was ever going to fire". The probe used
the nil UUID for orgId and userIds so it satisfies no foreign key: it exercised
ingest -> sync -> invocation -> shared-secret auth -> the notifications insert
and could not deliver anything to anyone. It ended Failed, as designed.

Config divergence found: deployed SMTP_PORT is 587, the developer's .env says
465 (.env.example says 587, so .env is the outlier). Not cosmetic — the
function does `secure: port === 465`, so local testing exercises implicit TLS
while production exercises STARTTLS. Both branches were tested against this
host and both deliver, so nothing is broken, but a local "it works" proves the
wrong path. Noted with the fix.

Still unproven, and stated as such: a push arriving on a real device, the
notifications row plus the function's own sendMail against a real recipient,
and the probe run's error text (Inngest's free API exposes run status but not
output; a shared-secret 401 is structurally impossible since both functions
read the same project secret, but the message was inferred, not read).

Revised posture: notification INFRASTRUCTURE is verified — keys pair,
credentials authenticate, mail delivers, Inngest reaches the function. The
APPLICATION leg is not. Materially smaller than "nobody has watched anything
work", and the remaining risk is in code rather than configuration.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `543e7fc` 2026-08-01 — Gideon Akinlotan

design(timesheets): match Timesheets-Dashboard.png by measurement (#59)

Second pass over the Timesheets screen. The first pass matched it by eye
against crops; this one measured both images numerically -- ink bounding
boxes, 1-px border-edge scans and column-cluster positions -- and drove the
code to the numbers.

Structure and rhythm:
- tabs: px-3.5 / gap-2 / 3px underline sitting 10px clear of the container
  rule, as the reference draws it (it was welded to the rule before)
- filter bar: h-10, gap-4, column ratios from the six measured widths,
  semibold labels and darker chevrons
- stat tiles: content-width (xl:flex + flex-auto) instead of six equal
  columns, hint row centred
- table: 28px avatars, 53px rows, 41px header, bordered row-overflow button
- pagination, tip banner and rail buttons resized to the reference
- page rhythm retuned so the title, subtitle, tab rule, filter row, stat row
  and table card top all land within 1px of the reference

Table columns: table-fixed with percentages derived from the reference's ten
header centres, which lands every column within 4px. Content-sizing had them
up to 49px out.

Details the reference shows and we did not: Export carries no icon, the rules
check is a filled green disc, and every figure in the table carries the same
weight (Total Hours had an extra bold).

Type sizes stop short of the reference: it runs staff names at 8.6px and the
week cell at 9.4px, below any legible floor for the screen that decides
someone's pay (docs/DESIGN.md SS5). Settled at 9.6-10.6px, reproducing the
reference's hierarchy without its size. Logged in design/.loop/timesheets-log.md
along with every other inferred value.

Dark mode verified; typecheck and lint clean.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `23e50f0` 2026-08-01 — Gideon Akinlotan

fix: let missing assets 404 instead of returning 200 with the SPA shell (#60)

Closes P1-7 from docs/audit01.md.

The SPA fallback rewrote EVERY non-file path to index.html, including build
output. A request for /assets/index-abc123.js that did not exist returned
index.html with content-type: text/html and HTTP 200.

Two real consequences:

  * It defeats verification. Uptime monitors, link checkers, CI steps asserting
    an asset deployed, and any agent checking its own deploy all read 200 as
    "present". This audit was itself fooled by it into reporting a source-map
    leak that did not exist — there are zero .map files on that server.
  * It is the exact failure vite.config.ts warns about under `base: '/'`: a
    script request answered with HTML, failing the MIME check, leaving a blank
    page with a 200 in the access log and nothing in Sentry. Absolute base paths
    fixed the cause; this rewrite was still hiding the symptom.

Fix is one line — `RewriteRule ^(assets|icons)/ - [L]` before the fallback —
scoped deliberately to the two directories the build emits, so SPA deep links
are untouched.

Deployed on its own after backing the live .htaccess up to ~/private_backups/,
and verified immediately against production:

  /assets/does-not-exist.js   200 text/html -> 404
  /icons/nope.png             200          -> 404
  real assets + sw.js + manifest            200, MIME unchanged
  /app/dashboard, /invite/:token, unknown   200 (SPA fallback intact)
  source maps                               403 (still refused)
  HSTS, Permissions-Policy, cache, HTTPS    unchanged

ErrorDocument 404 /index.html is kept and documented as near-dead code: the
fallback catches every unknown non-file path first, so it only fires for a miss
under assets/ or icons/, where the status line is the part that matters.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `328a247` 2026-08-01 — Gideon Akinlotan

feat(ui): add the Tabs primitive that unblocks the 11 Settings/Profile screens (#62)

P2-1. Eleven of the eleven remaining designed screens are tabs, and no tab bar
existed, so none of them could start. This is that component plus the tab
definitions, landed on its own so the screens can be built in parallel without
each session inventing its own bar.

It is a <nav> of links, NOT role="tablist", and that is deliberate. Every tab is
a distinct URL — a manager needs to send someone a link to Billing, and a page
this deep must survive a refresh. The ARIA tabs pattern is for swapping panels
within one page; announcing role="tab" on something that navigates tells a
screen-reader user content will change in place and then moves the whole page
under them, while giving up open-in-new-tab, copy-link and the back button.
W3C's guidance is to use links when the tabs are navigation. Browsers then
provide keyboard support for free, so there is no roving-tabindex logic to get
wrong.

Two bugs caught while writing it: an explicit `aria-current` would have
overridden the one NavLink sets and silently removed the only programmatic
signal of which section is open, and the overflow comment referenced a
`scrollbar-none` utility this project does not have.

src/lib/settingsTabs.ts is the single source of truth for both tab sets, in the
designed order. A bar that differs by one item between two pages is the kind of
thing nobody notices until a customer does. Role gating is included: staff see
no Settings tabs at all rather than a bar of links that all 403, and Billing and
Permissions are owner-only because one spends money and the other can grant
someone the ability to. Hiding a tab is presentation — RLS in 0002_rotaflow.sql
remains the boundary.

11 tests cover the gating, the designed order, route uniqueness, and that
callers get a copy rather than the shared constant. 116 tests total.

Also corrects this report's own §6. It said the designs give Settings
"(expandable, 8 sub-items)" and stopped there. Both mockups are true at once:
ProfileSettings.png shows the sidebar group expanded, SettingsOrganisation.png
shows it collapsed with the same 8 destinations as an in-page tab bar. The tab
bar is what was blocking screens; the sidebar group blocks nothing and is still
to build.

The sidebar was deliberately NOT restructured here — eight worktrees were active
on design-match branches and Sidebar.tsx is shared by all of them. §7c records
the recommendation instead: move Integrations into Settings, fold Team into
Settings > Permissions, and keep Clock in as a staff-only item rather than
dropping it to match what is a manager's-eye mockup.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `bd11a72` 2026-08-01 — Gideon Akinlotan

fix(deps): migrate to react-router v7 — closes the open-redirect advisories (#64)

P1-2. react-router-dom 6.30.4 -> 7.18.2. 6.30.4 was the last 6.x, so there was
no patch route: the fix was a major or nothing.

## What this actually fixes, and what it knowingly accepts

Gone: "Open redirect via backslash in <Link> and useNavigate" (CVE-2025-68470
bypass) and "Open redirect leading to XSS" (CVSS 6.9). Both applied to this app
— it uses <Link> and useNavigate on every screen.

Arrives, and does NOT apply: GHSA-qwww-vcr4-c8h2, "RSC Mode CSRF Bypass",
affecting react-router 7.12.0 - 8.2.0. It requires RSC mode. RotaFlow is a
static SPA on BrowserRouter with no server, no createBrowserRouter, no
loaders/actions, no Form/useFetcher/useSubmit — verified by grep, not assumed.

Note that `npm audit fix --force` proposes 7.11.0 here. Do NOT take it. The
open-redirect range was react-router 6.0.0 - 7.17.0, so 7.11.0 sits inside it:
npm's "fix" trades an advisory that cannot affect us for one that already did.
7.18.2 is the only version that clears the applicable issue.

## The migration itself

The API surface was entirely declarative — Link, useNavigate, Navigate,
useParams, useSearchParams, useLocation, NavLink, Routes/Route/Outlet,
BrowserRouter — all unchanged in v7. No data-router APIs, no removed `json`
or `defer`.

One real change: `navigate()` returns a Promise in v7, so 14 call sites tripped
no-floating-promises / no-misused-promises. Each is now `void navigate(...)`.
Deliberately `void` rather than `await` — every one of these is fire-and-forget
navigation at the end of a handler, and awaiting would change ordering for no
benefit.

## Verified in a real browser, not just by the gates

Static gates prove it compiles. They cannot prove it routes, and this is a
router major, so:

  route resolution   /  /login  /signup  /forgot-password  /app/dashboard
                     /definitely-not-a-route — all mount, no console errors
  ProtectedRoute     /app/dashboard renders the login page — redirect intact
  catch-all          unknown route mounts the 404 page
  client navigation  clicking a <Link> changes the path AND a window stamp
                     survives, proving no full page reload

(The first run of that harness failed every route with "supabaseUrl is
required" — a worktree with no .env, not a router fault. Worth recording: the
app hard-throws at module load without env, so a build made without one
white-screens rather than degrading.)

typecheck, lint --max-warnings 0, format:check, 116 tests, build — all clean.

Supersedes #48.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `d8fd37f` 2026-08-01 — Gideon Akinlotan

feat: build the Locations & Departments workspace (#65)

Merges design/Locations-Management.png and design/Location-department.png
into one tabbed workspace at /app/locations (+ /app/locations/departments),
and adds /locations-preview (DEV-only) rendering the same tree against
fixtures for the design loop.

Screens
- Locations tab: 5 summary tiles, search + scope filters, the sites table
  (type, region, staff, upcoming shifts, coverage meter, status, row
  actions), pagination and the advisory strip.
- Departments tab: 4 tiles, the departments table, the overview panel and
  the six shortcut cards.
- Both tabs share the right-hand detail rail, the metric grid and the
  activity list. Dark variants throughout, verified by screenshot.

Real data, honestly scoped
/app/locations derives coverage, staff counts, upcoming-shift counts and
open-shift counts from real shifts / staff_profiles / departments rows over
the next 7 days (src/lib/locationsDirectoryMapping.ts). The references also
show a site type, region, capacity, open hours, manager, payroll code, cost
centre and an activity feed — none of which exist as columns in
docs/SCHEMA.md. Those map to null and the components omit them rather than
invent values. DepartmentManager's add/rename/delete moves into a dialog so
the old page loses no capability.

Tabs
The Locations | Departments switch is navigation, so it uses the route-based
ui/Tabs from #62 — each half has its own URL and survives a link or a
refresh. The in-page strips that #62 deliberately does not serve (the staff
profile sections, and Overview/Staff/Shifts/Settings/History inside the
location detail panel) use ui/PanelTabs, a role="tablist" sibling. Both
files document which to reach for. StaffProfileTabs now uses PanelTabs
instead of its own copy.

Also generalises StaffPagination into ui/TablePagination with a `noun` prop
(staff, locations and departments draw an identical footer), and adds
violet/rose/teal tones to Badge plus rose/teal and base/lg sizes to IconTile
for the type chips and department marks.

The references are downscaled renders (~0.7x), so this matches their
proportions and structure at the project's real type scale rather than
their literal font sizes. Working shown in design/.loop/locations-log.md;
the calibration note is now in docs/LOOP.md so the next screen inherits it.

typecheck, lint (--max-warnings 0), format:check, build and the 116-test
suite all clean.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `5c9124b` 2026-08-01 — Gideon Akinlotan

fix: discard navigate()'s promise so main typechecks again (#68)

#64 (react-router v7) and #65 (Locations workspace) each passed CI on their
own branch and were red together the moment both were on main: v7 widened
`navigate`'s return type from `void` to `void | Promise<void>`, and
LocationsPage returns it straight out of a `(): void` handler.

`tsc --noEmit` fails and `@typescript-eslint/no-floating-promises` fires.
Both navigations are fire-and-forget, so a small `goTo` helper `void`s the
result once instead of at each call site.

Worth noting for later: PR checks ran against each branch head, so nothing
ever built the combination. Neither author could have seen this.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `78b0c9c` 2026-08-01 — Gideon Akinlotan

design: build the Announcements management screen (#66)

* feat(announcements): build the Announcements management screen

Matches design/Announcements-Dashboard.png: tabbed status filter, search +
scope selects, the announcements table (audience, status, schedule stamp,
author, row actions), a centred pager, the announcement preview rail
(message, audience/delivery, engagement, attachments, quick actions) and the
guidance banner. Light and dark are both built.

`/app/announcements` renders the same `AnnouncementsView` from Supabase.
The schema is narrower than the mock, so the page derives what it can and
reports the rest as absent rather than inventing it:

- status comes from `published_at` (unset = Draft, future = Scheduled,
  past = Sent); there is no archived state, so the Archived tab is empty and
  says why
- author name comes from `staff_profiles` and role from `memberships` —
  `profiles` is select-own-only under RLS
- delivery counts and attachments are hidden: `notifications` is scoped to
  `user_id = auth.uid()`, so a manager cannot count another member's reads
  from the client, and there is no attachments table
- the mock's "Archive Announcement" is relabelled "Delete Announcement",
  because deleting is the only thing it could actually do

Posting and removing an announcement (plus the Inngest fan-out) are preserved
from the old page, now behind a composer modal on the "New Announcement" CTA.

Adds `68: '17rem'` to the spacing scale and `danger`/`indigo` tones plus
`base`/`lg` sizes to `IconTile` — all measured off the reference, all noted in
design/.loop/announcements-log.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(announcements): surface a toast when posting fails

The composer only reported the failure to Sentry, so a failed post left the
dialog open with no explanation — a regression against the page it replaced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `3440db8` 2026-08-01 — Gideon Akinlotan

perf: split routes into lazy chunks — entry chunk 802 kB -> 319 kB (#69)

P1-6. Everything arrived in one 802 kB chunk, so a carer opening /app/clock
downloaded the rota builder's drag-and-drop engine, the reports CSV exporter
and every settings screen before they could clock in.

33 route components are now React.lazy. HomePage, LoginPage and NotFoundPage
stay eager: they are the public entry points, and on a genuinely first visit —
no service worker yet — lazy-loading them would add a round trip to the exact
moment first impressions are made.

Suspense boundaries are placed deliberately. AppShell wraps only its <Outlet>,
so the sidebar and header do not unmount while a chunk loads; a boundary higher
up would flash the whole chrome on every in-app navigation. App.tsx has a second
boundary for the lazy public routes.

Be honest about what this buys. This app precaches every chunk, so an installed
user still downloads the whole bundle — splitting does NOT reduce that. What it
buys is (a) a first visit that fetches the entry plus one route rather than
everything, and (b) far cheaper updates: precache revisions are per file, so a
tweak to Leave re-downloads ~10 kB instead of ~800 kB, and this project ships
several times a day. Cost: precache 1500 -> 1681 KiB, 19 -> 98 entries, once.

The chunking needed tuning, not just lazy(). The first attempt emitted 104
chunks — Rollup lost the shared parent for libraries the lazy routes import and
produced a chunk PER ICON and per date-fns function. lucide-react, date-fns and
@dnd-kit are now grouped in manualChunks; tree-shaking still applies inside each
group, and @dnd-kit rides with the rota-builder chunk since nothing else uses it.

Rebased three times onto a fast-moving main (#64, #65, #66, #68) by re-applying
the transform to the current App.tsx rather than resolving conflict markers by
hand — safer, and it picks up newly-added routes automatically.

typecheck, lint, format:check, 116 tests, build — all clean.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
---
## `57ea53d` 2026-08-01 — Gideon Akinlotan

feat(reports): build the Reports & Exports screen to match the design (#63)

* feat(reports): build the Reports & Exports screen to match the design

Rebuilds `/app/reports` from a two-card CSV stub into the reporting
workspace in design/Reports-Dashboard.png: the report catalogue with
search/category/format filters and favourites, per-row run and download
actions, and a rail of Reports Overview (donut + legend), Recent Reports
and Quick Actions.

New presentational components under `src/components/reports/`, plus a
`ui/DonutChart` primitive. `ReportsView` is prop-driven so the live page
and the DEV-only `/reports-preview` (reference fixtures) render the same
tree — the same pattern as Timesheets and Staff.

The live page only lists exports that genuinely exist: the four backed by
`reportsService` (rota, timesheets, leave, swaps). The six other report
types in the reference have nothing behind them and are omitted rather
than shown disabled. "Last Run", the overview split and Recent Reports
come from a per-org localStorage run log (`lib/reportPrefs.ts`) — there
is no `report_runs` table to read, and inventing server-side history
would be fabricating data. "Filters", "Custom Report", "Schedule Report",
"Report Builder" and "Report Settings" are not rendered on the live page
because none of them has a destination yet.

Deviations from the reference and every inferred value are logged in
design/.loop/reports-log.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(reports): address the CodeRabbit review

- Complete the ARIA tabs pattern on `ReportsTabs` — roving `tabIndex`,
  Arrow/Home/End handling and `aria-controls` pointing at a real
  `role="tabpanel"`. Declaring `role="tab"` without those promises an
  interaction model that was not there. `reportsTabId` moved to
  `lib/reportRows.ts` so the component file exports only a component.
- Give the Reports Overview period select a `focus-within` ring; it set
  `outline-none` with nothing replacing it.
- `aria-busy` on the Run button, so the pulse is not the only progress cue.
- Reload favourites and the run log when `orgId` resolves or changes — the
  `useState` initialiser ran once, so switching organisation showed the
  previous one's starred reports.
- Derive the category filter options from the distinct set, not one per
  catalogue entry (duplicate `<option>` values and React keys).
- Demo fixture: Timesheet Summary is `Timesheets`, not `Compliance`. The
  reference tints that one rail tile green while its table row is amber;
  the fixture now follows the data, so the rail tile is amber too.
- Preview controls actually filter the preview rows and toggle favourites,
  so the design loop can reach the empty and starred states. Defaults are
  wide open, so the first paint is unchanged.

Also fixes a latent bug of my own: `rangeFileSuffix` built the export
filename from `toISOString()` on a local-midnight Date, which names the
previous day anywhere east of UTC. It now formats local calendar parts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `c2d6410` 2026-08-01 — Gideon Akinlotan

design(swaps): match Swap-Request.png and rewire /app/swaps to it (#61)

* design(swaps): match Swap-Request.png and rewire /app/swaps to it

Builds the Swaps screen against design/Swap-Request.png by measurement rather
than by eye: card and divider edges, text extents and cap-heights, control
heights and fills were all read out of the PNG with a pixel scan, and the
layout was iterated eight times against screenshots at the reference's 1416px
content width.

- New `src/components/swaps/*`: SwapsView composes SwapTabs, SwapFilterBar,
  SwapTable (SwapParties + SwapShiftSide), SwapPagination, SwapTipBanner and
  the rail's SwapOverviewCard / SwapRulesCard / SwapActivityCard. Quick
  Actions reuses the existing timesheets card unchanged.
- `src/lib/swapRows.ts` holds the view model and the status token maps;
  `swapMapping.ts` turns stored swaps into rows and derives the activity rail.
- `/app/swaps` renders the same tree against Supabase data — tabs, scope
  filters (location, department, shift type, status), sorting, pagination,
  CSV export, a New Swap Request modal and a per-row review modal carrying the
  approve / decline / accept / withdraw actions the old list had inline.
- `/swaps-preview` (DEV-only, alongside the other preview routes) renders it
  against fixtures reproducing the reference's exact figures.

`shift_swaps` models a hand-over, not a two-shift exchange — and the reference
shows the identical date, time and location on both sides of every row — so
SwapRow carries one shift rendered as both "Giving Away" and "Taking". No
schema change was needed.

The live route deliberately omits the Swap Rules card: no policy store exists
yet (docs/audit01.md, Settingspolicy), and invented thresholds would tell staff
a swap is permitted when nothing enforces it. It renders in the preview against
the reference's values and switches on when a policy table lands.

Known differences, all logged in design/.loop/swaps-log.md: the reference's
face is ~25% narrower than Inter at the same cap height, so cap height was
matched and columns widened to absorb the advance; times stay font-mono per
docs/RULES.md §9; brand blue, canvas and muted-text colours stay on their
tokens rather than the mockup's more vivid values.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* style(swaps): run prettier over the demo fixtures

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `a78d0b8` 2026-08-01 — Gideon Akinlotan

feat(security): add a Content-Security-Policy, verified in a browser first (#70)

P1-4. For an app that renders user-supplied content (announcements, staff
notes) and holds session tokens in the browser, CSP is what turns an XSS from
account takeover into a blocked console error. It is also the compensating
control for the open-redirect class that P1-2 just migrated away from.

Every origin was derived from the code, then the policy was VERIFIED by serving
the real production build behind it and driving a headless browser over it —
before it went anywhere near production. Two things only that could have found:

1. worker-src needs `blob:`. Sentry's replayIntegration compresses replay
   payloads in a Worker created from a blob URL. Without it every route logs a
   violation.

2. connect-src needs the Google Fonts origins, even though the fonts are a
   STYLESHEET and style-src already allows them. On the first visit the page
   fetches the stylesheet directly and style-src governs it. On every visit
   after that the service worker's StaleWhileRevalidate handler fetches it, and
   a fetch() is governed by connect-src. Miss this and fonts break on the second
   load and every load after — never the first. That is the shape of bug nobody
   reproduces, and a control run against a permissive policy is what proved it
   was the policy rather than my harness.

Choices worth stating:

  * 'unsafe-inline' is in style-src (framer-motion and React write inline
    styles) and NOT in script-src, which is where it would matter — index.html
    carries no inline script.
  * img-src allows any https: on purpose. Staff photos are arbitrary pasted
    URLs today (P2-3), so locking to ImageKit would break real avatars. Images
    cannot execute; the job is stopping script injection, not policing image
    hosts. Tighten when uploads land.
  * openrouter.ai is deliberately absent — the AI key never reaches the browser,
    only the ai-rota-assistant Edge Function talks to it.
  * wss://*.supabase.co is present. Omitting it would have silently stopped all
    12 Realtime screens from live-updating.

Deployed after backing the live .htaccess up to ~/private_backups/, then
verified against production itself: all routes mount, no CSP violations, no
network failures across a service-worker-controlled second navigation.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `3ded822` 2026-08-01 — Gideon Akinlotan

feat(leave): build the Leave screen to match design/Leave.png (#67)

* feat(leave): build the Leave screen to match design/Leave.png

Rebuilds `/app/leave` against its reference. The old page was a stacked
"request form + flat list" with a My leave / Approvals toggle; the reference
specifies a workspace — status tabs, a six-control filter bar, a seven-column
request table with pagination, and a rail carrying a leave-type donut, per-type
balances, the approval queue and quick actions.

Structured the way TimesheetsView is: `LeaveView` is presentational and every
figure reaches it already computed, so the authenticated page and the new
DEV-gated `/leave-preview` render the identical tree. Nothing existing is lost —
requesting leave, approving, declining and withdrawing all still work, now
behind `LeaveRequestModal` and `LeaveReviewModal`, and the offline outbox path
is unchanged.

Three things the reference draws are deliberately absent rather than faked, each
documented at the point of use:

- Per-type allowances. `staff_profiles.holiday_allowance` is a single annual
  number, so Leave Balances renders the one row it can measure. The reference's
  Sick / Personal / Carer's rows need a `leave_entitlements` table.
- The overtime queue. `overtime_requests` has no reader or writer anywhere
  (docs/audit01.md P2-7), so counting it would mean inventing a number.
- Half days. `leave_requests` stores whole dates.

Adds a `leave` colour namespace to tailwind.config.ts — five type inks with
light and dark washes, sampled off the PNG. Deliberately not `shift-tint`: that
palette is the rota grid's and `shift_types.colour` is per-org configurable, so
a tenant recolouring its Night shift must not recolour Sick Leave.

Date-only columns are read with `parseISO` (local midnight) rather than
`new Date(string)` (UTC, then formatted in the system zone) — the bug class
ci.yml pins `TZ: UTC` over.

Known deviation: cards keep `rounded-2xl` per docs/DESIGN.md §2 where the
reference draws ~8px. Matching the PNG would make Leave the only screen in the
product with 8px cards; if 8px is the real intent it is a design-system change,
not a Leave change. Full diff list in design/.loop/leave-log.md.

docs/LOOP.md also records the trap that cost this pass an iteration:
design/Leave.png is a 1920x1080 design exported at 87.08%, so measuring it at
face value makes every correct font look 15% too large.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* test(leave): cover the date and duration arithmetic behind the Leave table

The test floor landed on main while this branch was in flight, and
`docs/audit01.md` P0-2 names leave arithmetic as one of the four paths that
produce a wrong number for a real person. `leaveRows.ts` is now the module the
Leave table's every date string passes through, so it gets the same treatment
`hours.ts` and `leaveEntitlement.ts` already have.

23 tests, weighted at what actually breaks silently:

- date-only columns parsed as local rather than UTC midnight, which is the
  documented bug class ci.yml pins `TZ: UTC` over
- both DST transitions, where counting raw milliseconds floors a 7-day request
  to 6
- single day counted as 1 rather than 0, and an inverted range clamped
- `type` free text normalising to the five-key palette, with the column's
  'holiday' default landing on Annual Leave and anything unrecognised on Other
  rather than being dropped
- the donut counting approved days only — pending and declined are not days
  taken

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `529b8f5` 2026-08-01 — Gideon Akinlotan

docs(audit01): record P1 status — five fixed, one held, one needs a decision (#72)

P1-1, P1-2, P1-4, P1-6 and P1-7 are fixed and deployed. Adds §7d with the
current state of all seven.

P1-5 (#71) is written but held as a DRAFT on purpose. Supabase Preview reports
"skipping", so no preview database was created and the migration has been
applied nowhere. Static checking caught two real bugs in it — invites has no
`status` column, and the first draft widened audit_logs_select from owner-only
— but it cannot tell you the triggers fire or that 0013 applies cleanly on top
of the live 0012. It reaches production on merge; merging it unverified is the
pattern this report exists to stop.

P1-3 is not an engineering task. Five demo orgs and eight accounts share one
password in the production database, and RLS is the only thing separating them
from the first real tenant. Tear down or move to a separate project — that is
the owner's call, and it should happen before the first customer onboards.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
---
## `2eb2252` 2026-08-01 — Gideon Akinlotan

Audit 02: build the 14 screens the navigation pointed at, and stop shipping the previews (#75)

* feat(settings): build the 14 Settings and Profile screens the tab bar pointed at

`src/lib/settingsTabs.ts` has listed fourteen routes since #62, described as
the thing that unblocked the remaining screens. Nothing imported it except its
own unit test, so every one of those routes fell through to the `*` catch-all
and rendered the 404 page. The tab bar was defined, tested, and never rendered.

Settings (8 sections, owner/manager) and My Profile (6, everyone) now exist as
layout routes with the tab bar in the layout — a new section is a `<Route>`
plus a `SETTINGS_TABS` entry, and a missing half is immediately visible.

Wired to real data, not mocks: organisation details and preferences, role
display labels, scheduling policies and notification defaults through a new
typed `orgPreferences` reader over the `organisations.settings` jsonb;
permissions from memberships + staff profiles; billing from `subscriptions`;
audit and activity from `audit_logs`.

Where the reference asks for something the system genuinely cannot do, the
screen says so instead of faking it — SMS with no provider, notification
templates with no table, custom roles the three-value `memberships.role` CHECK
cannot represent, API tokens with no public API, a session list Supabase does
not expose to the client, and a "100% Secure" ring over checks nothing
performs. Each is stated on the screen with the reason.

Navigation follows audit01 §7c: Integrations and Team fold into Settings (both
redirect), and Clock in becomes role-conditional rather than dropped, because
the mockups are a manager's view and clock-in is the screen a carer opens twice
a day. Managers now get the designed 12-item sidebar.

Also:
- `window.confirm` replaced by a themed promise-based ConfirmDialog at all five
  destructive sites. The GDPR anonymisation guard mattered most: a browser may
  suppress `confirm()` in an installed PWA, leaving a button that silently does
  nothing.
- Button gains the danger/success/warning variants designsystem.png specifies;
  43 elements were hand-rolling `bg-danger` in a className.
- Page titles normalised to the `text-page-title` token. 26 headings used three
  different sizes for one role — text-2xl (19), text-3xl (10), text-xl (4) —
  because several were measured off design exports that are 1672px wide, ~87%
  of the 1920 they were designed at. designsystem.png *states* 32/40, so the
  token is authoritative over any measurement.
- New `navigationTargets` test parses the real route table out of App.tsx and
  asserts every tab resolves. Verified to fail (14/16) against the previous
  App.tsx — the first draft of its parser passed two routes that did not exist,
  which is why it resolves nesting from tag structure rather than by prefixing.

typecheck, lint, format, 155 tests and build all green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* perf(build): stop shipping the 13 DEV preview chunks to production

The preview routes were gated behind `import.meta.env.DEV` in #52 and that
gate works — no preview route string survives in any production chunk, so the
pages are genuinely unreachable.

But the gate was on the *routes*, not the *definitions*. Every
`lazyPage(...)` call sat at module top level, outside the branch, so Rollup
saw thirteen live `import()` expressions and emitted a chunk for each. They
were written to `dist/assets/`, and — the part that actually costs something —
listed in the service worker's precache manifest. Every user downloaded all
thirteen on first visit: 87 kB of fabricated staff names, invented metrics and
mock organisations, precached onto the phone of a carer on ward wifi.

That silently undid part of #69, whose whole point was that opening /app/clock
should not drag in the rest of the app.

Gating the definition folds the ternary to a stub at build time and takes the
`import()` — and every preview page and mock dataset behind it — with it.

Verified against the built output, not the source:

  preview chunks in dist/assets   13 -> 0
  preview entries in dist/sw.js   13 -> 0
  precache            125 entries / 1844.70 KiB -> 97 / 1737.77 KiB
  entry chunk                     335,157 -> 332,354 bytes

The design loop is unaffected: /leave-preview still renders on the dev server,
checked in a browser after the change.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* docs(audit): replace audit01 with audit02 — the smoke test that found 14 dead screens

Audit 01 is superseded rather than appended to. Everything it recorded as
fixed was re-verified rather than assumed, and what is still open is carried
forward in §8 with its reasoning intact.

The headline finding is one Audit 01 could not have reached by reading code:
fourteen screens were in the navigation, covered by a passing unit test, and
did not exist. Every gate was green because a route is a string and a
`<Route path>` is a string and nothing compared the two.

Also records, with before/after numbers taken from `dist/` rather than source:
the preview chunks that were being precached to every user, the three heading
sizes serving one role and why the pixel-match passes produced them (the
design exports are 1672px — 87% of 1920), the button variants missing from the
design system, and the eleven controls the references ask for that the system
genuinely cannot do yet — each stated on its screen rather than mocked up.

§6 is explicit about the one thing this session could NOT verify: the new
screens rendering against real data, which needs a login this session should
not handle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* docs(audit): confirm the preview-chunk finding against the live docroot

`ls ~/rota.gakinz.com/assets | grep -c PreviewPage` returns 13 on production
right now, so this is measured on the server rather than inferred from a local
build. Audit 01 §7 established that a 200 from this origin proves nothing;
asking the filesystem over SSH is the check that does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(nav): show Clock in to managers too, not just staff

audit01 §7c recommended making Clock in staff-only, which is the obvious
reading of the mockups — none of them show it, and all of them are signed in
as a manager. Implemented as recommended, then reconsidered on the risk shape.

In a small care home the owner and the manager are usually on the rota
themselves. Hiding the control costs a working manager the screen they open
twice a day, with no route to it from the nav; showing it to a manager who
never clocks in costs one row they can ignore. That asymmetry is not close.

Gating on "has a staff_profile" would be more precise, but the sidebar has no
such query and adding one to render navigation is a poor trade for a row.

Managers now see the designed twelve plus Clock in.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `e68c456` 2026-08-03 — Gideon Akinlotan

Build the product vision: marketing site, app shell, role gates and the Sunnyvale dataset (#77)

* feat(marketing): build the public site the nav promised — 6 routes, honest copy

`/` was a single page with a two-item nav. The brief specifies a full marketing
site: Features, Solutions, Pricing, Resources, About and Contact, with a
product shot, benefit grid, sector cards, a stats band, a "why teams choose"
block, social proof and a closing CTA.

All six routes now exist and every nav, footer and CTA link resolves —
`navigationTargets.test.ts` grew 19 assertions that parse the real route table
out of App.tsx and check each link against it. Verified they fail: deleting the
`/pricing` Route turns two of them red, naming the nav item and the footer link.

## The social-proof decision

The brief asks for "10,000+ active users · 500+ organisations · 99.9% uptime"
and a testimonial from a named person at a named company. RotaFlow is
pre-launch with no customers, and this site is live at rota.gakinz.com, so
every one of those is a false factual claim to real prospective buyers — a CAP
Code breach, and the thing `docs/audit01.md` §4 independently told us not to do.

So the sections are built, designed and wired, and populated from
`src/lib/marketing.ts` with claims that are true today and checkable against
this repository. `TRACTION` and `TESTIMONIALS` are empty constants: fill either
and the corresponding band switches over with no code change. `/pricing` says
billing is not live rather than implying a card will be charged, because
`subscriptions` is an empty seam and nothing can charge anyone.

`/resources` publishes a built / partial / not-built breakdown of the product,
which is a stronger position with a care-sector buyer than a feature matrix
with every box ticked.

## Two bugs found by screenshotting rather than by a gate

- The hero copy rendered at `opacity: 0`. It was gated behind a framer-motion
  animation completing, so anything that stops that — slow JS on a phone, a
  crawler, a headless render — hid the most important block of copy on the
  site. Now the CSS `fade-up` keyframe with `both` fill, which paints with no
  JS at all and drops out under `motion-reduce`.
- The product-shot phone sat on top of the last two columns of the rota grid.

typecheck, lint, format, 174 tests and build all green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* feat(shell): global search, mobile tab bar, role gates and a real sidebar

Four gaps between the app shell and the brief, plus one genuine permission
hole found on the way.

## The permission hole

`/app/staff`, `/app/staff/:id` and `/app/locations` had no role check at all.
A staff member who followed a manager's link got the full manager interface,
with every write failing silently on RLS — nothing leaked that the database
would not hand over, but a screen of controls that quietly do nothing is its
own kind of broken. Reports and the rota builder did check, each with a
differently-worded one-line card.

`RequireRole` now declares it on the `<Route>`, so a new page cannot forget,
and `PermissionDenied` gives the four facts that turn "it's broken" into "I
need to ask for access": the area, the role held, the role required, and the
way back. RLS remains the actual boundary; this is presentation.

## Global search

`⌘K` from anywhere. Searches screens and their actions — not database records:
a fan-out of `ilike` queries across a dozen tables on every keystroke is a
query storm against tenants with six-figure row counts, for a feature nobody
has asked for. Record search drops in as an extra result group later.
Role-filtered before matching, so a staff member never sees "Billing" in a
list they would only be denied at. Wired with `aria-activedescendant` so the
input keeps focus while the selection moves.

## Mobile tab bar

Home · Schedule · Clock in · Leave · More, with `More` opening the existing
drawer. A phone gets different navigation, not smaller navigation: the things
a carer opens are a short predictable list and should be one thumb-reach away.
The floating hamburger that sat over page content on every mobile screen is
gone — one opener now, in a place a thumb already is. `env(safe-area-inset-bottom)`
keeps the row clear of the iPhone home indicator, and `main` gained bottom
padding so the last table row is not stuck under the bar.

## Sidebar

Tagline, organisation switcher, profile block, Help & Support, and a collapse
control persisted to localStorage — read during the initial `useState` rather
than in an effect, so a collapsed sidebar does not make the page jump sideways
on every load. Collapsed items keep their labels via `sr-only`; eleven
unlabelled icons are unusable with a screen reader and `title` alone is not
reliably announced.

The org name and switcher moved out of the header into the sidebar, next to
each other — the header was showing the name and the switcher separately,
saying the same thing twice.

`navigationTargets` grew 26 assertions covering every search destination.

typecheck, lint, format, 200 tests and build all green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* docs+seed: correct the screen inventory, and add the 248-staff Sunnyvale org

## docs/SCREENS.md and docs/ARCHITECTURE.md were both stale

#75 built the 14 Settings and Profile screens and restructured the sidebar, but
neither document was updated. §3 still read "8 designed tabs, 2 have code, 0 are
tabs" and §4 "6 designed tabs, 2 partial, 0 are tabs" — all fourteen exist and
all are tabs. §6 still described the pre-#75 flat 15-item sidebar and listed the
nav restructure as an open question it had already settled.

ARCHITECTURE's route map was worse: most entries marked unbuilt are live, and
none of the Settings, Profile or marketing routes appeared at all.

Counts recomputed by parsing this file's own tables against `ls design/` rather
than by hand — 35 mockups, 33 built, 2 partial, 0 not built. The invariant
(every screen png has exactly one status row) is verified, not asserted.

## Sunnyvale Care Group — the depth dataset

`demo_seed.sql` is five small orgs, sized to be read at a glance on a call.
Sunnyvale is the opposite: one care group, 3 sites, 8 departments, 248 staff,
so pagination, filters, coverage arithmetic and the directory are under real
load. Separate file, separate id namespace, separate teardown — neither seed can
touch the other's rows, and refreshing the small demo does not mean rebuilding
248 staff.

Two deliberate imperfections in the attendance data, because a clean dataset
hides the bugs that matter: one in forty finished shifts has no clock-out (the
"forgot to clock out" case `pairClockEvents` must flag rather than silently drop
a day's work — a bug this repo has shipped once), and clock times carry ±4
minutes of jitter so the timesheet variance column is not uniformly zero.

⚠️ **It has never been run.** No local Postgres (Docker would not start) and it
needs the seed password, which is the owner's to hold. Static review did catch
two genuine bugs first — a non-rectangular `int[][]` literal that Postgres
rejects outright, and a department index off by one that made Kitchen staff
NMC-registered — so the rest is plausible, not proven. Run it in the SQL editor,
where an error is visible and harmless. The README says all of this too.

It also documents why the dashboard will read ~140 on shift today rather than
the mockup's 41: 248 staff and 41-on-shift are not consistent with each other,
and scheduling 83% of the workforce nowhere to match one tile would defeat the
point of a load-realistic dataset.

typecheck, lint, format, 200 tests and build all green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `e887128` 2026-08-03 — Gideon Akinlotan

Make every control do its job: 30 stub buttons, approved swaps that move the shift, and measured responsiveness (#82)

* design(clockin): ship design/clockin.png on the live /app/clock

/clockin-preview matched the reference (#43); /app/clock never did. It
rendered a different screen entirely — a max-w-lg centred card with a
status pill and two buttons — so the matched components existed but
nothing outside the preview used them. The design had never shipped.

Same rewire as the swaps pass: extract the layout into a presentational
ClockInView, put the mapping in lib, drive both routes from it. The
preview now screenshots the component tree the product ships instead of
a parallel copy free to drift.

Everything on the live screen is computed from real rows — the shift and
its break from `shifts`, the day's schedule from the same, recent
activity and both weeks' hours from `clock_events` paired through
lib/hours. GPS, geofencing, the offline outbox and the realtime refresh
all carry over unchanged.

Two behaviour fixes fell out of the rewire:

- Clocking out no longer requires taking a break first. The old chain was
  in -> break_start -> break_end -> out, so the only way to end a shift
  was through a break you may not have taken. Clock Out is now reachable
  from both 'working' and 'break'.
- Weekly hours bucket paired *segments*, not events. Slicing events per
  week and pairing each slice leaves a night shift that clocks in 23:00
  Sunday and out 07:00 Monday looking unclosed in the first week, which
  pairClockEvents then runs to `now` — inventing hours nobody worked.

The reference is a 1920x1280 design exported at 80%, which the aspect
test in docs/LOOP.md cannot detect (1536x1024 is exactly 3:2, so three
candidate canvases all "agree") and cap heights are too coarse to
resolve. Long-string widths settled it at 0.793. Measuring at that scale
found the buttons should be h-14 not h-12, the shift time 36px not 32,
card padding 24 not 20, and the Need Help/attendance spacing well short.
Working shown in design/.loop/clockin-log.md.

QR and PIN are dropped rather than shipped dead: nothing generates the
per-location code a scan would read and there is no PIN in the schema,
so that slot goes to manual clock-in, the real second method. "View
Policy" renders only when handed a destination, which returns for free
once settings-policy is built.

38 tests cover the new mapping. One of them caught date-fns isYesterday
reading the system clock rather than the `now` being rendered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* style: apply prettier to the clock-in files

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* design: match Team Availability to design/Availability.png

Builds the team availability screen: a weekly staff x day matrix with
per-day coverage counts, working preferences, unavailable periods,
pending submissions, conflicts, and the scheduling rules availability is
validated against.

Ten components under src/components/availability/ plus the row/day/state
shapes in src/lib/availabilityMatrix.ts, composed by AvailabilityView and
rendered at a new /availability-preview route. Presentational only —
every figure arrives precomputed, so the live page and the preview render
an identical tree.

`partial` and `preference` are modelled as distinct states even though
both cells read "Preference": the reference tints them differently and
counts them separately in the legend (38% partially available vs 6%
preference only), so collapsing them would make the summary
unreproducible.

Adds an `avail` token group for the four cell washes. The fills are
sampled; the INKS deliberately are not. Measured against their own wash,
the reference's inks land at 4.11 / 3.53 / 4.17 : 1 — under the 4.5:1
DESIGN.md §5 requires, on the densest text on the screen. Each ink is the
sampled hue darkened by the minimum that clears the threshold (now 4.67 /
4.67 / 4.61); at 12px the shift is invisible side by side. Dark mode
needed the inverse — the light inks measured 2.6-3.9:1 on the dark
washes, so brightened `-fg-dark` variants were added (7.9-9.5:1).

The donut carries reserved status colours, not a categorical palette, so
identity comes from the labelled legend and never from colour alone; 2px
inter-segment gaps per the mark spec.

Captures were taken at 1624px and downscaled to 1415 — these references
are a 1920x1080 design exported at 0.871x, and comparing a 1:1 render had
me shrinking text into arbitrary sub-token sizes before that was caught.
Everything is back on stock tokens. See design/.loop/availability-log.md.

typecheck, lint, format:check and build all clean; dark mode verified by
screenshot.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* feat: make the Leave and Timesheets stub buttons do their jobs

Thirteen controls across two screens either reported "coming soon" or were
silent no-ops. §24 of the build prompt forbids both; a button that answers a
click with a toast about itself is worse than one that is absent, because the
user has already decided they need it.

Leave (six):
- Export writes a real CSV of `filtered` — post-filter, post-sort,
  pre-pagination — so the file matches what is on screen rather than page one
  of it (§47).
- The period control and both "choose a range" buttons open one date-window
  dialog. Requests are matched by OVERLAP, not containment: a fortnight
  starting in March is still March leave when you ask about April, and
  dropping it would hide someone who is away.
- "View all balances" computes annual entitlement per staff profile with the
  same arithmetic already used for the signed-in user. People with no
  allowance recorded are omitted rather than shown as zero — those are very
  different statements.
- "Team calendar" navigates to /app/schedule.

Timesheets (seven), plus the table that made them possible:
- `timesheets` had no reader and no writer anywhere in the app. It does now,
  via a new service, so "Approve Selected" records a real sign-off.
  `total_minutes` is a SNAPSHOT of the agreed hours and deliberately does not
  track the derived figure afterwards: if a clock event is corrected later the
  two disagree, and that disagreement is a fact worth seeing.
- No unique constraint exists on (org, staff, period), so approval reads first
  and splits into one insert plus per-row updates. Re-approving is idempotent
  instead of accumulating duplicate sign-offs for the same week.
- Row click opens the worked segments, including the `reviewReason` flags from
  lib/hours.ts. A forgotten clock-out has to be visible on the screen a manager
  approves from, not only in the module that detected it.
- Export writes payroll CSV carrying the approval status per row, because a
  file that hides which lines a human signed off is how unapproved hours get
  paid.
- Department filter was an empty list and a no-op handler; it now loads real
  departments. "View all pending" filters to the queue. The guide opens real
  documentation of how the hours are derived.

Sidebar: `NavItem.to` becomes required. Every item has had a route since #75,
so the greyed-out "Soon" branch was dead — but leaving the field optional keeps
the door open to shipping navigation that goes nowhere. A future unrouted entry
is now a typecheck failure.

Contact address corrected to info@rota.gakinz.com.

typecheck, lint, format and 238 tests green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* feat(rota,schedule,announcements): replace the last stub controls with real ones

Rota Builder — the action rail did nothing. Seven buttons, one working:

- Copy Shifts / Paste Shifts store the week's shifts as day OFFSETS from
  Monday, not absolute dates, so the same clipboard pastes into any week and
  Tuesday stays on Tuesday.
- Copy Previous Week fetches that week's rotas rather than reusing state, since
  only the visible week is ever loaded.
- Clear Shifts deletes draft shifts only, behind the themed ConfirmDialog.
  Published shifts are skipped deliberately: staff have been told they are
  working them, and a bulk clear must not silently unschedule someone's
  Saturday.
- Pastes run sequentially. A week can be 50+ rows, and firing them together is
  how you trip the rate limiter halfway and leave a rota half-pasted.
- Templates opens the shift-type library; Print prints.

The "More" button is gone rather than given invented contents; its slot went to
Copy Previous Week, which §8 actually asks for.

View tabs went from four to two. "2 Weeks" and "Month" were inert for a real
reason — rotas key on an exact period_start/period_end pair, so a month is a
different rota row from the weeks inside it. Making them work would create rota
rows as a side effect of looking at a calendar, and change what Publish means
depending on the open tab. §8 asks for weekly and daily; Day is safe because it
narrows the DISPLAY while the week's rota stays loaded and editable.

More filters: job title and open-shifts-only, with an active-count badge.

Schedule — Filters now filters, and does so at the source, so the grid, the
coverage percentage, the summary tiles and the ICS export cannot disagree about
which shifts they are describing. History opens the full publication list and
states that rotas record when they were published but not by whom, rather than
inventing an author. The display-settings gear navigates to Preferences instead
of growing a second copy of settings that already have a screen.

Announcements — category and pinned filters, CSV export of the filtered feed,
and a guide that documents how audience narrowing and read counts actually
behave, including that read counts are a floor rather than an exact figure.

New: a Popover primitive that dismisses on pointerdown rather than click, so
opening a second popover while one is open does not close-then-reopen it.

typecheck, lint, format and 238 tests green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* feat(swaps,locations): wire the last nine silent no-op controls

These were worse than the "coming soon" toasts: `() => undefined` handlers
render a normal, enabled button that swallows the click with no feedback at
all. A user cannot tell that from a bug in their browser.

Swaps (four):
- Period and overview-range open a date window. Swaps are dated by the SHIFT
  they concern, not by when the request was typed — a May request about a June
  shift belongs in June — falling back to `created_at` only when the shift row
  is gone.
- The period label read "this week" unconditionally while the table showed
  every swap ever raised. It now reports the window actually applied, with a
  "This week" button that sets the range the old label claimed.
- More filters: swaps I am part of, and requests still awaiting a decision.
- View policy documents the two-step accept-then-approve flow, what a manager
  should check, and — stated plainly — that none of those checks are automated,
  so the screen will not stop an approval that breaks a rest period.

Locations (five):
- More filters (both tabs): sites/departments with staff, or with upcoming
  shifts. Says why status, type and region are absent — they are not columns.
- View activity goes to the audit log.
- Guide covers the location/department relationship, why a location's timezone
  governs how every shift reads, what coverage does and does not measure, and
  that deleting a site detaches its shifts rather than destroying them.

A repository-wide grep for "coming soon", "not built yet" and `() => undefined`
handlers now returns nothing outside the design-preview routes.

typecheck, lint, format and 238 tests green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* feat: approved swaps move the shift, spec route aliases, and two real overflows

**An approved swap now reassigns the shift.** It previously only marked the row
`approved`, on the reasoning that reassignment belongs in the Rota Builder
where the conflict and coverage context lives. That reasoning fails in the way
that matters: it left the rota — the thing staff actually read — disagreeing
with a decision both parties had just been notified about. The requester still
saw the shift on their schedule; the colleague who took it did not see it on
theirs; the manager got no signal a second step was outstanding.

Ordered after the approval write deliberately. If the reassignment fails the
swap stays approved and the shift stays put, which is visible and correctable
by hand, and the toast says so. The reverse order could move a shift for a swap
that was never approved. (§14, §25.)

**Route aliases** for the three paths the spec spells differently from the
built app: `/app/team/:staffId`, `/app/clock-in`, `/app/profile/*`, plus
`/auth/callback`. Aliased rather than renamed — renaming would break every
bookmark and every link already sent to staff. The callback route exists
because its allowlist lives in the Supabase dashboard, not only in this code:
if that is ever pointed at the conventional path, the user must not land on the
404 page while holding a valid session in the URL hash.

**Two genuine mobile overflows**, found by measuring rather than eyeballing.
A first pass with headless screenshots reported the dashboard as broken at
390px; that was an artefact — headless clamps the window to 500px and then
crops the image, so a correct page looks cut off. Driving CDP's
`Emulation.setDeviceMetricsOverride` at a true 390px viewport and comparing
`scrollWidth` against `clientWidth` across four breakpoints and eleven screens
found the dashboard clean and these two not:

- Clock-in's security footer: two flex rows that never wrapped, so the support
  block and its button pushed the page to 406px and it scrolled sideways.
- Rota Builder's toolbar: same, to 458px.

Both now wrap. Everything else flagged is a `min-w-[Xrem]` table inside an
`overflow-x-auto` container — the intended pattern from §27, where the table
scrolls and the page does not.

typecheck, lint, format and 238 tests green; production build emits SW and
manifest with 0 preview chunks.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* docs: track the build prompt and record verified status against it

Adds docs/NEW_STRUCTURE.md (previously untracked in the working copy) and marks
its acceptance checklist.

Three states rather than two, because a tick that means "I wrote the code" and
a tick that means "I watched it work" are not the same claim and this report is
worth nothing if they are conflated:

- 43 items evidenced — automated test, measurement, or a code path read end to
  end.
- 23 built and routed but never exercised at runtime here, marked unproven.
- 6 areas named as not built at all, rather than quietly left ticked: the
  /admin platform area, /app/overtime, the standalone location-detail route,
  Connected Accounts, timesheet correction requests, and observed notification
  delivery.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `efe773c` 2026-08-03 — Gideon Akinlotan

Consolidate: merge the rota assistant, the rolling demo seed, and six dependency bumps (#83)

* chore(deps): bump framer-motion from 11.18.2 to 12.43.0

Bumps [framer-motion](https://github.com/motiondivision/motion) from 11.18.2 to 12.43.0.
- [Changelog](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)
- [Commits](https://github.com/motiondivision/motion/compare/v11.18.2...v12.43.0)

---
updated-dependencies:
- dependency-name: framer-motion
  dependency-version: 12.43.0
  dependency-type: direct:production
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>

* chore(dev-deps): bump @types/node from 22.20.1 to 26.1.2

Bumps [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) from 22.20.1 to 26.1.2.
- [Release notes](https://github.com/DefinitelyTyped/DefinitelyTyped/releases)
- [Commits](https://github.com/DefinitelyTyped/DefinitelyTyped/commits/HEAD/types/node)

---
updated-dependencies:
- dependency-name: "@types/node"
  dependency-version: 26.1.2
  dependency-type: direct:development
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>

* feat(demo): rolling three-month demo, past/future colour rule, rota assistant

The demo dataset was one week wide, seeded a rota for only one of five sites,
and used shift-type colours outside the app's palette — so four sites rendered
blank and every chip fell through to the grey default. Rebuild it as a rolling
three months and make the builder read the way a rota is actually used.

Demo data (supabase/seed):
- 17 weeks anchored on current_date: three completed weeks, this week, thirteen
  ahead. Re-running re-centres it, so it is always "this month plus two".
- A rota per site per week. RotaBuilderPage reads shifts *by rota id*, so a
  missing rota row silently hides that site's seeded shifts.
- 90 staff on rotating patterns, one per pattern per site, so every site is
  covered every day and the grid reads as a rolling rota rather than noise.
- Shift-type colours now come from the eight-swatch palette in shiftPalette.ts.
- Ten planted problems — unfilled weekend nights, a double booking, leave with
  shifts still inside it, a 9h rest gap, an unavailability clash, expiring DBS
  checks, no-shows, a missing clock-out, unsynced offline events. A demo that
  only shows a healthy rota never exercises the warning paths.
- Clock events for every finished shift in the last four weeks, plus whoever is
  genuinely mid-shift clocked in right now.
- Adds a dedicated worker account, and rotates demo passwords on re-run so
  c_password is always the live value rather than probably-the-live-one.

Past vs upcoming:
- shiftTimeState() splits past / live / future, and past chips swap their
  shift-type colour for a neutral token in both the builder and the schedule.
  Colour belongs on the work still to come; a shift running now gets a live
  edge instead. One clock per grid, not one per chip.

Finding a pattern or a time:
- ShiftPatternLegend: the colour key doubles as a filter, with each pattern's
  times and this week's count on it.
- The search box now matches what it always promised — staff, skills, job
  titles, shift-type names, shift times and notes, rather than names only.

Rota assistant (was AutoFillPanel):
- lib/rotaInsights: deterministic rules over rows the org already has, so
  Review and Fill gaps work offline with no API key and cannot invent a name or
  a date. Flags shortages, leave clashes, unavailability, double bookings, WTR
  rest breaches, over-contract weeks and lapsing documents; ranks cover for an
  open shift with the reasoning shown and hard blockers excluded outright.
- The Edge Function keeps the language model to phrasing, and gains an
  announcement task plus availability/hours/open-shift grounding. Without
  OPENROUTER_API_KEY it 503s naming the missing secret; the other tabs carry on.
- "Draft it with AI" in the announcement composer fills the form, never posts.

16 new tests, all pinned to a fixed instant.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(ai): verify the model's rota suggestions instead of trusting them

With OPENROUTER_API_KEY set and the function exercised against real demo data,
gpt-4o-mini broke two of the rules it was given: it put one person on an
overlapping Night and Twilight on the same day, and returned 20:45-06:15 for a
Night pattern whose real hours are 21:45-07:15. Both would have landed on a
manager's grid as valid-looking suggestions.

Being told the rules is not the same as following them, so the function now
checks:

- Times snap to the chosen shift type's own default_start/default_end. The type
  owns its hours, and this is what dragging that type onto the grid already
  does, so the two routes now agree.
- Anything overlapping an existing shift for that person is dropped, and an
  accepted suggestion becomes "busy" itself so the rest of the same response
  cannot double-book them.
- Overlap is judged in the location's timezone: the model returns a local date
  and "HH:MM" while stored shifts are UTC instants, and comparing those two
  directly is wrong by the offset. Night shifts crossing midnight are handled.
- Suggestions outside the requested period are dropped.
- What was dropped or re-timed is appended to the summary. A list that quietly
  shrinks is indistinguishable from a model that had less to say.

Prompt gains the two rules it was observed breaking.

Verified against the same request that produced the bad output: 4 suggestions
re-timed to 17:00-23:00, 2 dropped for clashing, nobody double-booked.

Also documents APP_URL and NOTIFICATION_FUNCTION_SECRET in .env.example. Both
are read by Edge Functions but appeared in no example file, so a fresh
environment had no way to know they existed. Found by auditing every key in
.env against its consumer and against the live Supabase secrets: 26 keys, all
correctly named, no placeholders left, and no secret behind a VITE_ prefix.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* chore(dev-deps): bump @vitest/coverage-v8 from 3.2.7 to 4.1.10

Bumps [@vitest/coverage-v8](https://github.com/vitest-dev/vitest/tree/HEAD/packages/coverage-v8) from 3.2.7 to 4.1.10.
- [Release notes](https://github.com/vitest-dev/vitest/releases)
- [Changelog](https://github.com/vitest-dev/vitest/blob/main/docs/releases.md)
- [Commits](https://github.com/vitest-dev/vitest/commits/v4.1.10/packages/coverage-v8)

---
updated-dependencies:
- dependency-name: "@vitest/coverage-v8"
  dependency-version: 4.1.10
  dependency-type: direct:development
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>

* chore(deps): bump @sentry/react from 8.55.2 to 10.69.0

Bumps [@sentry/react](https://github.com/getsentry/sentry-javascript) from 8.55.2 to 10.69.0.
- [Release notes](https://github.com/getsentry/sentry-javascript/releases)
- [Changelog](https://github.com/getsentry/sentry-javascript/blob/10.69.0/CHANGELOG.md)
- [Commits](https://github.com/getsentry/sentry-javascript/compare/8.55.2...10.69.0)

---
updated-dependencies:
- dependency-name: "@sentry/react"
  dependency-version: 10.69.0
  dependency-type: direct:production
  update-type: version-update:semver-major
...

Signed-off-by: dependabot[bot] <support@github.com>

* chore(deps): bump lucide-react from 1.27.0 to 1.28.0

Bumps [lucide-react](https://github.com/lucide-icons/lucide/tree/HEAD/packages/lucide-react) from 1.27.0 to 1.28.0.
- [Release notes](https://github.com/lucide-icons/lucide/releases)
- [Commits](https://github.com/lucide-icons/lucide/commits/1.28.0/packages/lucide-react)

---
updated-dependencies:
- dependency-name: lucide-react
  dependency-version: 1.28.0
  dependency-type: direct:production
  update-type: version-update:semver-minor
...

Signed-off-by: dependabot[bot] <support@github.com>

* chore(ci): bump github/codeql-action in the github-actions group

Bumps the github-actions group with 1 update: [github/codeql-action](https://github.com/github/codeql-action).


Updates `github/codeql-action` from 4.37.3 to 4.37.4
- [Release notes](https://github.com/github/codeql-action/releases)
- [Changelog](https://github.com/github/codeql-action/blob/main/CHANGELOG.md)
- [Commits](https://github.com/github/codeql-action/compare/v4.37.3...v4.37.4)

---
updated-dependencies:
- dependency-name: github/codeql-action
  dependency-version: 4.37.4
  dependency-type: direct:production
  update-type: version-update:semver-patch
  dependency-group: github-actions
...

Signed-off-by: dependabot[bot] <support@github.com>

* chore: ignore vitest coverage output in eslint and git

* fix(deps): pin @vitest/coverage-v8 to 3.x — its major is locked to vitest's

CI caught what five local gates did not.

`@vitest/coverage-v8@4` declares a hard `peer vitest@4.1.10`. This project is on
vitest 3.2.7, so a clean `npm ci` fails with ERESOLVE and every job after it
never runs.

Locally it looked completely fine — typecheck, lint, 254 tests and even
`npm run test:coverage` all passed. They passed because an earlier
`npm install` (resolving an unrelated framer-motion conflict) had already
rewritten the lockfile to a resolution that `npm ci` refuses. **`npm install`
succeeding proves nothing about `npm ci`**, and the tests I ran were the wrong
question: the failure is in dependency resolution, not in test execution.

Pinned back to ^3.2.7, lockfile regenerated, and verified the honest way —
`rm -rf node_modules && npm ci` from the committed lockfile.

`dependabot.yml` now ignores its majors with that reasoning inline. This is the
same shape as the tailwind-merge/tailwind coupling in audit01 §2 and the
eslint-plugin-react-refresh 0.x trap in P0-4: a package whose major is
meaningless except in lockstep with its host. Lift it in the same PR that moves
vitest to 4.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `e02002a` 2026-08-03 — Gideon Akinlotan

Fix double-booked staff, make the warnings real, and cap the dashboard (#85)

* fix(rota): refuse double-bookings and surface the warnings that were silent

Two defects with one cause: nothing in the builder ever checked whether a
person was already working when a shift was written, and the panel that was
supposed to say so could not detect it.

Prevention. Every write path — add, drag-create, drag-move, edit, paste,
copy-previous-week, AI apply, AI assign — now runs `findClashingShift` first
and refuses an overlap, naming who is already rostered and when. Bulk callers
thread a running list through the loop so a shift written on one pass is
visible to the next; without that a paste only sees the week as it was before
it started and duplicates inside a single batch slip through. This is how the
live demo data ended up with each person rostered twice a day: "Copy previous
week" onto an already-populated week, unchecked. Paste now reports what it
skipped, because a paste that silently dropped half its rows looks exactly
like one that worked.

Detection. The Warnings tab was bound to `computeWarnings`, which counted
unfilled shifts and nothing else — so a rota with someone booked twice
reported zero warnings. It now reads `computeRotaInsights`, the engine that
already existed for the assistant and covers double-bookings, rest breaches,
approved-leave clashes, declared unavailability, contract overruns and
document expiry. Severity is shown by icon and word as well as colour, and
each entry jumps to the shift it is about. `computeWarnings` is deleted rather
than deprecated so nothing binds to it again.

Publishing a week with a critical issue is now blocked (§41): publishing is
what tells staff the week is real.

Duplicating an assigned shift produced a guaranteed self-overlap. It now
duplicates as an open shift and says so — which is what "another slot on a
busy shift" actually means.

13 new tests cover the overlap rule, including back-to-back shifts (not a
clash), open shifts (never clash), and instants compared across differing UTC
offsets. 267 pass.

* feat(app): stop the dashboard growing without bound, align nav to §4

Dashboard. Today's Schedule and Upcoming Shifts both rendered every row they
were given. They emit one row per shift-type-and-location group, so five sites
times six shift types is thirty rows, and Upcoming spans the rest of the week
on top of that — the left column ran several times the height of the two
beside it and pushed everything else below the fold. Both are capped at six
with the remainder counted, so the three-column row reads as one band and the
full list stays one click away.

Metric cards are now §7's five, in its order: Total Staff, On Shift Today,
Shift Coverage, Open Shifts, Pending Leave. Compliance keeps its place as the
hint on Total Staff rather than a card of its own.

Navigation. The sidebar is §4's list verbatim — Rota Builder, Team,
Integrations added, Clock In moved down. Two earlier deviations are resolved
in the spec's favour: Team had been folded into Settings -> Permissions, and
Integrations demoted to a Settings tab; §10 and §34 are explicit that
/app/team is the workforce directory, so the directory moved there and
/app/staff now redirects to it rather than the other way round. Every link
already sent to staff still resolves. Mobile tabs take §22's spelling.

The nav config moved to lib/sidebarNav.ts so it can be tested without
importing a React tree, and 39 new assertions check every sidebar target for
all three roles against the route table parsed out of App.tsx — the same guard
that already covers settings tabs, marketing nav and global search. Renaming
every nav target is exactly when that guard earns its keep.

306 tests pass; typecheck, lint and build clean.

* style: apply prettier

format:check is a separate CI step from lint; the first push ran eslint and
tsc but not prettier, so five files failed the gate on formatting alone.

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
---
## `60fe2c6` 2026-08-03 — Gideon Akinlotan

Build the 10 screens NEW_STRUCTURE names that had no route (#86)

* feat(overtime): build /app/overtime — the table had no reader and no writer

`overtime_requests` has been in the schema since migration 0001 and nothing in
the app ever touched it (audit01 P2-7). NEW_STRUCTURE §14 and §34 both name the
screen; there was no route. Staff could not offer overtime and managers could
not allocate it, so hours worked beyond contract were invisible outside the
timesheet totals.

Adds the service, the view-model, the page and the nav entry. The service is
shaped deliberately like `leaveService` — the two are the same workflow, a
person asks and a manager decides — so the pages, the status vocabulary and the
RLS story stay recognisable instead of each request type inventing its own.

Two views on one route, matching Availability: a staff member sees and raises
their own, a manager toggles to the organisation and approves. Splitting them
would mean a manager who is also on the rota — the normal case in a small care
home — has two places to look. The route is open to every member because §2
lists "Request overtime" among what staff can do; the Team toggle is what gates
the approval queue.

Realtime: `overtime_requests` was absent from 0012's publication on that
migration's own first rule — "only tables a screen actually watches". One
watches it now, and it carries the same approve/decline queue as leave_requests
and shift_swaps, both published. 0013 adds it, idempotently and by the same
pattern. Adding the table to the TypeScript union without the migration would
have given a subscription that silently never fires.

13 tests on the view-model. `formatOvertimeHours` renders 0.5 as "30m", not
"0.5" — a decimal on a payroll-adjacent screen reads as an error — and the
rounding case covers the carry (1.999h is "2h", never "1h 60m"). Totals exclude
rejected and withdrawn hours, which would otherwise overstate what the
organisation is committed to paying.

* feat(app): add the location detail route and the Connected Accounts tab

Two of the routes NEW_STRUCTURE §34 names that had nothing behind them.

**/app/locations/:locationId** is the existing workspace with one site opened,
not a second implementation of it. A parallel detail screen would duplicate the
tabs, the data load and every future fix, and would drift from this one within
a release. A URL-named site now wins over "first in the list" on load, falling
back to the first row when the id is unknown so a stale bookmark still lands
somewhere usable. Selecting a different site rewrites the URL only when the URL
was already naming one — on /app/locations the selection is a panel, not a
destination, and pushing history per click would make Back walk the list
instead of leaving the screen. The route is declared after
`locations/departments` so that literal path is never captured as a :locationId.

**/app/account/accounts** is built on `auth.getUserIdentities()`, so every row
is a sign-in method that genuinely works; linking and unlinking go through
`linkIdentity`/`unlinkIdentity` and change the account server-side. Nothing is
mocked.

§21 names Google, Microsoft and Apple, but `OAuthProvider` is `google | github`
and a provider only appears if it is also declared in VITE_OAUTH_PROVIDERS —
the same list the sign-in screen reads, for the same reason: a button for a
provider disabled in the dashboard is a dead end. So the unsupported ones are
absent rather than shown broken. An already-linked identity still renders even
if it is no longer offerable, so nothing a user connected can silently vanish.

Unlinking the last identity is disabled with the reason shown — Supabase
refuses it server-side, and that refusal is the real guard.

The profile tab-order test caught the new tab, as designed; updated to §21's
order. 324 tests pass.

* fix(locations): include routeLocationId in the load callback's deps

The URL-named site is read inside `load`, so omitting it from the dependency
array meant navigating between two location detail URLs reused a callback
closed over the previous id.

* feat(admin): build the platform administration area

The last of NEW_STRUCTURE §34's unbuilt routes: seven screens behind /admin,
plus the guard that gates them.

**The guard is not RequireRole.** §2 is explicit that Super Admin is a
platform-level permission and not an organisation membership role, so
`RequirePlatformAdmin` reads `profiles.is_platform_admin`. Conflating the two
would hand every customer's owner the keys to every other customer's data. It
waits for the profile to resolve before deciding — rendering the denial early
would flash "access denied" at a genuine administrator on every hard refresh.
As always, RLS is the boundary: `public.is_platform_admin()` is folded into
`is_org_member`/`has_org_role` in 0002, so a non-admin who defeats the
component still reads nothing.

**The shell is its own.** AppShell is built around an organisation — org
switcher, role-filtered sidebar, tenant-scoped search — all of which are
misleading in an area that sits above organisations. Platform screens are
tinted `danger` rather than `primary` and carry a standing banner, so a
screenshot of cross-tenant data never looks like a customer's own.

**Five screens on real data**: overview, organisations, platform users, billing
and audit all read live cross-tenant rows through the ordinary RLS path rather
than a service-role Edge Function, which would replace a policy the database
enforces with one this codebase would have to keep correct.

**Two screens whose tables do not exist, handled honestly.**
`support_access_sessions` and `feature_flags` are named in docs/SCHEMA.md and
§20/§34 but appear in no migration. Rather than fake them:

- Support says plainly that time-boxed access is not built, and that the
  platform-admin flag is already standing, un-time-boxed, unrecorded access —
  then does the half that is real: find a tenant, see its size, open its audit.
- Feature flags says per-tenant flags need a store that does not exist, then
  reports what genuinely varies per deployment — which integrations have keys,
  read from the same `lib/env.ts` the rest of the app branches on. A toggle
  that persisted nowhere would be worse than none.

Billing reports subscription state and explicitly does not report revenue,
invoices or MRR: no payment provider is wired to this deployment, and a number
on a billing screen that nothing computed is worse than an absent one.

The one write in the area is the platform-admin flag — the most dangerous
switch in the product. It confirms, states what it grants in plain words, and
refuses to let an administrator remove their own access or the last one:
stranding the platform is unrecoverable without a database console.

Nav lives in lib/adminNav.ts so the route guard test can read it without a
React tree. Nine new assertions cover all seven routes and assert /admin never
appears in the tenant sidebar for any role. 333 tests pass.

* fix(overtime): allow 'cancelled' — the Withdraw button could not have worked

`overtime_requests.status` was created in 0002 as
  check (status in ('pending','approved','rejected'))
while `leave_requests.status`, defined fifteen lines above and otherwise
column-for-column identical, allows 'cancelled' too.

`cancelOvertimeRequest` writes 'cancelled', so the Withdraw control would have
failed with a 23514 check-constraint violation on every use — surfacing as
"could not withdraw that request" and as a Sentry error nobody could act on.

The omission reads as an oversight rather than a decision: the two tables model
the same workflow and `leaveService` has always had `cancelLeaveRequest`.
Overtime had no service at all until this branch, so nothing had ever tried to
write the value and the gap could not surface. 0014 widens the constraint,
which is safe — every existing row already satisfies the narrower set.

Also corrects two comments that asserted the opposite. `overtimeRows.ts` said
the column had "no CHECK constraint" and a test justified its fallback on that
basis. Both are now accurate: the fallback is defensive against a future
widening, not something reachable today.

* perf(overtime): do not read the staff directory for the personal view

The roster is only used to put names against other people's requests, which
only the Team view renders. Loading it for a staff member reads the whole
directory to populate a column they never see — the same reason
AvailabilityPage already skips it.

Own profile is now merged into the lookup explicitly rather than relying on
"that column is not rendered in this mode", which would make the view model
correct only by accident.

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
---
## `9d47df7` 2026-08-03 — Gideon Akinlotan

Pin the sidebar, merge four screens into two workspaces, and put shift delete on the shift (#87)

* feat(nav): pin the sidebar, merge four screens into two workspaces, surface shift delete

**The sidebar scrolled away.** AppShell was `min-h-screen`, which grows with its
content — so `main`'s `overflow-y-auto` had no bounded parent to scroll inside,
the document scrolled instead, and the sidebar and header went with it. On a
long rota you lost the navigation entirely and had to scroll back up to change
screen. The shell is now exactly one viewport tall and only `main` scrolls.

`100dvh`, not `100vh`: on mobile Safari and Chrome `vh` is pinned to the
*largest* viewport, so with the address bar showing, the bottom of the sidebar —
the profile block and the collapse control — sits below the fold with no way to
reach it.

**Deleting a shift was three steps and an off-screen panel.** Click the chip,
find the inspector on the right, find Delete inside it — for the most common
correction a manager makes while building a rota. There is now a × on the chip
itself, confirmed (§1 requires it, and the distance that used to make an
accidental delete unlikely is gone by design, so the guard replaces it). The
prompt names the person and the time, because on a full grid the × you pressed
and the shift you meant are one row apart.

It is a sibling of the chip, not a child: the chip is a `<button>` carrying
dnd-kit's listeners, and a button inside a button is invalid HTML browsers
silently reparent. It stops pointer events, or pressing it starts a drag.
Hidden until hover or keyboard focus — 50+ chips with a permanent × is the
visual noise §3 rules out — but *permanently* visible under `hover: none`,
because on a tablet a hover-only affordance is an invisible one.

**Four screens became two workspaces.** Rota Builder + Schedule are one job
split in two (build a week, read the published result) with no way across but
the sidebar; Team + Availability are "who works here" and "when can they work".
Each pair is now one sidebar entry with section tabs.

They stay separate components. Merging the rota builder and the schedule into
one file would produce ~2,500 lines against §31's "do not build large
monolithic components", and they genuinely do different work — one writes
drafts, one reads published rows. Merged as a *workspace*: one header, one URL
space, one sidebar entry, two focused components underneath. Routes are
unchanged, so every existing bookmark still lands.

Staff get one tab, not two: they cannot open the builder or the directory, so a
switch whose other side 403s would be a control that only ever produces a
permission screen. `WorkspaceHeader` renders no tab bar for a single item.

**Integrations is out of the sidebar.** It had been in both the sidebar and the
Settings tab bar pointing at the same route, so one destination had two nav
entries and the sidebar row lit up "active" while the Settings bar
simultaneously said you were inside Settings.

`navigationTargets.test` now covers the workspace tabs across all three roles —
a tab can 404 for one role while looking fine for another.

338 tests green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(clockin): make every card in a row end on the same line

The right rail (Today's Schedule + Recent Activity) is naturally taller than
the shift card beside it, so the grid row grew to the rail's height while the
shift card kept its own — the two columns ended 60px apart. Row 2 had the same
latent problem, held together only by its cards' content happening to match.

The grid's default `items-stretch` stretches the *cell*; without the card also
filling that cell it just sits at its natural height inside a taller box. So
every cell and every card root is now `h-full`, and the rail is a flex column
whose last card takes the slack — Recent Activity is a list, so extra height
shows more of it rather than stretching a fixed layout.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `a4d58b6` 2026-08-03 — Gideon Akinlotan

feat(reports): add the charts §17 asks for, on a validated palette (#88)

§17 requires "Summary cards, **Charts**, Data tables, Download actions". The
screen had three of the four — a catalogue, filters and working CSV exports,
but nothing that showed a trend.

Two charts, from the queries that already exist: hours actually worked (paired
clock events, the same `pairClockEvents` arithmetic /app/timesheets shows, so
the chart cannot disagree with the screen it reports on) and shifts scheduled
per day. Labour *cost* is in §17's category list and is deliberately absent —
no pay-rate column exists anywhere in the schema, and a cost chart would be an
invented number carrying the authority of a graph.

**Two charts, never two axes.** Hours and shift counts are different magnitudes
in different units; one plot would need a second y-scale, which lets the author
imply any relationship they like by choosing the scales.

**The palette is computed, not chosen.** The obvious move was to reuse the
`shift-*` hues — the product already has eight and they look right together.
Run against the six checks they FAIL as a chart palette: clay↔violet sit at
ΔE 14.1 for *normal* colour vision (below the 15 floor), and every hue is under
3:1 on the card surface, because they are pale chip washes designed to sit
behind dark text, not marks read on their own.

So `chartPalette.ts` is a separate, deeper set, validated in both modes:

    light  #2563C9,#127D5E,#A76A0C,#8A46C4,#BE3B34  → ALL CHECKS PASS
    dark   #4A8BE4,#1FA57C,#B08028,#9E6BD4,#DC6457  → ALL CHECKS PASS

Dark steps are chosen against the dark surface, not flipped. Order is fixed and
never cycled: colour follows the entity, so filtering a series out must not
repaint the survivors.

CVD separation lands in the 6–8 band, which is legal only with a non-colour
channel — so a legend is always drawn for two or more series (never for one,
where the title names it), and the same figures are available as a real
`<table>` behind a disclosure. Identity is never colour-alone.

Rendering it and looking at it caught two things the validator cannot: bars
sized at the full group width made a single-series chart a row of touching
slabs, and `justify-between` x-labels drifted out of line with bars centred in
fixed slots. Both fixed — cluster capped at 62% of the slot and centred, labels
on the same equal-column track as the groups.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `83fea7a` 2026-08-04 — Gideon Akinlotan

Platform console: roles, immutable audit, tenant depth, organisation status (#90)

* Platform console phase 1: fix the two defects, add platform roles and real audit writes

`/admin` already existed — seven working screens since #86. This is the
foundation the rest of the console needs, and it starts by fixing two things
that were broken rather than missing.

**`/admin/users` did not work.** `profiles` RLS was still 0001's own-row-only
policy; nothing in 0002-0014 ever widened it. So `listAllProfiles()` returned
exactly one row — the reader's own — and the platform-admin toggle updated zero
rows and got back a 204 with no error. It rendered a one-account table and a
button that reported success and changed nothing. 0015 widens the read to
platform administrators and moves the write onto RPCs.

**`audit_logs` had one writer in the entire system** (`anonymize_staff_member`,
0011). No role change, rota publish, invite or org edit was recorded — audit01
P1-5, "the highest-value schema work outstanding". 0016 adds the writers.

## 0015 — platform roles, additively

`platform_admins` carries the granular role; `profiles.is_platform_admin` stays
exactly as it is and keeps its meaning, so not one policy from 0002 changes.

The table is the source of truth and the boolean is a trigger-maintained mirror,
not the reverse: a profile with the flag set and no `platform_admins` row would
hold unlimited cross-tenant read through every 0002 helper while
`has_platform_role()` returned false — standing access with no recorded role and
no revocation record, drifting invisibly. The "someone writes the boolean
directly" objection is answered structurally, reusing 0010's `smtp_pass`
pattern: the UPDATE privilege on that column no longer exists for
`authenticated`. Backfill runs in the same file, before anything gates on it.

Grants go through SECURITY DEFINER RPCs with no write policy at all (the 0006
posture), so the last-platform-owner guard lives in the database and not only in
the browser.

## 0016 — audit events

`org_id` becomes nullable for platform-scoped events; the owner-only read policy
stays correct for free, since `has_org_role(null, ...)` is false. The FK becomes
`on delete set null` — an audit trail a tenant deletion erases is not an audit
trail — and the actor and org names are snapshotted at write time rather than
joined, which fixes the actor column without widening `profiles` so co-members
can read each other's email addresses.

Immutability is a trigger, not a policy: RLS does not apply to the table owner
and service_role carries BYPASSRLS, so "no UPDATE policy" would not actually
stop an Edge Function rewriting history. Deliberately NOT `force row level
security` — that applies RLS to the owner, and with no INSERT policy by design
it would silently break every SECURITY DEFINER writer instead of hardening
anything. The trigger permits exactly one UPDATE, the FK detach, because
referential actions fire triggers and a blanket block would make deleting an
organisation fail outright.

Triggers for what the database can observe (memberships, rotas, invites,
organisations, platform_admins); a whitelisted RPC only for exports, which are
reads and leave no row behind. Not on `shifts` — a publish writes hundreds of
rows and would make this a second shifts table.

## Lifted out of the tenant app

Seven near-duplicate stat cards plus `AdminStat` become one `StatTile`; 31
hand-rolled "Loading…" blocks get a `LoadingState` with skeletons that do not
shift the layout; ten hand-rolled tables and seven raw `<table>`s in the console
get one `DataTable`, generalised from `SiteTableHeader`'s column descriptor and
`StaffTable`'s props. `AdminPage` now delegates to all of them plus the existing
`PageHeader`/`EmptyState`, so the two areas cannot drift again. `Sidebar`'s
focus trap becomes `useFocusTrap`, shared with the console's new mobile drawer
rather than copied into it.

## The console

There was no link to `/admin` anywhere in the product — you had to type the URL.
Added to `UserMenu`, not the sidebar: `navigationTargets.test` asserts no
`/admin` target appears there for any role, correctly.

Billing and feature flags are role-restricted in the nav AND gated on the route,
because §34 is explicit that restricted routes must not rely only on hidden
navigation.

## Verification

typecheck, eslint --max-warnings 0, 342 tests, prettier --check and build all
pass. Both migrations parse against the real PostgreSQL 17 grammar. Not yet run
against a live Postgres — the PL/pgSQL inside the dollar-quoted bodies is
unverified until then, and no migration has been applied anywhere.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* Platform console phase 2: tenant and account depth, suspension, and the administrator roster

Four new screens, two migrations. The console could list every customer and do
nothing about any of them; it can now open one, see who is in it, what it uses
and what it has done — and suspend it.

## 0017 — organisation lifecycle

`organisations` had no `status`, no `suspended_at`, no soft-delete of any kind,
so the most-used action in any platform console was not expressible.

**Suspension is a billing and account state, not a lockout, and every surface
says so.** No RLS policy reads this column: a suspended organisation's staff
keep signing in, keep clocking in, keep seeing their rota. Making it a real
lockout means a check inside `is_org_member()`, which every policy in 0002
depends on, across tables with no RLS test coverage (audit01 §7) — doing that
badly locks every tenant out at once. A badge claiming a customer is locked out
while their carers are still clocking in is what audit01 §4 calls worse than a
stated absence, so the caveat appears in the migration header, the service
doc, the confirm modal and the banner on the screen.

Column grants close the write path (0010's `smtp_pass` pattern again) — without
them a suspended tenant's own owner could set `status` back to 'active' from
their settings screen. `set_org_status` requires a reason of at least five
characters and writes the audit row in the same transaction, with `visibility =
'org'` so the customer's owner can read why. 0016's organisation trigger is
replaced (not edited — it is shipped) to skip status, or every suspension would
be audited twice.

## 0018 — platform settings

A singleton with real typed columns rather than key/value, whose CHECK admits
exactly one row. Not `app_settings`: despite the name that table is keyed
`user_id unique` and holds one person's theme.

## The screens

- `/admin/organisations/:id` — overview, users, locations, subscription, usage,
  audit. Usage uses PostgREST `head`+`count` so no rows cross the wire, and says
  plainly that no plan carries a seat or location cap, so nothing is being
  enforced against these numbers.
- `/admin/users/:id` — overview, organisations, activity. Sessions and security
  are **not** shown: they need `auth.sessions` and the Auth Admin API, reachable
  only from a service-role Edge Function. Shown-as-absent rather than shown
  empty, which would read as "this person has never signed in".
- `/admin/subscriptions` — keyed on organisations, not subscriptions, because
  the interesting row is a tenant with *no* record and a list of subscriptions
  cannot show one.
- `/admin/settings` — general, administrators, authentication, maintenance. The
  Authentication tab is deliberately read-only: password policy, magic links and
  session length belong to Supabase Auth, and a switch here would persist a
  boolean nothing consults — the exact defect `/admin/users` shipped with.
  Maintenance mode is a banner and is labelled one; a static PWA cannot refuse
  to serve itself.

The administrators roster keeps a promise phase 1 made — its confirm dialog told
people a new grant "can be promoted from the administrators roster", and now
there is one.

## Fixed while writing

A first draft used `window.prompt` for the suspension reason, which is precisely
audit01 P0-2 (five destructive actions behind native dialogs, all replaced).
Replaced with `SuspendOrgModal`, which can also show the caveat — the most
important thing on that screen, and something a native prompt cannot render.

## Verification

typecheck, eslint --max-warnings 0, 345 tests, prettier --check and build pass.
All five new migrations parse against the real PostgreSQL 17 grammar. Still not
applied anywhere, and the PL/pgSQL inside dollar-quoted bodies stays unverified
until they run against a live Postgres.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* Fix every auth flow on localhost: redirect to the origin you are actually on

Sign-up, sign-in, magic link, Google, GitHub and password reset were all broken
on localhost, and all for the same reason.

## The bug

Every redirect was built as:

    env.appUrl || window.location.origin

which reads as "the configured URL, falling back to wherever we are" and
behaves as "the configured URL, always" — the fallback only fires when
`VITE_APP_URL` is *empty*, and it never is, because `.env.example` ships it and
every real `.env` copies it.

So from localhost, every one of those flows sent the user to
`https://rota.gakinz.com`. Nothing threw. Supabase completed the auth, the
session landed on production, and the dev server was never told anything had
happened — which is why all six failed in the same silent, identical way.

`inviteService.buildAcceptUrl` even carried the comment "Falls back to the
current origin in dev". It could not, and never had.

## The fix

`lib/appOrigin.ts` — `appOrigin()` / `appUrlFor(path)`, resolving the browser's
own origin, with `env.appUrl` kept only as a non-browser fallback.

`window.location.origin` is correct in *every* environment, which is the whole
argument for it: in production it already equals `VITE_APP_URL`, and in dev, on
a preview build or behind a tunnel it is the only value that can work.
`VITE_APP_URL` could only ever be wrong here, never more right. It stays the
canonical URL for anything *displayed* as "your RotaFlow address".

Applied to all four call sites: LoginPage, SignupPage, ForgotPasswordPage and
buildAcceptUrl — the last so an invite minted on localhost is acceptable on
localhost.

## The other half, which is not code

The project's Supabase redirect allowlist held only `https://rota.gakinz.com/**`.
Supabase silently falls back to the Site URL for any target not on that list, so
the code fix alone would have changed nothing. Added `http://localhost:5042/**`
and `http://localhost:5142/**` alongside it; site_url and the production entry
are untouched.

Verified against the live auth endpoint, both directions:

    redirect_to=http://localhost:5142/app/dashboard  -> back to localhost:5142
    redirect_to=http://localhost:9999/evil           -> falls back to production

The second is the bug reproduced exactly, and confirms the allowlist is still
doing its job.

typecheck, eslint --max-warnings 0, 345 tests and prettier --check all pass.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* Make auth failures legible: explain why signup is blocked, and stop rendering "{}"

Follow-up to the redirect fix. Sign-up and magic link were still reported as
"not working", and driving the real form found three separate reasons — none of
which produced a message anyone could act on.

## 1. A disabled button that did not look disabled

`canSubmit` gates on four conditions — first name, last name, a valid email and
all four password rules — and not one of them said so. The button simply sat
there. Worse, `Button` carried `disabled:pointer-events-none`, which prevented
nothing (a disabled <button> already refuses clicks natively) while suppressing
both the `not-allowed` cursor and the `title` tooltip. At `opacity-50` a
saturated primary button still reads as clickable.

So: click, nothing happens, no cursor change, no message. That is
indistinguishable from a broken sign-up, and it is what was being reported.

- `Button` disabled state is now visibly disabled and still hoverable.
  Removing `pointer-events-none` also restores the `title` hints on the
  platform console's disabled controls, which have been invisible all along.
- `SignupPage` names what is outstanding, in the order the form is filled in:
  "Enter both your first and last name.", "That does not look like a valid
  email address.", "Your password still needs: one number, one uppercase, one
  symbol."

## 2. Magic link on /login claimed to send mail it never sent

`shouldCreateUser: false` is correct there — signing in must not create an
account from a typo — but it means an address with no account gets **no email
at all**, while Supabase still returns success, because it will not confirm
whether an account exists. The screen said "Magic link sent — check your
inbox." That is simply false, and it is the most confusing thing it could say:
you wait for a mail that was never going to arrive.

Reworded to keep the anti-enumeration property and still point a new user at
signup.

## 3. Errors rendered as the literal string "{}"

supabase-js wraps any HTTP 5xx in `AuthRetryableFetchError` whose `.message` is
`"{}"` — the JSON body is discarded, so "Error sending confirmation email"
never reaches the app. The object still passes `instanceof Error`, so
`err instanceof Error ? err.message : …` faithfully printed `{}` on screen.

`lib/authErrors.ts` uses the message when it says something and otherwise
translates the status. Applied to Login, Signup and ResetPassword.

## What was NOT wrong

SMTP is healthy — verified directly against premium17: TLS good, `235
Authentication succeeded`, and `RCPT TO` accepted for a real domain. The 500
seen while testing came from the deliberately unroutable `@example.invalid`
address, which Exim rejects with 550. Worth recording so nobody re-diagnoses
the mail server. Note `smtp_max_frequency` is 60s per address, so rapid repeat
attempts are dropped upstream — that now surfaces as the 429 message.

Verified by driving the real form in Chrome: every hint appears at the right
moment, the button enables exactly when the form is complete, and a failing
submit now shows a sentence rather than "{}". No test users were left behind —
GoTrue rolls back when the confirmation email fails.

typecheck, eslint --max-warnings 0, 345 tests, prettier --check all pass.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `0330847` 2026-08-04 — Gideon Akinlotan

Port slice 1: one brand mark, Platform Health, and temporary support access (#89)

* Retire the raster logo: one vector mark on every surface, icons regenerated

Six surfaces — the app sidebar and header, the marketing nav and footer, and
the invitation screen — rendered `src/assets/logo.png`. `BrandMark`'s own
docstring already recorded why that file is wrong: it is a glow-on-dark-blue
export that cannot sit on a light canvas. Splash, app boot, auth and onboarding
had moved to the vector; the other six had not, so the product shipped two
different marks depending on which screen you were looking at.

Everything now uses `BrandMark`, and the raster is deleted rather than left
lying around for the next person to import.

Also:

- The platform console had no mark at all, just a shield glyph and the word
  RotaFlow. It gets the real mark, and the shield moves down to the
  danger-tinted "Platform administration" eyebrow — so the deliberate "never
  mistaken for a tenant's own screen" signal in AdminShell's docstring is kept,
  it just stops standing in for the logo.

- `public/favicon.svg` was a base64 PNG wrapped in an `<svg>` element. It is now
  actual vector geometry, 654 bytes against 3,904.

- The three PWA icons are regenerated from that same geometry. DESIGN.md §7 has
  asked for this since the design system landed ("current shipped PWA
  icons/favicon predate this design system"). The maskable variant insets the
  mark to 66% so Android's circular crop does not clip the R's leg.

DESIGN.md now names BrandMark as the single implementation and records why a
raster must not come back. public/icons/README.md documents regeneration.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* Add Platform Health: real probes, and an honest list of what a browser cannot see

NEW_STRUCTURE §34 lists a platform health screen and the console did not have
one. The obvious way to build it is a wall of figures — uptime, error rate,
queue depth, p95 — and every one of those would have been invented, because
RotaFlow ships as a static bundle with no server of ours to ask. That is the
exact failure mode AdminFeatureFlagsPage already refuses for feature flags.

So this measures what a browser genuinely can measure, and says so:

- Database: a `head: true` count against organisations. No rows come back, so
  it times the round trip rather than a payload, and it goes through RLS — it
  proves the path a real request takes, not a privileged shortcut.
- Authentication: a session lookup, reporting when the current session expires.
- Realtime: subscribes to a throwaway channel and times the handshake, then
  removes the channel.

The three run concurrently; a slow connection should not make the page look
broken. Each has an 8-second timeout, and a probe that does not settle is
reported as down rather than left spinning.

Integrations (ImageKit, Sentry, Inngest, push, SSO) are shown separately and
flagged `configuredOnly`, because a key being present proves this deployment
will *try* to use the service, not that the far end is up. Conflating the two
is how a health page starts lying.

A closing card lists what is deliberately absent — platform-wide error rates,
queue depth, storage totals, per-region latency, historical uptime — and what
it would take to get them. Latencies are labelled as measured from the viewer's
own device, so nobody reads 120ms as a global figure.

Pure logic (thresholds, status ranking, formatting) sits in `lib/platformHealth`
with 16 unit tests, away from `services/` — anything importing `lib/supabase`
pulls in a WebSocket that Node does not have, which is why the probes and the
judging are separate modules.

navigationTargets grew from 119 assertions to 120: the new ADMIN_NAV entry is
checked against the route table parsed out of App.tsx, so it cannot ship
pointing at a 404.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* Support access: time-boxed sessions, and a banner that tells the customer

0017 added `organisations.support_access_allowed` and said of it: "Read by the
console today and enforced by nothing … 0019's session table is where it
becomes a precondition." This is 0019, and the flag stops being advisory —
`request_support_access` refuses outright when a customer has turned it off,
in the database, where a console screen cannot route around it.

## A table of rows, not a boolean

"Which platform staff can see this tenant" is not a state, it is a series of
events with reasons attached. A boolean answers "can Erin see Sunnyvale right
now"; it cannot answer "who looked at Sunnyvale in March, why, under which
ticket, for how long" — which is the question a customer's DPO asks, and the
one an ICO enquiry asks after that.

Both mutations go through SECURITY DEFINER functions and there is no insert or
update policy on the table at all, so the 15-character reason minimum, the case
reference, the 15-minute-to-24-hour bounds and the customer's opt-out cannot be
bypassed by writing to it directly. Status is a function of three columns
rather than a stored value: a stored 'active' would be wrong the moment the
clock passed the expiry and would need a cron job to stay true.

## What it does not do, stated on the screen

It does not grant anything. Platform staff already hold cross-tenant read
through `has_platform_role` (0015), and making that read conditional on an open
session touches every policy in that migration and needs an RLS test suite that
does not exist. Doing half of it would produce the worst outcome: a table that
looks like an access control and is not one.

So this is an accountability record, and the page says exactly that — because
"we have support access sessions" is a sentence someone will repeat to a
customer, and it needs to survive being repeated accurately.

## The half that matters

`SupportAccessBanner` renders inside the tenant's own app, above the scroll
container so it cannot be scrolled away, naming the administrator, the reason,
the case reference and the countdown. An owner gets a button that ends it —
`revoke_support_access` admits the tenant's own owner precisely so that button
can exist. A support-access system whose only surface is our own console is a
log we keep about ourselves.

It renders nothing when nobody is looking, and the query uses 0019's partial
index so the common case costs one cheap request.

Pure logic in `lib/supportAccess` with 19 unit tests, including that revoked
outranks expired when both are true, and that the countdown rounds *down* so
remaining access is never overstated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* Stop sending platform administrators into onboarding

A platform administrator with no organisation membership signed in and landed
on "tell us about your organisation". AppShell gates /app/* on membership and
sent everyone with none to /onboarding, on the reasonable assumption that a
signed-in user with no org is a new customer. A platform account is the
counter-example, and it is not a rare one: support and finance roles have no
business holding a membership anywhere.

The consequence was worse than the confusion. The only way out of onboarding is
to create an organisation, so the path of least resistance for a platform
administrator trying to reach the console was to mint a junk tenant — in
production, in the same table real customers live in, where it would then show
up in the console's own organisation count.

Member-less platform administrators now go to /admin, which is where they were
trying to get. Everyone else still goes to onboarding.

This changes the default, not the ability: a platform administrator who
genuinely wants to create an organisation can still navigate to /onboarding.

The route itself was never the problem — /admin sits under RequirePlatformAdmin
rather than AppShell, so typing the URL always worked. What was broken was
being dropped somewhere else first and having to know that.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* GDPR: a data subject request register built around the statutory clock

0011 already lets an organisation owner export and anonymise one staff member
from the staff screen. That is the action, and it lives where it is used. This
is the obligation, which is a different problem: Article 12(3) gives one month
from receipt, extendable by two, and the breach is the lateness itself
regardless of how good the eventual answer was.

So the screen is a deadline board, not a data browser. Overdue first, then due
within seven days, and the tiles count what is actually at risk rather than
what merely exists. It is a register you can be asked to produce, which is the
only version of this screen worth building.

## One month is not thirty days

A request received on 31 January is due 28 February. `+ 30 * 86_400_000` gives
2 March — two days of breach nobody notices until someone complains. Both sides
do calendar arithmetic, and I checked they agree rather than assuming:

  postgres  date '2026-01-31' + interval '1 month'  ->  2026-02-28
  lib       addMonths('2026-01-31', 1)              ->  2026-02-28
  postgres  date '2028-01-31' + interval '1 month'  ->  2028-02-29
  lib       addMonths('2028-01-31', 1)              ->  2028-02-29

That matters because the modal previews the deadline before the row exists, so
a client that rounded differently from the database would show one date and
store another.

Dates stay `YYYY-MM-DD` strings end to end and are compared as UTC midnights,
so a machine in UTC and one in Europe/London agree about which day it is — this
suite deliberately runs in both. `todayIso` formats local components rather
than going through `toISOString`, which would report tomorrow after 23:00 for
anyone east of UTC and silently eat a day of deadline.

## What the database refuses to let the screen skip

- `due_on` is computed on insert, never supplied by a caller.
- Closing a request without an outcome note raises. An outcome-less 'completed'
  is exactly the row that cannot be defended a year later, so there is both a
  CHECK and an explicit error with a sentence in it.
- An extension needs a reason of at least fifteen characters and can be taken
  once. An extension nobody justified is indistinguishable from a missed
  deadline.
- No insert, update or delete policy on the table at all — every mutation goes
  through a SECURITY DEFINER function, so none of the above can be bypassed.

An organisation's own owner can read requests recorded against them: they are
the controller for their own staff, and a register they cannot see does not
help them meet their own obligation.

The page states plainly what it does not do. It does not perform the work —
export and erasure stay with the owner on the staff record, where the data is
and where the right permissions apply — and it does not send the subject the
extension notice that Article 12(3) requires, because that is an email a person
still has to write.

Migration 0020 applied and verified: table, 3 functions, RLS on, 6 CHECK
constraints, 1 policy. 26 unit tests on the clock.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `aebac6a` 2026-08-05 — Gideon Akinlotan

Rebuild the platform console to the reference, and give it real tables (#93)

* delete: remove Audit 01 report as it has been replaced by Audit 02 with updated findings and fixes

* Add platform_seed.sql for seeding initial data across multiple tables

This commit introduces a new SQL script, platform_seed.sql, designed to populate the console's database with realistic data for various entities such as incidents, support cases, invoices, and platform announcements. The script ensures idempotency, allowing it to be run multiple times without adverse effects, and is structured to run after demo_seed.sql to maintain data integrity. It includes detailed comments explaining the purpose and functionality of each section, making it easier for future developers to understand and modify as needed.

* fix(docs): guard the artifacts' hash router against prototype-chain dispatch

CodeQL flagged `SCREENS[id]` in both standalone artifacts as
js/unvalidated-dynamic-method-call, high severity, and it is right: `id`
comes straight from `location.hash`, and a bare index lookup resolves
`constructor`, `toString` and friends up the prototype chain to functions
the next line then invokes.

`Object.hasOwn` before the lookup, so an id that is not a screen lands on
the "not built yet" panel rather than calling something. Verified in
headless Chrome: `#/constructor` renders the panel, `#/overview` still
renders the overview.

These are design references rather than shipped code — `docs/` is not in
`dist/` — but a prototype anyone might open in a browser is still a page
that should not dispatch on an attacker-supplied name.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `7f1acac` 2026-08-05 — Gideon Akinlotan

fix(seed): make platform_seed.sql survive a real runner (#94)

Three defects, all found by running it against the live database rather
than by reading it.

**Session-local state.** The file built its ids with a `pg_temp` function
and held its scratch tables `on commit drop`. Both assume one session and
one transaction for the whole file; `supabase db push --include-seed`
executes statement by statement, so the function vanished and the scratch
tables were dropped after the first insert. The id helper is now an inline
`md5(...)::uuid` expression and the scratch tables are dropped explicitly
at the end.

**Scratch tables on a pooled connection.** A pooler can hand back a session
that still holds `pf_org` from an earlier run, and `create temp table` on a
name that exists is a hard error rather than a no-op. Each one is now
dropped before it is created.

**A reset that matched nothing.** Invoice and integration ids are derived
from a *pair* of keys — `invoice:<org>:<month>` — while the reset deleted
`invoice:<i>`. It removed no rows, so the second run collided on the
primary key. The reset now walks the same pairs, and both inserts carry
`on conflict (id) do nothing`.

Also: the support case insert joined memberships to find each tenant's
owner, which emits two rows for an organisation with two active owners —
both carrying the same derived id, a primary key collision inside one
INSERT. Scalar subqueries with `limit 1` instead.

Verified against the live project: the seed now completes, and a probe
that raises on any empty table passes for all fifteen.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `f22b708` 2026-08-06 — Gideon Akinlotan

fix(console): three screens that contradicted the database (#95)

**System status claimed incidents are not recorded.** They have been since
0021 shipped, and Incidents sits directly above the panel saying otherwise.
The panel now points at the register and confines itself to what is still
absent: the public status page, which `is_public` describes and no policy
grants.

**Audit's Before and After were always an em dash.** 0027 added the columns
and taught `audit_write` to lift a scalar into them, but the page was still
reading the two keys out of `metadata`. It now reads the columns and falls
back to metadata for events recorded before they existed — otherwise the
whole history before 05 August looks like a gap in the record rather than a
column that arrived late. Still scalars only, in both paths.

**Billing, Subscriptions and Overview printed invented money beside real
tenants.** Live, that read as MRR £184,260 and invoices for an organisation
that does not exist, against eight real customers whose actual recurring
revenue is £856. All three now compute from `invoices` and
`subscriptions × plans` through `lib/revenue.ts` — the same functions on
every screen, so they cannot disagree about a month, and integer pence
divided by 100 exactly once in `lib/money.ts`.

Two Overview tiles went the other way: "active users today" and the
organisation-health split were 12,489 and 1,284 next to real counts of four
and eight. Per-*user* activity still is not recorded anywhere, so that tile
now counts tenants — a different and true thing — from
`organisations.last_activity_at` (0023). Health is derived from account
status, subscription state and last activity, with suspended ranked first and
never-active counted as at risk rather than fine.

New: `lib/tenantHealth.ts`, 14 tests. The placeholder list on Overview is
down to churn and the system-health history strips, both of which genuinely
have nothing behind them.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `37d264e` 2026-08-06 — Gideon Akinlotan

fix(overview): the activity feed reads the audit log it links to (#97)

`recentAudit` was fetched on every load and never used, while the Platform
activity panel rendered five invented rows — under a heading that links to
the audit log and beside a note claiming the audit feed is real.

It now renders the rows it fetched: the action, the organisation, before →
after from 0027's columns, who did it and when. The icon comes from the
action's namespace by prefix rather than an exhaustive map, so an action
added by a future writer still renders with the generic mark instead of
crashing on a missing key, and the tone comes from the row's own severity.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `c97cf5f` 2026-08-06 — Gideon Akinlotan

chore: remove every em and en dash, and edit the copy they were hiding (#98)

The em dash is the most reliable tell that a machine wrote something, and
this codebase had 1,595 of them across 401 files: in rendered copy, in the
comments, in table cells where a lone dash meant "no value", and in time
ranges like 07:00 - 15:00.

They are gone. Each one was replaced by what it was standing in for. A
period where two sentences had been welded together, a comma for a genuine
aside, a hyphen in a range or a placeholder cell. Where the replacement
left a comma splice the sentence was rewritten rather than repunctuated,
which is most of the hand editing in this diff.

Four pieces of copy were rewritten for the patterns that travel with the
dash:

  "Faster, offline-ready, no store."  ->  "Loads faster and works offline.
  It installs from the browser." A three-item list ending in a negation
  fragment is a shape people do not write.

  "Let's set up your ..." and "Here's what you can do next." on onboarding.
  Announcing what you are about to do instead of doing it.

  "No app store, no separate build, no waiting for a review" on Features,
  and the platform-support role blurb, both built from stacked negations.

Migrations are deliberately untouched. 0021 to 0027 have already run
against production, and rewriting their comments would make the repository
describe something other than what executed. The seeds and Edge Functions
are re-runnable and were edited.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `81eb6f7` 2026-08-06 — Gideon Akinlotan

feat: close the six things that were holding go-live (#101)

Seven migrations and the application changes to match. Each one was a control
that appeared to exist and did not.

**A support session is now the gate, not a note about one.** Since 0002,
`is_org_member()` ended in `or is_platform_admin()`, so any platform
administrator could read every tenant's rotas, staff records, clock events and
leave, at any time, with no grant and no expiry. 0019 recorded the intent to
look and no policy ever consulted it. 0028 redefines the two functions every
tenant policy is built on, so access now requires a session that is theirs,
unrevoked and unexpired, and writes additionally require scope read_write.
Verified against production: with no session every tenant table returns zero,
with one the granted organisation opens and every other stays shut.

0031 draws the line back where it belongs. Organisations, subscriptions and
memberships are the customer register and stay readable, because a support
session for every glance at a customer list is a ritual rather than a control.
Counts move to `platform_tenant_counts()` and `platform_totals()`, which return
numbers rather than rows: how large a tenant is, without who is in it.

**Granting a session had never worked.** 0016 constrained
`audit_logs.visibility` to two values while eight callers passed a third, so
`request_support_access` raised 23514 and rolled back inside its own audit
write. It surfaced the moment 0028 made a session matter and the first real
grant was attempted. 0032 widens the constraint, because the callers were
right.

**Retention is enforced.** 0029 adds `enforce_retention()`, a pg_cron schedule
at 02:15, and a run log. Five policy rows now say enforced because they are.
The audit log is unreachable from the function by construction: its retention
is null and the loop skips null.

**Feature flags gate something.** `flag_enabled_for_org()` was never called, so
turning off GPS clock-in turned off nothing. 0030 keeps the two that are really
flags, retires the four that were never flags, and moves entitlements to
`plans.features` beside the price that buys them. `useFeatureAccess` asks once
per organisation load and fails closed.

**Two orphan schemas removed.** Production held `incident_events`,
`platform_incidents` and three functions that no migration declared, found by
diffing generated types against the migrations. Both tables were empty and
unreferenced. That diff is now the check that the repository still describes
production.

Also: `last_activity_at` gets a writer, health samples are recorded from real
probes instead of read from seeded rows, the database types are generated
rather than hand maintained (which surfaced 31 real nullability bugs), a
support case can be handed back to the queue, and `platform_teardown.sql` can
remove the demo data now sitting on live organisations.

Return to Organisation is gone from the console rail, as asked.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `e2a7285` 2026-08-06 — Gideon Akinlotan

System status: the jobs panel reads the queue the tile counts (#102)

* feat: close the six things that were holding go-live

Seven migrations and the application changes to match. Each one was a control
that appeared to exist and did not.

**A support session is now the gate, not a note about one.** Since 0002,
`is_org_member()` ended in `or is_platform_admin()`, so any platform
administrator could read every tenant's rotas, staff records, clock events and
leave, at any time, with no grant and no expiry. 0019 recorded the intent to
look and no policy ever consulted it. 0028 redefines the two functions every
tenant policy is built on, so access now requires a session that is theirs,
unrevoked and unexpired, and writes additionally require scope read_write.
Verified against production: with no session every tenant table returns zero,
with one the granted organisation opens and every other stays shut.

0031 draws the line back where it belongs. Organisations, subscriptions and
memberships are the customer register and stay readable, because a support
session for every glance at a customer list is a ritual rather than a control.
Counts move to `platform_tenant_counts()` and `platform_totals()`, which return
numbers rather than rows: how large a tenant is, without who is in it.

**Granting a session had never worked.** 0016 constrained
`audit_logs.visibility` to two values while eight callers passed a third, so
`request_support_access` raised 23514 and rolled back inside its own audit
write. It surfaced the moment 0028 made a session matter and the first real
grant was attempted. 0032 widens the constraint, because the callers were
right.

**Retention is enforced.** 0029 adds `enforce_retention()`, a pg_cron schedule
at 02:15, and a run log. Five policy rows now say enforced because they are.
The audit log is unreachable from the function by construction: its retention
is null and the loop skips null.

**Feature flags gate something.** `flag_enabled_for_org()` was never called, so
turning off GPS clock-in turned off nothing. 0030 keeps the two that are really
flags, retires the four that were never flags, and moves entitlements to
`plans.features` beside the price that buys them. `useFeatureAccess` asks once
per organisation load and fails closed.

**Two orphan schemas removed.** Production held `incident_events`,
`platform_incidents` and three functions that no migration declared, found by
diffing generated types against the migrations. Both tables were empty and
unreferenced. That diff is now the check that the repository still describes
production.

Also: `last_activity_at` gets a writer, health samples are recorded from real
probes instead of read from seeded rows, the database types are generated
rather than hand maintained (which surfaced 31 real nullability bugs), a
support case can be handed back to the queue, and `platform_teardown.sql` can
remove the demo data now sitting on live organisations.

Return to Organisation is gone from the console rail, as asked.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(health): the jobs panel reads the same queue the tile counts

The tile said 14 queued from background_jobs while the panel underneath
listed 412, 184 and 688 from the demo module, on the same screen. Both now
read the queue, and a queue with failures says so beside its depth.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `051d63e` 2026-08-06 — Gideon Akinlotan

feat: the four open items, in the order they mattered (#103)

**A demo tenant says so in the database.** 0035 adds `organisations.is_demo`,
backfills the eight organisations that exist today (every account in this
deployment is the owner's own, including the `+demo` aliases), and
`platform_seed.sql` now writes only where that flag is set. A real signup
lands with the default of false and cannot be seeded by accident. The console
badges those tenants in the list and on the detail header. This replaces a
thing somebody has to remember with a thing the database knows, which is why
it came before running the teardown.

**Three pages moved onto their tables.** Users reads the account totals from
`platform_auth_facts_summary`, and no longer invents a per-row MFA and
last-login column: reading those per account is one round trip each, so they
are totals here and per-account facts on the account's own screen.
Integrations reads `integration_connector_stats`, which aggregates 812 sync
runs in Postgres rather than in a browser. Notifications reads
`platform_announcements` and counts recipients from delivery rows.

**Five Settings tabs are gone.** Branding, Security, Email, Storage and API
each rendered controls for settings this deployment does not store and could
not enforce: a colour Tailwind compiles into the bundle, an MFA requirement
Supabase Auth owns, upload limits for a file store that is not wired up. A
switch that persists a value nothing reads is worse than an absent tab,
because somebody eventually believes it. The 0027 columns stay, so the tabs
return when something enforces them. Data Retention now reads the table and
shows which rows the nightly job actually enforces.

**Two metrics deleted rather than faked.** CSAT is gone from the Support
Centre and the read rate from Notifications. `rate_support_case` and
`mark_announcement_read` exist and nothing calls them, so both figures could
only ever repeat the seed. A satisfaction score nobody can submit is a
dashboard lying about your own support quality. Resolved-in-30-days replaces
CSAT, and it is real.

**Leaving the console lives on the user chip.** Return to organisation was
never a sixteenth platform screen; a list is the wrong shape for it. The chip
that already says who you are is now a menu with Return to organisation,
Account settings and Sign out.

Also, from a question asked while this was in flight: changing your password
now genuinely ends every other session. The panel has always promised that and
never done it, because whether a password change revokes other refresh tokens
is a GoTrue server setting. It calls `signOut({ scope: 'others' })`
explicitly, reports a failure rather than swallowing it, and Settings links to
it, because someone worried about a compromise looks in Settings first.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `baf8485` 2026-08-06 — Gideon Akinlotan

Organisations: Trial and At risk read the columns they describe (#104)

* feat: the four open items, in the order they mattered

**A demo tenant says so in the database.** 0035 adds `organisations.is_demo`,
backfills the eight organisations that exist today (every account in this
deployment is the owner's own, including the `+demo` aliases), and
`platform_seed.sql` now writes only where that flag is set. A real signup
lands with the default of false and cannot be seeded by accident. The console
badges those tenants in the list and on the detail header. This replaces a
thing somebody has to remember with a thing the database knows, which is why
it came before running the teardown.

**Three pages moved onto their tables.** Users reads the account totals from
`platform_auth_facts_summary`, and no longer invents a per-row MFA and
last-login column: reading those per account is one round trip each, so they
are totals here and per-account facts on the account's own screen.
Integrations reads `integration_connector_stats`, which aggregates 812 sync
runs in Postgres rather than in a browser. Notifications reads
`platform_announcements` and counts recipients from delivery rows.

**Five Settings tabs are gone.** Branding, Security, Email, Storage and API
each rendered controls for settings this deployment does not store and could
not enforce: a colour Tailwind compiles into the bundle, an MFA requirement
Supabase Auth owns, upload limits for a file store that is not wired up. A
switch that persists a value nothing reads is worse than an absent tab,
because somebody eventually believes it. The 0027 columns stay, so the tabs
return when something enforces them. Data Retention now reads the table and
shows which rows the nightly job actually enforces.

**Two metrics deleted rather than faked.** CSAT is gone from the Support
Centre and the read rate from Notifications. `rate_support_case` and
`mark_announcement_read` exist and nothing calls them, so both figures could
only ever repeat the seed. A satisfaction score nobody can submit is a
dashboard lying about your own support quality. Resolved-in-30-days replaces
CSAT, and it is real.

**Leaving the console lives on the user chip.** Return to organisation was
never a sixteenth platform screen; a list is the wrong shape for it. The chip
that already says who you are is now a menu with Return to organisation,
Account settings and Sign out.

Also, from a question asked while this was in flight: changing your password
now genuinely ends every other session. The panel has always promised that and
never done it, because whether a password change revokes other refresh tokens
is a GoTrue server setting. It calls `signOut({ scope: 'others' })`
explicitly, reports a failure rather than swallowing it, and Settings links to
it, because someone worried about a compromise looks in Settings first.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

* fix(organisations): Trial and At risk read the columns they describe

The list said 'Trial 86' and 'At risk 82' beside 'Total 8'. Both now come
from subscriptions.status and organisations.last_activity_at, through the
same healthBreakdown the Overview uses, so the two screens cannot disagree
about which tenants are in trouble.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
---
## `5b69bba` 2026-08-06 — Gideon Akinlotan

Ask for the current password before changing it (#105)

Supabase changes a password for anyone holding a live session. That is the
wrong default for the screen whose whole purpose is recovering from a
compromise. Someone at an unlocked laptop, or holding a stolen token, does not
usually know the password, and until now that was no obstacle: they could set a
new one and lock the owner out.

Worse, the "end every other session" step added alongside this panel turned
that into the attacker's tool. It revokes every session except the one doing
the changing, so the person who should have been protected is the one thrown
out.

So the change is verified first. `signInWithPassword` against the same account
is the check: it fails without side effects when the password is wrong, and
when it succeeds it issues a fresh session for this device, which costs
nothing. Only then does the update run.

Accounts that sign in through a provider have no password to confirm, so the
section says so and names the provider rather than presenting a form that
cannot work. `identities` carries one entry per provider, and the default when
it is absent is to show the form, since an account with no identity list is far
more likely to be an email one than an OAuth one.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
---
## `2aff369` 2026-08-06 — Gideon Akinlotan

Stop a cold load of any /app URL landing on onboarding (#106)

OrgProvider is mounted above ProtectedRoute, so it mounts and runs once while
auth is still restoring. That pass takes the "no user" branch and settles on
"no memberships, not a platform admin, finished loading" — a correct
description of nobody. When auth resolves, ProtectedRoute renders the tenant
shell in the same pass, and AppShell reads that settled state before the
provider's effect has re-run for the user who just arrived.

What AppShell saw was a finished load and an empty membership list, which is
indistinguishable from a brand-new signup, so it redirected to onboarding with
`replace`. Every cold load of an `/app/*` URL ended there: a pasted link, a
page refresh, reopening the installed app. An owner of several organisations
was invited to create their first one, in the same table real tenants live in,
and because the redirect replaced the history entry the back button could not
undo it. The comment above that redirect already warned about exactly this
outcome for platform administrators; the guard it relies on was reading stale
state, so a platform owner went to onboarding rather than /admin.

`loading` could not answer the question being asked of it. "Has a query
finished" is not "does this state describe the user who is signed in now", and
only the second one makes an empty membership list meaningful. So the provider
now tracks the id its state was loaded for, and reports loading until the two
agree.

The rule lives in src/lib/orgLoading.ts because the suite is a Node-environment
unit suite over src/lib, with no DOM renderer to mount a provider in. Keeping
it there is what makes the regression testable, including the window this
commit closes and the mirror-image case of signing in as somebody else while
the previous user's memberships are still loaded.

The id is recorded in `finally` rather than after a successful load, so a
failed query still resolves. Otherwise a dropped connection would hold the app
on the boot screen for ever and hide the "Couldn't load your organisations"
card that exists to recover from it.

Verified over CDP against a platform owner with no membership: /app/account/security
resolved to /onboarding before, and to /admin after.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
---
## `5da824a` 2026-08-06 — devgeereact

Remove a console menu link that 404s, and level the overview row

Two things on the platform console.

The user menu offered "Account settings" pointing at /app/settings/account,
which has never been a route. Account settings are /app/account/*; Settings is
organisation administration and has no `account` child, so every click on it
reached the 404 page. The item is removed, as asked.

navigationTargets exists to catch exactly this. It parses the route table out
of App.tsx and checks every nav catalogue against it, and it stayed green
because the link was written inline in AdminShell rather than in a catalogue
this suite can see. The menu's remaining target is now CONSOLE_MENU_TARGET in
adminNav.ts and is checked like the rest, so the next inline link is the one
that has to justify itself.

The three-card row underneath was set by whichever card had the longest list.
The audit feed asked for eight entries, its rows run to two lines each, and at
529px it forced a 584px row: System health drew six services in 265px and left
202 empty below them, Support drew its tiles and cases in 313 and left 154.
Both short cards looked broken and neither contained the cause.

Four entries sits the feed between the other two. Measured over CDP, the card
bodies are now 265, 296 and 313 in a 368px row, where they were 265, 529 and
313 in a 584px one. Losing the tail of the log costs nothing on a panel that
carries an "Audit log" link in its corner.

---
## `9c929b6` 2026-08-06 — devgeereact

Rebuild the organisation workspace shell to match docs/ORGANISATION_WORKSPACE.html

Un-merges the sidebar back to a flat 13-item nav (Rota Builder and Schedule,
Team and Availability are separate rows again), moves search into the rail as
a kbar-style row, adds live Leave/Shift Swaps pending badges, adds
breadcrumbs to the topbar, and consolidates account actions (Settings/My
Profile, Help & Support, sign out) into the rail's footer group in place of
the header's separate search bar and avatar dropdown.

Adds AppShellPreviewPage (DEV only) so the shell can be screenshotted against
the reference without a seeded login, reusing the per-screen preview pages
that already existed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `5b0d908` 2026-08-06 — devgeereact

Rebuild the Dashboard to match docs/ORGANISATION_WORKSPACE.html, role-split

Splits the single dashboard into ManagerDashboard (cover-against-minimum
chart, rota draft/published status, needs-you feed, hours by department) and
StaffDashboard (their own hours, next shifts, leave remaining), matching the
artifact's two branches. The dashboard previously showed every role the same
manager-oriented view, including Quick Actions a staff member cannot use.

Adds the real data behind it rather than approximating: a minimum-staff-on-
shift org policy (organisations.settings, alongside the existing scheduling
policies), and loadWeeklyRosterSummary/loadMyWeekSummary/loadMyUpcomingShifts
in dashboardService.ts, built from shifts already in the schema plus the
existing rotaInsights.shiftNetMinutes helper.

Drops the day-stepper Today's Schedule and Monthly Overview cards along with
the org-wide (not per-person) Upcoming Shifts card the old dashboard showed
to every role: none has an equivalent in the reference, and the day-level
schedule they duplicated already lives at /app/schedule and /app/rota.

Retires dashboard/StatCard in favour of the shared ui/StatTile primitive,
matching every other summary-tile screen in the app.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `fdf71a0` 2026-08-07 — devgeereact

Rota Builder: surface publish status as a callout, matching the artifact

Rota Builder stays the real drag-and-drop grid with its AI assistant,
inspector panel and shift-type manager, per the scope decision to restyle
rather than replace it with docs/ORGANISATION_WORKSPACE.html's simpler
click-a-cell mock. The one concrete gap was visual: a critical-issues publish
failure only ever showed as a bare line of red text, and there was no
persistent draft/published state indicator at all, both real callouts in the
reference.

Both now use the existing ui/Callout primitive (danger/info/success), reusing
data already computed (criticalWarnings, allPublished, rotasInScope) rather
than adding new logic. Also swaps ManagerDashboard's hand-rolled conflict
banner onto the same primitive for consistency.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `96e7219` 2026-08-07 — devgeereact

Clock In: use the primary-wash token for the policy banner

bg-primary/5 (dark: /10) instead of bg-primary-wash. docs/DESIGN.md is
explicit that washes are opaque, sampled colours, not an alpha of the solid,
specifically to avoid drift: the same primary/N reads as a different colour
over surface than over background. One-line fix; Schedule and Clock In were
otherwise already reviewed against the reference and found already aligned.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `cd76c16` 2026-08-07 — devgeereact

Leave, Overtime: small artifact-driven fixes; Timesheets/Availability/Swaps audited clean

Leave: adds the balance-scope note the reference shows ("balances show annual
leave only"), as a caption on LeaveBalancesCard rather than a new page-level
banner, next to the figure it explains. The constraint itself already existed
and was already reasoned through in LeavePage's doc comment. Real schema
limitation, not new copy, it was just never surfaced to the person reading
the number.

Overtime: replaces a local, undocumented MetricCard duplicate with the shared
ui/StatTile primitive, the same consolidation already applied to Dashboard.

Timesheets, Availability and Shift Swaps were read against the reference and
left unchanged: each already covers the artifact's content (and Swaps'
"How shift swaps work" modal is more honest than the mock's claim that
rest/cover checks are automatic, they are not, yet). Team's "inviting lives in
Settings" note was deliberately not ported, /app/team can already create a
staff profile directly, so porting it would have been inaccurate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `e9d45a1` 2026-08-07 — devgeereact

Team, Locations: selected-row uses primary-wash, not a raw alpha

bg-primary/[0.04] (dark: bg-primary/10) on the selected row in the staff
table, the locations table and the departments table. docs/DESIGN.md names
"hovered/selected rows and nav items" directly as a primary-wash case, for
the same reason as the status washes: an alpha of the solid reads as a
different colour over surface than over background, so a selected row in a
white card and one in a scrolled table looked like two different states.

Announcements and Reports read against the reference and left unchanged;
already cover its content.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `374957b` 2026-08-07 — devgeereact

Manager Dashboard: match the artifact exactly, not just structurally

Two remaining deltas against docs/ORGANISATION_WORKSPACE.html's manager
dashboard:

- "Rostered this week" had no sparkline. Adds loadRosteredHoursTrend, one
  query across the last 7 weeks (draft-inclusive, same as
  loadWeeklyRosterSummary) bucketed client-side, rendered with the existing
  ui/TrendChart Sparkline.
- The manager view had an Announcements card the reference doesn't show for
  managers (only the staff branch has one). Removed; announcements stay
  reachable from the sidebar and the staff dashboard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `5b9d673` 2026-08-07 — devgeereact

Add DashboardLivePreviewPage: real DashboardPage against fetch-intercepted fixtures

DashboardPreviewPage renders ManagerDashboard/StaffDashboard directly, never
exercising DashboardPage.tsx's own hooks, Promise.all fan-out, or real
service calls. A crash in that wiring is invisible to it. Adds a second,
AdminPreviewHarness-style harness at /dashboard-live-preview that mounts the
real DashboardPage with OrgContext + AuthContext stubbed and fetch
intercepted, against fixtures chosen to include the edge cases hand-built
fixtures usually sand away: organisations.settings null, a staff row with
holiday_allowance null, a leave request referencing a staff_profile_id no
longer in the roster, a shift with a null department_id, a mixed
draft/published week. ?role=owner|manager|staff switches the stubbed role.

Also leaves a temporary, readable console.error in DashboardPage's catch
block (in addition to the existing reportError call) while a live-data
Dashboard crash is under investigation; remove once confirmed fixed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `372322a` 2026-08-08 — devgeereact

Give sites a staffing minimum, and bring the dashboard and nav to the artifact

The rota builder could flag a rest breach or a leave clash, but had nowhere
to record what a manager actually needs for cover, and the dashboard had no
way to show a shortfall. `minimum_cover_rules` adds that: one row per site
per weekday, edited from a site's own Settings tab in Locations, read by
`rotaInsights.ts` alongside shifts to compute the gap. A day with no rule set
is not flagged, silence means no policy, not a minimum of zero, and nothing
here blocks a rota from saving beyond the same critical-warning gate every
other insight already goes through.

The manager dashboard reads the same rules for a new "Cover Against Minimum"
chart and a "Hours by Department" breakdown. The first pass reused
`upcomingShifts`, a window that starts tomorrow by design (Today's Schedule
covers today separately), so both charts always read today as fully
unstaffed regardless of the real rota. Fixed with a second query that starts
at today.

Second pass: side-by-side against docs/ORGANISATION_WORKSPACE.html turned up
three real gaps rather than cosmetic ones. The sidebar had nowhere to surface
a pending count, so Leave and Swaps now carry one, polled the same way
`NotificationBell` already polls unread notifications rather than opening a
second Realtime channel on tables `LeavePage`/`SwapsPage` already subscribe
to (same channel name, same org, same tables, would throw on double-subscribe).
The cover chart was two grouped bars asking the reader to compare heights;
it is now one bar per day, coloured by whether it cleared the line, with the
minimum itself drawn as a dashed threshold, a clearer signal for a yes/no
question. And the dashboard had no way to act on what it showed, so a
manager's pagehead now carries "Post announcement" and "Open rota builder"
directly.

The dashboard is also split by role for the first time: staff got the
manager's operational view wholesale, including the "approve requests" tone
of Pending Requests. They now see their own next shifts and hours instead.

Seeded for the five demo organisations from each site's own already-seeded
weekly headcount, one below its typical staffing, so most days read as
healthy and the planted shortfalls in demo_seed.sql show up on the new chart
as real gaps rather than synthetic ones.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `3d999ee` 2026-08-08 — devgeereact

Rota builder: a real staffing minimum in Coverage, and a status banner up top

Same pass as the dashboard, checked against docs/ORGANISATION_WORKSPACE.html.

The Coverage tab already told you whether every shift that exists is filled,
"Optimal" if nothing is still open. It could not tell you whether enough
shifts exist in the first place, there was no schema-backed target headcount
to compare against when that tab was built. There is now
(0036_minimum_cover_rules.sql), so `computeDailyTotals` takes the rules and
the locations in scope and sums each day's real minimum alongside the
existing fill-rate numbers, both shown, on purpose kept as separate lines: a
day can have every created shift filled and still be short of the minimum, if
too few shifts were ever raised for it.

The published/draft state was only visible as a button label, "Unpublish" if
you already know that means published. It's now a callout above the grid,
reusing the existing `Callout` component rather than another one-off toned
box, and for a draft it says the thing the button label can't: how many
issues are blocking it, not just that it hasn't happened yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `55619cf` 2026-08-08 — devgeereact

Merge worktree-org-workspace-shell: the full artifact rebuild, reconciled

Two sessions built the same thing at once. This branch had added a real
per-site staffing minimum (0036_minimum_cover_rules.sql) and layered it onto
the existing shell; a parallel worktree had independently rebuilt the shell,
dashboard and rota builder wholesale against docs/ORGANISATION_WORKSPACE.html
- separate sidebar rows again for Rota Builder/Schedule and Team/Availability,
search moved into the rail, breadcrumbs and the account menu back in the
header/footer where the reference puts them, a proper Dashboard/StaffDashboard
split with the mockup's own six-tile stat row, a conflict banner, an hours
sparkline, and Cover Against Minimum as a single threshold-line chart instead
of two competing bars. That work is more complete than this branch's shell
pass and now wins wherever the two only disagreed on how, not what.

Where they overlapped on substance rather than style:

- The other branch's staffing minimum was one flat number
  (Settings -> Policies, "minStaffOnShift"), its own comment noting the real
  answer needed "a table of its own". This branch's migration is that table,
  per site, per weekday, so `loadWeeklyRosterSummary` now sums the real rules
  instead of taking a flat parameter, and the now-unwired Policies field is
  removed rather than left lying about what it does. Settings -> Policies
  points at Locations, where the real control lives, instead.

- Its `useNavBadges` hook subscribed to Realtime on `leave_requests` and
  `shift_swaps`, and is mounted twice at once by design (the sidebar, always;
  the dashboard, whenever it's the visible page). Two callers opening the same
  channel name is exactly the "cannot add postgres_changes callbacks ... after
  subscribe()" crash this session hit and root-caused two turns ago against
  what looked at the time like an unrelated dev server. `useNavBadgeCounts`
  polls instead, like `NotificationBell` already does for the same reason, so
  it survives being mounted more than once. Kept.

- A duplicate publish-status banner: RotaBuilderPage ended up with both
  branches' callouts stacked, auto-merged cleanly because they lived in
  different parts of the file. This branch's copy is removed; the other's
  handles a `publishError` state this one didn't.

RotaBuilderPage's Coverage-tab minimum line and ShiftInspectorPanel changes
never overlapped with the other branch's work and are untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `49fa469` 2026-08-08 — devgeereact

Fix the cover chart's caption: it named a setting the merge had just removed

Left over from reconciling the two branches' staffing-minimum work: the
caption still said "the N-person staffing minimum set in Settings -> Policies"
and quoted only coverByDate[0]'s figure as if it were one constant, both true
of the flat number the other branch built, neither true once this branch's
per-site-per-weekday rules took over the computation. Points at Locations,
where the real control now lives, and drops the false single-number claim.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `a42e7b3` 2026-08-11 — devgeereact

Codebase-wide bug sweep: security RLS, timezone bugs, admin console gaps

A full audit surfaced ~30 issues across the app. Fixes include:

- Six RLS/RPC self-approval gaps closed in one migration (0037): leave,
  overtime, timesheet and swap approvals could be self-approved; clock
  events had no guard window; accept_invite() trusted a spoofable email
  column; notifications leaked across support-access boundaries; and
  grant_platform_role() could strand the platform with no owner.
- A leave_requests date-order constraint (0038) after verifying zero
  live rows would violate it.
- send-notification now scopes recipients to active org members before
  sending, closing a cross-tenant notification path.
- Timezone-unsafe week arithmetic in the rota builder (UTC-vs-local Date
  bugs repeated across nav, copy-week and repeat-forward), plus
  per-location (not blanket-org) timezone resolution in rota insights
  and the dashboard's weekly summary.
- A dnd-kit id collision and a duplicate React key from the rota grid's
  flattening work, offline clock-in timestamps that could be lost on a
  transient failure, and a year-boundary double-count in leave entitlement.
- Admin console: duplicate DataTable column keys across four screens, a
  feature-flag rollout slider that wrote on every keystroke, GDPR board
  sorting/ordering that used the wrong deadline and mixed in closed
  requests, a support-case org lookup keyed by name instead of id, a
  manager-visible settings form the database always rejects, three inert
  header controls now wired to real exports/filters, and a Revoke action
  with no confirmation and no real reason.
- The Support Centre's reply/status/assign RPCs existed since 0024 with
  no UI calling them; added the case detail screen that uses them.

Verified: tsc, eslint, prettier and the full test suite (547 tests) all
pass; production build succeeds; every migration verified live via direct
SQL probes rather than trusting the apply response.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `c481755` 2026-08-11 — devgeereact

Fix admin console screens telling operators the wrong thing about security

A follow-up review re-verified the admin console against the current
schema and found console copy that had drifted from what the database
actually enforces — dangerous because it's read by operators making real
compliance and security judgment calls.

- /admin/gdpr's retention panel claimed no job deletes aged data and
  printed hardcoded periods; enforce_retention() has deleted five
  categories nightly via pg_cron since 0029. Now reads the real
  retention_policies table and shows what's actually enforced.
- /admin/support-access's panel said a session "is not the thing that
  grants access"; migration 0028 made it exactly that for staff records,
  rotas, shifts and clock events (while deliberately leaving the
  organisation/subscription/membership registers ungated, per 0031).
- /admin/organisations/:id warned three tabs needed a support session
  when only Locations actually does — Users, Usage and Data all read
  through paths 0031 reopened to platform admins directly.
- /admin/users/:id showed identical placeholder verification/login/MFA
  values for every account; getAuthFacts() over platform_user_auth_facts
  (0027) existed and was unused.
- /admin/feature-flags described critical flags as requiring
  re-authentication with no such control wired; critical toggles now
  confirm before writing platform-wide.
- Fixed a regression from the previous commit: the growth panel's period
  badge stayed "Last 12 months" after the selector became functional.
- Removed three dead, unused, and now-stale exported constants
  (RETENTION_POLICY, BILLING_GAPS, UNAVAILABLE_METRICS) that described a
  schema state the product has since moved past.

Verified: tsc, eslint, prettier and the full test suite (545 tests) all
pass; production build succeeds. Every RLS/RPC claim checked against the
actual migration SQL, not assumed from the old comments.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `b391094` 2026-08-11 — Gideon Akinlotan

Merge pull request #107 from devgeereact/fix/console-menu-and-row

Remove a console menu link that 404s, and level the overview row
---
## `c475074` 2026-08-11 — devgeereact

Fix Platform console link and org switcher when the sidebar is collapsed

Both dropped out silently in the collapsed rail: the platform-console link
was missing from the DOM entirely for admins, and the org switcher rendered
as an inert span with no click handler. The collapsed state persists in
localStorage, so once collapsed either control stayed broken across
sessions until the rail was expanded again.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `2ff10bd` 2026-08-11 — devgeereact

Fix demo_seed.sql: org hard-delete now survives its own audit trail

Two real schema drifts since this last ran successfully, not seed-script
bugs:

1. memberships_audit (AFTER DELETE) writes an audit_logs row referencing
   org_id, but by the time it fires mid-cascade the parent organisations
   row is already gone, so audit_logs' own FK rejects it. Any hard delete
   of an org with memberships hits this, not just the reset at the top of
   this script. Disabled for that one statement.

2. audit_logs.org_id is ON DELETE SET NULL, not CASCADE (a real audit
   trail should survive the org it describes) — so a prior run's rows
   outlive the reset with the same deterministic ids. Added
   ON CONFLICT (id) DO NOTHING to the seed's own audit-log insert.

Also points the owner login at dev@rota.gakinz.com instead of the old
gakinz101+demo.owner@gmail.com alias.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `3d2cafc` 2026-08-11 — devgeereact

Rebuild Schedule to match docs/ORGANISATION_WORKSPACE.html exactly

Replaces the old day/week/fortnight/month + filters + ICS export + print +
publishing-history build with a literal match to the reference's
SCREENS.schedule, a deliberate scope decision (not an oversight) made with
the user: the manager's screen answers "who is on, where, right now" — five
stat tiles (On shift now, Clocked in, On leave, Off sick, Status; no
"Agency cover", which has no real data behind it in this schema), a Day/Week
toggle where Week points at the rota builder, and today's shifts grouped by
site. Staff get their own week, one card per day.

- ManagerSchedule.tsx / StaffSchedule.tsx: new presentational components,
  same Page+role-split pattern as ManagerDashboard/StaffDashboard.
- SchedulePage.tsx: thin data loader. Manager view is draft-inclusive
  (operational reality, matching the Dashboard's "on shift now" number);
  staff view stays published-only.
- SchedulePreviewPage.tsx: moved to pages/app/, now renders the real
  ManagerSchedule/StaffSchedule against fixtures (?role=staff switches
  branch) instead of a hand-rolled duplicate, so it can't drift from the
  real screen the way the old one had.
- Deleted 15 components and lib/publishedSchedule.ts from the old build,
  all confirmed to have no other consumers.
- Dropped rotaWorkspaceTabs: nothing rendered it once Schedule stopped
  cross-linking to the rota builder (the reference has no shared tab bar
  between the two), so it was the exact dead-tab-list bug class
  navigationTargets.test.ts exists to catch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `fec4534` 2026-08-11 — devgeereact

Clock In: match the pagehead pattern, keep all nine cards

Swaps the screen's own icon+title header for WorkspaceHeader, same as
Dashboard/Schedule/Rota Builder, with docs/ORGANISATION_WORKSPACE.html's
lede copy. A deliberate scope decision, not a rebuild: unlike Schedule,
every existing card stays (Current Shift, hero clock, Today's Schedule,
Recent Activity, Weekly Summary, Attendance Status, Need Help, Policy
banner, Security footer) — this screen's GPS/offline/geofencing logic and
its layout already match design/clockin.png closely, and none of that is
in the mockup to compare against.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `981c6ae` 2026-08-11 — devgeereact

Rebuild Timesheets to match docs/ORGANISATION_WORKSPACE.html, add Amend

Literal rebuild, chosen over reskinning the existing week-grain build: a
day-grain table (today's shifts against what was actually clocked, via
lib/timesheetDayRows.ts), search+status filtering, six manager tiles / four
staff tiles, real CSV export, and "Approve week". Approval stays week-grain
throughout — timesheets.period_start/period_end is the only period the
schema stores, so both "Approve week" and the per-row Approve approve that
person's whole week, not the single visible day.

Adds Amend, which didn't exist anywhere in the app: a manager can now
correct a clock-in/out time from Timesheets, exactly what ClockInPage's own
help text already promised ("your manager or organisation owner can edit
any event from Timesheets") with nothing built behind it. RLS already
permitted the write (clock_events_update, 0037); this adds
clockService.updateClockEvent to use it, and migration 0039 adds
'timesheet.amended' to log_audit_event's whitelist so the correction and
the manager's reason leave a real trail, not just a silently swallowed
promise.

Deleted 11 dead components (PendingApprovalCard, TimesheetFilterBar,
TimesheetPagination, TimesheetRulesCard — never actually rendered live,
TimesheetStatCard, TimesheetStatusPill, TimesheetSummaryCard, TimesheetTable,
TimesheetTabs, TimesheetTipBanner, TimesheetsView) and two lib modules
(timesheetRows.ts, timesheetStatus.ts), all confirmed to have no other
consumers. Kept components/timesheets/QuickActionsCard.tsx — it's shared
with Shift Swaps (SwapsView.tsx), not timesheets-only, despite living in
this folder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `955e953` 2026-08-12 — devgeereact

Rebuild Availability to match docs/ORGANISATION_WORKSPACE.html

One screen for everyone rather than a role split — a manager gets the same
weekly-pattern and exceptions cards as anyone else, plus a "Team
availability, {today}" card. Drops the Team/Availability workspace tab bar
(teamWorkspaceTabs), matching the reference's own nav: its own sidebar row,
no shared tab strip, same call already made for Rota Builder/Schedule.
Team/StaffPage.tsx keeps its own half of that link for now, since nobody's
asked to rebuild Team yet.

Two things the reference only fakes are real here:

- Each weekday's "Change" button actually toggles that day (creates/deletes
  the underlying availability row) instead of a toast with no persistence.
- "Add exception" actually writes a one-off dated override. The schema
  already supported this (`date` + `recurring: false` on `availability`),
  but nothing in the old UI could create one — only recurring weekday
  patterns were reachable from a form.

"Team availability, {today}" is computed per person from their real
recurring pattern plus any dated exception for today, not the reference's
hardcoded "everyone's available except one person" demo table.

lib/availabilityRows.ts carries the pure logic (weekly-pattern derivation,
exception listing, per-date team resolution), tested directly rather than
through the component tree.

Deleted the entire disconnected components/availability/ tree (Matrix,
Toolbar, StatCard, ViewBar, Pagination, SummaryCard, Donut,
PendingRequestsCard, RulesCard, TipCard) — none of it was reachable from the
real /app/availability route, only from its own now-deleted preview page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `cf5af59` 2026-08-12 — devgeereact

Rebuild Leave to match the workspace mockup

Replaces the tabbed/paginated Leave screen with the mockup's flat layout:
role-specific tiles (manager gets a real cover-risk scan across a 60-day
lookahead, not just a count), a single search+status filter, and a table
with Decline/Approve or Withdraw inline. Declining now requires a reason,
recorded via a new 'leave.reviewed' audit action (migration 0040) since
leave_requests has no column of its own for one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `9a97b07` 2026-08-12 — devgeereact

Rebuild Shift Swaps, Overtime and Team to match the workspace mockup

Shift Swaps: replaces the table/donut/rail/filters layout with the mockup's
tiles + request list + refusal-reasons card. Adds a real awaiting_colleague/
awaiting_manager/open status split the mockup's simpler model can't
represent, since the schema allows naming a colleague directly. The
reference's "Take this shift" button is omitted rather than faked: no RLS
policy lets a third party claim an open swap today.

Overtime: drops the My/Team toggle (Raise a claim stays visible to everyone,
so nothing is lost) and matches the mockup's flat Claims table. Replaces the
reference's uncomputable "Estimated cost"/"Top driver" tiles with real
pending-hours and requests-shown figures. Corrects a stale comment claiming
overtime_requests has no reader/writer — it's been a working feature since
PR #86.

Team: rebuilds the directory to the mockup's Department/Site/Contract/
Rostered/Today columns and six real tiles (documents expiring and invites
outstanding now wired to listExpiringDocuments/listPendingInvites, previously
unused). The staff profile's six tabs render real, different content per
tab for the first time — Shifts/Documents/Emergency contacts/Leave were
previously cosmetic, always showing the same Overview dashboard regardless
of which tab was clicked.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `36b19d7` 2026-08-12 — devgeereact

Staff profile preview: support ?tab= to screenshot each pane directly

Lets the design-loop verify Shifts/Documents/Emergency contacts/Leave/
Activity individually instead of only ever landing on Overview.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `424d808` 2026-08-12 — devgeereact

Swaps: peer approval without a manager gate; Team: lock payroll ID, restrict self-edit; default screens to Pending

Shift Swaps: restores the richer design/Swap-Request.png layout (status
tabs, filters, donut overview, activity feed, pagination) the mockup-only
rebuild had traded away. Adds a real workflow change: once a named
colleague accepts, the REQUESTER can now give the final approval
themselves and the shift reassigns immediately — no manager needed for a
swap both people already agreed to (0043_swap_requester_finalize.sql).
Managers keep every existing capability; open ("anyone") swaps still need
one, since there's no second named colleague to close the loop.

Team: staff_profiles.payroll_id is now unique per org and locked once set,
enforced by a trigger rather than only the form (0041) — the anonymize
RPC still clears it via a transaction-local bypass flag. A new narrow RLS
policy plus trigger lets a staff member update only their own phone and
photo, everything else on their row stays manager/owner-only (0042);
/app/account/profile's "Work details" section is now read-only for the
fields staff can no longer touch, with a real photo-URL field replacing
the "nothing is wired to it" placeholder. Emergency contacts moved onto
the profile's Overview tab instead of its own — one glance away instead
of a click nobody thinks to make until they need it. Fixed the Shifts
tab's two-column layout, which was squeezing Upcoming Shifts too narrow
to show its own status badge and actions.

Leave, Swaps and Overtime now default their status filter to Pending
instead of "Any", so a reviewer lands on what needs a decision rather
than a list of already-settled requests.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `8cf3e95` 2026-08-12 — devgeereact

Reconcile Swaps and Locations to the workspace mockup; extend Policies

Swaps drifted toward design/Swap-Request.png last turn (tabs, donut,
pagination, activity rail). docs/ORGANISATION_WORKSPACE.html is now the
sole reference, so it's back to the reference's plain tiles + request
list + rules card, keeping the peer-approval workflow underneath: a
colleague can now also claim an untargeted "open" swap
(shift_swaps_claim_open, 0044), which reuses the same accepted/finalize
path a named offer already had.

Locations had never been touched to match the reference at all — it was
still the table + side-panel workspace design/Locations-Management.png
described, with type/status permanently null because no column backed
them. 0045 adds both; the screen is now the reference's card grid, with
Departments and Minimum cover as real dialogs (the reference's own
versions are toast placeholders) instead of a table row you have to
select first.

Settings -> Policies gained the fields the reference has that were
missing (Maximum weekly hours, Swap approval, Auto-decline clashing
leave) and Settings -> Organisation gained date format and currency.
Swap approval is real: turning it off is what the new peer-finalize path
reads. Help & Support didn't exist for a signed-in user at all before
this (the sidebar link left the app shell for the public contact page);
it now opens real support cases via a service that already existed for
the platform console but had no requester-facing door into it.

---
## `996b189` 2026-08-12 — devgeereact

Rebuild Announcements to the workspace mockup; real read receipts

Announcements had never been touched to match
docs/ORGANISATION_WORKSPACE.html either — it was still the tabbed
table/preview-panel/CSV-export workspace design/Announcements-Dashboard.png
described, and its own docstring recorded why delivery data was always
null: notifications is RLS-scoped to user_id, so a manager could never
count another member's reads from the client.

announcement_reads (0046) is a small org-shared table instead, the same
shape minimum_cover_rules already uses for "any member reads, the value
isn't personal" — a read receipt is a fact about the post, not someone's
inbox. Read: X/Y and "Remind N unread" are both real now, and so is Take
down (a real delete, worded as one). "Pinned" reuses the existing real
`urgent` column rather than a new one. The composer also gained a real
Audience select (all sites / one site / one department) — creation only
ever posted org-wide before, despite the schema and the filters already
implying otherwise.

Dropped: the Scheduled/Drafts/Archived tabs. createAnnouncement always
sets published_at immediately, so nothing could ever land in them.

---
## `1aa3edf` 2026-08-12 — devgeereact

Reports: the tiles and department/absence breakdown SCREENS.reports has

Added four real tiles (Hours worked, Overtime, Absence, Cover
shortfalls) and two bar-row breakdowns (Hours by department, Absence
reasons) to the workforce-trends card, reusing the existing catalogue,
run history and quick actions underneath rather than replacing them --
they're real, working CSV exports the reference's own version of this
screen doesn't have an equivalent for.

Left out: Staff cost and Agency spend. Neither is backable -- there is
no pay-rate column anywhere in the schema and no agency-shift concept,
so either figure would be invented and shown with the authority of a
report.

---
## `28ba3df` 2026-08-12 — devgeereact

Permissions: real Remove/Change role; Notifications and Billing polish

Settings -> Permissions previously left "Change role" and "Remove"
unbuilt with a note that they needed an audit event to be attributable.
That event has existed since 0016 -- memberships_audit fires on every
insert/update/delete already -- so the gap was the client action, not
the audit trail. Both are wired now, gated the way the reference
describes ("An organisation must keep one owner"), which is enforced at
the database with a new trigger (0047) rather than trusted to a disabled
button.

Settings -> Billing gained Sites and Billing contact (both real, reusing
data already collected elsewhere). Notifications gained the reference's
lede, a link to real notification preferences, and the push-permission
callout -- the existing push-subscribe control stays, since it is real
device-level capability the reference has no equivalent for.

---
## `4fbadb2` 2026-08-12 — devgeereact

Dashboard: real missed clock-in detection for the "Needs you" feed

SCREENS.dashboard's manager view lists a missed clock-in alongside
pending leave and swaps; nothing computed one before this. Flags a
shift that started 30+ minutes ago, is assigned to someone, and has no
clock-in event anywhere in today's window (capped at 12 hours so a
shift nobody ever worked stops paging on every refresh).

Not wired as a Settings -> Notifications toggle: it's a value computed
on page load, not a dispatch a toggle could switch on or off. Making it
a real send needs a scheduled job and de-duplication, a background-job
change, not a settings-screen one -- documented on that screen rather
than left unexplained.

---
## `65d5f40` 2026-08-12 — devgeereact

Fix Swaps/Reports issues found during visual verification

Swap Rules card: "Set per location, see Locations" overflowed and
truncated the label column next to it in a screenshot at 1440px --
shortened to "Set per location".

Swaps tiles: "Waiting on you" was hardcoded to 0 for staff, copied
directly from the reference's own static demo, which never modelled a
peer-review responsibility for anyone but a manager. With the real
colleague-accept and requester-finalize paths this build added, a
staff member can very much have something waiting on them; the tile
now reads real needsReview data for both roles.

Reports design-loop preview was still the pre-rebuild static card and
had drifted out of sync with the real ReportsAnalyticsCard -- updated
with matching fixture tiles and bar-row breakdowns so a screenshot of
it is trustworthy again.

---
## `beebe9e` 2026-08-13 — devgeereact

Brand rollout and sitewide contrast/accessibility fixes

Phase 0 of docs/PRODUCT_TRANSFORMATION_PLAN.md: retires the old "Smarter
Rota. Stronger Teams." tagline and CTA copy for the docs/BRAND.md platform
("Scheduling certainty for every shift.") across marketing pages, auth
pages, the sidebar and footer, consolidated behind src/lib/brand.ts and
src/lib/marketing.ts rather than scattered per-page strings. Adds the
Privacy/Terms/Cookies/Accessibility legal-IA pages (honest placeholders
pending counsel review, not final legal text) and a shared AUTH_FEATURES
list on Login/Signup that replaces a hardcoded "Compliant & Secure — Stay
compliant with confidence" claim, an unsubstantiated compliance statement
BRAND.md's evidence boundary explicitly forbids.

Also closes a real, sitewide reduced-motion gap found while adding the axe
accessibility test suite: 12 of 13 `animate-fade-up` usages across toasts,
banners, prompts, modals, onboarding and auth pages were missing the
`motion-reduce:animate-none` pairing the homepage hero alone had. Adds
`primary.ink`/`warning.ink`/`success.ink`/`danger.ink` to tailwind.config.ts
(additive — existing DEFAULT values untouched) and applies them everywhere
a semantic colour was used as small/link text below the WCAG AA contrast
minimum, verified per-page via axe rather than by eye: the whole public
site and most of the authenticated app (rota builder, schedule, onboarding,
admin console, staff, timesheets) are now at zero known violations. The one
remaining gap (src/components/ui/Badge.tsx) is deliberately untouched — it
renders inside screens a concurrent worktree is actively pixel-matching
against reference designs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `6bf4ae6` 2026-08-13 — devgeereact

Admin console: remove or disclose illustrative metrics

P0 #3 of docs/PRODUCT_TRANSFORMATION_PLAN.md — a platform-console screen
must never present placeholder data as production intelligence.

- AdminOverviewPage: two stat-tile sparklines (Total users, Published
  rotas) paired a real number with a fully invented trend line, named
  nowhere in the page's own placeholder-figures disclosure. Removed rather
  than disclosed, since the tiles' real values don't need a decorative
  chart.
- AdminOrganisationsPage: "New this month" showed a fabricated "+18% vs
  July" next to the real count. Replaced with a real month-over-month
  calculation off the same `created_at` growth series the overview chart
  already uses.
- AdminSubscriptionsPage: the Value/Cycle/Payment table columns are
  entirely fabricated (no payment provider is connected), but the
  on-screen callout only disclosed the Usage column. Extended it to name
  all four.
- AdminSupportPage: a doc comment still claimed the case queue was
  placeholder data; it has been backed by a real `support_cases` table
  since migration 0024. Corrected the stale claim.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `5b5ccb7` 2026-08-13 — devgeereact

Seed dataset rebuilt to v3, with two real bugs fixed along the way

demo_seed.sql/platform_seed.sql now build a RotaFlow platform team (8
accounts, platform_owner/admin/support/finance roles) plus five demo
companies, each with two branches and a manager/supervisor/staff login per
branch — 33 sign-in-able accounts total, replacing the earlier single-branch
five-org shape. Real credentials live in the gitignored, uncommitted
docs/ACCOUNTS.md rather than this file, which now hardcodes its own simple
password by deliberate choice (this repository is public, but the seed's
own account-to-password pairing is kept out of it).

Two bugs found and fixed while getting the seed to run cleanly against the
current schema:

- The reset step deleted every membership row for the demo orgs in one
  statement, which migration 0047's `memberships_keep_one_owner_trigger`
  (added after this script was last touched) correctly rejects once it
  reaches an org's last owner row mid-cascade. Disabled for that one
  statement, same pattern the file already used for the `memberships_audit`
  trigger.
- The five demo orgs never set `is_demo = true` on insert, so
  platform_seed.sql's fixture data (invoices, incidents, support cases,
  integrations) was silently attaching to three unrelated pre-existing
  orgs instead. `is_demo` is also no longer used as a delete/attach filter
  at all — both scripts now scope by the five companies' exact slugs,
  since `is_demo` was blanket-backfilled onto whatever organisations
  existed when that column shipped and cannot be trusted to mean "created
  by this seed".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `4695a3e` 2026-08-13 — devgeereact

Add Playwright/axe E2E suite, a CI gate for it, and fix wildcard CORS

docs/PRODUCT_TRANSFORMATION_PLAN.md §8: introduces a real E2E smoke and
WCAG A/AA test suite (public marketing/auth/legal pages, no Supabase
session needed) wired into a new `e2e` CI job, plus `npm audit
--audit-level=high` as the dependency-audit gate. Runs against `npm run
dev` rather than the production build, since the DEV-only `-preview`
routes it uses to test pages without a live session are compiled out of
`dist/` entirely.

Also fixes a real security gap found while adding it: `ai-rota-assistant`,
`send-notification` and `test-smtp` all reflected `Access-Control-Allow-Origin:
*`, verified against a hostile origin. A wildcard doesn't let an
unauthenticated caller in (`verify_jwt` still gates each function
independently), but it does let any origin holding a leaked access token
read the response. Replaced with a shared allowlist
(supabase/functions/_shared/cors.ts) scoped to the production domain and
the project's dev ports, verified live post-deploy: the real app origin
still gets the header, a hostile one gets nothing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `70d8a56` 2026-08-13 — devgeereact

AI assistant: audit trail, prompt versioning, and a data-lifecycle record

docs/PRODUCT_TRANSFORMATION_PLAN.md §8.6 (AI operations). ai-rota-assistant
now writes one audit_logs row per completed suggestion/announcement — model,
a new PROMPT_VERSION constant, the requesting manager's identity, and (for
rota suggestions) accept/drop counts, the raw material for an
invalid-suggestion-rate measurement. audit_write is deliberately revoked
from `authenticated` so a client can't forge an entry for an action that
never happened, so this needed a second, narrowly-scoped service-role
client used for nothing else — with the caller's real identity threaded
through explicitly, since auth.uid() is null on a service-role call.
Verified live: signed in as a real seed-account manager, made an actual
request, confirmed the row landed with correct metadata.

docs/DATA_LIFECYCLE.md is the first written record of backup/restore,
retention, GDPR export/deletion, audit-log immutability, incident response
and support escalation, graded against what's actually implemented rather
than declared. It records the two most consequential findings from this
pass: the production database currently has zero backups (`pitr_enabled:
false`, verified via the Supabase Management API — a billing decision, not
a code change, deliberately left to the account owner), and five of six
declared retention policies have no enforcement job behind them yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `5b4008c` 2026-08-13 — devgeereact

Wire the legal-IA routes into App.tsx

Missed from beebe9e: the Privacy/Terms/Cookies/Accessibility pages existed
but were never routed, so /legal/* 404'd despite the footer linking to it
and navigationTargets.test.ts asserting the link resolves.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `a23f911` 2026-08-13 — devgeereact

Format the two newly-tracked plan docs for the CI format gate

Both were untracked scratch files until beebe9e committed them, so
format:check never ran against them before. Whitespace only, no content
change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `0c426a3` 2026-08-13 — devgeereact

Add release notes to /resources

P1 item 3 of docs/PRODUCT_TRANSFORMATION_PLAN.md ("establish product
support, help centre content, release notes and in-app feedback capture").
/resources already answers "what is built"; it had nothing answering "what
changed recently" for someone deciding whether to look again after an
earlier no.

Seven real, dated entries drawn from actual git history, in the same
honest voice as the rest of the page — not a marketing recap, and nothing
listed that isn't live. Added as a new timeline section rather than a
separate route: no new nav entry or IA decision needed, and it sits next
to the build-status section it naturally follows on from.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `014889f` 2026-08-13 — devgeereact

Add in-app feedback capture, and fix a live support-case outage found while verifying it

P1 item 3 of docs/PRODUCT_TRANSFORMATION_PLAN.md, the other half of
0c426a3: /app/help gets a second, lighter-touch entry point beside
"Contact support" — no modal, category `feature`, priority `low`, for a
suggestion or a rough edge rather than something broken that needs a
reply. Same underlying `open_support_case` RPC, so it lands in the same
queue distinctly rather than needing new infrastructure.

Verifying it live (signed in as a real seed-account member, called the RPC
directly) surfaced a real, pre-existing bug, not introduced by this
feature: platform_seed.sql hardcodes support-case references
CASE-4120..CASE-4129 directly into the table, bypassing
support_case_reference_seq entirely. That sequence starts at exactly 4120
(migration 0024), so the first ~10 real calls to open_support_case since
any seed run — including the already-shipped "Contact support" button —
failed outright with a duplicate-key error. Fixed the live sequence
(advanced past the seeded range, a pure counter move, no rows touched) and
patched the seed script to advance it itself after inserting, keyed to
whatever is actually in the table rather than a fixed number, so it can't
regress a sequence a real user has since advanced further.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `f3edbe1` 2026-08-13 — devgeereact

Publish the event taxonomy, and verify it against real data

docs/PRODUCT_TRANSFORMATION_PLAN.md §8.3 ("publish event taxonomy"). Maps
each of §12's eleven success metrics to exactly what data computes it,
distinguishing what is already derivable from existing tables with a query
from what needs new capture (four gaps: rota-session starts, schedule-view
events, an AI-suggestion-outcome field, and Web Vitals collection) from
what is a human/business process no amount of instrumentation produces
(NPS, pricing conversations). No third-party analytics vendor is assumed —
first-party, same-project storage is the recommended default if the
session/view events are ever built, avoiding a vendor decision this
document deliberately doesn't make.

Every "computable now" row was actually queried against the live
demo/seed dataset, not just checked for schema presence. Two came back
with impossible negative values (a rota published before its own
organisation existed; a request reviewed before it was created) — a real,
recorded seed-data quality gap (independent timestamp generation, not
enforcing chronological ordering between dependent rows), not a bug in the
metric definitions themselves. The other two returned clean, plausible
numbers, evidence the underlying data genuinely supports the metric once
real usage exists to measure.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `a5f6eb5` 2026-08-13 — devgeereact

Give every Sentry event a release identifier

docs/PRODUCT_TRANSFORMATION_PLAN.md §8.3 ("a Sentry release/version
convention"). Verified this was genuinely missing, not just undocumented:
fetched the live production bundle, confirmed a real DSN is wired
correctly (EU ingest region, matching CLAUDE.md's requirement), and sent a
real test event through it — accepted, but carrying no release tag, same
as `sentryVitePlugin`'s source-map upload, which had no `release` option
set either. Sentry can ingest errors from this project; it cannot yet
answer "which deploy introduced this" or "did the last deploy make error
rate worse", both of which need every event and every uploaded source map
tagged with a consistent identifier.

Not `__APP_VERSION__` (already exists, drives the version shown on
StatusPill/AdminPlatformHealthPage): that's `package.json`'s version
field, which has been "1.0.0" since the first commit and isn't bumped per
deploy, so it can't distinguish one build from another. `__SENTRY_RELEASE__`
is the short git commit SHA at build time instead, read via `execSync` in
vite.config.ts (falls back to `__APP_VERSION__` only if git is genuinely
unavailable), passed to both `Sentry.init()` and `sentryVitePlugin`'s
`release.name` so client events and uploaded source maps agree. Verified
the built bundle actually carries the right value: `release:"f3edbe1"`,
matching `git rev-parse --short HEAD` exactly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `77ca540` 2026-08-13 — devgeereact

Fix the same sequence-collision bug for incidents, found by checking for it

Discovered 014889f's support_case_reference_seq bug, then checked whether
any other reference-number sequence in the schema had the same shape of
problem: grepped every `create sequence` in the migrations and checked each
against what platform_seed.sql hardcodes. Two more sequences exist —
incident_reference_seq (0021) and invoice_number_seq (0023) — and one of
them has the identical bug.

incident_reference_seq starts at 138; platform_seed.sql hardcodes
INC-0138..INC-0145 directly into `incidents`, bypassing it entirely. The
first real call to declare_incident (the app's own "Declare" button in
/admin/incidents) after any seed run collides the same way the support-case
button did. Confirmed live: advanced the sequence (setval, no rows
touched), then called declare_incident for real as a seed platform_admin
account — succeeded, immediately resolved to keep the console clean.
Patched the seed script with the same greatest()-guarded setval this file
already carries for support_cases, so a future re-run can't reintroduce it.

invoice_number_seq does not have this bug: platform_seed.sql's invoice
numbers are shaped INV-YYYY-<org><month> while the sequence-backed real
ones are INV-YYYY-<sequential>, different enough that their ranges don't
collide in practice. Checked, not just assumed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `f62cf13` 2026-08-13 — devgeereact

Live-verify the GDPR erasure function, and record what actually happened

docs/DATA_LIFECYCLE.md §4 described anonymize_staff_member from reading
migration 0011's source only. Called it for real instead — as a real org
owner (Meridian Security demo account), against a real staff record with
no login of its own (not one of the documented accounts in
docs/ACCOUNTS.md, so nothing in active use was disrupted; fully
recoverable regardless via a demo_seed.sql re-run).

Clean pass, no bug found this time: identity scrubbed exactly as the
migration's own comments claim (name, phone, photo, payroll ID all gone,
active=false), all 85 of the subject's shifts left untouched, both
emergency_contacts and documents hard-deleted to zero, and a real
audit_logs row recording who erased what and when. The two documented
limits (auth.users untouched, ImageKit file not deleted) held under the
live test too, not just on paper.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `d11320c` 2026-08-14 — devgeereact

Warm up the dashboard's caught-up state, and add times to the hero rota chips

"Needs you" showed a bare "Nothing needs your attention." on the empty
path — the plan-design-review finding was that empty states need warmth,
not a flat one-liner, so it now matches the icon-circle treatment already
used for the populated list. The hero rota preview's shift chips gained
their start times (mono, matching the design/attendance grid convention)
instead of solid colour bars with no information in them.

Verified via /dashboard-preview (pending temporarily emptied, then
reverted) and the live homepage; tsc --noEmit clean.

---
## `db51744` 2026-08-14 — devgeereact

Rewrite the transformation plan, add a design exploration, and a weekly drift-audit

docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md re-scores the original plan
against what actually shipped since 13 Aug: most of the old P0 list is
done, but production safety (zero Supabase backups, no RLS review, no
real-device UAT) was under-weighted and is now Phase 0. Went through
plan-ceo-review, plan-eng-review and plan-design-review, each with an
outside-voice pass; caught and fixed a stale-memory bug along the way
(migration_recorded_but_not_applied.md was citing an issue closed a week
earlier).

docs/FRESH/DESIGN_EXPLORATION.md is a design-consultation output — an
industrial/utilitarian direction evolving the existing DESIGN.md tokens
rather than replacing them. docs/DESIGN.md stays the enforced system;
this is a proposal, validated through design-shotgun (3 variants,
"Instrument Panel" approved) and design-html (Pretext-native reference
build, verified at 3 viewports + dark mode).

.github/workflows/plan-drift-audit.yml is Phase 0.4 from the plan: a
weekly Claude-driven re-audit so the plan can't go stale and silent again.
Two-job split (AI step is contents:read only, cannot push; a separate
deterministic job holds write access and opens the PR) so "never pushes
to main" is enforced by the permission boundary, not just prompt wording.
Needs an ANTHROPIC_API_KEY repo secret before it can run — not set yet.

---
## `c6ebdc4` 2026-08-14 — devgeereact

Fix demo_teardown.sql: audit_logs trigger disable had no matching re-enable

Ran it live against production (project vwqqbdvlskngrqrejzxi) to clean up
the v3 demo dataset. First attempt failed outright: deleting auth.users
cascades to profiles, which cascades to audit_logs.actor_user_id via
ON DELETE SET NULL, and audit_logs_no_update's built-in exception
(migration 0016) only covers org_id -> null, not actor_user_id -> null.
The trigger correctly blocked it.

Fix disables that trigger around the auth.users deletes, matching the
pattern already used for the memberships triggers a few lines up. First
version of the fix disabled but never re-enabled it — caught by an
independent verification query after running (tgenabled='D'), fixed live
by hand immediately, and fixed here so the script itself doesn't regress
next time it runs.

Verified end-to-end: 5 demo orgs deleted, 33 demo/platform users deleted,
the 3 real organisations that share the mis-set is_demo flag (City
Hospital Care Group, GAKINZ, Harni MCare) untouched, dev@rota.gakinz.com
and gakinz101@gmail.com untouched, the 4 audit_logs rows referencing
deleted demo users kept their action/content/timestamp with actor_user_id
nulled, and the trigger is back to enabled ('O') on the live table.

---
## `d8fe039` 2026-08-14 — devgeereact

fix: don't crash the whole app when Supabase env vars are unset

createClient('', '') throws synchronously at module-evaluation time,
which took down every page (not just ones touching Supabase) whenever
VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY were unset — exactly the case
CI's e2e job runs under. Root's contract (env.ts's requireKeys) is to
degrade, not throw; supabase.ts didn't honor that. Fall back to a
syntactically valid placeholder so the client constructs and only
fails at the network layer if actually used.

Also reformats an import in ManagerDashboard.tsx that was failing
`format:check` in CI.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---
## `b418ccc` 2026-08-14 — Gideon Akinlotan

fix: restore org-creation RLS bootstrap window dropped by 0031 (#115)

0031 replaced organisations_select with `is_org_member(id) or
is_platform_admin()`, dropping the bootstrap clause 0003/0005 added so a
creator can see the org row they just inserted before the on_org_created
trigger grants their membership. Neither clause is true at insert time for
an ordinary signup, so every new organisation creation 42501s. Restores
0005's narrowed bootstrap clause alongside 0031's platform-admin clause.

Found via the RotaFlow QA auditor's clean-slate signup test; confirmed by
reading migrations 0003, 0005 and 0031 directly.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `82914a9` 2026-08-14 — Gideon Akinlotan

fix: qualify org-bootstrap subquery correlation dropped by aliasing (#116)

0048's bootstrap clause read `where m.org_id = id` inside a correlated
subquery against memberships. memberships has its own `id` column, so the
bare `id` bound to the innermost scope (m.id) instead of the intended
correlation to organisations.id. Confirmed live: pg_policies.qual showed
`WHERE (m.org_id = m.id)`, always false, collapsing the clause to an
unconditional `created_by = auth.uid()` — org creation still worked (that
OR-branch alone sufficed), but the permanent creator backdoor 0005 was
written to close stayed open. 0005's original subquery had the same shape,
so this has likely never actually narrowed as intended. Qualifies the
outer reference explicitly this time.

Found while verifying 0048 actually applied live, not just recorded.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `0b7cb51` 2026-08-15 — Gideon Akinlotan

feat: Stripe billing integration for Settings > Billing (#117)

* docs: add design spec for Stripe billing integration

Scopes replacing the Payment section's deliberate stub with real Stripe
checkout/portal/webhook wiring against the existing 0023 plans/invoices
schema, not the older per-seat marketing pricing model. Decisions made
collaboratively during brainstorming, recorded with rationale.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* docs: add implementation plan for Stripe billing integration

10 tasks: schema migration, shared Stripe client helper, three Edge
Functions (checkout, portal, webhook), client billing service, Settings
page wiring, marketing/docs copy correction, Stripe dashboard setup, and
end-to-end verification.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat: add stripe_price_id and stripe_customer_id columns

Adds two nullable columns required by Stripe billing integration:
- plans.stripe_price_id: Identifies which Stripe Price the plan checks out as
- subscriptions.stripe_customer_id: Stores Stripe Customer ID for checkout/portal

Both columns are defined with descriptive comments explaining their usage
and idempotent with 'if not exists' for safe re-run capability.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat: add shared Stripe client helper for Edge Functions

Implements getStripeClient() helper that centralizes Stripe SDK initialization,
ensuring consistent API version and error handling across create-checkout-session,
create-portal-session, and stripe-webhook functions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat: add create-checkout-session Edge Function

* fix: add error handling for subscription lookup in create-checkout-session

* feat: add create-portal-session Edge Function

Implements Stripe Billing Portal session creation for organization owners.
Forwards caller's JWT for RLS-scoped queries, validates owner role, and
handles the no-customer-yet path with a clear 404 message.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat: add stripe-webhook Edge Function

Handles the 5 subscription/invoice lifecycle events Stripe sends after
checkout: checkout.session.completed, customer.subscription.updated/
deleted, invoice.paid, invoice.payment_failed. Authenticated by Stripe's
own request signature (constructEventAsync + STRIPE_WEBHOOK_SECRET), not
a JWT — deploys --no-verify-jwt and uses service_role, same pattern as
the inngest function.

Deviates from the task brief: handleInvoicePaid uses an explicit
select-then-insert-or-update on `invoices`, mirroring
handleInvoicePaymentFailed's existing shape, instead of the brief's
.upsert(..., { onConflict: 'provider_ref' }) — invoices has no unique
constraint on provider_ref (only `number`, per 0023_commercials.sql), so
that onConflict target would error at runtime.

* fix: map Stripe subscription statuses and propagate DB write errors in stripe-webhook

Review findings from the Task 5 review:

1. subscriptions.status has a check constraint of only ('trialing',
   'active','past_due','canceled') per 0002_rotaflow.sql, but Stripe's
   real Subscription.Status enum also includes incomplete,
   incomplete_expired, unpaid, paused. Writing those verbatim (as
   handleCheckoutCompleted and handleSubscriptionUpdated both did)
   would violate the constraint. Added mapSubscriptionStatus() and
   used it at both call sites instead of widening the constraint,
   which stays a separate, controller-gated schema change.

2. Every handler swallowed Supabase write errors with
   console.error(...) and continued, so the outer try/catch in
   Deno.serve — whose whole purpose is to return 500 so Stripe
   retries a real failure — never saw them; a failed write returned
   200 as if it had succeeded. Changed all 8 write-error sites across
   the 5 handlers to throw instead, so a DB failure now surfaces to
   the outer catch and Stripe retries the delivery.

* feat: add client billing service for checkout and portal

* feat: wire real checkout and billing portal into Settings > Billing

Replaces the static "Payment is not connected yet" stub with a
conditional plan-picker (no active subscription) / manage-billing
button (active subscription), backed by Task 6's
billingCheckoutService (listPlans/startCheckout/openBillingPortal).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* docs: correct billing copy now that Stripe is wired in

* fix: resolve QA findings — Enterprise CTA, grid layout, hero heading, trust comment

* docs: correct Task 10's invoice-trigger steps per final review

stripe trigger invoice.paid/invoice.payment_failed create standalone
fixtures with no subscription_details, so the webhook's org_id lookup
correctly no-ops on them — not a bug to chase. Points Step 4 at the real
invoice a subscription Checkout already produces, and Step 7 at a test
clock advancing a real subscription past its period end instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix: apply final cross-cutting review fixes before merge

Nine findings from the whole-branch review, applied in one pass:
formats PricingPage/billingCheckoutService with prettier; corrects the
onboarding wizard's third, contradictory pricing model to match
0023_commercials.sql; drops ResourcesPage's now-false "no payment
provider" claim; syncs subscriptions.plan on
customer.subscription.updated by resolving the Stripe Price against
plans.stripe_price_id; gives canceled subscriptions a path back to the
plan picker instead of a dead-end "Manage billing" button; surfaces
the Edge Function's actual error message instead of a generic
FunctionsHttpError; sources invoice failure_reason from the
PaymentIntent's last_payment_error instead of last_finalization_error;
and refreshes two stale docblocks plus the SCHEMA.md subscriptions row
now that Stripe is actually wired in.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `fe8daa8` 2026-08-15 — Gideon Akinlotan

chore: regenerate database.types.ts for stripe_price_id/stripe_customer_id (#118)

Migration 0050 (merged in #117) auto-applied on merge as expected; this
picks up the two new columns (plans.stripe_price_id,
subscriptions.stripe_customer_id) that PR #117's TypeScript code didn't
need to reference by name, so it wasn't blocking. Verified live against
the actual columns before regenerating, not just the migration history
row.

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `1558a5b` 2026-08-15 — Gideon Akinlotan

fix: surface the real checkout/portal error message to the org owner (#119)

billingCheckoutService.ts already extracted the Edge Function's specific
error (e.g. "Professional is not available for checkout yet", "No
billing account yet") into the thrown Error's message, but
SettingsBillingPage.tsx's catch blocks discarded it in favor of a
hardcoded generic string. Uses err.message when it's an Error instance,
falling back to the generic string only for a genuinely unexpected
throw shape.

Residual from PR #117's final whole-branch review (Finding 6, ruled to
park rather than loop a third fix round).

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `b0b446e` 2026-08-16 — devgeereact

Refactor code structure for improved readability and maintainability


---
## `0a92d68` 2026-08-19 — Gideon Akinlotan

chore: remove demo/platform seed scripts and the now-pointless is_demo badge (#120)

The is_demo column existed to gate platform_seed.sql from ever attaching
fabricated data to a real tenant (0035). The 3 real orgs that carried it
(a historical backfill artifact, not planted demo data) have been removed
from production, so zero organisations carry the flag anymore. Removes:

- supabase/seed/{demo,platform,sunnyvale}_{seed,teardown}.sql + README —
  no more ability to accidentally reseed demo data into production
- the org.is_demo && <Badge>Demo</Badge> in both admin org list/detail
  pages — dead code with nothing left to render
- a stale demo_seed.sql file reference in NotificationsPage's comment

Does NOT touch: the is_demo column itself (a schema decision, not a
"trace" to sweep), or src/lib/{staffDemo,clockinDemo,reportsDemo}.ts +
their /preview routes (dev-only design-loop fixtures, never reachable in
production, unrelated to real data).

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `99ca96d` 2026-08-19 — Gideon Akinlotan

Real billing/revenue data across the Platform Console (#121)

* docs: add design spec for real admin console billing/revenue data

First sub-project out of adminOverviewDemo.ts's ~13-domain scope: MRR,
ARR, subscription counts, revenue by plan, collected/outstanding/refunds,
ARPO, invoices, failed payments, and dunning-driven org suspension.
Infrastructure already exists from this session's Stripe work; this wires
real readers onto it rather than adding new data sources.

Includes a security-relevant migration (set_org_status() gains a
service_role exception so the webhook can suspend an org after dunning
exhausts, without bypassing the function's own audit-write call) —
confirmed with the user before writing it into the spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* docs: add design spec for admin-assisted organisation creation

Lets a platform admin create an org for a direct-contact prospect: plan +
negotiated price, real owner invited via the existing invites flow, admin
never holds owner rights even briefly. Two real bootstrap conflicts found
and resolved during design, both narrow exceptions mirroring patterns
already proven in this codebase (0005/0048's org-creation RLS bootstrap):
create_invite()'s owner/manager gate, and on_org_created's unconditional
creator-becomes-owner trigger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* docs: add implementation plan for real admin billing/revenue data

8 tasks: revenue-churn reconstruction (started_at/canceled_at, no snapshot
table needed), real churn on Overview, real per-row subscription facts
(including real seat-usage via countMembershipsByOrg), real Org Detail
MRR, trend-chart honesty threshold, dead-export cleanup, set_org_status
service_role exception, webhook dunning-suspension.

Investigation during planning found the actual remaining gap much
narrower than the spec assumed — AdminBillingPage.tsx and most of
AdminSubscriptionsPage.tsx/AdminOverviewPage.tsx were already wired to
real data in a prior pass; only 4 fabricated values plus the trend
threshold and dunning-suspension backend work remained.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat: add real revenue-churn reconstruction to revenue.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix: align mrrAtDatePence/revenueChurnForMonth boundary and status filters

The "lost" filter in revenueChurnForMonth used c >= monthStart while
mrrAtDatePence's active-at-date check uses strict c > asOf for
startingMrr, so a subscription canceled exactly at monthStart was
excluded from the denominator but included in the numerator. Switch
"lost" to c > monthStart to match.

mrrAtDatePence had no status filter, so a trialing subscription (never
billed) was counted as full recurring revenue. Add the same
status === 'active' || 'past_due' condition monthlyRecurringPence and
revenueByPlan already use, to both mrrAtDatePence and the "lost"
filter, so a trialing subscription never contributes to MRR or churn
in either direction.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix: don't gate revenue-churn reconstruction on active/past_due status

Fix round 1 (ad86836) added a status filter requiring active/past_due
on both mrrAtDatePence and revenueChurnForMonth's "lost" filter to
exclude trialing subscriptions from revenue. But cancellation always
sets status to 'canceled' (stripe-webhook's mapSubscriptionStatus never
leaves a canceled subscription at active/past_due), so requiring
active/past_due on the "lost" side made it permanently unmatchable —
real churn would always compute as 0/null once wired to live data.

Narrow the exclusion to `status !== 'trialing'` instead, which still
keeps an in-progress trial out of MRR/churn without also excluding
every subscription that has since been canceled — the exact case this
function exists to reconstruct. Known accepted limitation: a trial
canceled without ever converting reads the same 'canceled' status as
genuine churn, since this schema has no historical status snapshot.

Added a regression test proving a status:'canceled' subscription (the
realistic post-cancellation shape) is still counted as lost revenue.

* feat: real revenue churn on the Overview growth chart

Adds monthlyChurnCounts (platformOverview.ts) plotting real cancellation
counts on the growth chart's "Churned" series, replacing demoChurnTrend.
Wires Task 1's revenueChurnForMonth into the caption below the chart as
real text ("N% of MRR lost so far this month"), and trims DEMO_SECTIONS
to drop churn now that it's real. Updates the page's own doc comment,
which still described churn as a placeholder.

* fix: drop dead demoChurnTrend and add monthlyChurnCounts test coverage

demoChurnTrend/CHURN_SHAPE (adminOverviewDemo.ts) were left unused after
churn moved to real data, and their doc comment still claimed nothing
records a churn event — false now that canceled_at drives the real
series. Deleted both rather than fix the lie in a comment for dead code.

platformOverview.test.ts had a describe block for every other exported
function except the new monthlyChurnCounts. Added one mirroring
monthlyGrowth's style, including the inclusive-start/exclusive-nextStart
boundary case monthlyGrowth already pins.

* feat: real per-row subscription facts on the Subscriptions page

* feat: real MRR on the organisation detail page

Calls subscription_mrr_pence (0023, granted to authenticated) alongside
this page's existing Promise.all data load, storing it in orgMrrPence.
The MRR StatTile now renders a real £ figure via formatMoney, or an
em-dash for an org with no billable subscription — replacing the
DEMO_ORG_MRR placeholder and its "Placeholder" hint. Storage stays a
placeholder, untouched.

Also adds a fixture for this RPC to AdminPreviewHarness (dev-only,
stripped from the production bundle): without it the manual-check route
had nothing to serve for the new call and the tile rendered garbage
instead of a real figure, defeating the point of the preview harness.

* feat: honest empty state for the MRR trend chart until 3 real months exist

Add monthsOfPaidHistory(invoices) to revenue.ts, gating the Subscriptions
page's MRR sparkline: fewer than 3 distinct months with a paid invoice
hides the chart and shows an explanatory hint instead of drawing a trend
line over mostly-empty history.

* chore: delete billing/revenue placeholders now that real data replaced them

* feat: let set_org_status accept a service_role caller

* feat: suspend an org when Stripe dunning exhausts payment retries

* fix: gate MRR/churn exclusion on actual subscription status, not canceled_at alone

canceled_at is set the moment cancellation is requested (Stripe's Customer
Portal defaults to cancel-at-period-end), weeks before it takes effect —
but mrrAtDatePence/revenueChurnForMonth (revenue.ts) and
monthlyChurnCounts (platformOverview.ts) treated any non-null canceled_at
as "revenue stopped here", so a still-active/past_due subscription with a
merely scheduled cancellation was dropped from MRR and counted as churn
early, contradicting subscription_mrr_pence() which only ever checks
status. handleSubscriptionDeleted in stripe-webhook made this worse by
overwriting canceled_at with the termination time, so a cancellation's
bucketed month silently moved again once it actually ended.

Fix: exclude/count a subscription only once its CURRENT status reads
'canceled', with canceled_at as the boundary — not on canceled_at alone.
handleSubscriptionDeleted now prefers Stripe's own canceled_at (same
mapping handleSubscriptionUpdated already uses) so the recorded date
stays stable across both handlers. Updates the doc comments (canceled_at
is not immutable-once-set) and adds/updates tests for the
scheduled-vs-actually-terminated distinction.

* fix: route Org Detail's MRR read through the service layer

AdminOrganisationDetailPage called supabase.rpc('subscription_mrr_pence')
directly — the only page bypassing src/services/, against CLAUDE.md's
"data calls in src/services" rule. Adds getOrgMrrPence(orgId) to
billingService.ts as a thin wrapper matching the file's existing
pattern, and calls that instead.

Also restores the MRR tile's "Active and past due" hint, dropped in an
earlier edit — every other MRR tile in the console carries it, and
without it £0.00 reads as a bug rather than a definition.

* fix: correct stale billing-provider claims, wire real churn onto Subscriptions

Two console pages still asserted facts this branch's own work had already
made false:

- AdminSubscriptionsPage said "Churn is not shown: nothing records the
  month an organisation left" — contradicted by this branch's own
  revenueChurnForMonth and the Overview page's real churn chart. Wires
  the same function in here too (subscriptions/planPrices were already
  loaded for the existing MRR tile, so this was cheap): a new "Churn this
  month" tile plus corrected Callout copy.
- AdminBillingPage said "No payment provider is connected" in three
  places (header comment, a disabled-button tooltip, and a Callout) —
  false since Stripe billing landed well before this branch. Corrected
  to state Stripe is connected and dunning-suspension is real, deployed
  code, while staying honest that View/Credit are disabled for a
  different reason (no Stripe-side lookup/credit call wired into the
  console yet) and that the dunning-suspension path hasn't been watched
  fire end-to-end against a real Stripe exhaustion.

* docs: correct stale claims and fill schema gaps in the billing docs

- The design spec's Stripe dashboard config step told the user to set
  the day-14 terminal action to "mark the invoice uncollectible / cancel
  the subscription (whichever Stripe calls it)" — these are two
  different, independently selectable settings, and only "Cancel the
  subscription" fires the deletion event Task 8's suspension code
  listens for. Names the required setting unambiguously.
- adminOverviewDemo.ts's header still claimed no payment provider was
  connected and there was no plan catalogue — both false since Stripe
  billing and plans landed. Rewrites it to describe what is actually
  still fabricated (Users, Support, Platform Health, etc.) rather than
  making a blanket claim about the whole file.
- docs/SCHEMA.md's subscriptions row omitted canceled_at, started_at and
  price_pence, the three columns this branch's churn/MRR reconstruction
  depends on, and nowhere documented set_org_status()'s new service_role
  exception (0051) or why stripe-webhook needs it.

* docs: fix residual stale claims from the final-review re-check

- Org Detail's Billing tab still claimed no payment provider was
  connected, contradicting its own MRR tile a few lines above.
- adminOverviewDemo.ts cited the wrong migration (0023, the plans/
  invoices prerequisite) for where Stripe billing actually landed (0050).
- platformBilling.ts's header claimed nothing computes money anywhere in
  this codebase, rather than stating its own file scope is deliberately
  period-only.
- monthlyChurnCounts's status-gating rationale had the mechanism
  backwards: the gate is what causes a past bucket to gain a count later
  (once status actually flips to canceled), not what prevents it.

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---
## `8fbcf9c` 2026-08-19 — Gideon Akinlotan

Admin-assisted organisation creation (#122)

* docs: add design spec for admin-assisted organisation creation

Lets a platform admin create an org for a direct-contact prospect: plan +
negotiated price, real owner invited via the existing invites flow, admin
never holds owner rights even briefly. Two real bootstrap conflicts found
and resolved during design, both narrow exceptions mirroring patterns
already proven in this codebase (0005/0048's org-creation RLS bootstrap):
create_invite()'s owner/manager gate, and on_org_created's unconditional
creator-becomes-owner trigger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* docs: add implementation plan for admin-assisted org creation

* feat: let a platform admin create an org with an owner invite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix: prevent trigger collision in admin_create_organisation_with_invite

The original DELETE logic collided with memberships_keep_one_owner_trigger
(0047). Instead, prevent on_org_created (0002) from firing by leaving
created_by = null; the trigger only fires when created_by is not null.
This gives a stronger guarantee: the admin never holds membership, not
even transiently.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat: add createOrganisationWithInvite to platformService

* feat: add AdminCreateOrgModal

* feat: wire admin-assisted org creation into the Organisations page

Replaces the disabled "Add organisation" button with a working flow:
opens AdminCreateOrgModal, shows a copyable invite link on success, and
refreshes the organisation list/summary tiles via the existing reloadKey.

Task 4 of 4 in the admin-assisted org creation plan.

* fix: keep the invite-link card visible during the org list's own load/error states

The card lived inside AdminOrganisationsPage's success-only ternary arm,
so handleOrgCreated's own reloadKey bump (which resets organisations to
null and re-fetches) hid the one-time invite link behind AdminLoading,
and behind AdminError indefinitely if that refetch failed. Moved it to
render as a sibling above the failed/loading/empty/success conditional
so it survives regardless of what the list is doing.

Also adds an 'rpc/admin_create_organisation_with_invite' fixture to
AdminPreviewHarness so /admin-preview/organisations can drive the
create-org success path end to end (migration 0051's RPC isn't live
everywhere yet), matching the existing rpc/* fixture pattern.

* fix: close create_invite()'s bootstrap gate to platform_owner/platform_admin only

create_invite()'s two bootstrap-exception branches gated on
is_platform_admin(), which is true for ANY unrevoked platform_admins row
regardless of role (platform_support and platform_finance included), not
just the platform_owner/platform_admin set that
admin_create_organisation_with_invite itself gates on.

Because create_invite is grant execute to authenticated and unchanged
since 0006, any platform_support/platform_finance account could call it
directly with any org_id, find a memberless org (RLS already lets
is_platform_admin() see everything), invite themselves as 'owner', and
accept to become a permanent real owner of that tenant — bypassing 0028's
entire support-access session gate.

Narrow both gates to has_platform_role(['platform_owner','platform_admin'])
to match the new RPC's own gate exactly. Strictly narrowing: every
legitimate caller (the RPC itself) is unaffected.

* fix: re-issue path, audit trail, and validation gaps in admin-assisted org creation

Fixes surviving from whole-branch review of the admin-assisted
organisation creation feature (0051):

- AdminOrganisationDetailPage: the "no owner" branch (an org stranded
  because its owner invite expired or was never accepted) now offers an
  inline re-invite form — email input + button calling createInvite(),
  showing the resulting link the same way AdminOrganisationsPage does.
  Previously there was no UI path to recover a memberless org.

- admin_create_organisation_with_invite: writes an audit_write() call
  after the subscription insert recording which platform admin created
  the org and at what negotiated price — organisations_audit is
  UPDATE-only and subscriptions has no audit trigger, so nothing else
  recorded this.

- admin_create_organisation_with_invite: plan validity is now checked
  against the live plans table instead of a hardcoded list of 4 codes,
  so a 5th plan added later doesn't become selectable in the UI and then
  rejected by the RPC.

- admin_create_organisation_with_invite: populates organisations.contact_email
  from the owner's email on insert, so the org has a real contact on file
  from creation rather than only after the invite is accepted.

- AdminCreateOrgModal: a duplicate-slug conflict (Postgres 23505) now
  surfaces as "That slug is already taken. Try a different one." instead
  of the raw constraint-violation string, matching the existing
  err.code === '23505' pattern used in OnboardingPage/RotaBuilderPage.

- AdminCreateOrgModal: negotiated price is now capped at £1,000,000/month
  client-side, so an absurd value (e.g. pounds/pence confusion) doesn't
  overflow Postgres integer and surface as a raw range error.

* fix: correct audit visibility value, gate and scope the re-invite affordance

- audit_write's visibility argument was 'platform' — not a real value
  (only 'org'/'platform_only'/'both' exist, per 0016/0032's CHECK
  constraint). This broke admin_create_organisation_with_invite
  unconditionally: the constraint violation would abort the whole
  transaction on every call, discovered only at first live use.
  Corrected to 'platform_only' (the negotiated price is commercially
  sensitive, not customer-facing).
- The re-invite form on AdminOrganisationDetailPage rendered for any org
  missing an owner, but create_invite's bootstrap only admits a genuinely
  memberless org (zero total members, not just zero owners) — an org
  with staff but no owner would always fail with a confusing 42501.
  Split into three states: zero members (the form), owner-missing but
  other members present (point at the Users tab instead), and
  owner-missing with no platform_owner/platform_admin role (a plain
  message, no dead-end button for roles the server will reject).
- Corrected the success copy — nothing is emailed, only a link is
  created for the admin to copy and send themselves, matching the
  equivalent copy already used on AdminOrganisationsPage.

* chore: renumber migration to 0052 after 0051 landed via #121

* chore: regenerate database.types.ts after migrations 0051/0052 landed live

Closes the documented, anticipated typecheck/lint gap from Task 2
onward — admin_create_organisation_with_invite is now in the generated
RPC union. Also fixes one real mismatch the regeneration surfaced:
p_price_pence's generated arg type is number | undefined (matching its
SQL default), not number | null — functionally identical at the SQL
layer (the default is null either way), just a TS-level correction.

---------

Co-authored-by: devgeereact <292055051+devgeereact@users.noreply.github.com>
Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
---