# 08. Delivery roadmap, work packages and release gates

Work is ordered by dependency and risk, not by calendar. Sizes are relative: **S** is a bounded copy, component or configuration change; **M** spans one journey or a few layers; **L** spans environments, providers or several evidence gates. A size is not a date.

## 1. Phases at a glance

| Phase                     | Goal                                             | Exit                                                                                                              |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 0. Facts                  | Know what is deployed and fix the blind spots    | Live settings and versions recorded. Alerts reach the owner                                                       |
| 1. Safe to hold real data | Close the blockers in the README                 | Every P0 package passes its acceptance                                                                            |
| 2. Pilot                  | 3 to 5 organisations run real weeks              | Both loops in [02](02-ORGANISATION-AND-STAFF.md) §1 completed by every pilot, with no P0 or unexplained P1 defect |
| 3. Professional finish    | Consistency, website, content, social            | Design rules adopted on the main screens, new website live, profiles set up                                       |
| 4. Paid launch            | Accept paying organisations within a stated size | Billing scenarios pass in test mode and one supervised live payment                                               |

Phases 1 and 3 can overlap where the work does not touch the same files. Do the cosmetic work only when it does not hide or delay a blocker.

## 2. Work packages

### Phase 0. Facts (owner and read-only checks)

| ID    | Package                                                                                                                                                                                 | Size | Exit                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------- |
| P0-01 | Rotate `SUPABASE_ACCESS_TOKEN`, re-run `auth-config.yml`, fix `plan-drift-audit.yml`                                                                                                    | S    | Both green. GitHub failure emails switched on |
| P0-02 | Read live state: `platform_settings.require_mfa`, deployed Edge Function versions, applied migrations against the repo (GAP-074 `create_invite`), Supabase plan and region, PITR status | S    | Recorded in `DEPLOYMENT.md` with the date     |
| P0-03 | UKIPO trade mark search (decision D1)                                                                                                                                                   | S    | Decision recorded                             |
| P0-04 | Owner decisions D2 to D8 recorded in the README                                                                                                                                         | S    | No row left Pending that blocks phase 1       |

### Phase 1. Safe to hold real data

| ID    | Package                                                                                                                    | Size        | Depends on              | Exit                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------- | ---------------------------------------------------------------------------- |
| P1-01 | Checkout guard and webhook ordering guard ([03](03-PLATFORM-AND-BILLING.md) B1, fixes 1 and 2)                             | S           | none                    | Two Checkouts produce one subscription. Stale event ignored                  |
| P1-02 | Trial and read-only fallback ([03](03-PLATFORM-AND-BILLING.md) B3)                                                         | M           | D2                      | Unpaid organisation becomes read-only after the trial. Data still exportable |
| P1-03 | Remove `medical_notes`, add leave-reason hint ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S1)                             | S           | D5                      | No health field collected                                                    |
| P1-04 | Restrict document types now; private storage later ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S2)                        | S then M    | D4                      | No DBS or right-to-work link requested                                       |
| P1-05 | Sign-in MFA challenge, then switch on `require_mfa` ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S5)                       | M           | P0-02                   | Platform admin without `aal2` refused                                        |
| P1-06 | Alerts to a person: Sentry rules, uptime check, health probe notification ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S7) | S           | P0-01                   | Test alert reaches the owner's phone                                         |
| P1-07 | Paid plan, PITR, off-site backup copy, full restore rehearsal ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S6)             | L           | D6                      | Measured RPO and RTO recorded                                                |
| P1-08 | Legal review: Terms, Privacy, DPA, subprocessors, ICO fee ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S8)                 | L (adviser) | D7                      | Draft banners removed                                                        |
| P1-09 | Inert settings wired or removed ([02](02-ORGANISATION-AND-STAFF.md) §4)                                                    | M           | none                    | A test per wired setting                                                     |
| P1-10 | Shared-device and offline queue fixes, offline Playwright test in CI ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S4, §4)  | M           | none                    | Test green in CI                                                             |
| P1-11 | Turnstile on sign-up, reset and enquiry; leaked-password protection ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S9)       | S           | D6 for the paid feature | Scripted sign-ups refused                                                    |
| P1-12 | AI payload uses IDs, not names ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S3)                                            | S           | none                    | Captured request has no names                                                |
| P1-13 | Support access default off, per-case consent ([03](03-PLATFORM-AND-BILLING.md) A4)                                         | S           | D8                      | New orgs default to off                                                      |
| P1-14 | Website claims corrected ([06](06-WEBSITE-AND-CONTENT.md) §3)                                                              | S           | none                    | Every claim maps to a SAAS capability                                        |

### Phase 2. Pilot

| ID    | Package                                                                                    | Size    | Exit                                                     |
| ----- | ------------------------------------------------------------------------------------------ | ------- | -------------------------------------------------------- |
| P2-01 | Recruit 3 to 5 pilot organisations (D12) through the enquiry form and direct outreach      | M       | Signed pilot terms, including data processing            |
| P2-02 | Settings and navigation defects O1 to O13 ([02](02-ORGANISATION-AND-STAFF.md) §3)          | S each  | All fixed before the first pilot signs in                |
| P2-03 | Website enquiry intake and console inbox ([06](06-WEBSITE-AND-CONTENT.md) §5)              | M       | A test enquiry reaches the owner                         |
| P2-04 | Billing page states and invoice list ([03](03-PLATFORM-AND-BILLING.md) B4)                 | M       | Each state shows the right words                         |
| P2-05 | Platform console copy and gates ([03](03-PLATFORM-AND-BILLING.md) A2)                      | S       | No false statement remains                               |
| P2-06 | Real-device run of both loops, with observed users ([02](02-ORGANISATION-AND-STAFF.md) §8) | M       | Findings recorded with time and mistakes                 |
| P2-07 | Payroll CSV presets ([09](09-NEW-FEATURES.md) F4)                                          | S       | One preset checked by a pilot's payroll person           |
| P2-08 | Weekly pilot review: defects, questions, requests                                          | ongoing | Each request accepted, deferred or refused with a reason |

### Phase 3. Professional finish

| ID    | Package                                                                                                       | Size       | Exit                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| P3-01 | Design adoption, in the order of [04](04-DESIGN-AND-EXPERIENCE.md) §9                                         | M per step | Ratchet tests in place and falling                                  |
| P3-02 | `src/lib/format.ts` and migration as screens are touched                                                      | S          | No locale-less formatting                                           |
| P3-03 | Website rebuild: layout, screenshots, prerender, JSON-LD, real 404 ([06](06-WEBSITE-AND-CONTENT.md) §2 to §4) | L          | Link previews correct on LinkedIn and WhatsApp                      |
| P3-04 | Content editor and `public-content` function ([06](06-WEBSITE-AND-CONTENT.md) §6)                             | M to L     | A post published in the console appears on the site and in app Help |
| P3-05 | Social profiles set up ([07](07-SOCIAL-PROFILES-AND-COMMUNITY.md))                                            | S          | Accounts secured, links in `site_settings`                          |
| P3-06 | Private document storage ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S2 phase 2)                             | M          | Lifecycle tests pass                                                |
| P3-07 | Sidebar grouping tested with two managers ([04](04-DESIGN-AND-EXPERIENCE.md) §6)                              | S          | Shipped only if they find things faster                             |

### Phase 4. Paid launch

| ID    | Package                                                                              | Size | Exit                                        |
| ----- | ------------------------------------------------------------------------------------ | ---- | ------------------------------------------- |
| P4-01 | All Stripe scenarios in test mode ([03](03-PLATFORM-AND-BILLING.md) Part C)          | M    | Every row passes                            |
| P4-02 | Stripe Tax and VAT display (after D3 and VAT registration)                           | S    | Invoice shows net, VAT and gross            |
| P4-03 | One supervised live payment, separately authorised by the owner                      | S    | Recorded with the expected financial effect |
| P4-04 | Performance test at 20 sites, 250 staff, 10,000 shifts, 50,000 clock events          | M    | Measured, and the supported size published  |
| P4-05 | Release checklist from [05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) §5 run end to end | S    | Recorded in `PWA-RELEASE-GATES.md`          |

## 3. Pilot terms (proposal for the owner)

- Free during the pilot, then the trial terms that apply to everyone.
- The pilot organisation agrees a weekly 15-minute call and real feedback.
- A signed data processing agreement before any real staff data goes in.
- RotaFlow commits to: a named contact, a stated response time, a data export on request, and deletion on exit.

## 4. Release gate (every release from phase 2 on)

1. All CI jobs green, plus the PWA offline test.
2. No open P0. Every open P1 has an owner and a user-visible treatment if needed.
3. Migrations backwards-compatible with the previous client.
4. Rollback and post-release checks written before deploying.
5. One real clock-in on a real phone after release.
6. Results recorded in `PWA-RELEASE-GATES.md` with date and version.

No release is called "green" on old screenshots or skipped tests.

## 5. How each package is run

Before starting: write the task contract in `.agent/CURRENT-TASK.md` (outcome, scope, authority, evidence, rollback). Inspect the real path: action, validation, service, RPC or RLS, result, audit, notification. Use current official documentation for Stripe, Supabase and other providers. One cohesive pull request per package. Business-rule changes separate from visual changes. Update the SAAS.md row in the same pull request when a capability's status changes.
