// stripe-webhook. RotaFlow
//
// Stripe calls this directly on subscription/invoice lifecycle events.
// Auth is Stripe's own request signature (STRIPE_WEBHOOK_SECRET), exactly
// like inngest's own signing-key check — there is no end-user session for
// a provider webhook to forward, so this is deployed --no-verify-jwt and
// uses service_role, the one function in this feature allowed to.
//
// subscriptions writes are upserts keyed on org_id / (org_id, provider_ref)
// because Stripe's delivery is documented at-least-once: a naive insert
// would create duplicate subscriptions on a retry.
//
// invoices writes use an explicit select-then-insert-or-update instead of
// an upsert: 0023_commercials.sql gives `invoices` a unique constraint on
// `number` only, not on `provider_ref`, so `.upsert(..., { onConflict:
// 'provider_ref' })` would target a non-existent unique index and error at
// runtime. Look up the row by provider_ref first, then insert or update
// depending on whether it already exists — the same shape
// handleInvoicePaymentFailed already needs to track `attempts` correctly.
//
// invoice.paid/invoice.payment_failed write into the SAME invoices table
// (0023_commercials.sql) that issue_invoice()/set_invoice_status() write
// manually for platform-finance-issued invoices. This is a second,
// automated writer into that table, not a replacement for the manual path
// (still used for off-Stripe deals).
//
// Deploy: `supabase functions deploy stripe-webhook --no-verify-jwt`.
// Secrets: STRIPE_SECRET_KEY (shared), STRIPE_WEBHOOK_SECRET (from the
// Stripe dashboard's webhook endpoint config, or `stripe listen`'s own
// printed secret for local testing).
//
// After deploying: Stripe dashboard -> Developers -> Webhooks -> Add
// endpoint, pointed at <SUPABASE_URL>/functions/v1/stripe-webhook,
// subscribed to: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted, invoice.paid, invoice.payment_failed.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getStripeClient } from '../_shared/stripe.ts';
import type Stripe from 'npm:stripe@17';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// subscriptions.status has a check constraint of only
// ('trialing','active','past_due','canceled') — 0002_rotaflow.sql — but
// Stripe's real Subscription.Status enum is wider (incomplete,
// incomplete_expired, unpaid, paused). Map onto the 4 allowed values rather
// than widen the constraint; a schema change is a separate, controller-gated
// step, not something this webhook does on its own.
function mapSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due';
    case 'canceled':
    case 'paused':
      return 'canceled';
    default:
      // Defensive: TypeScript's exhaustiveness checking on the switch above
      // already covers every currently-known value, but Stripe's API can
      // add more over time.
      return 'past_due';
  }
}

async function handleCheckoutCompleted(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orgId = session.metadata?.org_id;
  const plan = session.metadata?.plan;
  if (!orgId || !plan) {
    console.error('checkout.session.completed missing org_id/plan metadata', session.id);
    return;
  }

  const stripe = getStripeClient();
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        org_id: orgId,
        plan,
        status: mapSubscriptionStatus(subscription.status),
        provider: 'stripe',
        provider_ref: subscription.id,
        stripe_customer_id:
          typeof session.customer === 'string' ? session.customer : session.customer?.id,
        started_at: new Date(subscription.start_date * 1000).toISOString(),
        current_period_end: new Date(
          subscription.current_period_end * 1000,
        ).toISOString(),
      },
      { onConflict: 'org_id' },
    );
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
}

// Looks up the plan whose `stripe_price_id` matches the subscription's
// current Stripe Price, so customer.subscription.updated can keep our copy
// of `subscriptions.plan` in sync when a customer changes plans through
// Stripe's Customer Portal. Returns null (rather than throwing) when the
// price doesn't match any known plan — e.g. a price not yet backfilled into
// `plans` — so the caller can skip the `plan` column instead of writing null
// into a `not null` column with a CHECK constraint.
async function resolvePlanCode(
  supabase: SupabaseClient,
  priceId: string | undefined,
): Promise<string | null> {
  if (!priceId) return null;
  const { data, error } = await supabase
    .from('plans')
    .select('code')
    .eq('stripe_price_id', priceId)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);
  return data?.code ?? null;
}

async function handleSubscriptionUpdated(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.error('customer.subscription.updated missing org_id metadata', subscription.id);
    return;
  }

  const planCode = await resolvePlanCode(
    supabase,
    subscription.items.data[0]?.price.id,
  );
  if (!planCode) {
    console.error(
      'customer.subscription.updated: no matching plan for price',
      subscription.items.data[0]?.price.id,
      subscription.id,
    );
  }

  const updatePayload: Record<string, unknown> = {
    status: mapSubscriptionStatus(subscription.status),
    current_period_end: new Date(
      subscription.current_period_end * 1000,
    ).toISOString(),
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
  };
  if (planCode) updatePayload.plan = planCode;

  const { error } = await supabase
    .from('subscriptions')
    .update(updatePayload)
    .eq('org_id', orgId)
    .eq('provider_ref', subscription.id);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);
}

async function handleSubscriptionDeleted(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) return;

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('provider_ref', subscription.id);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);
}

function invoiceNumberFrom(invoice: Stripe.Invoice): string {
  // Stripe's own invoice number if set, else fall back to its id — either
  // way this only has to be unique, `invoices.number` has no format check.
  return invoice.number || invoice.id;
}

async function handleInvoicePaid(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  const orgId = invoice.subscription_details?.metadata?.org_id;
  if (!orgId) {
    console.error('invoice.paid missing org_id metadata', invoice.id);
    return;
  }

  const line = invoice.lines.data[0];
  const periodStart = new Date(
    (line?.period.start ?? invoice.period_start) * 1000,
  );
  const periodEnd = new Date((line?.period.end ?? invoice.period_end) * 1000);
  const paidAt = new Date().toISOString();

  // No unique constraint on provider_ref (only `number` is unique, per
  // 0023_commercials.sql), so this cannot be an upsert with
  // onConflict: 'provider_ref' — that target has no matching unique index
  // and would error at runtime. Select first, then insert or update,
  // mirroring handleInvoicePaymentFailed below.
  const { data: existing } = await supabase
    .from('invoices')
    .select('id, attempts')
    .eq('provider_ref', invoice.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: paidAt,
        amount_pence: invoice.amount_paid,
        currency: invoice.currency.toUpperCase(),
        failure_reason: null,
      })
      .eq('id', existing.id);
    if (error) throw new Error(`invoices update (paid) failed: ${error.message}`);
  } else {
    const { error } = await supabase.from('invoices').insert({
      org_id: orgId,
      number: invoiceNumberFrom(invoice),
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      amount_pence: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),
      status: 'paid',
      issued_on: new Date(invoice.created * 1000).toISOString().slice(0, 10),
      due_on: invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10)
        : new Date(invoice.created * 1000).toISOString().slice(0, 10),
      paid_at: paidAt,
      provider: 'stripe',
      provider_ref: invoice.id,
    });
    if (error) throw new Error(`invoices insert (paid) failed: ${error.message}`);
  }
}

// `last_finalization_error` is set when Stripe fails to *finalize* an
// invoice (e.g. bad tax settings), not when a card is declined — the
// realistic failure mode. The actual decline reason lives on the invoice's
// PaymentIntent. This function receives the invoice straight from the
// webhook payload (not fetched fresh), so `payment_intent` is likely a
// string id rather than an expanded object; retrieve it to read
// `last_payment_error`.
async function resolveFailureReason(invoice: Stripe.Invoice): Promise<string> {
  const piId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id;
  if (piId) {
    try {
      const stripe = getStripeClient();
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.last_payment_error?.message) return pi.last_payment_error.message;
    } catch (err) {
      console.error('Failed to retrieve payment intent for failure reason:', err);
    }
  }
  return invoice.last_finalization_error?.message || 'Payment failed';
}

async function handleInvoicePaymentFailed(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  const orgId = invoice.subscription_details?.metadata?.org_id;
  if (!orgId) return;

  const failureReason = await resolveFailureReason(invoice);

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, attempts')
    .eq('provider_ref', invoice.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'past_due',
        failure_reason: failureReason,
        attempts: (existing.attempts ?? 0) + 1,
      })
      .eq('id', existing.id);
    if (error) throw new Error(`invoices update (past_due) failed: ${error.message}`);
  } else {
    const line = invoice.lines.data[0];
    const periodStart = new Date(
      (line?.period.start ?? invoice.period_start) * 1000,
    );
    const periodEnd = new Date((line?.period.end ?? invoice.period_end) * 1000);
    const { error } = await supabase.from('invoices').insert({
      org_id: orgId,
      number: invoiceNumberFrom(invoice),
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      amount_pence: invoice.amount_due,
      currency: invoice.currency.toUpperCase(),
      status: 'past_due',
      issued_on: new Date(invoice.created * 1000).toISOString().slice(0, 10),
      due_on: invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10)
        : new Date(invoice.created * 1000).toISOString().slice(0, 10),
      failure_reason: failureReason,
      attempts: 1,
      provider: 'stripe',
      provider_ref: invoice.id,
    });
    if (error) throw new Error(`invoices insert (past_due) failed: ${error.message}`);
  }

  const { error: subError } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('org_id', orgId);
  if (subError) {
    throw new Error(`subscriptions update (past_due) failed: ${subError.message}`);
  }
}

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return jsonResponse({ error: 'Missing stripe-signature header' }, 400);
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return jsonResponse({ error: 'Webhook not configured' }, 500);
  }

  const body = await req.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    // constructEventAsync, not constructEvent: Deno's Web Crypto API is
    // async, unlike Node's, and Stripe's SDK provides this variant
    // specifically for edge runtimes.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe signature verification failed:', err);
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(
          supabase,
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(
          supabase,
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(
          supabase,
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'invoice.paid':
        await handleInvoicePaid(supabase, event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(
          supabase,
          event.data.object as Stripe.Invoice,
        );
        break;
      default:
        // Unhandled event types are expected — Stripe's default webhook
        // config sends more than this function subscribes to handling.
        break;
    }
    return jsonResponse({ received: true });
  } catch (err) {
    console.error(`stripe-webhook handler error for ${event.type}:`, err);
    // Non-200 so Stripe retries — this is a real failure, not a signature
    // problem, and retry is the correct behaviour for a transient DB error.
    return jsonResponse({ error: 'Handler error' }, 500);
  }
});
