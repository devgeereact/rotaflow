# Privacy data map

**Dated 4 September 2026.** A snapshot, like `docs/QA-AUDIT-REPORT.md`, not a
living document — the register in `docs/SAAS.md` is what stays current.

Built by reading the code, the migrations and the edge functions, not by asking
what the product does. Every row cites where it can be checked. Where a fact is
a legal conclusion rather than an observation it is marked **REQUIRES LEGAL
REVIEW**; where it is a business fact nobody has recorded it is marked
**REQUIRES OWNER INPUT**, and those are collected in the last two sections.

**This is the technical input a privacy notice needs. It is not the notice**
(that is `src/lib/privacyNotice.ts`, rendered at `/legal/privacy`), and it is
not legal advice.

---

## 1. The frame

| | |
| --- | --- |
| Project | RotaFlow, `~/WebstormProjects/rotaflow`, deployed to `rotaflow.space` |
| Operator | Gideon Akinlotan, UK sole trader, trading as RotaFlow. No company number. **REQUIRES OWNER INPUT:** no postal address published, no ICO registration |
| Intended users | UK and EEA. Employers and the staff they invite |
| Role | **Controller** for visitors, account holders, billing contacts, support correspondence and crash reports. **Processor** for everything an employer records about its staff |
| Live data | None. Production held 0 organisations and 1 user at the last measurement (2026-08-31). Nothing below has been exercised against a real tenant |
| Database | Supabase Postgres, `eu-west-1` (Ireland) |
| Backups | **None.** No backups and no point-in-time recovery, by cost decision (`docs/DATA_LIFECYCLE.md` §1). Every deletion is irreversible |

---

## 2. Collection points

Grouped by where a person's information enters the system. "Subject" is who the
data is about, which is not always who typed it.

| # | Collection point | Fields | Subject | Purpose | Stored in | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Sign-up | first name, last name, email, password | account holder | create an account | `auth.users`, `profiles` | `src/pages/SignupPage.tsx` |
| C2 | Sign-in, magic link, OAuth | email, password, provider identity | account holder | authenticate | Supabase Auth | `src/pages/LoginPage.tsx` |
| C3 | Password reset | email, new password | account holder | account recovery | Supabase Auth | `src/pages/ForgotPasswordPage.tsx` |
| C4 | Organisation setup | org name, slug, sector, team size, site name, **site postal address**, coordinates, geofence radius | the organisation | provision the tenant | `organisations`, `locations` | `src/components/onboarding/StepAbout.tsx` |
| C5 | Invitations | colleague email, role, location, department | the invitee | onboard staff | `invites` | `src/components/settings/TeamInviteManager.tsx` |
| C6 | Staff record (manager-entered) | name, job title, department, contract type, weekly hours, holiday allowance, skills, **payroll id**, start date, **phone**, **email**, sites, photo URL | the staff member | scheduling and pay | `staff_profiles` | `src/components/staff/StaffFormModal.tsx` |
| C7 | Own profile | full name, phone, photo URL | the staff member | keep the record current | `profiles`, `staff_profiles` | `src/pages/app/account/ProfilePage.tsx` |
| C8 | Emergency contacts | contact name, relationship, phone, second phone, **medical notes** | **a third party**, plus health data about the staff member | emergency response | `emergency_contacts` | `src/components/staff/EmergencyContactsModal.tsx` |
| C9 | Documents | free-text type (DBS, right to work…), name, **URL**, issue and expiry dates | the staff member | compliance records | `documents` | `src/components/staff/DocumentsModal.tsx` |
| C10 | Pay rates | hourly rate, effective date, note | the staff member | labour cost and payroll export | `staff_pay_rates` | `supabase/migrations/0104_pay_rates.sql` |
| C11 | Leave | **type (includes `sick`)**, dates, free-text reason | the staff member | absence management | `leave_requests` | `src/components/leave/LeaveRequestModal.tsx` |
| C12 | Clock in / out | time, method, **latitude, longitude, accuracy**, location name | the staff member | attendance and pay | `clock_events` | `src/pages/app/ClockInPage.tsx`, `src/hooks/useGeolocation.ts` |
| C13 | Shifts, swaps, overtime, availability, timesheets | dates, times, notes visible to colleagues, reasons | the staff member | scheduling | `shifts`, `shift_swaps`, `overtime_requests`, `availability`, `timesheets` | `src/components/swaps/`, `src/components/overtime/` |
| C14 | In-app support | message bodies, replies, rating, requester email | the requester | answer the request | `support_cases`, `support_case_messages` | `src/services/supportCaseService.ts` |
| C15 | Marketing contact form | name, email, organisation, sector, team size, message | the enquirer | reply to an enquiry | **nothing server-side** — `mailto:` handoff | `src/pages/ContactPage.tsx:105-121` |
| C16 | AI assistant | manager's free-text prompt, plus assembled staff context | the staff scheduled | draft a rota or an announcement | prompt not stored; output reviewed before saving | `supabase/functions/ai-rota-assistant/index.ts` |
| C17 | Billing | email and card details **entered on Stripe's page**, org id, plan code | the payer | take payment | Stripe; `subscriptions`, `invoices` locally | `supabase/functions/create-checkout-session/index.ts` |
| C18 | Push notifications | endpoint, `p256dh`, `auth` keys | the device owner | deliver notifications | `push_subscriptions` | `src/hooks/useWebPush.ts` |
| C19 | Audit trail | actor id, **actor email and name snapshots**, **IP address**, **user agent**, action metadata | the actor | security and accountability | `audit_logs` | `supabase/migrations/0016_audit_events.sql` |
| C20 | Sessions | user agent, last seen | the account holder | let a person see and revoke their own sessions | `own_sessions` | `supabase/migrations/0100_own_sessions.sql` |
| C21 | Crash reports | stack trace, page path, breadcrumbs | whoever hit the error | fix faults | Sentry (EU) | `src/lib/sentry.ts` |
| C22 | Org SMTP settings | host, port, user, **password**, from address | the organisation | send mail as the customer | `org_smtp_settings` | `src/pages/app/settings/SettingsIntegrationsPage.tsx` |
| C23 | Calendar feed | token in a URL, then that person's shifts, times, locations, notes | the staff member | subscribe a calendar | `calendar_feed_tokens` | `supabase/functions/calendar-feed/index.ts` |

### Notes on the ones that carry the most risk

**C8 — emergency contacts.** The only place the product holds data about
somebody who has no relationship with it at all. `medical_notes` is
free text prompted with "Allergies, conditions", so it is Article 9 health data
by design. Hard-deleted on erasure. **REQUIRES LEGAL REVIEW:** Article 14
notification duty, and how it divides between employer and processor.

**C9 — documents.** The type is an unconstrained text input whose own
placeholder suggests DBS and right-to-work, so criminal-record and immigration
data lands in a column nothing was designed around. It is a *link*, not an
upload: erasure removes the row and cannot remove the file (GAP-056).

**C11 — leave type.** `sick` makes an absence record a health record about a
named person. Deliberately excluded from the AI prompt
(`ai-rota-assistant/index.ts:520-536`) after it was found leaving the UK/EU
beside real names on 2026-08-30.

**C12 — location.** `enableHighAccuracy: true`. The browser's own permission
prompt is the gate; declining falls back to a manual clock-in recorded as
manual, so the feature degrades rather than blocks.

**C16 — AI.** Names, job titles, skills, contracted hours and leave *dates*
leave the UK/EU on a manager's click. The browser never talks to OpenRouter;
the edge function does.

**C23 — calendar feed.** Deployed `--no-verify-jwt`; the token in the query
string *is* the credential, and the function's own header says the URL is
assumed leakable. Revocable, and revoked by erasure since `0111`.

---

## 3. Browser storage

Verified by reading every storage write in `src/`, and confirmed at runtime
against a production build. **No cookies are set anywhere** — there is no
`document.cookie` write in `src/` or `public/`.

| Key | Store | Purpose | Category | Consent needed | Lifetime | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `sb-<ref>-auth-token` | localStorage | session, so you stay signed in | necessary | No | until sign-out or expiry | `src/lib/supabase.ts` |
| `rotaflow:activeOrgId` | localStorage | which tenant you were in | necessary | No | until sign-out | `src/lib/session.ts` |
| `rotaflow:consent` | localStorage | your answer, and when | necessary | No | until cleared or changed | `src/lib/consent.ts` |
| onboarding draft | **sessionStorage** | org name and site address across a refresh | necessary | No | until onboarding completes | `src/pages/OnboardingPage.tsx:295` |
| `rotaflow-outbox` | IndexedDB | clock-ins, leave and swaps made offline | necessary | No | until synced or discarded | `src/lib/offlineOutbox.ts` |
| `pwa-theme` | localStorage | light or dark | preferences | **Yes** | until site data cleared | `src/context/ThemeContext.tsx` |
| `rotaflow.sidebar.collapsed` | localStorage | sidebar state | preferences | **Yes** | until site data cleared | `src/components/layout/Sidebar.tsx` |
| `rotaflow:report-favourites:*` | localStorage | starred reports, per org | preferences | **Yes** | until site data cleared | `src/lib/reportPrefs.ts` |
| `rotaflow:report-runs:*` | localStorage | this browser's export history | preferences | **Yes** | until site data cleared | `src/lib/reportPrefs.ts` |
| `rotaflow:installPromptSnoozedUntil` | localStorage | you dismissed the install banner | preferences | **Yes** | 30 days | `src/lib/installPrompt.ts` |
| `supabase-api`, `imagekit-media` | Cache API | offline reads. Holds authenticated tenant responses for 5 minutes | necessary | No | cleared on sign-out | `vite.config.ts:219`, `src/lib/session.ts:50` |
| `rotaflow-fonts` | Cache API | self-hosted webfonts, no personal data | necessary | No | 1 year | `vite.config.ts:235` |

The `preferences` classification is **provisional and REQUIRES LEGAL REVIEW**.
Storage that is not strictly necessary needs consent under PECR regulation 6;
whether a preference the user sets by their own deliberate click falls inside
the strictly-necessary exemption is exactly the kind of question this document
should not answer for itself. It is treated as needing consent, which is the
safe direction.

**The offline outbox is deliberately not cleared on sign-out**
(`src/lib/session.ts:16-27`) — a queued clock-in belongs to the person who made
it, not to the session. Isolation is by a `userId` ownership filter instead.
Residual: rows written before that field existed are treated as belonging to
whoever is signed in (`src/services/syncQueue.ts:211`), which is a shared-device
exposure for pre-upgrade data.

---

## 4. Processors and transfers

Published at `/legal/trust`, generated from `src/lib/subprocessors.ts`. Repeated
here only where this document adds something.

| Processor | What it gets | Where | Outside UK/EU |
| --- | --- | --- | --- |
| Supabase | everything the product holds | eu-west-1, Ireland | No |
| OpenRouter + model provider | staff names, job titles, skills, hours, leave **dates** | United States | **Yes** |
| Stripe | billing identity of the payer | United States | **Yes** |
| Sentry | stack trace, page path, breadcrumbs | EU ingest | No |
| ImageKit | uploaded images, including staff photographs | United Kingdom | No |
| Namecheap / cPanel | the site itself, and outbound mail | United Kingdom | No |
| Cloudflare | IP address and requested pages of **every visitor** | global edge | Not flagged — see below |

**Cloudflare is the awkward one.** The `outsideUkEu` flag means "personal data
leaves the UK/EU to reach it", and a proxied request is served by the location
nearest the visitor. It is nonetheless a worldwide network run by a US company,
and it sees every visitor whether or not they sign in. Flagging it `true` would
group it with Stripe and OpenRouter, where the page says both are in the United
States and neither receives anything unless you use the feature it powers —
none of which is true of Cloudflare. It stays `false`, the region field and
`/legal/trust` say plainly what it is, and the transfer question is recorded
below. **REQUIRES LEGAL REVIEW.**

**REQUIRES LEGAL REVIEW** for the two genuine transfers: no international data
transfer agreement, no UK addendum to the standard contractual clauses, and no
transfer risk assessment exists for either Stripe or OpenRouter.

---

## 5. Retention

From `retention_policies` (`0027`, `0092`), enforced by `enforce_retention()`
nightly at 02:15 UTC (`0029`, fixed by `0057`), with each run recorded in
`retention_runs`.

| Data | Period | Trigger | Method | Enforced |
| --- | --- | --- | --- | --- |
| Rota and shift history | 84 months | shift start date | hard delete | Yes |
| Attendance, incl. GPS | 36 months | event date | hard delete | Yes |
| Leave | 72 months | end date | hard delete | Yes |
| Support cases | 36 months | resolution date | hard delete | Yes |
| Notification delivery + settled outbox | 12 months | creation | hard delete | Yes |
| Audit log | indefinite | — | append-only trigger refuses `UPDATE`/`DELETE` | By the database |
| Deleted tenant | immediate | owner's action | cascade across ~32 tables | **The declared 1-month grace window is not implemented** |
| Platform health samples | 90 days | sample time | pruned inside the probe | Yes |
| `staff_pay_rates` | none | — | survives anonymisation, identifying nobody | By decision |
| Uploaded files | **none** | — | **not deleted at all** (GAP-056) | No |

Nothing is anonymised by retention; every branch is a hard `DELETE`.

**Every period above REQUIRES LEGAL REVIEW.** They were chosen when the
schedule was built and have not been justified against a statutory or business
requirement. Indefinite audit retention is the one most worth defending or
shortening.

---

## 6. Rights

| Right | Available | How | Evidence |
| --- | --- | --- | --- |
| Access | Partly | manager exports one person's record, 13 datasets | `src/services/gdprService.ts:47-61` |
| Portability | Partly | same export, JSON | as above |
| Rectification | Yes | edit the staff record | `src/components/staff/StaffFormModal.tsx` |
| Erasure | Partly | `anonymize_staff_member`, owner-only | `0111_erasure_misses_email.sql` |
| Restriction, objection | Case-managed only | `gdpr_requests` register | `0020_gdpr_requests.sql` |
| Withdraw consent | Yes | consent panel, footer or account preferences | `src/lib/consent.ts` |
| Org export | Yes | 33 tables, one JSON file | `src/services/orgLifecycleService.ts:92-127` |
| Org deletion | Yes | typed name confirmation, immediate cascade | `0063_delete_organisation.sql` |

**No self-service anything for an individual** (GAP-057). `auth.users` is never
touched by erasure (`0011:4-11`), so there is no account deletion in any real
sense. Requests go by email into `gdpr_requests`, which computes a due date one
month out, extendable by two with a recorded reason, and cannot be closed
without an outcome note.

What erasure keeps, deliberately: shifts, clock events, leave, swaps,
timesheets, availability, site assignments and pay rates, all repointed at an
anonymised `staff_profiles` row reading "Deleted Member".
`erasure_retained_columns()` enumerates the kept columns with reasons and a
pgTAP test fails the build when a new identifying column appears, which is the
right shape for this class of problem.

---

## 7. Security controls relevant to privacy

| Control | State | Evidence |
| --- | --- | --- |
| Tenant isolation | Row-level security, not application filtering; CI fails on a table with no RLS, a readable table with no policy, or any grant to `anon` | `supabase/tests/database/rls_invariants.test.sql` |
| Transport | TLS only, Cloudflare in front, origin refuses direct requests | `.htaccess` |
| Content security policy | `script-src 'self'`; only Supabase, Sentry EU and ImageKit reachable | `.htaccess:158` |
| Fonts | self-hosted since 2026-09-03; previously leaked every visitor IP to Google | `public/fonts/README.md` |
| Secrets | Edge Function secrets and Postgres `vault`; the notification secret is generated in-database and has no second copy | `0091` |
| `smtp_pass` | excluded from the `authenticated` column grant; clients read `org_smtp_settings_safe` | `docs/SCHEMA.md` |
| Audit log | append-only, enforced by trigger, two narrow carve-outs | `0066` |
| Rate limiting | on invites and other sensitive paths | `0085`, `0086` |
| Backups | **none, and no PITR** | `docs/DATA_LIFECYCLE.md` §1 |
| Scheduled checks | `backup.yml` and `auth-config.yml` have **never succeeded** — the repository holds one secret | GAP-036 |

---

## 8. REQUIRES OWNER INPUT

1. **ICO registration.** Not registered, no number. Most UK organisations
   processing personal data must register and pay the fee. Blocks publication.
2. **Postal address.** The notice currently offers one on request. Whether that
   satisfies Article 13 is question 4 below.
3. **Legal form.** Sole trader or a limited company. Changes every clause of
   the Terms and the identity in the notice.
4. **EU Article 27 representative.** Unanswered, and the product is intended
   for EEA users.
5. **Commercial terms**, all marked inline in `src/lib/termsDraft.ts`: refunds,
   pro-rata credit, what happens to data at the end of the billing grace
   window, VAT inclusive or exclusive, notice before suspension, any service
   level.
6. **Uploaded files** (GAP-056). Erasure cannot reach them. Needs a decision
   about the image host before the notice can stop admitting it.
7. **Minimum age** (GAP-060), and what an employer scheduling a 16- or
   17-year-old must be told.
8. **Whether a DPA will be commissioned.** `docs/SAAS.md` CAP-059 says never;
   any customer with an information-security review will ask for one.
9. **The `LICENSE` file** names no copyright holder, and the repository is
   public.

## 9. REQUIRES LEGAL REVIEW

1. **Every lawful basis.** Proposed in the notice, confirmed by nobody.
2. **The Article 9 condition** for `emergency_contacts.medical_notes` and for
   sickness leave.
3. **Article 14** and emergency contacts (GAP-058).
4. **Whether an email address alone satisfies Article 13** for a sole trader.
5. **Transfer mechanism and risk assessment** for Stripe and OpenRouter.
6. **Whether Cloudflare's edge network is a restricted transfer.**
7. **Every retention period**, and indefinite audit retention in particular.
8. **The PECR classification of the four interface preferences** — strictly
   necessary, or consent-requiring as currently treated.
9. **The one-month rights response time** as a published commitment, for both
   UK and EEA subjects.
10. **The whole liability section** of the Terms, and governing law.
11. **Whether a DPO or an Article 30 record is required** at this scale.
