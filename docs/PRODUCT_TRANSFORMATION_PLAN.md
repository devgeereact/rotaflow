# RotaFlow Product Transformation Plan

**Status:** Proposed implementation plan — 13 August 2026  
**Scope:** Product, brand, UX/UI, technical readiness and launch gaps. This is an
evidence-based plan, not permission to expand V1 indiscriminately.

## 1. Executive assessment

RotaFlow has a credible core: a tenant-isolated, offline-first workforce
scheduling PWA with a coherent manager and staff workflow. The technical
foundation is substantially ahead of its commercial readiness: 47 additive
migrations, RLS-scoped services, an offline write outbox, a guarded AI drafting
function, a documented design system and passing quality gates.

The product should **not** be repositioned as a generic enterprise workforce
suite. It should win a narrower initial category: UK multi-site, shift-based
teams whose work cannot pause when signal quality is unreliable. The durable
differentiator is dependable operational continuity, not unsubstantiated AI or
“all-in-one” claims.

The current name is worth retaining. **RotaFlow** is clear to the UK market,
easy to pronounce and already embodied in the product mark, PWA identity,
domain and code. The required rebrand is a focused positioning and system
rollout, not a costly rename.

## 2. Product scorecard

| Area                 |    Score | Assessment                                                                                                                                                                                                               |
| -------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UX                   |     7/10 | The core manager/staff journeys and role-specific navigation are strong. The app has too many top-level operational destinations for daily use and lacks validated customer research.                                    |
| UI                   |     7/10 | A coherent light-first token system, reusable primitives and an excellent rota-grid direction exist. Consistency debt remains in older arbitrary typography/radius/alpha usages.                                         |
| Architecture         |     8/10 | Static PWA + Supabase + managed services fits the deployment reality well. The service boundary and organisation context are clear.                                                                                      |
| Performance          |     7/10 | Route splitting and PWA caching exist; production build is healthy. Baseline field Web Vitals and real-device offline performance have not been measured.                                                                |
| Accessibility        |     7/10 | Semantic components, focus management, keyboard paths and colour-plus-text status states are deliberate. No automated axe suite, keyboard E2E suite or user testing evidence exists.                                     |
| Security             |     8/10 | RLS, CSP, source-map protection, audited sensitive actions and caller-JWT AI access are very good foundations. Independent RLS/security testing and operational secret rotation remain gaps.                             |
| Scalability          |     7/10 | Multi-tenancy and data isolation are sound. Query performance, load envelopes, retention and operational monitoring need real production validation.                                                                     |
| Developer experience |     7/10 | Strict TypeScript, linting, tests and unusually strong written architecture are in place. CI/CD enforcement, component documentation and E2E tests should mature next.                                                   |
| AI readiness         |     6/10 | AI is correctly constrained to assisted drafting with deterministic checks and human approval. It needs evaluations, prompt/version observability and explicit user disclosure before being a commercial differentiator. |
| Brand                |     7/10 | The new platform in `docs/BRAND.md` is specific, defensible and well matched to the product. It now needs visual, copy and lifecycle consistency across every customer touchpoint.                                       |
| Business model       |     4/10 | Pricing concepts exist, but live billing, entitlement strategy, support operations and pricing validation do not. Treat the beta as a learning instrument, not a final revenue system.                                   |
| Documentation        |     8/10 | Architecture, schema, hooks, design, deployment, PRD and brand guidance are unusually complete. Customer documentation, policy pages and a single launch runbook are missing.                                            |
| Legal/compliance     |     5/10 | GDPR-oriented data controls and audit records exist, but public Privacy, Terms, Cookie, AI transparency, accessibility and processor documentation are absent.                                                           |
| **Overall maturity** | **7/10** | Suitable for a controlled design-partner beta after the P0 and P1 actions below; not yet ready for broad enterprise claims or paid self-service.                                                                         |

## 3. What to preserve

- The offline-first attendance queue and clear synced/failed-write feedback.
- Tenant scoping by `org_id` plus RLS, rather than client-side role checks.
- The split between Rota Builder (create) and Schedule (consume).
- Manager review before publishing, and manager review before AI suggestions are applied.
- The calm, light-first interface; Inter + JetBrains Mono; Lucide iconography;
  semantic shift/status colours; and the existing BrandMark.
- Truthful public-copy guardrails: no invented customers, metrics, logos,
  testimonials, savings, uptime or compliance guarantees.

## 4. Critical gaps and decisions

### P0 — required before an externally recruited beta

1. **Publish legal trust pages and link them everywhere.** Add Privacy Notice,
   Terms of Service, Cookie Notice/consent implementation where required,
   acceptable-use policy, data-processing agreement path, subprocessor list,
   accessibility statement and a plain-language AI notice. Have UK counsel
   validate the final material; this is not legal advice.
2. **Close launch-operational gaps.** Confirm ownership and monitoring of the
   contact mailbox, error alerts, failed-offline-write recovery, backup/restore,
   incident response and support escalation. Test each with a real non-developer
   account.
3. **Remove or disclose all illustrative metrics in customer-visible spaces.**
   Platform-console rows called out as placeholder/demo must never be presented
   as production intelligence. Either build the data source or retain the
   disclosure and restrict the console to internal preview use.
4. **Run an RLS and destructive-action review on the deployed Supabase project.**
   Verify each role and tenant boundary with fixture accounts; review Edge
   Function secrets, CORS, audit rows and support-access expiry.
5. **Test the critical loop on real mobile devices.** Sign up → organisation
   setup → invite → publish → staff sees rota → no-signal clock-in → reconnect
   → timesheet correction. Test keyboard-only and screen reader behaviour.

### P1 — first beta learning cycle

1. Recruit 5–8 design partners from one primary wedge, recommended: care and
   healthcare providers with 20–250 shift workers and multiple sites.
2. Instrument the funnel, workflow events and reliability outcomes before
   optimising the dashboard or expanding reports.
3. Establish product support, help centre content, release notes and in-app
   feedback capture.
4. Convert the most-used design patterns into documented primitives; remove
   residual non-token class values as components are touched.
5. Add automated accessibility checks, Playwright critical-path tests, CI gates,
   a Sentry release/version convention and a production performance budget.

### Decisions that must precede development

- Select the initial vertical and buyer: care/home-care operations manager is
  recommended, while hospitality/retail remain compatible secondary messages.
- Define beta commercial terms: free design-partner beta versus paid pilot,
  support hours, data-retention/deletion commitments and eligibility.
- Decide whether the platform console is an internal operations tool or a
  customer-facing enterprise promise. It cannot be both while key metrics are
  illustrative.
- Obtain written legal approval for any statement about Working Time Regulations,
  GPS location, qualifications, medical notes or “compliance”.

## 5. Brand platform

### Positioning

**RotaFlow is the offline-first workforce scheduling platform for UK
shift-based organisations that need dependable cover across sites, teams and
shift patterns.**

Tagline: **Scheduling certainty for every shift.**

Value proposition: Build rotas with fewer surprises, keep staff informed, and
retain a dependable record of attendance—even when signal drops.

### Message hierarchy

| Audience         | Problem                                                  | Message                                                                            | CTA                   |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| Operations owner | Constant rework, cover gaps and fragmented communication | Plan, publish and supervise work from one dependable operational record.           | Join the beta         |
| Rota manager     | Last-minute gaps and manual checking                     | See conflicts, leave, availability and rest gaps before publishing.                | Build your first rota |
| Frontline staff  | Unclear, changing shifts and poor connectivity           | See your work, request changes and record attendance from your phone—even offline. | View your schedule    |

AI message: **“AI helps you draft; managers stay in control.”** It must never be
described as autonomous scheduling, legal/compliance judgement, or a guarantee
of a correct schedule.

### Voice

Clear, calm, practical and accountable. Use UK workforce terms: rota, shift,
cover, site, team, manager and staff. Lead with an operational outcome; use
short, specific language. Avoid hype (“revolutionary”, “seamless”), false social
proof and ambiguous “smart” claims.

### Visual identity

Keep the existing blue/navey/neutral, light-first system and the single
`BrandMark`. Do not introduce a replacement logo or raw colours. Make the
identity distinctive through an operational visual grammar:

- **Reliability:** stable gridlines, intentional status indicators and quiet
  surfaces, not noisy gradients or decorative 3D imagery.
- **Clarity:** numerals in JetBrains Mono for times/hours; dense but readable
  rota grids; hierarchy that always makes “what needs attention” obvious.
- **Human reality:** where imagery is used, show real shift teams in their
  environments—not generic corporate stock portraits. Obtain model/usage rights.
- **Motion:** short state-change confirmation only; respect reduced motion.

`docs/BRAND.md`, `docs/DESIGN.md`, `tailwind.config.ts` and
`src/components/ui/BrandMark.tsx` are the source-of-truth chain. Consolidate
new copy on `src/lib/brand.ts` and `src/lib/marketing.ts`; do not scatter brand
strings through pages.

## 6. UX and information architecture

### Recommended primary structure

```text
Today
  Dashboard (role-specific action queue)
Plan work
  Rota Builder [manager] · Schedule · Team [manager] · Locations [manager]
Run the shift
  Clock In · Availability · Leave · Shift Swaps · Overtime
Review
  Timesheets · Reports [manager] · Announcements
Manage
  Settings [manager] · My account · Help & support
```

Keep the current routes; group and label them visually before making route
changes. On mobile, prioritise **Today, Schedule, Clock in, Requests, More**;
do not replicate the desktop rail verbatim.

### Screen and workflow improvements

| Area                 | Keep                                                 | Improve next                                                                                                                                                           |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding           | Multi-step organisation setup                        | Show a progress checklist ending at a first published rota; defer optional configuration; add import-assisted team setup only after research.                          |
| Dashboard            | Coverage and operational queues                      | Make a single “next best action” dominant by role; eliminate decorative metrics that cannot be acted on.                                                               |
| Rota builder         | Grid, conflict detection, manager-controlled publish | Progressive disclosure: filter/context first, inspect conflict, resolve in place, publish review. Add keyboard E2E tests and a clear unsaved/published state.          |
| Schedule             | Staff-friendly, calendar export                      | Promote “what has changed since last seen” and change acknowledgement only if validated by research.                                                                   |
| Clock in             | Offline queue and GPS support                        | Make permission rationale, queued state, failed replay and manual fallback unmissable; keep GPS optional where policy requires.                                        |
| Leave/swaps/overtime | Self-service request and approval workflows          | Standardise request cards, status language, chronology, manager decision reasons and notifications. Merge their shared primitives, not their information architecture. |
| Team/locations       | Directory and location/departments                   | Surface qualifications/document expiry only when it affects a shift; make minimum cover setup a guided manager task.                                                   |
| Timesheets/reports   | Export and approval surfaces                         | Separate operational “today” reporting from payroll-period reconciliation. Do not add charts without a decision each chart supports.                                   |
| Settings             | Role-controlled tabs                                 | Group into Organisation, People & policy, Notifications, Billing and Security. Move low-frequency links to account/help.                                               |
| Platform console     | Audit and support foundations                        | Keep internal only until each metric is real, has definition, owner, data freshness and drill-down.                                                                    |

## 7. Feature disposition

| Disposition        | Features                                                                                                                             | Rationale                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Keep               | Rota builder, published schedule, availability, leave, swaps, attendance, timesheets, multi-site, offline queue, CSV/ICS, audit logs | These form the differentiated daily workflow.                                             |
| Improve            | Conflict/coverage resolution, mobile clocking, onboarding, notifications, reports, document/qualification signals                    | Reduce time-to-value and clarify operational risk.                                        |
| Merge              | Shared request/approval UI and notification/event patterns                                                                           | Consistency and lower maintenance without removing domain nuance.                         |
| Automate carefully | Reconnect sync, reminder notifications, rota validation, timesheet roll-up                                                           | Deterministic rules provide measurable operational value.                                 |
| Assist with AI     | First-pass rota suggestions and announcement drafting                                                                                | Existing architecture correctly scopes data and requires human review.                    |
| Defer              | Autonomous auto-fill, demand forecast, burnout detection, SSO, payroll integrations, live subscriptions, SMS                         | Valuable but insufficiently validated; each introduces high operational/compliance scope. |
| Remove/restrict    | Customer-facing placeholder analytics and fabricated demo context                                                                    | A trustworthy operational product cannot present illustrative data as fact.               |

## 8. Technical modernisation plan

1. **Quality system:** introduce CI that runs typecheck, lint, unit tests, build,
   dependency audit and E2E smoke tests on every PR. Add preview deployment
   smoke checks for headers, deep links, service worker and source-map blocking.
2. **Test pyramid:** retain the 582 fast tests; add Playwright journeys for each
   role, offline/reconnect, permission denials, keyboard rota actions and
   destructive confirmation. Add axe checks to key routes.
3. **Observability:** publish event taxonomy, error ownership, release health,
   performance budgets and alert thresholds. Capture field Web Vitals and
   offline-sync failure rate without collecting unnecessary staff PII.
4. **Data lifecycle:** document backup/restore, retention, export/deletion,
   audit-log retention, data residency and incident response. Load-test RLS
   queries against realistic tenant size.
5. **Design-system health:** catalogue primitives and variants in a living
   internal page; replace residual arbitrary classes when touched; audit light
   and dark contrast; govern token changes by visual regression screenshots.
6. **AI operations:** version prompts; retain minimal, access-controlled audit
   data for assistant requests; create a representative evaluation set; measure
   invalid suggestion rate, manager edits and accepted proposals; make the
   model/provider fall-back behaviour explicit.

## 9. Enterprise readiness

**Ready foundations:** tenant isolation, role model, audit logging, offline
capability, static deployment, CSP, Sentry integration and a managed-data
architecture.

**Not enterprise-ready yet:** SSO/SCIM, contractual SLA, documented DR targets,
formal penetration test, external vulnerability management, customer API,
data-processing terms, formal accessibility conformance evidence, localisation,
usage/entitlement governance, production billing and support operations.

Position the beta for small-to-mid-sized UK organisations. Do not market it as
government, healthcare-compliance or global-enterprise ready until these gaps
are closed and evidenced.

## 10. Implementation roadmap

| Phase                                    | Outcome                               | Key deliverables                                                                                                     | Exit evidence                                                      |
| ---------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0. Brand foundation (1–2 weeks)          | One truthful identity everywhere      | Approve `docs/BRAND.md`; replace legacy tagline/CTA/copy; logo/favicon audit; legal-link IA; copy inventory          | Brand acceptance checklist; no old messaging; stakeholder sign-off |
| 1. Beta trust (2–3 weeks)                | Safe, supportable external beta       | P0 legal pages; mailbox/support process; monitoring/alerts; deployed RLS review; mobile/offline UAT                  | Security/privacy checklist; test-account evidence; support drill   |
| 2. Core-loop polish (3–5 weeks)          | Faster first published rota           | Role-specific dashboard; onboarding checklist; request/approval pattern; conflict-resolution UX; accessibility fixes | 5 usability sessions; task-success and time baseline               |
| 3. Measurement and hardening (2–4 weeks) | Decisions backed by product evidence  | Analytics taxonomy, CI, Playwright/axe, field performance, release process, real admin metrics                       | Dashboard populated by real events; quality gates enforced         |
| 4. Design-partner beta (6–8 weeks)       | Validate wedge and willingness to pay | 5–8 active organisations; weekly research; support and release rhythm; pricing interviews                            | Activation, retention, reliability and interview thresholds met    |
| 5. Commercial V1                         | Repeatable paid value                 | Entitlements/billing only after pricing validation; onboarding improvements; knowledge base; customer reporting      | Paid-pilot conversion and operational readiness review             |
| 6. Expansion                             | Higher-value integrations and scale   | Payroll/SSO/API/localisation and carefully evaluated AI automation                                                   | Separate business case and security review per capability          |

### Sequencing rules

- Do not build billing before design partners validate a price and packaging.
- Do not add autonomous scheduling before deterministic validation, evaluation
  data and a human escalation path are established.
- Do not use compliance positioning before legal review and evidence.
- Do not let a visual refresh fork tokens, logos or marketing language from the
  existing sources of truth.

## 11. Production readiness checklist

- [ ] All public claims map to released capabilities and measured evidence.
- [ ] Privacy, Terms, Cookies, AI notice, accessibility statement and support
      contact are published and linked from public/auth pages.
- [ ] RLS, CORS, Edge Function authorisation, role boundaries and support access
      are tested in the deployed environment.
- [ ] Backups, restore exercise, secret rotation, incident response and on-call
      ownership are documented and rehearsed.
- [ ] `typecheck`, lint, 582+ unit tests, production build, E2E and accessibility
      smoke tests pass in CI.
- [ ] Real-device iOS/Android, offline/reconnect and installed-PWA checks pass.
- [ ] Sentry, product events, performance budget and alerts work in production.
- [ ] Every email/push path is confirmed, unsubscribed where appropriate, and
      error/retry behaviour is visible to staff and support.
- [ ] Only real platform metrics appear in customer-visible interfaces.
- [ ] A launch rollback and customer communication plan exists.

## 12. Success metrics

Establish baselines during Phase 3; do not invent targets before observing the
first design partners.

| Metric                 | Definition                                                                                    | Decision use                              |
| ---------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Activation             | Organisation creates its first location, invites staff and publishes first rota within 7 days | Tests onboarding and product value        |
| Time to first rota     | Median time from organisation creation to first publish                                       | Primary manager-efficiency measure        |
| Rota completion        | % of rota sessions resulting in a published rota without unresolved blocking conflicts        | Tests builder clarity                     |
| Staff adoption         | % of invited staff who view a schedule within 7 days; weekly active staff                     | Tests distribution and staff utility      |
| Attendance reliability | Offline writes queued, sync success, permanent failure and time-to-sync                       | Protects the core differentiator          |
| Workflow completion    | Leave, swap and overtime request completion/approval time                                     | Finds process friction                    |
| AI quality             | Suggestion acceptance, edit rate, rejected/invalid rate and manager-rated usefulness          | Proves AI value rather than novelty       |
| Accessibility          | Automated violation count plus manual keyboard/screen-reader critical-path pass rate          | Release gate, not vanity metric           |
| Performance            | p75 LCP/INP/CLS, route load and error-free session rate                                       | Field experience and regression detection |
| Satisfaction/retention | CSAT after support, manager NPS/interviews, 30/60/90-day active-org retention                 | Product-market fit signal                 |
| Commercial             | Design-partner-to-paid-pilot conversion, willingness-to-pay range, support cost per org       | Packaging and business-model validation   |

## 13. Immediate next action

Approve the positioning and initial market wedge, then execute Phase 0 and
Phase 1 before any broad UI rewrite. The brand copy already in progress should
be reviewed against this plan, consolidated into the documented sources of
truth, and released only with the beta trust foundations.
