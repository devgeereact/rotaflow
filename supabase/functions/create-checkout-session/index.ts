// create-checkout-session. RotaFlow
//
// Org owner picks a plan on Settings > Billing -> this creates a Stripe
// Checkout Session and returns its URL for a full-page redirect. No
// Stripe.js on the client: Checkout is entirely hosted by Stripe.
//
// Runs as the calling user (their JWT is forwarded into the Supabase
// client below, same pattern as ai-rota-assistant) so RLS scopes the
// plan lookup and the owner-role check queries memberships directly
// under that same RLS-scoped client — never service_role. Billing is
// owner-only, matching subscriptions' own RLS.
//
// Deploy: `supabase functions deploy create-checkout-session`.
// Secrets: STRIPE_MODE (test | live, defaults to live) selects which of
// STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY is used and which `plans`
// Price column is read — see _shared/stripe.ts and migration 0058.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getStripeClient, getStripeMode, priceColumn } from '../_shared/stripe.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
  planCode: string;
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

    const { orgId, planCode } = (await req.json()) as RequestBody;
    if (!orgId || !planCode) {
      return jsonResponse({ error: 'orgId and planCode are required' }, 400);
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

    // `status = 'active'` is not optional. `has_org_role` (0002) gates every
    // in-app permission on it, and membership status is how an owner is
    // suspended or how an invite that was never accepted is held back. Without
    // it this check accepts a 'suspended' or 'invited' owner — and
    // `memberships_select` lets them read their own row, so the query returns
    // a matching membership and the request proceeds to Stripe.
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
        { error: 'Only the organisation owner can change billing' },
        403,
      );
    }

    // Test and live Prices are different objects in different Stripe
    // namespaces, so each mode reads its own column — see 0058.
    const mode = getStripeMode();
    const column = priceColumn(mode);

    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select(`code, name, ${column}`)
      .eq('code', planCode)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) {
      return jsonResponse({ error: `Unknown plan: ${planCode}` }, 400);
    }
    const priceId = (plan as Record<string, string | null>)[column];
    if (!priceId) {
      return jsonResponse(
        { error: `${plan.name} is not available for checkout yet` },
        409,
      );
    }

    const { data: existingSub, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_mode')
      .eq('org_id', orgId)
      .maybeSingle();
    if (subError) throw subError;

    // A customer id only exists inside the mode that created it. Reusing a
    // live one in test mode (or vice versa) is a "No such customer" error
    // from Stripe, so let Stripe create a fresh customer for this mode
    // instead of handing it an id it cannot resolve.
    const reusableCustomerId =
      existingSub && existingSub.stripe_mode === mode
        ? existingSub.stripe_customer_id
        : null;

    const stripe = getStripeClient(mode);
    const origin = req.headers.get('Origin') || 'https://rotaflow.space';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: reusableCustomerId || undefined,
      client_reference_id: orgId,
      subscription_data: { metadata: { org_id: orgId, plan: planCode } },
      metadata: { org_id: orgId, plan: planCode },
      success_url: `${origin}/app/settings/billing?checkout=success`,
      cancel_url: `${origin}/app/settings/billing?checkout=cancelled`,
    });

    if (!session.url) {
      return jsonResponse({ error: 'Stripe did not return a checkout URL' }, 502);
    }

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return jsonResponse({ error: 'Unexpected error creating checkout session' }, 500);
  }
});
