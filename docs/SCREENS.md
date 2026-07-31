# RotaFlow — Screen Inventory

Full map of every screen the product needs — cross-referenced against the real
`design/` mockups and the real route table in `src/App.tsx`, not against what an
earlier version of this doc claimed. Rewritten 2026-07-31 because the previous
version's top summary tables had drifted from its own later phase log (see
"Corrections made this rewrite" below).

**Legend:** ✅ built and wired to a real route, doing real work (not a stub) · ❌
not built yet, or deliberately deferred

Role note: the codebase's actual `MembershipRole` is `owner | manager | staff`.
"Super Admin" is a separate `is_platform_admin` flag, not a 4th membership role —
it gates the `/admin` console only, which doesn't exist yet (§3).

---

## 1. Design mockups in `design/` → build status

Every PNG actually present in `design/` (22 files; style-guide assets —
`designsystem.png`, `rotaflowui.png`, `logo*.png` — aren't individual screens
and are excluded below).

| ✅/❌ | Design file                   | Screen                                                                      | Route                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ----------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅    | `signin.png`                  | Sign in                                                                     | `/login`                                                                                                                                                                                                                                                                                                                                                        |
| ✅    | `signup.png`                  | Sign up                                                                     | `/signup`                                                                                                                                                                                                                                                                                                                                                       |
| ✅    | `splash-screen.png`           | Cold-start splash                                                           | `/splash` (also renders inline while auth resolves)                                                                                                                                                                                                                                                                                                             |
| ⚠️    | `appboot.png`                 | App boot / "setting up organisation"                                        | `AppBootScreen.tsx` is real and rendered inline by `ProtectedRoute` while auth/org resolve — but per `docs/LOOP.md`'s own screenshot-verified tracking, it doesn't yet match this mockup's specific 5-step checklist UI (Secure connection → Loading data → Setting up organisation → Preparing features → Finalising). Functionally built, visually unmatched. |
| ✅    | `Organisation-Onboarding.png` | Onboarding step 1 — create org                                              | `/onboarding`                                                                                                                                                                                                                                                                                                                                                   |
| ✅    | `Organisation-about.png`      | Onboarding step 2 — about your org                                          | `/onboarding`                                                                                                                                                                                                                                                                                                                                                   |
| ✅    | `Team-onboarding.png`         | Onboarding step 3 — invite team                                             | `/onboarding` (department/location fields on this step are staged locally, not yet persisted — a real, self-documented schema gap, not a missing screen)                                                                                                                                                                                                        |
| ✅    | `Plan-Selection.png`          | Onboarding step 4 — choose plan                                             | `/onboarding` (records intent only — no payment processing; charging is out of V1 by design, see `docs/PRD.md`)                                                                                                                                                                                                                                                 |
| ✅    | `Onboarding-Complete.png`     | Onboarding step 5 — done                                                    | `/onboarding` (deliberately swaps two dead mockup links — "Set up shift types" / "Customise notifications", neither of which exist as screens — for real working links to Locations and Staff)                                                                                                                                                                  |
| ✅    | `Workforce-Dashboard.png`     | Manager dashboard                                                           | `/app/dashboard`                                                                                                                                                                                                                                                                                                                                                |
| ✅    | `Rota-Builder.png`            | Rota builder                                                                | `/app/rota`                                                                                                                                                                                                                                                                                                                                                     |
| ✅    | `staff.png`                   | Staff directory                                                             | `/app/staff`                                                                                                                                                                                                                                                                                                                                                    |
| ✅    | `Staff-Profile.png`           | Staff profile detail                                                        | `/app/staff` — an edit modal + emergency-contacts/documents modals over the list, not a standalone `/app/staff/:id` route                                                                                                                                                                                                                                       |
| ✅    | `Availability.png`            | Availability                                                                | `/app/availability`                                                                                                                                                                                                                                                                                                                                             |
| ✅    | `live-schedule.png`           | Staff-facing "Live" state — live badge + open-requests panel                | `/app/schedule`                                                                                                                                                                                                                                                                                                                                                 |
| ✅    | `published-schedule.png`      | Manager post-publish confirmation state — unpublish action, publish history | `/app/schedule`                                                                                                                                                                                                                                                                                                                                                 |
| ⚠️    | `Schedule-dashboard.png`      | Manager's default view / manage-published-rotas state                       | `/app/schedule` — per `docs/LOOP.md`, this specific default-state visual match is still a gap, distinct from the two rows above, which are matched                                                                                                                                                                                                              |

`/app/schedule` (`SchedulePage.tsx`) is one real, working route serving three
distinct visual states, per `docs/LOOP.md`'s own tracking (which is the
authoritative source for design-match status — this doc tracks whether the
underlying feature works, not pixel fidelity to a mockup).

## 2. Built screens with no design mockup

Real, wired, non-stub pages that simply never got a `design/*.png` reference
(some of these — Leave, Locations, Timesheets, Reports, Announcements, Swaps —
were asked about as if `Leave-Management.png` / `Locations-Management.png` /
`Timesheets-Dashboard.png` / `Reports-Dashboard.png` /
`Announcements-Dashboard.png` / `Swap-Request.png` / `Location-department.png`
existed; **they don't exist in this repo and never have** — checked
`git log --all -- design/`, no deletions, just never committed).

| ✅  | Screen                                                | Route                                 |
| --- | ----------------------------------------------------- | ------------------------------------- |
| ✅  | Leave request + tracking + approvals                  | `/app/leave`                          |
| ✅  | Shift swap request + respond + approvals              | `/app/swaps`                          |
| ✅  | Timesheets (real hours from clock events)             | `/app/timesheets`                     |
| ✅  | Reports (CSV export)                                  | `/app/reports`                        |
| ✅  | Announcements (feed + composer)                       | `/app/announcements`                  |
| ✅  | Locations & departments                               | `/app/locations`                      |
| ✅  | Clock in/out (GPS + manual, offline-queued)           | `/app/clock`                          |
| ✅  | Roles & team management (invite/revoke)               | `/app/team`                           |
| ✅  | Notifications inbox                                   | `/app/notifications`                  |
| ✅  | Integrations (per-org SMTP)                           | `/app/integrations`                   |
| ✅  | Org settings                                          | `/app/settings`                       |
| ✅  | Account settings (name, password, notification prefs) | `/app/account`                        |
| ✅  | Forgot / reset password                               | `/forgot-password`, `/reset-password` |
| ✅  | Accept invite (public, pre-signup)                    | `/invite/:token`                      |
| ✅  | Marketing / home                                      | `/`                                   |
| ✅  | 404                                                   | `*`                                   |

## 3. Not yet built / deliberately deferred

| ❌  | Screen                                                      | Why                                                                                                                                                                                     |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ❌  | Overtime request/offer                                      | `overtime_requests` table exists; genuinely never scoped — no route was ever named for it, unlike availability/leave/swaps, which all were before being built                           |
| ❌  | Staff self-service view of own emergency contacts/documents | Currently owner/manager-only, managed via modals on `/app/staff` — a staff member has no way to see or add their own                                                                    |
| ❌  | Real file upload for documents                              | `documents.file_url` is a pasted link today — no storage integration (ImageKit or otherwise) is wired anywhere in this repo                                                             |
| ❌  | Avatar upload                                               | Needs ImageKit, not wired                                                                                                                                                               |
| ❌  | Email change (Account settings)                             | Needs Supabase's confirmation round-trip on both addresses — deferred, not attempted                                                                                                    |
| ❌  | QR clock-in                                                 | Clock-in supports GPS + manual only; nothing generates a per-location scannable code                                                                                                    |
| ❌  | Live subscription billing / charging                        | Plan selection UI is real (records intent); actual payment processing is explicitly out of V1 per `docs/PRD.md`                                                                         |
| ❌  | Audit log viewer                                            | `audit_logs` is written to (e.g. by the GDPR anonymize RPC) but nothing reads it back anywhere in the product yet                                                                       |
| ❌  | Super Admin console (`/admin`)                              | Tenant management, platform-wide billing oversight, support tools, feature flags, platform-level GDPR tools — `is_platform_admin` flag exists in the schema, the console itself doesn't |

## 4. GDPR — built, but scope is deliberately narrower than "delete everything"

Per-staff **export** (JSON of everything held on them) and **anonymize**
(scrub PII, keep operational rows) live on `/app/staff`, owner-only
(`anonymize_staff_member` RPC, `0011_gdpr_anonymize.sql` — written and merged,
**not yet applied to the live database**). Two things this does NOT do, by
design, not oversight:

- Delete the person's RotaFlow login (`profiles`/`auth.users`) — that can span
  other organisations and needs Supabase's Auth Admin API, a platform-level
  operation.
- Delete the actual file behind a stored `documents.file_url` — only the
  database row is removed.

---

## Corrections made this rewrite

The previous version of this doc had two layers that disagreed with each
other: early per-role summary tables (written first) vs. a later
phase-by-phase build log (written as each phase shipped, and kept accurate).
This rewrite trusts the phase log. Specifically fixed:

- **Splash screen** was marked not-built ("only a bare spinner stands in") —
  false; `SplashScreen.tsx` is a full real component, referenced by
  `splash-screen.png` in multiple file comments.
- **Sign up** was marked as "just a toggle inside `LoginPage.tsx`" — false;
  `SignupPage.tsx` is a standalone real page at `/signup`.
- **Forgot / reset password** was marked "no UI exists anywhere" — false;
  both pages exist and are wired.
- **Accept invite** was marked "no invite-token flow exists" — false;
  `AcceptInvitePage.tsx` exists at `/invite/:token`.
- The doc previously invented implied filenames (`Leave-Management.png` etc.)
  for screens that are real but simply have no mockup — corrected in §2 above,
  with the actual `design/` contents verified via `find design -type f`, not
  assumed from context.

## Reference assets (not screens)

- `designsystem.png` — canonical token sheet (colour, type, spacing, icons,
  shadows, components). Source of truth for `docs/DESIGN.md`.
- `rotaflowui.png` — full product screen showing the design system applied.
- `logo.png` / `logo-1.png` / `logo-2.png` — brand mark variants.
