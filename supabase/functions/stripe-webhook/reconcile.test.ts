import { describe, expect, it } from 'vitest';
import {
  decideInvoiceFailure,
  documentsToWrite,
  invoiceDocuments,
  needsDocumentRetrieval,
  stripeDocumentUrl,
  isAlreadyQueued,
  paymentFailedNotification,
  trialEndingNotification,
  trialEndsAtIso,
  freshestSubscription,
  mapSubscriptionStatus,
  shouldSuspendOnDeleted,
  subscriptionRefOf,
  subscriptionScope,
  subscriptionUpdatePayload,
} from './reconcile';

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

describe('customer.subscription.updated ordering', () => {
  // Stripe does not deliver events in order, and `event.created` is whole
  // seconds, so it cannot sort them. The handler writes the subscription as
  // Stripe holds it now, retrieved at processing time, instead of the event's
  // own copy. https://docs.stripe.com/events/how-events-work#event-ordering
  const PERIOD_END = 1_790_000_000;
  const snapshot = (status: string, canceledAt: number | null = null) => ({
    id: 'sub_1',
    status,
    current_period_end: PERIOD_END,
    canceled_at: canceledAt,
  });

  it('writes the retrieved state, not a stale payload', () => {
    // An older `updated` carrying past_due arrives after the card recovered.
    const current = snapshot('active');
    const chosen = freshestSubscription(snapshot('past_due'), current);
    expect(chosen).toBe(current);
    expect(subscriptionUpdatePayload(current).status).toBe('active');
  });

  it('does not resurrect a subscription cancelled after the event was sent', () => {
    const current = snapshot('canceled', PERIOD_END - 86_400);
    expect(freshestSubscription(snapshot('active'), current)).toBe(current);
    const payload = subscriptionUpdatePayload(current);
    expect(payload.status).toBe('canceled');
    expect(payload.canceled_at).toBe(
      new Date((PERIOD_END - 86_400) * 1000).toISOString(),
    );
  });

  it('declines when retrieval failed or named another subscription', () => {
    const event = snapshot('active');
    expect(freshestSubscription(event, null)).toBeNull();
    expect(freshestSubscription(event, { ...event, id: 'sub_2' })).toBeNull();
  });

  it('builds the payload in ISO time from Stripe seconds', () => {
    expect(
      subscriptionUpdatePayload({
        id: 'sub_1',
        status: 'trialing',
        current_period_end: 0,
        canceled_at: null,
      }),
    ).toEqual({
      status: 'trialing',
      current_period_end: '1970-01-01T00:00:00.000Z',
      canceled_at: null,
      trial_ends_at: null,
    });
  });
});

describe('mapSubscriptionStatus', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['incomplete', 'past_due'],
    ['incomplete_expired', 'past_due'],
    ['canceled', 'canceled'],
    ['paused', 'canceled'],
    ['something_new', 'past_due'],
  ])('maps %s to %s', (stripe, stored) => {
    expect(mapSubscriptionStatus(stripe)).toBe(stored);
  });
});

describe('customer.subscription.deleted ordering', () => {
  it('suspends after exhausted dunning on the subscription the organisation holds', () => {
    expect(shouldSuspendOnDeleted(true, 'payment_failed')).toBe(true);
  });

  it('does not suspend a paying replacement when a late deleted names the old one', () => {
    // The cancellation matched no row because provider_ref has moved on.
    expect(shouldSuspendOnDeleted(false, 'payment_failed')).toBe(false);
  });

  it('does not suspend on a voluntary cancellation or a dispute', () => {
    expect(shouldSuspendOnDeleted(true, 'cancellation_requested')).toBe(false);
    expect(shouldSuspendOnDeleted(true, 'payment_disputed')).toBe(false);
    expect(shouldSuspendOnDeleted(true, null)).toBe(false);
  });
});

describe('trial and payment notices (F16)', () => {
  const trialEnd = Date.parse('2026-10-15T09:00:00Z') / 1000;

  it('tells the owners their trial ends in 3 days, with the charge date', () => {
    const row = trialEndingNotification({
      orgId: 'org_1',
      ownerIds: ['u_1'],
      subscriptionId: 'sub_1',
      trialEnd,
      mode: 'live',
    });
    expect(row).toEqual({
      org_id: 'org_1',
      event_name: 'billing/trial_will_end',
      payload: {
        orgId: 'org_1',
        userIds: ['u_1'],
        type: 'billing',
        title: 'Your trial ends in 3 days',
        body: 'Your card will first be charged on 15 October 2026. To change plan or cancel, open Settings, Billing.',
      },
      dedupe_key: `stripe:trial_will_end:live:sub_1:${trialEnd}`,
    });
  });

  it('writes nothing when there is no owner to tell', () => {
    expect(
      trialEndingNotification({
        orgId: 'org_1',
        ownerIds: [],
        subscriptionId: 'sub_1',
        trialEnd,
        mode: 'live',
      }),
    ).toBeNull();
    expect(
      paymentFailedNotification({
        orgId: 'org_1',
        ownerIds: [],
        invoiceId: 'in_1',
        mode: 'live',
      }),
    ).toBeNull();
  });

  it('keys a payment failure on the invoice, so retries do not repeat it', () => {
    const first = paymentFailedNotification({
      orgId: 'org_1',
      ownerIds: ['u_1', 'u_2'],
      invoiceId: 'in_1',
      mode: 'test',
    });
    expect(first?.payload.title).toBe('Payment failed');
    expect(first?.payload.userIds).toEqual(['u_1', 'u_2']);
    expect(first?.dedupe_key).toBe('stripe:payment_failed:test:in_1');
  });

  it('keeps test and live notices apart', () => {
    const live = trialEndingNotification({
      orgId: 'o',
      ownerIds: ['u'],
      subscriptionId: 's',
      trialEnd,
      mode: 'live',
    });
    const test = trialEndingNotification({
      orgId: 'o',
      ownerIds: ['u'],
      subscriptionId: 's',
      trialEnd,
      mode: 'test',
    });
    expect(live?.dedupe_key).not.toBe(test?.dedupe_key);
  });

  it('reads a unique violation as already queued, and nothing else', () => {
    expect(isAlreadyQueued({ code: '23505' })).toBe(true);
    expect(isAlreadyQueued({ code: '42501' })).toBe(false);
    expect(isAlreadyQueued(null)).toBe(false);
  });

  it('records a Stripe trial end in ISO time, and no trial as null', () => {
    expect(trialEndsAtIso(trialEnd)).toBe('2026-10-15T09:00:00.000Z');
    expect(trialEndsAtIso(null)).toBeNull();
    expect(trialEndsAtIso(undefined)).toBeNull();
  });
});

/**
 * 0156: the hosted page and PDF links. The same host rule as the database
 * CHECK, so a URL that would fail the write is dropped before it, rather than
 * turning a paid invoice into a 500 that Stripe retries for days.
 */
describe('invoice documents', () => {
  const hosted = 'https://invoice.stripe.com/i/acct_1/test_abc?s=ap';
  const pdf = 'https://pay.stripe.com/invoice/acct_1/test_abc/pdf?s=ap';

  it('keeps the links Stripe documents', () => {
    expect(invoiceDocuments({ hosted_invoice_url: hosted, invoice_pdf: pdf })).toEqual({
      hosted_invoice_url: hosted,
      invoice_pdf: pdf,
    });
  });

  it.each([
    ['another host', 'https://evil.example/i/x'],
    ['plain http', 'http://invoice.stripe.com/i/x'],
    ['userinfo pointing elsewhere', 'https://invoice.stripe.com@evil.example/x'],
    ['a look-alike host', 'https://pay.stripe.com.evil.example/x'],
    ['a bare host with no path', 'https://invoice.stripe.com'],
    ['whitespace inside', 'https://invoice.stripe.com/i/x y'],
    ['a script URL', 'javascript:alert(1)'],
    ['an over-long URL', `https://invoice.stripe.com/${'a'.repeat(2048)}`],
  ])('drops %s', (_label, url) => {
    expect(stripeDocumentUrl(url)).toBeNull();
  });

  it('treats a missing or non-string link as absent', () => {
    expect(invoiceDocuments({})).toEqual({ hosted_invoice_url: null, invoice_pdf: null });
    expect(stripeDocumentUrl(42)).toBeNull();
  });

  it('retrieves only a finalised invoice that is missing a link', () => {
    expect(
      needsDocumentRetrieval({
        status: 'paid',
        hosted_invoice_url: hosted,
        invoice_pdf: pdf,
      }),
    ).toBe(false);
    expect(needsDocumentRetrieval({ status: 'paid', hosted_invoice_url: hosted })).toBe(
      true,
    );
    expect(needsDocumentRetrieval({ status: 'open' })).toBe(true);
    expect(needsDocumentRetrieval({ status: 'draft' })).toBe(false);
  });

  it('prefers what Stripe holds now over the event', () => {
    const fresher = 'https://invoice.stripe.com/i/acct_1/test_new?s=ap';
    expect(
      documentsToWrite(
        { hosted_invoice_url: hosted, invoice_pdf: null },
        { hosted_invoice_url: fresher, invoice_pdf: pdf },
      ),
    ).toEqual({ hosted_invoice_url: fresher, invoice_pdf: pdf });
  });

  it('falls back to the event when the retrieval has no link', () => {
    expect(
      documentsToWrite(
        { hosted_invoice_url: hosted, invoice_pdf: pdf },
        { hosted_invoice_url: null, invoice_pdf: null },
      ),
    ).toEqual({ hosted_invoice_url: hosted, invoice_pdf: pdf });
  });

  it('never writes null over a link already stored', () => {
    expect(
      documentsToWrite({ hosted_invoice_url: null, invoice_pdf: null }, null),
    ).toEqual({});
  });
});
