# Known issues

Limitations a customer can see or would ask about today, in plain terms. This file
owns that customer-facing list only. Each entry links the `docs/SAAS.md` row that
owns its status, and when that row closes, the entry here is removed in the same
pull request. Internal defects with no customer-visible effect stay in the
register alone.

Checked against the code and the register on 11 October 2026. Re-checked against the
code on 9 November 2026, after the move to the PHP API and Clerk: Working offline
(the offline queue), the calendar subscription link, Accounts and security, demo
requests and Product scope. The other entries still carry the 11 October check.

## Working offline

- **Only three actions queue without a network**: clocking in or out, a leave
  request and a swap request. They are held on the device and sent when the
  connection returns. Everything else, including building or publishing a rota and
  approving anything, needs a connection, and screens show only what was cached in
  the last few minutes. Some offline wording promises more than that cache holds.
  (GAP-049; the full classification is `docs/ARCHITECTURE.md`, "Offline and PWA")
- **A queued action the server later refuses** (for example, a duplicate clock-in)
  is reported on the screen it came from with Retry and Discard, but there is no
  notification to act on later. (GAP-086)
- **An offline action queued on an older version of the app, before actions were
  tied to the person who made them, is never sent.** It stays on the device but
  is not replayed or shown to anyone, because nobody can tell whose it is. Only
  an action queued before 2 September 2026 and never sent can be in this state.
  (GAP-042)
- **If a session ends without signing out** (for example, it expired), the device
  keeps receiving that person's push notifications until somebody signs in and
  turns notifications on again. Signing out stops them. (GAP-042)

## Staff records

- **Photos and documents added before uploads existed are still links.** Both
  are now uploaded and stored privately; an older photo or document keeps the
  link it was given until it is replaced. (GAP-084)
- **Medical notes entered on an emergency contact before 11 October 2026 are
  still stored.** The field is no longer asked for or shown, so those notes cannot
  be seen or edited on screen; deleting the contact removes them, and a person's
  data export still includes them. Removing the stored values is a separate,
  planned change. (GAP-058)
- **Erasing a person does not delete files hosted elsewhere** that an older
  document link or a photo link pointed to. Uploaded documents and photos are
  deleted with the person. (GAP-056)
- **A user cannot change their own sign-in email address.** (GAP-085)
- **Your own data is requested, not downloaded on the spot.** My account, Your
  data files the request, and a completed erasure removes your login; the copy
  or the deletion follows once the request has been checked. (GAP-057)

## Scheduling

- **The rota grid shows three weeks at a time**: the previous, current and next.
  (GAP-079)
- **Weeks always start on Monday.** There is no setting for it. (GAP-116)
- **The working-time rules on Settings → Policies warn, they do not block.** A
  manager can still save a rota that breaks minimum rest, maximum weekly hours or
  maximum consecutive days.
- **A calendar subscription link stays valid until it is revoked**, or until it has
  gone 90 days without being fetched (`backend/src/Mod/CalendarFeed.php`). The feed
  has no limit of its own beyond the 300 requests a minute per address that the API
  puts on every public route (`backend/src/Api.php`). Treat the link as a password.
  (GAP-052)

## Accounts and security

- **An organisation cannot require two-factor sign-in for its staff.** Sign-in is
  Clerk's email code (`backend/src/Jwt.php` verifies the token). The PHP API has no
  authenticator-app enrolment and no organisation switch to make it compulsory:
  `backend/src/DataMove/Map.php` records the old `require_mfa` setting as "two-step
  sign-in is set in Clerk". Whether two-step sign-in is switched on for people is a
  Clerk dashboard setting: `NOT VERIFIED` from the repository. (CAP-049, GAP-017)
- **Bot protection and a check against known leaked passwords at sign-up and
  sign-in** are Clerk dashboard settings, not repository code: `NOT VERIFIED`.
  (GAP-033, GAP-034)
- **Nothing watches Clerk's sign-in settings.** The only auth-settings check,
  `.github/workflows/auth-config.yml`, was written for the retired Supabase project,
  and no file under `.github/workflows/` or `scripts/` compares Clerk's settings with
  a baseline (`git grep -il clerk -- .github scripts` finds none that does), so a
  change to sign-in settings would not be noticed automatically. (GAP-036)

## Billing

- **There is no free-forever plan.** A new organisation gets 30 days free with
  Professional limits. After that, without a plan, the organisation is read-only:
  everyone can sign in, see and export everything, and staff can clock in and
  request leave, but rotas cannot be built or published and nobody new can be
  invited. (CAP-125)
- **A free trial ends without a reminder email.** The days left are on Settings,
  Billing, and owners and managers see a banner once it has ended, but nothing is
  emailed beforehand unless the owner has already chosen a plan through Stripe,
  in which case Stripe's three-day notice is sent. (GAP-127)
- **Choosing a plan with less than two days of the trial left starts billing that
  day.** Stripe does not accept a shorter trial at Checkout. (CAP-125)
- **Invoice links stop working after a while.** Settings, Billing lists your last
  12 invoices with links to Stripe's copy, but Stripe expires those links about a
  month after each invoice is due (never more than 120 days). For an older
  invoice, open the billing portal from the same screen, which lists every one.
  An invoice appears in the list once it is paid or a payment has failed, not
  while it is still being prepared. (CAP-127, GAP-129)
- **The billing contact shown on Settings, Billing is not sent to Stripe.**
  Stripe emails receipts and invoices to the address used at checkout. (GAP-128)

## Product scope

- **No public API, outbound webhooks, payroll integrations, SSO or SCIM, or
  per-tenant branding.** These are later (product phase 2). (CAP-065, CAP-066, CAP-067, CAP-068,
  CAP-032)
- **No SMS notifications.** In-app, email and web push only. (`docs/SAAS.md` §9)
- **Demo requests are answered by email.** The contact form records that you would
  like a demo and we reply to arrange a time; there is no online booking calendar.
  If the enquiry cannot be sent (a network failure, for example) the form shows our
  support address instead of a confirmation (`src/pages/ContactPage.tsx`).
  (CAP-126)
- **No live payment has completed end to end yet.** Stripe Checkout and the Billing
  Portal are built and test-mode behaviour is proven, but no real charge is on
  record. (CAP-036)
