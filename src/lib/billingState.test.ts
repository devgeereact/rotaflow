import { describe, expect, it } from 'vitest';
import {
  billingStatus,
  entitledPlan,
  invoiceAmountLabel,
  invoiceDateLabel,
  invoiceStatus,
  orgStateBadge,
  planName,
  planPriceLabel,
  READ_ONLY_BANNER,
  readOnlyErrorMessage,
  toOrgBillingSnapshot,
  trialDaysLabel,
} from './billingState';

describe('trial and read-only (D2, 0154)', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('counts the free trial from the server trial end', () => {
    expect(trialDaysLabel('2026-11-02T12:00:00Z', now)).toBe('Trial, 23 days left');
    expect(trialDaysLabel('2026-10-11T09:00:00Z', now)).toBe('Trial, 1 day left');
    expect(trialDaysLabel('2026-10-10T20:00:00Z', now)).toBe('Trial, ends today');
    expect(trialDaysLabel('2026-10-01T12:00:00Z', now)).toBeNull();
    expect(trialDaysLabel(null, now)).toBeNull();
  });

  it('badges the free trial and read-only, and defers to the subscription otherwise', () => {
    expect(
      orgStateBadge(
        { state: 'trial', trialEndsAt: '2026-11-02T12:00:00Z', readOnly: false },
        now,
      ),
    ).toEqual({ label: 'Trial, 23 days left', tone: 'info' });
    expect(
      orgStateBadge({ state: 'read_only', trialEndsAt: null, readOnly: true }, now),
    ).toEqual({ label: 'Read-only, choose a plan', tone: 'danger' });
    expect(
      orgStateBadge({ state: 'active', trialEndsAt: null, readOnly: false }, now),
    ).toBeNull();
    expect(orgStateBadge(null, now)).toBeNull();
  });

  it('never lets an unknown state hide the server read-only flag', () => {
    const snapshot = toOrgBillingSnapshot({
      state: 'something_new',
      trial_ends_at: null,
      read_only: true,
    });
    expect(snapshot.readOnly).toBe(true);
    expect(orgStateBadge(snapshot, now)?.label).toBe('Read-only, choose a plan');
  });

  it('shows the server words for a BILL1 refusal and nothing for other errors', () => {
    expect(
      readOnlyErrorMessage({ code: 'BILL1', message: 'Your trial has ended.' }),
    ).toBe('Your trial has ended.');
    expect(readOnlyErrorMessage({ code: 'BILL1' })).toBe(READ_ONLY_BANNER);
    expect(readOnlyErrorMessage({ code: '42501', message: 'denied' })).toBeNull();
    expect(readOnlyErrorMessage(new Error('boom'))).toBeNull();
    expect(readOnlyErrorMessage(null)).toBeNull();
  });
});

const NOW = new Date('2026-10-10T12:00:00Z');

describe('billingStatus', () => {
  it('says "No plan yet" when there is no subscription, not trialing', () => {
    expect(billingStatus(null, NOW)).toEqual({ label: 'No plan yet', tone: 'neutral' });
  });

  it('counts the days left in a trial', () => {
    expect(
      billingStatus(
        {
          plan: 'professional',
          status: 'trialing',
          trial_ends_at: '2026-11-02T12:00:00Z',
        },
        NOW,
      ).label,
    ).toBe('Trial, 23 days left');
  });

  it('says "1 day", not "1 days"', () => {
    expect(
      billingStatus(
        { plan: 'starter', status: 'trialing', trial_ends_at: '2026-10-11T09:00:00Z' },
        NOW,
      ).label,
    ).toBe('Trial, 1 day left');
  });

  it('says the trial ends today rather than "0 days left"', () => {
    expect(
      billingStatus(
        { plan: 'starter', status: 'trialing', trial_ends_at: '2026-10-10T20:00:00Z' },
        NOW,
      ).label,
    ).toBe('Trial, ends today');
  });

  it('falls back to plain "Trial" without an end date', () => {
    expect(billingStatus({ plan: 'starter', status: 'trialing' }, NOW).label).toBe(
      'Trial',
    );
  });

  it('spells cancelled the British way', () => {
    expect(billingStatus({ plan: 'starter', status: 'canceled' }, NOW)).toEqual({
      label: 'Cancelled',
      tone: 'danger',
    });
  });

  it('names a failed payment plainly', () => {
    expect(billingStatus({ plan: 'business', status: 'past_due' }, NOW).label).toBe(
      'Payment failed',
    );
  });

  it('reads active as Active', () => {
    expect(billingStatus({ plan: 'business', status: 'active' }, NOW).tone).toBe(
      'success',
    );
  });
});

describe('entitledPlan', () => {
  it('prefers the organisation plan, which is what limits apply to', () => {
    expect(entitledPlan('starter', { plan: 'business', status: 'past_due' })).toBe(
      'starter',
    );
  });

  it('falls back to the subscription plan when the organisation is not loaded', () => {
    expect(entitledPlan(null, { plan: 'business', status: 'active' })).toBe('business');
  });

  it('is null with neither', () => {
    expect(entitledPlan(undefined, null)).toBeNull();
  });
});

describe('planPriceLabel', () => {
  it('formats pence in the plan currency', () => {
    expect(planPriceLabel({ monthly_price_pence: 12900, currency: 'GBP' })).toBe(
      '£129.00 a month',
    );
  });

  it('does not assume pounds', () => {
    expect(planPriceLabel({ monthly_price_pence: 2900, currency: 'EUR' })).toBe(
      '€29.00 a month',
    );
  });
});

describe('planName', () => {
  it('names known plans and passes unknown codes through', () => {
    expect(planName('professional')).toBe('Professional');
    expect(planName('custom')).toBe('custom');
  });
});

describe('the owner invoice list (0156, F3)', () => {
  it.each([
    ['paid', 'Paid', 'success'],
    ['open', 'Open', 'info'],
    ['past_due', 'Failed', 'danger'],
    ['uncollectible', 'Uncollectible', 'danger'],
    ['void', 'Void', 'neutral'],
    ['refunded', 'Refunded', 'neutral'],
  ])('says %s as "%s"', (status, label, tone) => {
    expect(invoiceStatus(status)).toEqual({ label, tone });
  });

  it('shows an unknown status in words, never as a code', () => {
    expect(invoiceStatus('in_review')).toEqual({ label: 'In review', tone: 'neutral' });
  });

  it('prints the issue date as the calendar day stored', () => {
    expect(invoiceDateLabel('2026-10-01')).toBe('1 October 2026');
    expect(invoiceDateLabel('not a date')).toBe('not a date');
  });

  it('prints the amount in the invoice currency, pence included', () => {
    expect(invoiceAmountLabel({ amount_pence: 4900, currency: 'GBP' })).toBe('£49.00');
    expect(invoiceAmountLabel({ amount_pence: 12345, currency: 'EUR' })).toBe('€123.45');
  });
});
