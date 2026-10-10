# 03. Platform console, support and billing

Platform administration is a separate authority from organisation membership. Keep `/admin`, its role-aware navigation and its route guards. The real protection is in the database: RLS through `is_platform_admin()` and `is_platform_operational()` (`0122`, `0138`), plus role checks inside each RPC. Every live admin page reads real data. Fixtures exist only in the DEV-only preview harness.

## Part A. Platform console

### A1. Roles (VERIFIED, `0015:42`, `src/lib/platformRoles.ts:36-72`)

| Role               | Can do                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| `platform_owner`   | Everything, including granting roles                                       |
| `platform_admin`   | Configuration, operations and billing                                      |
| `platform_support` | Operational pages: support, support access, audit, incidents, integrations |
| `platform_finance` | Billing and subscriptions                                                  |

### A2. Section plan

| Section                                | Today                                                                                            | Work                                                                                                                                                                                                                 | Acceptance                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Overview                               | Real RPCs (`0133`)                                                                               | Label every figure with its period and source. Move chart colours from hand-copied hex (`AdminOverviewPage.tsx:177-180,490,529,556-567`) to `chartPalette`                                                           | Fixture totals match the screen, including zero and failed states |
| Organisations                          | Real directory (`0130`), import, create with invite                                              | Keep                                                                                                                                                                                                                 | A tenant beyond the first page can be found                       |
| Organisation detail                    | Real. **No route gate** (`App.tsx:823`). Tabs are gated (`organisationTabs.ts`)                  | Add the route gate. **Fix three false statements**: "no plan carries a limit" (`:963-965`), "plan is set at sign-up" (`:931-933`), "MRR is from Stripe" (`:937`)                                                     | Copy matches `0070`, `0120` and `subscription_mrr_pence`          |
| Users                                  | Real (`0131`). Role grants are owner-only RPCs                                                   | Keep                                                                                                                                                                                                                 | Finance and support cannot grant roles                            |
| Subscriptions                          | Real, read-only                                                                                  | **Remove the "Change plan" link** (`:471-480`), which leads nowhere. Show the Stripe mode beside each row                                                                                                            | No decorative control remains (CAP-124)                           |
| Billing                                | Real (`0134`). Chart hex hand-copied (`AdminBillingPage.tsx:61-73,377,447`)                      | Group money by currency. Add a "Record credit" action on an invoice, calling the existing `credit_invoice()` (`0149`), labelled "Credit recorded in RotaFlow. No refund issued." Fix the stale comment at `:106-107` | A credit is recorded once, audited, and never moves money         |
| Support cases                          | Real. Reply queues an outbox row (`0148`)                                                        | Watch one reply reach a real inbox before calling it done (GAP-111)                                                                                                                                                  | Internal notes never reach the customer                           |
| Support access                         | Real, time-boxed (15 minutes to 24 hours, `0019:132-136`), consent re-checked per query (`0143`) | See A4                                                                                                                                                                                                               | Expiry and revocation work below the UI                           |
| Audit                                  | Real                                                                                             | Keep. Add export limits                                                                                                                                                                                              | Unauthorised roles see nothing                                    |
| Platform health                        | Real probe every 5 minutes (`0076`), "Not sampled" when absent                                   | Show the age of the last sample. Alert a person after repeated failures ([05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S7)                                                                                             | A stale probe shows as stale                                      |
| Incidents                              | Real (declare, update, resolve)                                                                  | Keep. Link to the public status line on the website ([06](06-WEBSITE-AND-CONTENT.md) §6)                                                                                                                             | One incident shows on the site when marked public                 |
| Integrations                           | Real counts                                                                                      | Keep                                                                                                                                                                                                                 | No credential printed                                             |
| Notifications (platform announcements) | Real compose and publish (`0132`)                                                                | Keep. This is the in-app channel for service notices                                                                                                                                                                 | Tenants see it once and can dismiss it                            |
| GDPR                                   | Real register. **No route gate** (`App.tsx:984`). Finance sees an empty list                     | Gate to owner, admin and support                                                                                                                                                                                     | Finance cannot open it                                            |
| Feature flags                          | Real. Only `ai_rota_assistant` and `advanced_reporting` are consumed                             | Remove `shift_swap_automation`, which has no consumer (INFERRED)                                                                                                                                                     | Every flag shown changes something                                |
| Platform settings                      | 28 columns, only `require_mfa` drives behaviour                                                  | **Hide every setting that does nothing.** Keep MFA. Wire maintenance mode as a banner, or remove it                                                                                                                  | Every visible setting has a consumer                              |
| **New: Content**                       | Does not exist                                                                                   | The small website and help content editor ([06](06-WEBSITE-AND-CONTENT.md) §6). Phase 3                                                                                                                              |                                                                   |
| **New: Enquiries**                     | Does not exist                                                                                   | Inbox for website enquiries ([06](06-WEBSITE-AND-CONTENT.md) §5). Phase 2                                                                                                                                            |                                                                   |

Navigation groups for the console (labels only, no new routes): **Customers** (Overview, Organisations, Users), **Commercial** (Subscriptions, Billing, Enquiries), **Support** (Cases, Support access, GDPR), **Operations** (Health, Incidents, Integrations, Audit), **Configuration** (Announcements, Flags, Settings, Content). A group heading must not imply access to every item in it.

### A3. Platform MFA

Today a platform admin signs in with a password only. Enrolment exists (`TwoFactorSection.tsx`), but no sign-in step asks for the code (`LoginPage.tsx` has no MFA code). `0102:181` deliberately set `require_mfa = false`, because switching it on with no challenge would lock out the only admin. The live value is **UNKNOWN**. The fix is in [05](05-SECURITY-PRIVACY-AND-OPERATIONS.md) S5 and is a phase 1 blocker.

### A4. Support access consent

"Customer-approved" overstates it today. Consent is a standing organisation flag, `support_access_allowed`, that **defaults to true** (`0017:39`). Support staff then grant themselves a session.

Recommended (decision D8):

1. New organisations default to `false`.
2. The organisation's billing settings page shows the switch, with one sentence on what support can see.
3. When a support case needs access, support asks in the case thread. The owner turns access on for that case, and it switches itself off when the session ends.
4. Existing organisations keep their current value. There are no paying customers yet, so the change affects nobody's workflow.

`0148` already stops a support session from creating an owner. Keep that.

## Part B. Billing

### B1. Stripe integration as built (VERIFIED)

| Part                      | What works                                                                                              | Gap                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-checkout-session` | Owner only, active membership, price chosen by `STRIPE_MODE`, customer reused only within the same mode | **No check for an existing active subscription** (`:129-150`). A second Checkout creates a second Stripe subscription. The webhook then upserts on `org_id` (`stripe-webhook/index.ts:134`), overwriting `provider_ref` and orphaning the first one, which keeps charging. **Phase 1 blocker** |
|                           |                                                                                                         | No `trial_period_days`, no `automatic_tax`, no tax ID or billing address collection                                                                                                                                                                                                            |
| `create-portal-session`   | Owner only. Refuses a mode mismatch                                                                     | Organisations created by an admin have an active row with no Stripe customer (`0084:79-80`), so Manage billing fails for them                                                                                                                                                                  |
| `stripe-webhook`          | Signature checked per mode. Replay ledger (`0125`). Marked processed only after effects commit          | No ordering guard on `customer.subscription.updated`, so a stale event can overwrite newer state. `tax_pence` never written; `amount_pence` is the gross amount. Not handled: `trial_will_end`, `invoice.upcoming`, `charge.refunded`, `charge.dispute.created`                                |
| Mode safety               | `STRIPE_MODE` fails closed; a key whose prefix does not match is refused (`_shared/stripe.ts:51-77`)    | Global unique `invoices.number` could collide between test and live (INFERRED)                                                                                                                                                                                                                 |

Fixes, smallest first:

1. **Checkout guard.** If the organisation has a `trialing`, `active` or `past_due` subscription, refuse Checkout and return a Billing Portal link instead. Test: two Checkout calls for one organisation produce one subscription.
2. **Ordering guard.** Ignore a `subscription.updated` event older than the stored `current_period_start` or the last processed event time.
3. **Trial.** Pass `trial_period_days: 30` with `payment_method_collection: 'if_required'` (exact parameter to be confirmed against current Stripe docs before implementing). Handle `customer.subscription.trial_will_end` to send the reminder.
4. **Tax.** Once VAT registration is decided (D3), turn on Stripe Tax, collect the billing address and VAT number, and write `tax_pence` separately from the net amount.
5. **Refunds and disputes.** Record `charge.refunded` and `charge.dispute.created` as audit events and alert finance. Refunds themselves stay manual in the Stripe dashboard. No refund engine.

### B2. Plans and prices (VERIFIED, one source each)

| Plan         | Price (`0023:57-62`, `marketing.ts:366-436`) | Limits              | Per staff at the limit |
| ------------ | -------------------------------------------- | ------------------- | ---------------------- |
| Starter      | £29 a month                                  | 1 site, 15 staff    | £1.93                  |
| Professional | £129 a month                                 | 5 sites, 60 staff   | £2.15                  |
| Business     | £299 a month                                 | 20 sites, 200 staff | £1.50                  |
| Enterprise   | £790 a month                                 | Unlimited           | Contact                |

`marketing.test.ts` (CAP-040) already keeps the pricing page and the database in step. Good.

How this compares (prices seen on vendors' own pages, 10 Oct 2026): Planday from £2.99 a user (minimum 5), Deputy £3.25 a user (£20 minimum), RotaCloud £10 a month for up to 5 staff, Findmyshift free up to 5 staff, Connecteam free up to 10 users. Most offer a **14 to 30 day trial with no card**. RotaFlow's per-head price is competitive. Its weaknesses are no trial and a flat £29 entry that is high for a 5-person team.

Recommendations (decision D3):

- Keep the four plans and prices for the pilot. Do not discount before evidence.
- Add annual billing at ten times the monthly price ("two months free"). Stripe prices only, no new code beyond a toggle on the pricing page and in Checkout.
- State "prices exclude VAT" or "VAT not charged" once the VAT position is known. Today the page says neither.
- Remove the "Most popular" badge (`PricingPage.tsx:88`) until there is data.
- Fix the plan bullets so they match what is gated. Today Professional and Business list Availability, Timesheets, Announcements, Custom roles and Audit (`marketing.ts:391-409`), and Starter gets all of them too. The AI rota assistant is a Business-and-up entitlement (`0030:41`) but appears in no bullets. Either gate what the bullets promise or, simpler, list differences only by sites, staff, AI and advanced reports, which are the things actually enforced.
- Enterprise at a fixed £790 that still routes to "Contact us" is confusing. Show "From £790" or "Talk to us".

### B3. Entitlement and the free-forever loophole

`0120` sets an organisation's plan from its subscription. `trialing` and `active` are entitled, `past_due` until `grace_until`, and anything else falls back to `starter`, which `0120:32` calls "the free tier". But Starter costs £29, and the pricing FAQ says "every plan is paid from the start" (`PricingPage.tsx:30`). So an organisation that never pays, or cancels, keeps Starter limits indefinitely.

Recommended (decision D2):

1. Every new organisation starts a 30-day trial with Professional limits. The trial is a real Stripe trial once B1 fix 3 lands. Until then, a server-set `trial_ends_at` on the organisation.
2. When the trial ends without payment, or after cancellation and the grace period, the organisation becomes **read-only**: everyone can sign in, see and export their data, and staff can still see the published rota. Managers cannot publish or invite until a plan is chosen.
3. No free-forever tier at launch. Revisit after the pilot if small teams churn on price.
4. Seat limits: fix the two holes. Reactivating a staff member bypasses the cap because the trigger runs on INSERT only (INFERRED), and concurrent inserts can exceed it because the count is not locked. Align the FAQ with what is counted (staff profiles, `PricingPage.tsx:26` says "active membership").

`advanced_reporting` is enforced only in the browser (`ReportsPage.tsx:347`), accepted as packaging in `0090:44-50`. Leave it, unless reports become a selling point.

### B4. The organisation billing page

| Problem                                                          | Evidence                                                                    | Fix                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Shows "trialing" when there is no subscription                   | `SettingsBillingPage.tsx:147`                                               | Show the real state: "Trial, 23 days left", "No plan yet", "Active", "Payment failed, access until 14 Nov", "Cancelled, read-only from 30 Nov" |
| Shows `subscription.plan`, not the entitled `organisations.plan` | Same page                                                                   | Show the entitled plan, which is what limits apply to                                                                                          |
| "canceled" spelling                                              | `:267`                                                                      | "Cancelled"                                                                                                                                    |
| `£` hard-coded                                                   | Same page                                                                   | Use `plans.currency` through `lib/money.ts`                                                                                                    |
| No invoices in the app                                           | Invoices table has no PDF or hosted URL column (`AdminInvoiceModal.tsx:20`) | Store Stripe's `hosted_invoice_url` and `invoice_pdf` from `invoice.paid`. List the last 12 invoices with a "Download" link                    |
| No billing contact                                               |                                                                             | Add an optional billing email, passed to Stripe as the customer email                                                                          |
| No dunning messages                                              | (INFERRED)                                                                  | Send "Payment failed" and "Trial ends in 3 days" through the existing notification outbox                                                      |

Plan changes and cancellation stay in the Stripe Billing Portal. Do not build card entry, a wallet, a tax engine, proration previews or a second billing engine.

### B5. Customer language for money

| Situation                                   | Wording                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Sent to Stripe                              | Complete payment with Stripe                                                             |
| Back from Checkout, webhook not yet arrived | Confirming your payment. This usually takes a few seconds                                |
| Webhook recorded                            | Professional plan, active. Renews 14 Nov 2026                                            |
| Local credit recorded                       | Credit of £20.00 recorded. No refund has been issued                                     |
| Refund made in Stripe                       | Refunded £20.00 on 3 Nov 2026                                                            |
| Cancelled at period end                     | Your plan stays active until 30 Nov 2026. After that your organisation becomes read-only |

## Part C. Payment scenarios to prove

Run in Stripe test mode first. Do not switch the production project's mode.

| Scenario                          | Required outcome                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Successful Checkout               | Owner, organisation, plan and mode all correct. Stripe and RotaFlow agree           |
| Second Checkout while active      | Refused, Portal offered. One subscription in Stripe                                 |
| Abandoned Checkout                | No active subscription. Retry works                                                 |
| Return before webhook             | Pending message, then converges. The return page never grants entitlement by itself |
| Duplicate and out-of-order events | One effect. Paid state never regresses                                              |
| Trial ends without payment        | Read-only, data visible and exportable                                              |
| Trial converts                    | Active, first invoice recorded with PDF link                                        |
| Upgrade and downgrade             | Limits change. Over-limit downgrade explained, nothing deleted                      |
| Payment fails, then recovers      | Grace applies once. Recovery restores access                                        |
| Cancellation                      | Active until period end, then read-only                                             |
| Non-owner or other organisation   | Refused server-side                                                                 |
| Refund and dispute in Stripe      | Audit event recorded, finance alerted                                               |

After test-mode evidence, the owner may authorise one supervised live transaction. Planning approval does not authorise a real charge or refund.

## Part D. Support without new infrastructure

Keep the in-app support cases and a monitored mailbox (`support@rotaflow.space`). State the real response hours on the website. Prove that a reply notification reaches a real inbox before GAP-111 closes. Keep one escalation sheet: product issue to the support owner, data issue to the incident owner, payment dispute to the finance owner. In a one-person company that is the same person, but writing the roles down keeps the decisions clear.
