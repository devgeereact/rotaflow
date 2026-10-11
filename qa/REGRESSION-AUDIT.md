# Regression audit

Which closed defects are guarded by a test, and which test. Created on
11 October 2026 by reading every closed `BUG-` and `GAP-` row in `docs/SAAS.md`
(those struck through, `~~ID~~`) for the test files each cites, then checking that
each cited file exists in the tree. RF findings from the 5 September 2026 delivery
audit were closed as BUG-071 to BUG-081, so they appear under those numbers.

## Result, 11 October 2026

- 143 closed `BUG-` and `GAP-` rows in the register; **40** name at least one test file.
- Every test file those 40 rows name **exists** in the tree.
- The other 103 closed rows cite no test in the row itself. Many were documentation,
  configuration or decision rows with nothing to test; others may have a test
  the row does not name. That is a gap in the record, not proof of a gap in the
  tests, and it is the first thing the next audit should narrow.

Whether each test still **fails without its fix** was established when the defect
closed, row by row; it has not been re-proved here. To re-prove one, revert the
fix locally and run the named test.

## Guarded defects

| Row     | Defect                                                                                        | Guarding test                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| BUG-046 | Outbox replay                                                                                 | `supabase/tests/database/outbox_idempotency.test.sql`                                                                            |
| BUG-053 | Pricing page                                                                                  | `src/lib/marketing.test.ts`                                                                                                      |
| BUG-060 | Support CSAT                                                                                  | `supabase/tests/database/support_csat.test.sql`                                                                                  |
| BUG-061 | Concurrent approval                                                                           | `src/services/reviewConcurrency.test.ts`                                                                                         |
| BUG-070 | Query strings reaching Sentry                                                                 | `src/lib/sentry.test.ts`                                                                                                         |
| BUG-071 | Swap approval and reassignment                                                                | `src/services/swapDecision.test.ts`, `supabase/tests/database/swap_decision_atomicity.test.sql`                                  |
| BUG-073 | Two managers approving one timesheet                                                          | `supabase/tests/database/timesheet_uniqueness.test.sql`                                                                          |
| BUG-074 | Attendance across a period boundary                                                           | `src/lib/hoursBoundary.test.ts`                                                                                                  |
| BUG-075 | Reports above the API row cap                                                                 | `src/lib/pagination.test.ts`                                                                                                     |
| BUG-076 | "Invitations sent" after a failed send                                                        | `src/lib/inviteDelivery.test.ts`                                                                                                 |
| BUG-079 | Stripe replay and mode scoping                                                                | `supabase/functions/stripe-webhook/reconcile.test.ts`, `supabase/tests/database/billing_event_idempotency.test.sql`              |
| BUG-082 | Open Shifts offered an owner a control that could only fail                                   | `src/pages/app/OpenShiftsPage.test.tsx`                                                                                          |
| BUG-083 | The rota keyboard hint rendered below the whole grid                                          | `e2e/rota-grid.spec.ts`                                                                                                          |
| BUG-085 | Reports scrolled the whole page sideways on a phone                                           | `e2e/reports-responsive.spec.ts`                                                                                                 |
| BUG-086 | An owner with no staff record was told nothing needed covering                                | `supabase/tests/database/open_shifts_visible_without_a_staff_record.test.sql`                                                    |
| BUG-088 | The rota builder opened on the previous week                                                  | `e2e/authenticated-loop.spec.ts`, `e2e/rota-grid.spec.ts`                                                                        |
| BUG-105 | Staff were greeted "Good morning" at every hour                                               | `e2e/staff-dashboard.spec.ts`                                                                                                    |
| GAP-007 | No amendment diff                                                                             | `supabase/tests/database/rota_amendment_diff.test.sql`                                                                           |
| GAP-038 | The migration history does not grant `authenticated` EXECUTE                                  | `supabase/tests/database/function_grant_invariants.test.sql`                                                                     |
| GAP-039 | The draft/published boundary was only in the browser                                          | `supabase/tests/database/rota_publication_boundary.test.sql`                                                                     |
| GAP-040 | Duplicate clock-ins were refused only by a disabled button                                    | `supabase/tests/database/clock_event_reported_time.test.sql`                                                                     |
| GAP-043 | The public site had no sitemap, canonicals or social cards                                    | `src/lib/navigationTargets.test.ts`                                                                                              |
| GAP-075 | Shared layout, state and motion contracts were convention, not components                     | `e2e/responsive-and-motion.spec.ts`                                                                                              |
| GAP-076 | The rota grid could only be operated with a mouse, and lost its column headings when scrolled | `e2e/rota-grid.spec.ts`                                                                                                          |
| GAP-082 | Nothing had been driven against a real platform-admin session                                 | `e2e/platform-console.spec.ts`                                                                                                   |
| GAP-083 | Every org-scoped read pays the RLS predicate once per row                                     | `supabase/tests/database/clock_events_rls_equivalence.test.sql`                                                                  |
| GAP-089 | Sixty other tables still evaluate their RLS predicate per row                                 | `supabase/tests/database/definer_functions_check_membership.test.sql`, `supabase/tests/database/shifts_rls_equivalence.test.sql` |
| GAP-090 | `0122` fixed the tables and never looked at the functions                                     | `supabase/tests/database/platform_finance_boundary.test.sql`                                                                     |
| GAP-091 | `0126` dropped `create_invite`'s bootstrap branch; admin-assisted signup was dead             | `supabase/tests/database/invite_bootstrap.test.sql`, `supabase/tests/database/org_creation_bootstrap.test.sql`                   |
| GAP-094 | A resolved, rated support case could not be reopened                                          | `supabase/tests/database/support_case_reopen.test.sql`                                                                           |
| GAP-098 | Support-access consent was unreachable from the UI and unenforced mid-session                 | `supabase/tests/database/support_access_consent.test.sql`                                                                        |
| GAP-104 | Revoking a platform role left the person owner-equivalent inside every tenant they were in    | `supabase/tests/database/support_access_consent.test.sql`                                                                        |
| GAP-107 | The second-factor switch could be set by anyone who could edit any setting                    | `supabase/tests/database/platform_mfa_switch.test.sql`                                                                           |
| GAP-108 | A swap could be approved without the shift ever moving                                        | `supabase/tests/database/swap_decision_atomicity.test.sql`                                                                       |
| GAP-109 | Three tables where the only control was a missing policy                                      | `supabase/tests/database/table_grant_invariants.test.sql`                                                                        |
| GAP-117 | Every member can read every colleague's payroll id, phone and holiday allowance               | `src/services/orgExportSource.test.ts`, `supabase/tests/database/staff_profile_column_visibility.test.sql`                       |
| GAP-118 | Every staff member met an error boundary instead of a dashboard                               | `e2e/staff-dashboard.spec.ts`                                                                                                    |
| GAP-119 | An open amendment doubled every hour on the timesheet payroll is signed off from              | `src/lib/rotaRollup.test.ts`                                                                                                     |
| GAP-121 | Eleven screens wrote a shift's times as two separate times                                    | `src/lib/clockRows.test.ts`, `src/lib/moduleBoundaries.test.ts`, `src/lib/timeRange.test.ts`                                     |
| GAP-123 | Nothing stopped a person booking the same leave twice                                         | `src/services/leaveOverlap.test.ts`, `supabase/tests/database/leave_no_double_booking.test.sql`                                  |
