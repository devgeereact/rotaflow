import { describe, expect, it } from 'vitest';
import { billingStatus, entitledPlan, planName, planPriceLabel } from './billingState';

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
