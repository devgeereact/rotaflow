import { describe, expect, it } from 'vitest';
import { ALREADY_SUBSCRIBED as CLIENT_CODE } from '@/lib/billingState';
import { ALREADY_SUBSCRIBED, checkoutTrialEnd, decideCheckout } from './guard';

/**
 * A second Checkout for an organisation that is already paying created a
 * second Stripe subscription, and the webhook's upsert on `org_id` orphaned
 * the first one while it kept charging. These hold the refusal.
 *
 * The handler half (the 409 response, the Stripe call it prevents) needs Deno
 * and is NOT covered here.
 */

const stripeSub = (status: string, mode = 'live') => ({
  status,
  provider_ref: 'sub_123',
  stripe_mode: mode,
});

describe('decideCheckout', () => {
  it('allows Checkout when the organisation has no subscription row', () => {
    expect(decideCheckout(null, 'live')).toEqual({ allow: true });
  });

  it.each(['trialing', 'active', 'past_due'])(
    'refuses a second Checkout while a %s Stripe subscription exists',
    (status) => {
      expect(decideCheckout(stripeSub(status), 'live')).toEqual({
        allow: false,
        reason: ALREADY_SUBSCRIBED,
      });
    },
  );

  it('allows resubscribing after cancellation', () => {
    expect(decideCheckout(stripeSub('canceled'), 'live').allow).toBe(true);
  });

  it('does not block on a row with no Stripe subscription behind it', () => {
    // 0084 creates admin-led organisations with an `active` row and no
    // provider_ref; the column default is `trialing`. Neither is a Stripe
    // subscription that Checkout could duplicate.
    expect(
      decideCheckout(
        { status: 'active', provider_ref: null, stripe_mode: 'live' },
        'live',
      ).allow,
    ).toBe(true);
    expect(
      decideCheckout(
        { status: 'trialing', provider_ref: null, stripe_mode: 'live' },
        'live',
      ).allow,
    ).toBe(true);
  });

  it('does not let a test-mode subscription block a live Checkout', () => {
    expect(decideCheckout(stripeSub('active', 'test'), 'live').allow).toBe(true);
  });

  it('refuses in test mode too, when the subscription is a test one', () => {
    expect(decideCheckout(stripeSub('active', 'test'), 'test').allow).toBe(false);
  });

  it('uses the same error code the browser matches on', () => {
    expect(ALREADY_SUBSCRIBED).toBe(CLIENT_CODE);
  });
});

describe('checkoutTrialEnd', () => {
  const now = new Date('2026-10-12T09:00:00Z');

  it('carries the organisation trial end into Stripe, in Unix seconds', () => {
    expect(checkoutTrialEnd('2026-11-01T09:00:00Z', now)).toBe(
      Date.parse('2026-11-01T09:00:00Z') / 1000,
    );
  });

  it('charges now when the trial has ended', () => {
    expect(checkoutTrialEnd('2026-10-01T09:00:00Z', now)).toBeNull();
  });

  it('charges now when the trial is too close for Stripe to accept', () => {
    // 47 hours: Stripe needs at least 48 for a Checkout trial.
    expect(checkoutTrialEnd('2026-10-14T08:00:00Z', now)).toBeNull();
  });

  it('charges now when there is no trial or it is unreadable', () => {
    expect(checkoutTrialEnd(null, now)).toBeNull();
    expect(checkoutTrialEnd('not a date', now)).toBeNull();
  });
});
