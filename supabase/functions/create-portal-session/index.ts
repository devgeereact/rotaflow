// create-portal-session. RotaFlow
//
// Org owner clicks "Manage billing" on Settings > Billing -> this opens
// Stripe's own hosted Customer Portal (invoices, card updates,
// cancellation all handled by Stripe, not built here — see the design
// spec's "Invoice history / payment method UI" decision).
//
// Same JWT-forwarding + owner-check pattern as create-checkout-session.
//
// Deploy: `supabase functions deploy create-portal-session`.
// Secrets: shares STRIPE_MODE and the mode's secret key with the other two
// Stripe functions — see _shared/stripe.ts.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getStripeClient, getStripeMode } from '../_shared/stripe.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: requestCorsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const { orgId } = (await req.json()) as RequestBody;
    if (!orgId) {
      return jsonResponse({ error: 'orgId is required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonResponse({ error: 'Not authenticated' }, 401);
    }

    // `status = 'active'` is not optional — see the same check in
    // create-checkout-session. The Customer Portal is the higher-value target
    // of the two: it can cancel the subscription or change the payment method,
    // so a suspended owner reaching it is worse than one reaching Checkout.
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || membership.role !== 'owner') {
      return jsonResponse(
        { error: 'Only the organisation owner can manage billing' },
        403,
      );
    }

    const mode = getStripeMode();

    const { data: sub, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_mode')
      .eq('org_id', orgId)
      .maybeSingle();
    if (subError) throw subError;
    if (!sub?.stripe_customer_id) {
      return jsonResponse(
        { error: 'No billing account yet — choose a plan first' },
        404,
      );
    }

    // Unlike Checkout, the Portal has no fallback: it needs an existing
    // customer, and a customer from the other Stripe mode does not exist in
    // this one. Say so plainly rather than letting Stripe answer with a raw
    // "No such customer" — this is a deployment misconfiguration, not
    // something the owner did wrong.
    if (sub.stripe_mode !== mode) {
      console.error(
        `portal blocked: org ${orgId} customer is ${sub.stripe_mode}-mode, STRIPE_MODE is ${mode}`,
      );
      return jsonResponse(
        { error: 'Billing is temporarily unavailable — please contact support' },
        409,
      );
    }

    const stripe = getStripeClient(mode);
    const origin = req.headers.get('Origin') || 'https://rotaflow.space';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/app/settings/billing`,
    });

    return jsonResponse({ url: portalSession.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    return jsonResponse({ error: 'Unexpected error creating portal session' }, 500);
  }
});
