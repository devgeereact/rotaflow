-- =====================================================================
-- 0156_an_invoice_has_its_documents.sql: an owner can open the invoice
-- Stripe issued (Plans 2026, 03 B4 and 09 F3)
--
-- ## What was missing
--
-- `invoices` (0023) records each billing period with its number, amount,
-- currency and status, and the Stripe webhook writes it on `invoice.paid`
-- and `invoice.payment_failed`. It did not record WHERE the invoice is. An
-- owner who needed a copy for their accounts had to open the Billing
-- Portal and find it again. Stripe returns two links on every finalised
-- invoice, and this keeps them:
--
--   * `hosted_invoice_url`, the hosted invoice page (view, pay, download);
--   * `invoice_pdf`, the PDF itself.
--
-- Both are null on a draft (Stripe sets them at finalisation) and on an
-- invoice issued by hand through `issue_invoice`, which has no Stripe
-- document at all. Nullable, with no default and no backfill: a row from
-- before this migration simply has no link until Stripe sends an event for
-- it again.
--
-- ## Only Stripe's own hosts
--
-- The app renders these as links an owner clicks. A column that accepted
-- any text would be a stored open redirect waiting for one bad write, so
-- each is constrained to https on the two hosts Stripe documents for
-- invoice documents: `invoice.stripe.com` (the hosted page) and
-- `pay.stripe.com` (the PDF). Source: Stripe API reference, the Invoice
-- object (`hosted_invoice_url`, `invoice_pdf`, whose examples are
-- `https://invoice.stripe.com/i/acct_.../...` and
-- `https://pay.stripe.com/invoice/acct_.../.../pdf`), and
-- https://docs.stripe.com/invoicing/hosted-invoice-page ("Invoice URLs"),
-- both read 2026-10-12. Either host is accepted in either column so a
-- change of which host serves which document does not start failing
-- webhook writes; the webhook also drops a non-matching URL before it
-- writes (reconcile.ts `invoiceDocuments`), so this constraint is the
-- second line, not the only one.
--
-- The pattern requires `/` straight after the host, so
-- `https://invoice.stripe.com@evil.example/` and
-- `https://invoice.stripe.com.evil.example/` are both refused.
--
-- ## The links expire
--
-- Stripe's hosted invoice URLs expire 30 days after the due date (30 days
-- after finalisation with no due date), never more than 120 days, per the
-- page cited above. A stored link to an older invoice will land on Stripe's
-- "expired" page. The billing screen says so and points at the Billing
-- Portal, which always lists every invoice. Refreshing a link on demand
-- needs a server call to Stripe and is recorded as a follow-up.
--
-- ## Who reads them
--
-- Nothing changes. `invoices_select` (0023) already admits exactly the
-- organisation's owners and the platform billing roles, and `authenticated`
-- already holds a table-level SELECT (0056), which covers new columns. A
-- manager or member of staff reads no row at all, so reads none of these
-- links. No grant is added or removed. Writes stay with `service_role`
-- (0023 revoked insert, update and delete from `authenticated`).
--
-- pgTAP: supabase/tests/database/invoice_documents.test.sql.
-- =====================================================================

alter table public.invoices
  add column if not exists hosted_invoice_url text,
  add column if not exists invoice_pdf text;

alter table public.invoices
  drop constraint if exists invoices_hosted_invoice_url_is_stripe,
  drop constraint if exists invoices_invoice_pdf_is_stripe;

alter table public.invoices
  add constraint invoices_hosted_invoice_url_is_stripe check (
    hosted_invoice_url is null
    or (
      hosted_invoice_url ~ '^https://(invoice|pay)\.stripe\.com/[^[:space:]]*$'
      and length(hosted_invoice_url) <= 2048
    )
  ),
  add constraint invoices_invoice_pdf_is_stripe check (
    invoice_pdf is null
    or (
      invoice_pdf ~ '^https://(invoice|pay)\.stripe\.com/[^[:space:]]*$'
      and length(invoice_pdf) <= 2048
    )
  );

comment on column public.invoices.hosted_invoice_url is
  'Stripe''s hosted invoice page for this invoice. Null for a draft or a manually issued invoice. Expires 30 to 120 days after issue (Stripe). Written by stripe-webhook only.';
comment on column public.invoices.invoice_pdf is
  'Stripe''s PDF of this invoice. Null for a draft or a manually issued invoice. Expires with the hosted page. Written by stripe-webhook only.';
