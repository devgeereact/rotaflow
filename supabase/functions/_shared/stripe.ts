// _shared/stripe.ts. RotaFlow
//
// One Stripe client construction, shared by create-checkout-session,
// create-portal-session and stripe-webhook, so the API version and the
// missing-secret error message can't drift between the three.

import Stripe from 'npm:stripe@17';

export function getStripeClient(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  return new Stripe(key, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
