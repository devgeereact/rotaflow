import { describe, expect, it } from 'vitest';
import {
  annualRunRatePence,
  averageRevenuePerOrgPence,
  churnRate,
  collectedByMonth,
  collectedInMonth,
  monthKey,
  monthlyRecurringPence,
  mrrAtDatePence,
  outstandingPence,
  pastDuePence,
  refundedInMonth,
  revenueByPlan,
  revenueChurnForMonth,
  type InvoiceLike,
  type SubscriptionLike,
} from '@/lib/revenue';

const PRICES = new Map([
  ['starter', 2900],
  ['professional', 12900],
  ['business', 29900],
  ['enterprise', 79000],
]);

function sub(over: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    org_id: 'o1',
    plan: 'business',
    status: 'active',
    price_pence: null,
    started_at: '2026-01-01T00:00:00Z',
    canceled_at: null,
    ...over,
  };
}

function invoice(over: Partial<InvoiceLike> = {}): InvoiceLike {
  return {
    amount_pence: 29900,
    status: 'paid',
    issued_on: '2026-08-01',
    paid_at: '2026-08-04T09:00:00Z',
    refunded_at: null,
    org_id: 'o1',
    ...over,
  };
}

describe('monthKey', () => {
  it('takes the year and month from a date or a timestamp', () => {
    expect(monthKey('2026-08-04')).toBe('2026-08');
    expect(monthKey('2026-08-04T09:00:00Z')).toBe('2026-08');
  });
});

describe('monthlyRecurringPence', () => {
  it('sums the plan price for active subscriptions', () => {
    expect(monthlyRecurringPence([sub(), sub({ plan: 'starter' })], PRICES)).toBe(32800);
  });

  it('counts past due, a failed card is not a lost customer', () => {
    expect(monthlyRecurringPence([sub({ status: 'past_due' })], PRICES)).toBe(29900);
  });

  it('excludes trialing and cancelled', () => {
    expect(
      monthlyRecurringPence(
        [sub({ status: 'trialing' }), sub({ status: 'canceled' })],
        PRICES,
      ),
    ).toBe(0);
  });

  it('prefers a negotiated price over the plan price', () => {
    expect(monthlyRecurringPence([sub({ price_pence: 19900 })], PRICES)).toBe(19900);
  });

  it('treats an unknown plan as zero rather than NaN', () => {
    expect(monthlyRecurringPence([sub({ plan: 'legacy' })], PRICES)).toBe(0);
  });
});

describe('annualRunRatePence', () => {
  it('is twelve months of MRR', () => {
    expect(annualRunRatePence(29900)).toBe(358800);
  });
});

describe('averageRevenuePerOrgPence', () => {
  it('divides revenue by paying organisations', () => {
    expect(averageRevenuePerOrgPence(60000, 4)).toBe(15000);
  });

  it('is null with no paying organisations, not zero', () => {
    expect(averageRevenuePerOrgPence(60000, 0)).toBeNull();
  });
});

describe('collected and outstanding', () => {
  it('counts a payment in the month it was paid, not issued', () => {
    const rows = [invoice({ issued_on: '2026-07-01', paid_at: '2026-08-02T09:00:00Z' })];
    expect(collectedInMonth(rows, '2026-08')).toBe(29900);
    expect(collectedInMonth(rows, '2026-07')).toBe(0);
  });

  it('counts open and past due as outstanding regardless of age', () => {
    expect(
      outstandingPence([
        invoice({ status: 'open', paid_at: null, issued_on: '2026-03-01' }),
        invoice({ status: 'past_due', paid_at: null }),
        invoice({ status: 'paid' }),
      ]),
    ).toBe(59800);
  });

  it('separates past due from merely open', () => {
    expect(
      pastDuePence([
        invoice({ status: 'open', paid_at: null }),
        invoice({ status: 'past_due', paid_at: null, amount_pence: 12900 }),
      ]),
    ).toBe(12900);
  });

  it('counts a refund in the month it was refunded', () => {
    expect(
      refundedInMonth(
        [invoice({ status: 'refunded', refunded_at: '2026-08-09T09:00:00Z' })],
        '2026-08',
      ),
    ).toBe(29900);
  });
});

describe('collectedByMonth', () => {
  const now = new Date(2026, 7, 5); // August 2026, local time

  it('returns one entry per month, oldest first', () => {
    const series = collectedByMonth([], 3, now);
    expect(series.map((s) => s.month)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('includes an empty month as zero rather than dropping it', () => {
    const series = collectedByMonth(
      [invoice({ paid_at: '2026-06-04T09:00:00Z' })],
      3,
      now,
    );
    expect(series.map((s) => s.pence)).toEqual([29900, 0, 0]);
  });

  it('rolls the year backwards across January', () => {
    const january = new Date(2026, 0, 15);
    expect(collectedByMonth([], 2, january).map((s) => s.month)).toEqual([
      '2025-12',
      '2026-01',
    ]);
  });
});

describe('revenueByPlan', () => {
  it('groups by plan, largest first', () => {
    const rows = revenueByPlan(
      [sub(), sub({ plan: 'starter' }), sub({ plan: 'starter' })],
      PRICES,
    );
    expect(rows).toEqual([
      { plan: 'business', pence: 29900, count: 1 },
      { plan: 'starter', pence: 5800, count: 2 },
    ]);
  });
});

describe('churnRate', () => {
  it('is a percentage to one decimal', () => {
    expect(churnRate(3, 120)).toBe(2.5);
  });

  it('is null out of nothing rather than zero', () => {
    expect(churnRate(0, 0)).toBeNull();
  });
});

describe('mrrAtDatePence', () => {
  it('counts a subscription active at the as-of date, excludes one canceled before it', () => {
    const subs: SubscriptionLike[] = [
      sub({ started_at: '2026-01-01T00:00:00Z', canceled_at: null, price_pence: 12900 }),
      sub({
        started_at: '2026-01-01T00:00:00Z',
        canceled_at: '2026-03-01T00:00:00Z',
        price_pence: 29900,
      }),
    ];
    expect(mrrAtDatePence(subs, PRICES, new Date('2026-04-01T00:00:00Z'))).toBe(12900);
    // Before the cancellation, both counted:
    expect(mrrAtDatePence(subs, PRICES, new Date('2026-02-01T00:00:00Z'))).toBe(12900 + 29900);
  });

  it('excludes a subscription that had not started yet as of the date', () => {
    const subs: SubscriptionLike[] = [
      sub({ started_at: '2026-06-01T00:00:00Z', canceled_at: null, price_pence: 2900 }),
    ];
    expect(mrrAtDatePence(subs, PRICES, new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });
});

describe('revenueChurnForMonth', () => {
  it('is null when starting MRR for the month was zero', () => {
    const result = revenueChurnForMonth(
      [],
      PRICES,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(result).toBeNull();
  });

  it('computes lost MRR over starting MRR for the month', () => {
    const subs: SubscriptionLike[] = [
      sub({ started_at: '2026-01-01T00:00:00Z', canceled_at: null, price_pence: 12900 }),
      sub({
        started_at: '2026-01-01T00:00:00Z',
        canceled_at: '2026-03-15T00:00:00Z',
        price_pence: 29900,
      }),
    ];
    // Starting MRR for March = both active as of Mar 1 = 12900 + 29900 = 42800.
    // Lost in March = the one that canceled on Mar 15, before April 1 = 29900.
    const result = revenueChurnForMonth(
      subs,
      PRICES,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-04-01T00:00:00Z'),
    );
    expect(result).toBe(Math.round((29900 / 42800) * 1000) / 10);
  });
});
