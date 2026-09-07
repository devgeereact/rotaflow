import { describe, expect, it } from 'vitest';
import { decideInvoiceFailure, subscriptionRefOf, subscriptionScope } from './reconcile';

/**
 * RF-04 and RF-05 — Stripe's delivery guarantees, held in a test.
 *
 * The audit executed the handler's logic against fake provider and database
 * adapters and drove three deliveries: `invoice.paid`, then an OLDER
 * `invoice.payment_failed`, then that same failure again. The organisation
 * finished `past_due` with `attempts = 2` and `paid_at` still set — a paid
 * customer suspended by a redelivery, and a dunning count inflated by Stripe
 * retrying its own webhook rather than by a second attempt on the card.
 * Separately, the subscription update was filtered on `org_id` alone while
 * both Stripe modes deliver to the same URL.
 *
 * Stripe documents both properties this guards: delivery is at-least-once and
 * order is not guaranteed. https://docs.stripe.com/webhooks
 *
 * These run under vitest because `reconcile.ts` has no Deno globals in it, the
 * same arrangement `ai-rota-assistant/grounding.ts` uses. The transport half —
 * signature verification, the receipt RPCs — still needs Deno and is NOT
 * covered here.
 */

describe('decideInvoiceFailure', () => {
  it('records the first failure', () => {
    expect(decideInvoiceFailure(null, undefined)).toEqual({
      apply: true,
      attempts: 1,
      reason: 'first-failure',
    });
  });

  it('does not regress an invoice that is already paid', () => {
    // The out-of-order case. Stripe promises no ordering, so the failure from
    // before the customer's successful retry can arrive after the paid event.
    const decision = decideInvoiceFailure(
      { status: 'paid', paid_at: '2026-09-01T10:00:00Z', attempts: 1 },
      2,
    );
    expect(decision.apply).toBe(false);
    expect(decision.reason).toBe('already-paid');
  });

  it('treats a paid_at with a stale status as paid too', () => {
    expect(
      decideInvoiceFailure({ status: 'past_due', paid_at: '2026-09-01T10:00:00Z' }, 3)
        .apply,
    ).toBe(false);
  });

  it('does not count a webhook redelivery as another card attempt', () => {
    // Stripe retries its own webhook until it gets a 200. The old handler did
    // `attempts + 1` on each delivery, so the dunning count — and therefore
    // the grace window — moved because of RotaFlow's downtime, not the
    // customer's card.
    const decision = decideInvoiceFailure({ status: 'past_due', attempts: 2 }, 2);
    expect(decision.apply).toBe(false);
    expect(decision.reason).toBe('duplicate-delivery');
    expect(decision.attempts).toBe(2);
  });

  it('advances on a genuine second card attempt', () => {
    const decision = decideInvoiceFailure({ status: 'past_due', attempts: 1 }, 2);
    expect(decision).toEqual({
      apply: true,
      attempts: 2,
      reason: 'further-failure',
    });
  });

  it("prefers Stripe's own attempt_count over a local increment", () => {
    // Stripe has retried the card four times; we saw one. Its count wins.
    expect(decideInvoiceFailure({ status: 'past_due', attempts: 1 }, 4).attempts).toBe(4);
  });

  it('never counts backwards when an early event arrives late', () => {
    expect(decideInvoiceFailure({ status: 'past_due', attempts: 5 }, 2).attempts).toBe(5);
  });

  it('falls back to one more than held when Stripe sends no count', () => {
    expect(decideInvoiceFailure({ status: 'past_due', attempts: 2 }, undefined)).toEqual({
      apply: true,
      attempts: 3,
      reason: 'further-failure',
    });
  });
});

describe('subscriptionScope', () => {
  it('pins a financial write to one subscription in one mode', () => {
    expect(subscriptionScope('org-1', 'sub_live_1', 'live')).toEqual({
      org_id: 'org-1',
      provider_ref: 'sub_live_1',
      stripe_mode: 'live',
    });
  });

  it('keeps a test event out of the live namespace', () => {
    // The two modes deliver to the same URL on purpose. Without the mode in
    // the filter, this test fixture would reach the live subscription that
    // shares the org id.
    const test = subscriptionScope('org-1', 'sub_test_1', 'test');
    const live = subscriptionScope('org-1', 'sub_live_1', 'live');
    expect(test).not.toEqual(live);
    expect(test?.stripe_mode).toBe('test');
  });

  it('refuses to widen when the event names no subscription', () => {
    // The old code fell back to org_id alone here, which is what let an
    // invoice from a replaced subscription suspend its replacement.
    expect(subscriptionScope('org-1', null, 'live')).toBeNull();
    expect(subscriptionScope('org-1', undefined, 'live')).toBeNull();
    expect(subscriptionScope(null, 'sub_1', 'live')).toBeNull();
  });
});

describe('subscriptionRefOf', () => {
  it('reads a bare id', () => {
    expect(subscriptionRefOf({ subscription: 'sub_1' })).toBe('sub_1');
  });

  it('reads an expanded object', () => {
    expect(subscriptionRefOf({ subscription: { id: 'sub_2' } })).toBe('sub_2');
  });

  it('returns null when there is none', () => {
    expect(subscriptionRefOf({ subscription: null })).toBeNull();
    expect(subscriptionRefOf({})).toBeNull();
  });
});
