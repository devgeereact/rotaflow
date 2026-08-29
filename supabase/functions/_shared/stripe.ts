// _shared/stripe.ts. RotaFlow
//
// One Stripe client construction, shared by create-checkout-session,
// create-portal-session and stripe-webhook, so the API version and the
// missing-secret error message can't drift between the three.
//
// Test and live credentials can both be set at once. STRIPE_MODE decides
// which pair Checkout and the Portal use; the webhook ignores it and picks
// per event from the event's own `livemode` flag, so events from both modes
// keep working while STRIPE_MODE points at one of them.

import Stripe from 'npm:stripe@17';

export type StripeMode = 'test' | 'live';

const SECRET_KEY_ENV: Record<StripeMode, string> = {
  live: 'STRIPE_SECRET_KEY',
  test: 'STRIPE_TEST_SECRET_KEY',
};

const WEBHOOK_SECRET_ENV: Record<StripeMode, string> = {
  live: 'STRIPE_WEBHOOK_SECRET',
  test: 'STRIPE_TEST_WEBHOOK_SECRET',
};

/**
 * Which mode Checkout and the Portal run in.
 *
 * Unset means live. That default is deliberate: a deployment that predates
 * this seam has no STRIPE_MODE secret, and it must keep charging real cards
 * exactly as before rather than quietly falling back to test mode and
 * accepting no money at all. Anything other than a recognised value is
 * treated as a misconfiguration, not as "probably test" — guessing wrong in
 * that direction is the expensive one.
 */
export function getStripeMode(): StripeMode {
  const raw = Deno.env.get('STRIPE_MODE')?.trim().toLowerCase();
  if (!raw) return 'live';
  if (raw === 'test' || raw === 'live') return raw;
  throw new Error(`STRIPE_MODE must be "test" or "live", got "${raw}"`);
}

/**
 * Catches the swap that produces the most confusing failure: a live key set
 * under the test variable (or the reverse). Stripe would accept the key and
 * happily operate in the *other* mode, so a "test" run could take real money.
 * Restricted keys (rk_) carry no mode prefix, so they are let through.
 */
function assertKeyMatchesMode(key: string, mode: StripeMode, envName: string): void {
  const wrong = mode === 'test' ? 'sk_live_' : 'sk_test_';
  if (key.startsWith(wrong)) {
    throw new Error(
      `${envName} holds a ${wrong}… key but STRIPE_MODE is "${mode}" — refusing to run in the wrong Stripe mode`,
    );
  }
}

export function getStripeClient(mode: StripeMode = getStripeMode()): Stripe {
  const envName = SECRET_KEY_ENV[mode];
  const key = Deno.env.get(envName);
  if (!key) {
    throw new Error(`${envName} is not set (STRIPE_MODE is "${mode}")`);
  }
  assertKeyMatchesMode(key, mode, envName);
  return new Stripe(key, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * The signing secret for one mode. Returns undefined rather than throwing so
 * the webhook can report "no secret configured for this mode" against the
 * mode the event actually came from, which is the useful message.
 */
export function getWebhookSecret(mode: StripeMode): string | undefined {
  return Deno.env.get(WEBHOOK_SECRET_ENV[mode]);
}

/** The `plans` column holding the Price ID for this mode. */
export function priceColumn(mode: StripeMode): 'stripe_price_id' | 'stripe_test_price_id' {
  return mode === 'test' ? 'stripe_test_price_id' : 'stripe_price_id';
}
