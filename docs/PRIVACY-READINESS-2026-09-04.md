# Privacy and legal readiness — 4 September 2026

A dated snapshot of one project, RotaFlow. `docs/SAAS.md` is what stays current;
this records what an audit found on one day and what was changed in response.
The evidence behind it is `docs/PRIVACY-DATA-MAP.md`.

**Nothing here is legal advice, and nothing here says RotaFlow is compliant.**

---

## Summary

The repository was further along than a legal audit usually finds. Five legal
routes already existed, linked from the footer, in the sitemap, covered by
Playwright and axe, and three of them were written from the code with each
claim citing the file that proved it. That is unusual and it is the reason this
pass could be about accuracy rather than about starting.

Two things were nonetheless false in public, and one important thing was
missing.

**The published cookie and privacy pages said there was no tracking while the
app ran session replay.** `src/lib/sentry.ts` configured
`browserTracingIntegration()` at a 20% sample and `replayIntegration()` at
`replaysOnErrorSampleRate: 1.0`, started from `src/main.tsx` before the first
render, on every route — including the two pages making the claim. No consent
was asked for. This was not a wording problem: the product did something its
own notice denied.

**A bare "GDPR compliant" badge sat on `/login` and `/signup`** and inside the
signup funnel — the exact claim `src/lib/marketing.ts` records as having been
deleted from the adjacent feature list for being unverifiable, under a rule
`docs/BRAND.md` states outright.

**Nobody creating an account was ever shown a notice.** Sign-up, invitation
acceptance and the contact form carried no link to either document, and a
signed-in member of staff — the person the notice is actually about — had no
route to `/legal/*` from inside the app at all.

| | |
| --- | --- |
| Projects inspected | 1 (RotaFlow) |
| P0 | 0 |
| P1 | 5 — 4 fixed, 1 owner-blocked |
| P2 | 7 — 5 fixed, 2 recorded |
| P3 | 2 — both fixed |
| Documents created | Privacy Notice (draft), Terms of Service (draft), this report, the data map |
| Documents corrected | Cookie Notice, Trust page, sub-processor register |
| Code changed | 29 files |
| Tests added | 32 (13 unit on Sentry, 19 unit on consent) + 18 e2e |
| Owner decisions outstanding | 9 |
| Legal questions outstanding | 11 |

**Readiness: NOT READY — MATERIAL PRIVACY GAPS REMAIN.**

Not because of the code. The technical work is done and verified. It is because
the operator is not registered with the ICO, publishes no postal address, has
no answer on an EU representative, and no lawful basis in the notice has been
confirmed by anybody qualified. A notice cannot be published as final in that
state, and this document will not pretend otherwise.

---

## Issues

### P1

**P1-1 — Session replay and performance tracing ran without consent, contrary to the published notice.** *Fixed.*
`src/lib/sentry.ts:14-19`, started at `src/main.tsx:9`. Contradicted
`src/pages/legal/CookiesPage.tsx:29` and `src/lib/legalFacts.ts:123`. Tracing
URLs carry organisation and staff ids; replay uploads a masked DOM recording,
buffered before the error that sends it. Both integrations removed; crash
reporting gated on consent. Verified against a production build: no request
before consent, and no `replay_event` in the envelope after it. Recorded as
BUG-068.

**P1-2 — Unverifiable compliance claim on two conversion surfaces.** *Fixed.*
`AuthTrustStrip.tsx:5`, `StepChoosePlan.tsx:184`. Replaced with two checkable
facts. Recorded as BUG-069.

**P1-3 — No privacy information at any collection point.** *Fixed.*
Sign-up, invitation acceptance, the contact form, the clock-in pane, emergency
contacts, documents and both AI surfaces now carry a notice at the point of
collection, and the Help page carries the legal links so a signed-in person can
reach them.

**P1-4 — The privacy notice was a six-question summary.** *Fixed.*
No operator, no lawful basis, no rights procedure, no regulator, no effective
date, no mention of special-category data or of the third parties whose details
the product holds. Replaced with a full draft that cites its evidence and marks
what it cannot settle.

**P1-5 — No ICO registration, no published address, no answer on an EU representative.** *Not fixed — owner.*
Recorded as GAP-059. Blocks publication of the notice.

### P2

| | Issue | Status |
| --- | --- | --- |
| P2-1 | Sub-processor row for Sentry wrong in both directions — claimed a user id never sent (`Sentry.setUser` is never called), omitted replay and tracing | Fixed |
| P2-2 | Two storage keys undeclared: the onboarding draft holding an org name and site postal address, and the install-prompt snooze | Fixed |
| P2-3 | Query strings reaching Sentry in `event.request.url` — the field a reset token rides in on | Fixed (BUG-070) |
| P2-4 | SEO description claimed "built to WCAG 2 AA" where the page itself claims only to aim at it | Fixed |
| P2-5 | Cloudflare row read `outsideUkEu: false` beside a region saying "global edge network" | Fixed — reasoning written down, disclosed in prose rather than mis-grouped |
| P2-6 | Uploaded files survive erasure and organisation deletion | Recorded (GAP-056), disclosed, not fixable here |
| P2-7 | No self-service subject access or account deletion for an individual | Recorded (GAP-057), disclosed |

### P3

`docs/SCHEMA.md` said `notification_deliveries` had no retention policy a week
after `0092` gave it twelve months — fixed. `src/pages/legal/LegalNotice.tsx`
became unreferenced once Terms had content — removed.

### Found and recorded, not in scope for this pass

GAP-058 (emergency contacts and Article 14), GAP-060 (no age field in a product
scheduling 16- and 17-year-olds), the legacy offline-outbox rows without a
`userId` (`src/services/syncQueue.ts:211`), and no `List-Unsubscribe` on
outbound mail — defensible today because every message is transactional.

---

## What was built

**Consent.** Three categories: `necessary` (session, active org, onboarding
draft, offline outbox, the consent record itself), `preferences` (four
interface settings), `diagnostics` (crash reporting). Accept and reject are the
same component at the same size in the same row — asserted by a test that
compares their class names and heights, because that is the property regulators
name first. Nothing starts selected. The banner does not overlay or trap focus,
because the gate is in the write path (`isAllowed`), not in the interface: an
undecided visitor is untouched whether or not they answer. Reopen from the
footer or from account preferences. `CONSENT_VERSION` re-asks when the
categories change. Absent, corrupt, stale or unreadable all read as "nothing
allowed".

Withdrawing `preferences` deletes the keys it had already written, including
the per-organisation report keys found by prefix. A withdrawal that only stops
the next write is not a withdrawal.

**Documents.** A full Privacy Notice in `src/lib/privacyNotice.ts`, and a Terms
of Service draft in `src/lib/termsDraft.ts`, both rendered by a shared
`NoticeSections` component that puts each unresolved section's warning *in
place* rather than in an appendix. A notice that quietly omits the question of
its own lawful basis reads as finished; one that says "this paragraph needs a
solicitor, and here is why" tells the reader what they are holding.

The Terms draft is banded in a danger callout and describes the two thirds that
are facts about a working system — eligibility, roles, acceptable use, the
plans and their real prices, Stripe checkout, the fourteen-day grace window,
what deleting an organisation actually does. Liability and governing law are
deliberately empty and say what has to be decided.

---

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (`--max-warnings 0`) |
| `npm run format:check` | PASS |
| `npm test` | PASS — 873 unit tests, 49 files |
| `npm run build` | PASS |
| `npm run check:bundle` | PASS — 16% headroom, no DEV page shipped |
| `npm run check:docs` | PASS — 113 capability rows match the table |
| `npm run check:export` | PASS — 40 tenant tables, 12 person-keyed tables accounted for |
| `npm run check:migrations` | PASS — no new migrations |
| `npx playwright test e2e/consent.spec.ts` | PASS — 16/16 |
| `npx playwright test e2e/marketing.spec.ts e2e/app-surface.spec.ts` | PASS — 80/80, including axe on all five legal pages and 0 contrast violations on the authenticated surface |
| Runtime consent gate, production build | PASS — 9/9 (see below) |
| `supabase test db` (pgTAP) | **NOT TESTED** — needs Docker, unavailable here. No migration was written, so no RLS surface changed |
| Real Sentry endpoint | **NOT TESTED** — no DSN in this working tree; probed with a DSN pointing at a non-resolving host, which proves the gate, not the vendor |

### The runtime probe, and why it mattered

The unit tests assert the Sentry options contain no replay and no tracing. The
e2e suite asserts the banner behaves. **Neither can see what leaves the
browser**, because Sentry only runs when `import.meta.env.PROD` is true and
Playwright runs against `npm run dev`.

So: a production build with `VITE_SENTRY_DSN` pointing at
`consent-probe.invalid` (a TLD RFC 2606 guarantees cannot resolve), served by
`vite preview`, with every request to that host recorded.

- Undecided: no request, and `localStorage` empty.
- Rejected: no request, and `localStorage` holds only `rotaflow:consent`.
- Accepted: Sentry is contacted.
- The envelope: no `replay_event`, no `"type":"transaction"`, no console
  breadcrumb.

**And, on the first run, the full query string.** Breadcrumb scrubbing was in
place and the unit tests were green, but Sentry fills `event.request.url` from
`window.location.href` and never routes it through `beforeBreadcrumb` — so
`?secret=…` arrived intact, in the field a password-reset or magic-link token
would ride in on. Fixed with `beforeSend`, re-probed, 9/9.

That is the finding worth carrying forward: **a test that asserts a hook was
configured proves nothing about what is transmitted.**

### And the same lesson again, from the other direction

The first push of this work failed CI on `e2e-authenticated` — the one job that
cannot run on this machine, because it needs Docker. The banner is
`fixed bottom-0`, and on the onboarding step the Continue button sits at the
foot of the viewport, so the banner **intercepted the click**: Playwright
retried 231 times and gave up. A real visitor would have found the button
simply dead.

Sixteen consent tests passed while that was true. Every one of them clicked the
banner itself or something near the top of a page, so none could see it — the
defect is not in the banner, it is in what the banner covers. "Does not block
the page" had been written into the component's own doc comment and was true of
focus and false of pointers.

Fixed by having the banner measure itself into a `--consent-inset` custom
property that `body` and the app shell's scroll area pad by, so nothing is ever
underneath it and the space is given back the moment the question is answered.
Two regression tests added, and **both were confirmed to fail with the fix
reverted** — a regression test nobody has watched fail is a guess.

---

## Owner decisions and legal questions

Listed in full in `docs/PRIVACY-DATA-MAP.md` §8 and §9. The blocking ones:

1. Register with the ICO, or record why registration is not required.
2. Decide the postal address position, and confirm an email address alone is
   enough under Article 13.
3. Answer the EU Article 27 representative question.
4. Have a solicitor confirm every lawful basis, the Article 9 condition for
   health data, and the transfer mechanism for Stripe and OpenRouter.
5. Settle the commercial terms marked in `src/lib/termsDraft.ts`.
6. Decide what happens to uploaded files on erasure (GAP-056).

---

## Before publication

- [ ] ICO registration settled, number added or absence justified
- [ ] Operator identity and contact route confirmed
- [ ] EU representative question answered
- [ ] Every lawful basis confirmed by counsel
- [ ] Article 9 condition confirmed
- [ ] Transfer mechanism in place for both US processors
- [ ] Retention periods justified, indefinite audit retention defended or shortened
- [ ] PECR classification of the four interface preferences confirmed
- [ ] Commercial terms decided, liability and governing law drafted
- [ ] GAP-056 closed or permanently disclosed
- [ ] `LICENSE` given a copyright holder
- [ ] `docs/SAAS.md` GAP-036 addressed — the backup and auth-config workflows have never once succeeded, so there is still no backup of production
- [ ] `supabase test db` run somewhere with Docker before merging

**Readiness: NOT READY — MATERIAL PRIVACY GAPS REMAIN.** The technical work is
complete and verified; the gaps are the operator's and counsel's.
