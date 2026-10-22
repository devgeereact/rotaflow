// billing-account. RotaFlow
//
// Two small owner actions on the organisation's Stripe customer, from
// Settings, Billing (docs/SAAS.md GAP-128, GAP-129):
//
//   sync_contact   write the billing contact the owner set to the Stripe
//                  customer's email, so receipts and invoices go there and
//                  not to whoever went through Checkout.
//   invoice_links  retrieve one invoice and return its current hosted page
//                  and PDF links, because Stripe expires a stored hosted link
//                  30 to 120 days after the invoice is due.
//
// Same JWT-forwarding and owner check as create-portal-session: the client
// is built with the caller's JWT, so RLS scopes every read, and the
// organisation row and the invoice row are read as the caller. Only stored
// values reach Stripe (the stored customer id, the stored invoice
// `provider_ref`, the stored contact email); the browser never names a
// Stripe object. Links come back only if they are on Stripe's own hosts,
// through the same filter the webhook writes with.
//
// The refreshed links are returned, not stored: writing `invoices` needs
// `service_role`, and an owner who refreshes a link opens it straight away.
// The stored link is still replaced on Stripe's next event for the invoice.
//
// Deploy: `supabase functions deploy billing-account`. Merging does not
// deploy it. Secrets: shares STRIPE_MODE and the mode's secret key with the
// other Stripe functions (see _shared/stripe.ts).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import {
  getStripeClient,
  getStripeMode,
  stripeModeIsConfigured,
} from '../_shared/stripe.ts';
import { invoiceDocuments } from '../stripe-webhook/reconcile.ts';
import {
  billingContactEmail,
  isStripeInvoiceId,
  parseBillingAccountRequest,
} from './request.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
let requestCorsHeaders: Record<string, string> = {};

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'A JSON body is required' }, 400);
    }
    const parsed = parseBillingAccountRequest(body);
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, 400);
    }
    const request = parsed.value;

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

    // An active owner only, as in create-portal-session: billing is the
    // owner's, and a suspended membership must not reach Stripe.
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('org_id', request.orgId)
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

    if (!stripeModeIsConfigured()) {
      return jsonResponse(
        {
          error:
            'Billing is not configured on this deployment: the STRIPE_MODE secret is not set. ' +
            'Set it to "test" or "live" on the Supabase project.',
        },
        503,
      );
    }
    const mode = getStripeMode();

    const { data: sub, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_mode')
      .eq('org_id', request.orgId)
      .maybeSingle();
    if (subError) throw subError;
    if (!sub?.stripe_customer_id) {
      return jsonResponse({ error: 'No billing account yet. Choose a plan first.' }, 404);
    }
    // A customer from the other Stripe mode does not exist in this one. Same
    // refusal as the Portal: a deployment misconfiguration, not the owner's.
    if (sub.stripe_mode !== mode) {
      console.error(
        `billing-account blocked: org ${request.orgId} customer is ${sub.stripe_mode}-mode, STRIPE_MODE is ${mode}`,
      );
      return jsonResponse(
        { error: 'Billing is temporarily unavailable. Please contact support.' },
        409,
      );
    }

    const stripe = getStripeClient(mode);

    if (request.action === 'sync_contact') {
      const { data: org, error: orgError } = await supabase
        .from('organisations')
        .select('contact_email, settings')
        .eq('id', request.orgId)
        .maybeSingle();
      if (orgError) throw orgError;
      const email = org ? billingContactEmail(org) : null;
      if (!email) {
        return jsonResponse(
          {
            error:
              'Set a contact email in Settings, Organisation first. That address is the billing contact.',
          },
          422,
        );
      }
      await stripe.customers.update(sub.stripe_customer_id, { email });
      return jsonResponse({ email });
    }

    // invoice_links. Read as the caller, so `invoices_select` decides whether
    // the owner may see this invoice at all.
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, provider, provider_ref')
      .eq('id', request.invoiceId)
      .eq('org_id', request.orgId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) {
      return jsonResponse({ error: 'Invoice not found' }, 404);
    }
    if (invoice.provider !== 'stripe' || !isStripeInvoiceId(invoice.provider_ref)) {
      return jsonResponse(
        {
          error: 'This invoice was not issued through Stripe, so it has no Stripe link.',
        },
        422,
      );
    }

    const fresh = await stripe.invoices.retrieve(invoice.provider_ref);
    return jsonResponse(invoiceDocuments(fresh));
  } catch (err) {
    reportEdgeError(err, 'billing-account:unhandled');
    return jsonResponse({ error: 'Unexpected error reaching billing' }, 500);
  }
});
