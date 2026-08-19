# RotaFlow Product Transformation Plan v2

**Status:** Living plan — 13 August 2026 — APPROVED
**Supersedes:** `docs/PRODUCT_TRANSFORMATION_PLAN.md` (13 Aug 2026, "Proposed"). That
doc is preserved as the original strategic rationale; this doc re-scores status against
the current codebase and resequences the roadmap. Positioning, brand and feature
disposition sections are carried forward unchanged (Premise 3, confirmed) — see
sections 5-7 there, not duplicated here.
**Scope:** What actually shipped since the original plan, what remains genuinely open,
and the corrected priority order — production safety before further redesign.

## 1. Executive assessment (updated)

The original plan scored overall maturity 7/10 and listed five P0 items as required
before an externally recruited beta. In the time since, most of P0 shipped:

| Original P0 item | Status now | Evidence |
| --- | --- | --- |
| Publish legal trust pages | **Done** | `src/pages/legal/{PrivacyPage,TermsPage,CookiesPage,AccessibilityPage}.tsx` routed in `App.tsx`, sharing a `LegalNotice` template component (`5b4008c`) |
| Remove/disclose illustrative admin-console metrics | **Done** | `6bf4ae6` |
| Close launch-operational gaps (support mailbox, error alerts, incident response) | **Partial** | In-app feedback capture shipped and a live support-case outage found+fixed during verification (`014889f`); Sentry release convention added (`a5f6eb5`); no evidence of a rehearsed incident-response runbook |
| Run an RLS/destructive-action review on deployed Supabase | **Not done** | No audit artifact found; memory records zero backups in production (`pitr_enabled: false`, `backups: []`), flagged but not actioned |
| Test the critical loop on real mobile devices | **Not done** | No real-device UAT evidence; Playwright/axe E2E suite exists (`4695a3e`) but that is automated desktop-browser coverage, not real-device offline/keyboard/screen-reader testing |

Also shipped beyond the original P0/P1 list: CI with typecheck/lint/tests/build/E2E/axe
gates, event taxonomy published (`docs/OBSERVABILITY.md`, `f3edbe1`), AI assistant
audit logging with prompt versioning (`70d8a56`), seed dataset rebuilt to v3 with two
real bugs fixed (`5b5ccb7`), and two live incident sequence-collision bugs found and
fixed by systematically checking for the same class of bug twice (`support-case
outage`, `77ca540`).

**Corrected overall maturity: 7.5/10.** Like the original plan's 7/10, this is a
holistic judgment, not a strict average of the section 2 table (which averages
closer to 7.1) — the security correction is weighted more heavily than a flat
mean would suggest, because a production database with zero backups is a
release-blocking gap regardless of how many other areas improved. The delta
from 7/10 is documentation and trust-surface completeness, not production
safety — which is why this plan reorders
the roadmap rather than just raising the score.

## 2. What changed since the original plan (score deltas)

| Area | Original | Now | Why |
| --- | --- | --- | --- |
| Legal/compliance | 5/10 | 8/10 | All five trust pages shipped and routed; UK counsel review of content still outstanding |
| Documentation | 8/10 | 9/10 | Event taxonomy, data lifecycle doc, and this plan itself added |
| Developer experience | 7/10 | 8/10 | CI gate + Playwright/axe E2E suite closed the biggest gap the original plan named |
| AI readiness | 6/10 | 7/10 | Audit logging and prompt versioning shipped; evaluation set and disclosure copy still open |
| **Security** | 8/10 | **6/10** | Score corrected downward: zero production backups (`pitr_enabled:false`) is a maturity-blocking gap the original plan under-weighted relative to its own P0 list |
| Business model | 4/10 | 4/10 | Unchanged — `billingService.ts` reads real `invoices`/`plans` tables for admin reporting, but no self-serve checkout or entitlement enforcement exists |

All other areas (UX, UI, Architecture, Performance, Accessibility, Scalability) are
unchanged from the original scorecard — no evidence surfaced that would move them.

## 3. Corrected priority order (Premise 2)

The original plan sequenced Phase 0 as brand foundation and Phase 1 as beta trust.
Given the confirmed gap above, **production safety now leads, ahead of any further
redesign or brand rollout work**:

### New Phase 0 — Production safety (was buried inside old Phase 1)

1. **Enable Supabase point-in-time recovery / scheduled backups, and complete one
   test restore.** Currently `pitr_enabled: false`, `backups: []` in production.
   Enabling the toggle is a billing decision on the Supabase project tier, not a
   code change — flag to the account owner explicitly, don't silently defer it
   again. A backup that has never been restored from is unverified, not a safety
   net: this item is not done until one test restore has actually been run.
2. **Run and document an RLS + destructive-action review** against the deployed
   project: verify every role x org boundary with a fixture-account matrix, review
   Edge Function secrets, audit-row coverage, and support-access expiry. CORS
   is already partially hardened (`4695a3e` scoped it off wildcard to the production
   domain) — verify the remaining Edge Functions inherited that fix rather than
   re-auditing from scratch. Owner: Gideon. Produce a dated checklist artifact
   (not just a verbal pass) before this item is marked done.

   _Correction (eng review): an earlier draft of this item re-opened the
   migration-0021/`incident_events` schema discrepancy as unresolved work. That
   discrepancy was already investigated and closed on 2026-08-06 in commit
   `81eb6f7` (PR #101) via migrations `0028_support_access_gate.sql` and
   `0033_remove_parallel_incidents.sql` — a stale memory note, now corrected._
3. **Real-device mobile/offline UAT — the actual schedule-risk item in this phase.**
   Unlike items 1-2 (one person, desk-based, days), this needs physical iOS/Android
   hardware, real staff walking the flow, and separate keyboard-only/screen-reader
   passes — track it on its own timeline, not as an equal-weight bullet. Flow: sign
   up → org setup → invite → publish → staff sees rota → no-signal clock-in →
   reconnect → timesheet correction. The Playwright/axe suite covers desktop-browser
   regressions; it does not substitute for this.

### Phase 0.4 — Recurring drift-check (new, from CEO review)

4. **Set up a weekly plan-drift audit as a GitHub Actions cron job**, following
   the existing proven pattern in `.github/workflows/codeql.yml`
   (`schedule: cron: '17 4 * * 1'`) — git-tracked and not dependent on any one
   session/account's tooling surviving unattended for weeks, which is why this
   superseded an earlier draft that proposed the session-local `/schedule`
   cloud-agent feature instead (cross-model tension resolved in favor of the
   git-tracked mechanism). Owner: Gideon. The audit itself is a repeatable
   prompt (git log + Read + Grep against this doc's claims, the exact method
   used this session), not new custom tooling:

- **Cadence:** weekly, re-auditing this doc's claims against `git log` and the
  live codebase, same method used in section 1-2 above.
- **Output:** appended to this doc as a dated entry, not a separate artifact.
- **On failure to run:** append a `FAILED` marker for that week instead of
  staying silent — a missed run must be as visible as a completed one.
- **Monitor the monitor:** if no entry (success or FAILED) appears for 10+
  days, that silence is itself a flagged condition — a stopped scheduler must
  not look identical to "no drift found."
- **Commit mechanism:** opens a PR, never pushes straight to `main` — an
  unreviewed automated writer to `main` is the same class of risk this
  project's git safety conventions exist to prevent, even for a doc-only
  change. Gideon reviews and merges it as part of the same weekly check-in —
  no pile-up, no rubber-stamping on a separate cadence.
- **On finding real drift:** in addition to the weekly append, surface it at
  the start of the next session (memory system) rather than relying on
  someone re-opening this file — a passive file-only append is the exact
  pattern that let the original plan drift unnoticed.

### Phase 1 — Beta trust (mostly done, close the remainder)

- UK counsel sign-off on the four published legal pages — Privacy, Terms,
  Cookies, Accessibility (content review, not implementation).
- **Correction (review pass): a plain-language AI notice was never built.**
  The original plan's P0 list named five legal-page categories (Privacy,
  Terms, Cookie, AI transparency, Accessibility); only four exist in
  `src/pages/legal/`. This is a genuinely open gap, not a done item — add it
  to the counsel sign-off batch above.
- Rehearsed incident-response runbook and confirmed mailbox/alert ownership.
- Everything else in the original Phase 1 is shipped.

### Phases 2-6

Unchanged from the original plan (`docs/PRODUCT_TRANSFORMATION_PLAN.md` sections 6-10)
— core-loop polish, measurement/hardening, design-partner beta, commercial V1,
expansion. Do not start Phase 2 UX work (the design-consultation/shotgun/html skills
queued in this session) as a substitute for closing new Phase 0; run them in parallel
at most, never instead of.

#### Phase 2 navigation structure (design-review, restated here so V2 stands alone)

```text
Today
  Dashboard (role-specific "next best action" card, not a metrics grid)
Plan work
  Rota Builder [manager] · Schedule · Team [manager] · Locations [manager]
Run the shift
  Clock In · Availability · Leave · Shift Swaps · Overtime
Review
  Timesheets · Reports [manager] · Announcements
Manage
  Settings [manager] · My account · Help & support
```

Mobile: `Today, Schedule, Clock in, Requests, More` — not the desktop rail
verbatim (`Requests` folds Leave/Swaps/Overtime; `More` folds Review/Manage).
Full rationale in the original doc's section 6.

The "next best action" dashboard card should reuse existing Card primitives
rather than introduce a new component — verify against the current component
inventory at implementation time rather than assuming one exists yet.

**Empty state (design-review):** when there is no next action, the card shows
a calm caught-up confirmation — not a blank card, not a generic "Nothing to
do." Empty states are features (Design Principles), and this one recurs
often in a well-run org, so it isn't a rare edge case to skip.

Onboarding checklist steps are intentionally not specified here — the
original plan's own P1 item 1 already calls for deferring optional
configuration until after onboarding research; drafting steps now would
guess ahead of that research.

**Phase 2 exit criteria addition (design-review):** touch target sizing
(44px min), keyboard nav pattern for the regrouped rail, and ARIA landmarks
for the dashboard card are implementation-level detail deferred from this
roadmap doc, but are required before Phase 2 is marked done — gated by the
existing Playwright/axe CI suite, not restated here as a separate spec.

## 4. Premises (confirmed this session)

1. The plan was stale on status, not strategy — P0 items shipped since 13 Aug outrun
   the doc's own checklist. **Agreed.**
2. Production safety (backups, RLS review, mobile UAT) is the genuinely open P0 gap
   and now leads the roadmap, ahead of redesign work. **Agreed.**
3. Core positioning — UK multi-site shift-based teams, offline-first reliability,
   RotaFlow name retained — holds with no pivot needed. **Agreed.**

## 5. Approaches considered (for this rewrite)

- **A — Full rewrite (chosen).** This document. Re-scores maturity, folds in shipped
  work, resequences the roadmap, and is the target fed to `/plan-ceo-review`,
  `/plan-eng-review`, `/plan-design-review`.
- **B — Patch original doc in place.** Rejected: the original doc's own framing
  ("Proposed... not yet ready") would stay misleading against a codebase where most of
  its P0 list is done.
- **C — No written plan; let review-skill outputs be the plan.** Rejected: would have
  the three review skills critique a doc already agreed to be stale.

## 6. Open questions

- Is enabling Supabase PITR a billing approval only the account owner (Gideon) can
  make, or is there a self-service tier upgrade path? (Affects whether new Phase 0.1
  is a one-click fix or needs a purchase decision.) Owner: Gideon — resolve before
  Phase 0 is marked closed.
- Does `billingService.ts`'s real invoice/plan read mean billing is closer to
  self-serve-ready than the original "4/10, no live billing" score implied, or is it
  admin-reporting-only over manually-entered rows? Owner: Gideon — resolve before
  Phase 5 (Commercial V1) scoping starts.

## 7. Implementation Tasks

Synthesized from `/plan-ceo-review` (HOLD SCOPE mode). Each task derives from a
specific finding above. Run with Claude Code; checkbox as you ship.

- [ ] **T1 (P1, human: ~30 min / CC: ~10 min)** — supabase — Enable PITR and run one test restore
  - Surfaced by: outside-voice review — PITR toggle alone is unverified without a restore exercise
  - Files: `docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md`
  - Verify: a documented successful restore of a test snapshot
- [ ] **T2 (P1, human: ~1-2 days / CC: ~30 min)** — supabase — RLS/destructive-action review (role x org fixture matrix, Edge Function secrets, audit-row coverage, support-access expiry)
  - Surfaced by: CEO review Section 2 (Error & Rescue) — scope needed to be explicit, not a verbal pass
  - Files: `docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md`
  - Verify: dated checklist artifact covering every listed boundary
  - _Correction: the migration-0021/`incident_events` verification originally listed here was already
    resolved on 2026-08-06 (commit `81eb6f7`, PR #101) — removed, see eng-review outside-voice finding 1_
- [ ] **T3 (P1, human: ~2-3 days / CC: ~1 day, coordination-bound)** — mobile-qa — Real-device iOS/Android offline/keyboard/screen-reader UAT
  - Surfaced by: outside-voice review — bundled with desk-only items, hides the real schedule risk
  - Files: `docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md`
  - Verify: sign up → publish → no-signal clock-in → reconnect → correction, completed on real hardware
- [ ] **T4 (P1, human: ~1-2 hrs / CC: ~20 min)** — tooling — Set up weekly plan-drift audit as a GitHub Actions cron job
  - Surfaced by: CEO review Section 2/3/8 findings; eng-review outside-voice finding 2 (cross-model
    tension — an earlier draft proposed `/schedule`, a session-tied mechanism with no stated PR
    credential; resolved in favor of the git-tracked `.github/workflows/codeql.yml` pattern) plus
    findings 3-4 (monitor-the-monitor staleness check, weekly merge cadence)
  - Files: `.github/workflows/`, `docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md`
  - Verify: scheduled job configured, PR-based commit, `FAILED` marker on a missed run, 10-day
    staleness alarm, weekly merge by Gideon, drift surfaced at next session start

_No new tasks from Sections 1, 4, 5, 6, 7, 9, 10 — no code introduced by this
planning document; Section 11 skipped, no UI scope._

## 8. Sequencing rule

Production safety (new Phase 0) is a strict prerequisite, not a parallel track: do not
treat further redesign or brand-rollout work as equivalent priority to closing Phase 0.
The single highest-severity item is Supabase PITR/backups — it is a billing decision,
not engineering work, and has no dependency on anything else in this plan.

## Drift Audit Log

Written by `.github/workflows/plan-drift-audit.yml` (weekly). Each entry starts
`**YYYY-MM-DD**:` on its own line — required for the workflow's own staleness
check to parse the log.

**2026-08-13**: Seeded at creation. No automated audit has run yet — the
workflow needs an `ANTHROPIC_API_KEY` repository secret before its first
scheduled or manually-dispatched run can execute.
