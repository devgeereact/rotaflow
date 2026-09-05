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
// Unlike the other two Stripe functions this one does NOT read STRIPE_MODE.
// Test and live events arrive at the same URL, and both must keep being
// processed while STRIPE_MODE points at one of them — flipping to test for a
// QA run must not start dropping live subscription updates. So the mode is
// taken per event from Stripe's own `livemode` flag and the matching signing
// secret is used to verify it. Register this URL as a webhook endpoint in
// both Stripe modes and set both secrets.
//
// Secrets: STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY (shared), STRIPE_WEBHOOK_SECRET
// and STRIPE_TEST_WEBHOOK_SECRET (from the
// Stripe dashboard's webhook endpoint config, or `stripe listen`'s own
// printed secret for local testing).
//
// After deploying: Stripe dashboard -> Developers -> Webhooks -> Add
// endpoint, pointed at <SUPABASE_URL>/functions/v1/stripe-webhook,
// subscribed to: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted, invoice.paid, invoice.payment_failed.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  getStripeClient,
  getWebhookSecret,
  priceColumn,
  type StripeMode,
} from '../_shared/stripe.ts';
import {
  decideInvoiceFailure,
  subscriptionRefOf,
  subscriptionScope,
} from './reconcile.ts';
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
  mode: StripeMode,
): Promise<void> {
  const orgId = session.metadata?.org_id;
  const plan = session.metadata?.plan;
  if (!orgId || !plan) {
    console.error('checkout.session.completed missing org_id/plan metadata', session.id);
    return;
  }

  const stripe = getStripeClient(mode);
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const { error } = await supabase.from('subscriptions').upsert(
    {
      org_id: orgId,
      plan,
      status: mapSubscriptionStatus(subscription.status),
      provider: 'stripe',
      provider_ref: subscription.id,
      stripe_customer_id:
        typeof session.customer === 'string' ? session.customer : session.customer?.id,
      // Records which Stripe namespace the two ids above live in, so
      // Checkout and the Portal can tell a reusable customer from one that
      // belongs to the other mode — see migration 0058.
      stripe_mode: mode,
      started_at: new Date(subscription.start_date * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
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
  mode: StripeMode,
): Promise<string | null> {
  if (!priceId) return null;
  // Match against this mode's Price column: a test Price never appears in
  // stripe_price_id, so looking in the wrong column resolves to no plan and
  // silently skips the `plan` update.
  const { data, error } = await supabase
    .from('plans')
    .select('code')
    .eq(priceColumn(mode), priceId)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);
  return data?.code ?? null;
}

async function handleSubscriptionUpdated(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  mode: StripeMode,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.error(
      'customer.subscription.updated missing org_id metadata',
      subscription.id,
    );
    return;
  }

  const planCode = await resolvePlanCode(
    supabase,
    subscription.items.data[0]?.price.id,
    mode,
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
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
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

  // Prefer Stripe's own canceled_at (the same mapping handleSubscriptionUpdated
  // already applies) so the recorded cancellation date stays the moment
  // cancellation was requested, not the moment it actually took effect here.
  // Those two can be weeks apart under the Customer Portal's default
  // cancel-at-period-end flow, and revenue.ts / platformOverview.ts read
  // canceled_at as when the cancellation happened, not when it landed —
  // rewriting it here would make a churn chart whose past silently moves.
  // Fall back to "now" only in the unlikely case Stripe never set it.
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('provider_ref', subscription.id);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);

  // Stripe's own dunning (Smart Retries) exhausts before this event fires;
  // `cancellation_details.reason === 'payment_failed'` is how Stripe tells
  // us the cancellation was involuntary (retries ran out) rather than the
  // customer cancelling on purpose ('cancellation_requested') or a disputed
  // charge ('payment_disputed'). Only the involuntary case should suspend
  // the org — set_org_status (Task 7) is the one write path allowed to move
  // an org into 'suspended', and it's called here with the service_role
  // caller this function already runs as.
  if (subscription.cancellation_details?.reason === 'payment_failed') {
    const { error: statusError } = await supabase.rpc('set_org_status', {
      p_org: orgId,
      p_status: 'suspended',
      p_reason: `Stripe subscription ${subscription.id} canceled after exhausted dunning`,
    });
    if (statusError) {
      throw new Error(`org suspension failed: ${statusError.message}`);
    }
  }
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
  const periodStart = new Date((line?.period.start ?? invoice.period_start) * 1000);
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
async function resolveFailureReason(
  invoice: Stripe.Invoice,
  mode: StripeMode,
): Promise<string> {
  const piId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id;
  if (piId) {
    try {
      const stripe = getStripeClient(mode);
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
  mode: StripeMode,
): Promise<void> {
  const orgId = invoice.subscription_details?.metadata?.org_id;
  if (!orgId) return;

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, attempts, status, paid_at')
    .eq('provider_ref', invoice.id)
    .maybeSingle();

  // RF-04. Stripe delivers at least once and does not promise order, so a
  // failure from before the customer's successful retry can land after the
  // `invoice.paid` for the same invoice, and Stripe retries its own webhook
  // until it gets a 200. The old code wrote `past_due` and incremented
  // `attempts` on every delivery regardless of either, which suspended a
  // customer who had already paid and inflated the dunning count with
  // webhook retries rather than card attempts. See `reconcile.ts`.
  const decision = decideInvoiceFailure(existing, invoice.attempt_count);
  if (!decision.apply) {
    console.log(`invoice.payment_failed ${invoice.id}: no change (${decision.reason})`);
    return;
  }

  const failureReason = await resolveFailureReason(invoice, mode);

  if (existing) {
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'past_due',
        failure_reason: failureReason,
        attempts: decision.attempts,
      })
      .eq('id', existing.id);
    if (error) throw new Error(`invoices update (past_due) failed: ${error.message}`);
  } else {
    const line = invoice.lines.data[0];
    const periodStart = new Date((line?.period.start ?? invoice.period_start) * 1000);
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
      attempts: decision.attempts,
      provider: 'stripe',
      provider_ref: invoice.id,
    });
    if (error) throw new Error(`invoices insert (past_due) failed: ${error.message}`);
  }

  // `past_due_since` and `grace_until` are NOT set here. A trigger derives
  // them from `status` (0098), so a replayed event, a support tool or a
  // manual correction cannot leave the three disagreeing — and a second
  // failed payment inside one dunning run cannot restart the clock, which
  // would make the deadline permanently a fortnight away.
  //
  // RF-05. This filtered on `org_id` alone while the handler deliberately
  // accepts both Stripe modes at one URL, so a TEST fixture carrying a live
  // organisation's id could mark that live subscription past due, and an
  // invoice belonging to a replaced subscription could suspend its
  // replacement. Every other handler here already scoped by `provider_ref`;
  // this one did not. An event we cannot pin to one subscription is one whose
  // target we do not know, so it declines to write rather than widening.
  const scope = subscriptionScope(orgId, subscriptionRefOf(invoice), mode);
  if (!scope) {
    console.error(
      `invoice.payment_failed ${invoice.id} names no subscription; the invoice was recorded but no subscription was suspended`,
    );
    return;
  }

  const { error: subError } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('org_id', scope.org_id)
    .eq('provider_ref', scope.provider_ref)
    .eq('stripe_mode', scope.stripe_mode);
  if (subError) {
    throw new Error(`subscriptions update (past_due) failed: ${subError.message}`);
  }
}

/**
 * Reads `livemode` out of an as-yet-unverified event body. Defaults to live
 * when the body is unparseable or the flag is absent: an unsigned request is
 * about to be rejected either way, and defaulting to live keeps a malformed
 * *genuine* live event failing loudly against the live secret rather than
 * being misreported as a test-mode configuration problem.
 */
function peekLivemode(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'livemode' in parsed) {
      return (parsed as { livemode: unknown }).livemode !== false;
    }
  } catch {
    // not JSON — signature verification will reject it in a moment
  }
  return true;
}

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return jsonResponse({ error: 'Missing stripe-signature header' }, 400);
  }

  const body = await req.text();

  // Which mode this event came from, read from the unverified body purely to
  // choose a signing secret. Nothing is trusted on the strength of it: the
  // signature is still verified against that secret immediately below, so a
  // forged `livemode` only picks the wrong secret and fails verification.
  //
  // This is why the webhook does not consult STRIPE_MODE. Both modes' events
  // arrive at the same URL and both must keep working while STRIPE_MODE
  // points at one of them — otherwise flipping to test mode for a QA run
  // would start silently dropping live subscription updates.
  const mode: StripeMode = peekLivemode(body) ? 'live' : 'test';

  const webhookSecret = getWebhookSecret(mode);
  if (!webhookSecret) {
    console.error(
      `No webhook signing secret configured for ${mode} mode — set ${
        mode === 'live' ? 'STRIPE_WEBHOOK_SECRET' : 'STRIPE_TEST_WEBHOOK_SECRET'
      }`,
    );
    return jsonResponse({ error: 'Webhook not configured' }, 500);
  }

  const stripe = getStripeClient(mode);

  let event: Stripe.Event;
  try {
    // constructEventAsync, not constructEvent: Deno's Web Crypto API is
    // async, unlike Node's, and Stripe's SDK provides this variant
    // specifically for edge runtimes.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    reportEdgeError(err, 'stripe-webhook:signature', { mode });
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // RF-04. Record the delivery before acting on it, and mark it finished only
  // once its effects have committed. Stripe delivers at least once by design
  // and retries until it gets a 200, so without this an event that succeeded
  // and then lost its response was applied again on the retry.
  //
  // `claim_billing_event` returns false only for an event already processed to
  // completion. A redelivery of one that was interrupted returns true, because
  // finishing it is exactly what the retry is for.
  const orgIdOf = (e: Stripe.Event): string | null => {
    const object = e.data.object as {
      metadata?: Record<string, string> | null;
      subscription_details?: { metadata?: Record<string, string> | null } | null;
    };
    return (
      object.metadata?.org_id ?? object.subscription_details?.metadata?.org_id ?? null
    );
  };

  let shouldProcess = true;
  try {
    const { data, error } = await supabase.rpc('claim_billing_event', {
      p_provider: 'stripe',
      p_mode: mode,
      p_event_id: event.id,
      p_event_type: event.type,
      p_org: orgIdOf(event),
      p_created_at: new Date(event.created * 1000).toISOString(),
    });
    if (error) throw new Error(error.message);
    shouldProcess = data !== false;
  } catch (err) {
    // The ledger being unavailable must not silently turn idempotency off.
    // A 500 makes Stripe retry, which is the safe direction.
    reportEdgeError(err, 'stripe-webhook:claim', { eventType: event.type });
    return jsonResponse({ error: 'Could not record the event' }, 500);
  }

  if (!shouldProcess) {
    // Already applied. 200, so Stripe stops retrying.
    return jsonResponse({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(
          supabase,
          event.data.object as Stripe.Checkout.Session,
          mode,
        );
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(
          supabase,
          event.data.object as Stripe.Subscription,
          mode,
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
          mode,
        );
        break;
      default:
        // Unhandled event types are expected — Stripe's default webhook
        // config sends more than this function subscribes to handling.
        break;
    }

    // Only now. An event marked processed before its effects committed is one
    // Stripe will never send again and this database never applied.
    await supabase.rpc('complete_billing_event', {
      p_provider: 'stripe',
      p_mode: mode,
      p_event_id: event.id,
    });
    return jsonResponse({ received: true });
  } catch (err) {
    // The one place money and subscription state change. A webhook that
    // throws here is Stripe believing something happened that this database
    // does not record.
    reportEdgeError(err, 'stripe-webhook:handler', { eventType: event.type });
    // The receipt keeps `processed_at` null, so the retry below reprocesses
    // it. Recording why makes an event that keeps failing visible rather than
    // only countable in Stripe's dashboard.
    await supabase
      .rpc('fail_billing_event', {
        p_provider: 'stripe',
        p_mode: mode,
        p_event_id: event.id,
        p_error: err instanceof Error ? err.message : String(err),
      })
      .then(undefined, () => undefined);
    // Non-200 so Stripe retries — this is a real failure, not a signature
    // problem, and retry is the correct behaviour for a transient DB error.
    return jsonResponse({ error: 'Handler error' }, 500);
  }
});
