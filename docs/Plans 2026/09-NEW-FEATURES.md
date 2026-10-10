# 09. New features: what to add, what exists, what to refuse

The rule for this list: each feature must make a buyer more likely to pay or a user more likely to succeed, must reuse what already exists, and must be explainable in one sentence. Anything that needs a new subsystem is in §3, refused for now.

## 1. Already built (do not rebuild)

Checked in source on 10 October 2026. Several older documents describe some of these as missing.

| Feature                                          | Evidence                                           |
| ------------------------------------------------ | -------------------------------------------------- |
| CSV staff import with preview                    | `ImportStaffModal.tsx`, `lib/csvImport.ts`         |
| Repeat or copy a week                            | `RepeatWeekModal.tsx`                              |
| AI rota assistant (Business and up)              | `supabase/functions/ai-rota-assistant`             |
| Labour cost report                               | `LabourCostCard.tsx`, `payRateService.ts`          |
| Calendar feed with token rotation                | `calendar-feed` function, `calendarFeedService.ts` |
| Push notifications                               | `pushSubscriptionService.ts`, `public/push-sw.js`  |
| Document expiry and missed clock-in alerts       | `0093_scheduled_alerts.sql`                        |
| Qualification expiry warnings on the rota        | `rotaInsights.ts:472`                              |
| Announcement unread reminders                    | `0087`                                             |
| Organisation data export (33 tables)             | `check:export` gate                                |
| Setup checklist                                  | `/app/setup`, `setupProgress.ts`                   |
| Offline clock-in, leave and swap                 | `syncQueue.ts`, three `enqueue` calls              |
| Support cases, incidents, platform announcements | `/admin/*`                                         |

## 2. Recommended additions

Priority: **P1** before or during the pilot, **P2** after the pilot shows a need.

| ID  | Feature                                           | Why it helps                                                                           | Smallest version                                                                                                                                                          | Priority | Size |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| F1  | **30-day free trial**                             | Every main competitor offers 14 to 30 days, no card. Buyers test with their own shifts | Stripe trial plus read-only fallback ([03](03-PLATFORM-AND-BILLING.md) B3)                                                                                                | P1       | M    |
| F2  | **Website enquiry and demo request**              | Today enquiries are lost if the visitor's email program doesn't open                   | `public-enquiry` function, `enquiries` table, console inbox ([06](06-WEBSITE-AND-CONTENT.md) §5)                                                                          | P1       | M    |
| F3  | **Invoices in the app**                           | Finance teams need receipts without logging into Stripe                                | Store Stripe's invoice links, list the last 12 ([03](03-PLATFORM-AND-BILLING.md) B4)                                                                                      | P1       | S    |
| F4  | **Payroll CSV presets**                           | Payroll is the step after timesheets. Buyers ask "does it work with our payroll?"      | Three column layouts on the existing timesheet export: generic, Sage, Xero. Check each against the provider's current import template before shipping. No API integration | P1       | S    |
| F5  | **Working-time warnings that follow your policy** | Care and hospitality buyers need WTR evidence                                          | Wire the existing policies into the rota ([02](02-ORGANISATION-AND-STAFF.md) §4)                                                                                          | P1       | M    |
| F6  | **Sample week for new organisations**             | A trial user sees a full rota in seconds instead of an empty grid                      | A "Load an example week" button in setup that creates clearly labelled sample staff and shifts, with one "Remove sample data" button                                      | P1       | M    |
| F7  | **"What changed" summary on publish**             | Staff notice amendments. Managers see what they are about to send                      | Show added, moved and removed shifts before Publish, and in the staff notification                                                                                        | P1       | S    |
| F8  | **Requests switcher on phones**                   | Staff can reach Swaps and Overtime from the Requests tab                               | Segmented control ([02](02-ORGANISATION-AND-STAFF.md) O4)                                                                                                                 | P1       | S    |
| F9  | **My next shifts available offline**              | Staff in basements and wards check their next shift without a signal                   | Read-only cache of the person's own next 14 days of published shifts, with "last updated" time. Cleared on sign-out                                                       | P2       | M    |
| F10 | **Announcement read receipts for managers**       | Managers know who has seen an important notice                                         | "Read by 12 of 15" with the list (data exists through `read_at`)                                                                                                          | P2       | S    |
| F11 | **Missed clock-in follow-up list**                | Managers act on the alert that already fires                                           | A filter on Attendance: "Didn't clock in", from the existing state machine                                                                                                | P2       | S    |
| F12 | **"Your data" page**                              | Staff can find their rights, which buyers and the ICO expect                           | Request a copy or closure through the existing GDPR case process (GAP-057)                                                                                                | P1       | S    |
| F13 | **Change my email**                               | People change jobs and addresses; invitations depend on email                          | Verified change through Supabase Auth (GAP-085)                                                                                                                           | P2       | S    |
| F14 | **What's new panel**                              | Customers see progress without emails                                                  | Changelog entries from the content source, a dot on Help when there is something unread                                                                                   | P2       | S    |
| F15 | **Annual billing**                                | Lower churn, cash up front, an expected option                                         | Annual Stripe prices and a toggle ([03](03-PLATFORM-AND-BILLING.md) B2)                                                                                                   | P2       | S    |
| F16 | **Trial and payment emails**                      | Fewer surprised cancellations                                                          | "Trial ends in 3 days" and "Payment failed" through the existing outbox                                                                                                   | P1       | S    |
| F17 | **Help articles inside the app**                  | Fewer support questions                                                                | Articles from the content source, linked from the screen they explain                                                                                                     | P2       | S    |
| F18 | **Status notice on the website**                  | Customers see an incident without emailing                                             | A line from `site_settings` or a public incident flag ([03](03-PLATFORM-AND-BILLING.md) A2)                                                                               | P2       | S    |

## 3. Refused for now (too complex or not yet needed)

Revisit only with a paying customer asking for it, an owner decision and an affordable way to run it.

- Native App Store and Play Store apps (the PWA installs on both).
- Direct payroll or HR system integrations through APIs.
- Public API and outbound webhooks.
- SSO and SCIM.
- Kiosk, QR, NFC or biometric clock-in.
- Demand forecasting, automatic rota generation without review, burnout prediction.
- Continuous location tracking.
- Built-in chat or messaging.
- Per-customer branding.
- SMS (the seam is reserved).
- A page builder, CRM, or automatic social posting.
- Multi-language and multi-currency.

These are not judgements that the ideas are bad. Each one adds a system to run and secure, and the product earns more from finishing the loops it has.
