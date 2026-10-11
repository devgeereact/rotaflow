# Known issues

Limitations a customer can see or would ask about today, in plain terms. This file
owns that customer-facing list only. Each entry links the `docs/SAAS.md` row that
owns its status, and when that row closes, the entry here is removed in the same
pull request. Internal defects with no customer-visible effect stay in the
register alone.

Checked against the code and the register on 11 October 2026.

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

## Staff records

- **Documents and photos are links, not uploads.** A right-to-work document or a
  staff photo is a web address someone pastes; RotaFlow does not store the file.
  (GAP-084)
- **Erasing a person does not delete files hosted elsewhere** that their links
  pointed to. (GAP-056)
- **A user cannot change their own sign-in email address.** (GAP-085)
- **There is no self-service download or deletion of your own account data**; a
  request goes to the organisation or to support. (GAP-057)

## Scheduling

- **The rota grid shows three weeks at a time**: the previous, current and next.
  (GAP-079)
- **The working-week setting chosen in onboarding changes nothing yet.** It is
  stored and shown, and no screen reads it. (GAP-116)
- **A calendar subscription link never expires** until it is revoked, and the feed
  is not rate-limited. Treat the link as a password. (GAP-052)

## Accounts and security

- **Two-factor sign-in is enrolment only.** You can enrol an authenticator app, but
  the sign-in form never asks for the code, and an organisation cannot require it.
  (CAP-049, GAP-017)
- **No CAPTCHA, and no check against known leaked passwords**, on sign-up and
  sign-in. (GAP-033, GAP-034)
- **Supabase Auth settings are not being monitored.** The weekly check that compares
  them with the expected baseline has failed since 14 September 2026, so a change to
  sign-in settings would not be noticed automatically. (GAP-036)

## Product scope

- **No public API, outbound webhooks, payroll integrations, SSO or SCIM, or
  per-tenant branding.** These are Phase 2. (CAP-065, CAP-066, CAP-067, CAP-068,
  CAP-032)
- **No SMS notifications.** In-app, email and web push only. (`docs/SAAS.md` §9)
- **No live payment has completed end to end yet.** Stripe Checkout and the Billing
  Portal are built and test-mode behaviour is proven, but no real charge is on
  record. (CAP-036)
