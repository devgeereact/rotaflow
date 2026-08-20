# Admin Console Real Billing Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the last fabricated billing/revenue values in the Platform Console (Overview's churn line, Subscriptions' per-row facts, Org Detail's MRR tile) with real computed data, and make dunning-exhausted payment failures actually suspend the organisation.

**Architecture:** Most of this domain was already wired to real data in a prior pass (`AdminBillingPage.tsx` is fully real; `AdminSubscriptionsPage.tsx`'s MRR/ARR/counts/trend are already real) — investigation during planning found the actual remaining gap is much narrower than the design spec assumed: 4 fabricated values, one honesty-threshold fix on an already-real trend chart, a batch of now-dead exports to delete, and a migration + webhook change for dunning-driven suspension.

**Tech Stack:** TypeScript/React (client), Deno (Edge Function), PostgreSQL/PL-pgSQL (migration), Vitest (pure-logic tests).

**Spec:** `docs/superpowers/specs/2026-08-19-admin-billing-real-data-design.md`

## Global Constraints

- Revenue churn (not logo/count churn): lost MRR ÷ MRR-at-period-start.
- Trend charts: honest empty state until 3 real months of paid-invoice history exist; never zero-pad pre-launch months to fake a longer history.
- `set_org_status()` gains a `service_role` exception (`auth.uid() is null`) so the webhook can call it directly — this is the one write path for org status, and it's the one that keeps the `'org.suspended'` critical-severity audit entry intact.
- No new UI sections for Collected/Outstanding/Refunds/ARPO/Invoices/Failed-payments — `AdminBillingPage.tsx` already has all of these for real; this plan does not duplicate them onto Subscriptions.
- This repo has no test precedent for `src/pages/admin/*.tsx`, `src/services/*.ts`, or `supabase/functions/**` (Deno, excluded from `npm run typecheck`/lint per `CLAUDE.md`) — those are verified by `npm run typecheck`/`deno check` plus manual checks, not new test files. `src/lib/*.ts` pure functions ARE tested (`src/lib/revenue.test.ts` is the pattern to extend).

---

### Task 1: Revenue-churn reconstruction in `src/lib/revenue.ts`

**Files:**
- Modify: `src/lib/revenue.ts` (add two functions, after the existing `revenueByPlan`)
- Modify: `src/lib/revenue.test.ts` (add tests)

**Interfaces:**
- Consumes: `SubscriptionLike` (already defined in this file — has `org_id`, `plan`, `status`, `price_pence`). Needs one more field, `started_at` and `canceled_at`, both already real columns on `subscriptions` (`0002`/`0037`) not yet in this interface.
- Produces: `mrrAtDatePence(subscriptions, planPrices, asOf: Date): number` and `revenueChurnForMonth(subscriptions, planPrices, monthStart: Date, nextMonthStart: Date): number | null` — Task 2 calls these by exact name. Note the second boundary is `nextMonthStart` (exclusive), matching `monthlyGrowth`'s own established convention in `src/lib/platformOverview.ts` (`isBefore(at, nextStart)`) — not an inclusive month-end. Keeping both functions on the same convention avoids an off-by-one mismatch when Task 2 buckets months the same way `monthlyGrowth` already does.

- [ ] **Step 1: Write the failing tests**

```typescript
// add to src/lib/revenue.test.ts, alongside the existing imports/fixtures
import { mrrAtDatePence, revenueChurnForMonth } from '@/lib/revenue';

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
```

Also extend the `sub()` fixture helper at the top of `revenue.test.ts` to include `started_at`/`canceled_at` defaults:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/revenue.test.ts`
Expected: FAIL — `mrrAtDatePence`/`revenueChurnForMonth` not exported, and `SubscriptionLike` missing `started_at`/`canceled_at` (TypeScript error on the fixture).

- [ ] **Step 3: Implement**

Add `started_at: string;` and `canceled_at: string | null;` to the `SubscriptionLike` interface near the top of `revenue.ts`. Then add, after `revenueByPlan`:

```typescript
/**
 * MRR reconstructed as of a past date, using `started_at`/`canceled_at` —
 * both real, immutable-once-set timestamps, so this needs no snapshot
 * table. A subscription counts if it had started and not yet canceled as
 * of `asOf`. Uses each subscription's current `price_pence`/plan price as
 * a stand-in for its historical price — this schema does not track price
 * changes over time, so that is the same simplification every other
 * figure in this file already makes.
 */
export function mrrAtDatePence(
  subscriptions: readonly SubscriptionLike[],
  planPrices: ReadonlyMap<string, number>,
  asOf: Date,
): number {
  return subscriptions
    .filter((s) => new Date(s.started_at) <= asOf)
    .filter((s) => s.canceled_at === null || new Date(s.canceled_at) > asOf)
    .reduce((total, s) => total + (s.price_pence ?? planPrices.get(s.plan) ?? 0), 0);
}

/**
 * Revenue churn for one month: MRR lost to cancellations that fell inside
 * it, over MRR at the month's start. Null when starting MRR was zero — a
 * churn rate out of no revenue is a division by zero dressed as 0%, same
 * reasoning as the existing `churnRate` above.
 */
export function revenueChurnForMonth(
  subscriptions: readonly SubscriptionLike[],
  planPrices: ReadonlyMap<string, number>,
  monthStart: Date,
  nextMonthStart: Date,
): number | null {
  const startingMrr = mrrAtDatePence(subscriptions, planPrices, monthStart);
  if (startingMrr <= 0) return null;
  const lost = subscriptions
    .filter((s) => s.canceled_at !== null)
    .filter((s) => {
      const c = new Date(s.canceled_at!);
      return c >= monthStart && c < nextMonthStart;
    })
    .reduce((total, s) => total + (s.price_pence ?? planPrices.get(s.plan) ?? 0), 0);
  return Math.round((lost / startingMrr) * 1000) / 10;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/revenue.test.ts`
Expected: all pass, including the pre-existing tests in this file (unaffected by the interface addition since every other test's `sub()` calls now get the new fields via the updated fixture default).

- [ ] **Step 5: Commit**

```bash
git add src/lib/revenue.ts src/lib/revenue.test.ts
git commit -m "feat: add real revenue-churn reconstruction to revenue.ts"
```

---

### Task 2: Real churn line on `AdminOverviewPage.tsx`

**Files:**
- Modify: `src/lib/platformOverview.ts` (new sibling function to `monthlyGrowth`)
- Modify: `src/pages/admin/AdminOverviewPage.tsx`
- Modify: `src/lib/adminOverviewDemo.ts` (trim `DEMO_SECTIONS`)

**Interfaces:**
- Consumes: `revenueChurnForMonth`, `mrrAtDatePence` (Task 1).
- Produces: `monthlyChurnCounts(subscriptions, now, months): number[]` in `platformOverview.ts` — one integer per month (count of cancellations, index-aligned with `monthlyGrowth`'s own output, same `months` window), plotted on the existing chart's count axis. The percentage figure (`revenueChurnForMonth`'s return) is not plotted directly — see Step 1's reasoning.

- [ ] **Step 1: Add `monthlyChurnCounts` to `platformOverview.ts`**

`monthlyGrowth`'s two sibling series ("Active organisations", "New organisations") plot small integer counts (tens to low thousands), not percentages — a revenue-churn percentage (a number like `1.4`) plotted on that same axis would round to a flat line at the bottom, unreadable. Plot cancellation **count** per month instead (real, from the same `subscriptions` data, same bucketing convention as `monthlyGrowth`), and surface the revenue-churn percentage as text (Step 3) rather than a fourth axis. Add, directly below `monthlyGrowth` in `platformOverview.ts`:

```typescript
/**
 * Cancellations per month, oldest first — the "Churned" series on the
 * growth chart. A count, not a percentage, so it plots on the same axis
 * as `monthlyGrowth`'s "Active"/"New" series without needing a second
 * scale. The revenue-churn rate (lost MRR ÷ starting MRR) is real too,
 * computed the same way, but shown as text alongside the chart rather
 * than plotted — see `revenueChurnForMonth` in `lib/revenue.ts`.
 */
export function monthlyChurnCounts(
  subscriptions: readonly { canceled_at: string | null }[],
  now: Date,
  months = 12,
): number[] {
  const counts: number[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = startOfMonth(subMonths(now, i));
    const nextStart = startOfMonth(subMonths(now, i - 1));
    const count = subscriptions.filter((s) => {
      if (s.canceled_at === null) return false;
      const c = new Date(s.canceled_at);
      return !isBefore(c, start) && isBefore(c, nextStart);
    }).length;
    counts.push(count);
  }
  return counts;
}
```

(`startOfMonth`, `subMonths`, `isBefore` are already imported at the top of this file for `monthlyGrowth` — reuse those imports, do not add a second import statement.)

- [ ] **Step 2: Wire it into `AdminOverviewPage.tsx`'s `derived` and replace the chart series**

In the `derived` `useMemo` (the one already computing `growth`, `mrr`, `planMix` — shown above, this task extends it, does not replace it), add one more field:

```typescript
churnCounts: monthlyChurnCounts(data.subscriptions, now, periodMonths),
```

Import `monthlyChurnCounts` from `@/lib/platformOverview` — this file already imports `monthlyGrowth` and other names from that module per its existing `derived` computation; add to that same import statement.

Then find the `TrendChart`'s `series` array (the one with `"Active organisations"`/`"New organisations"`/`"Churned"` entries, currently `values: demoChurnTrend(derived.growth.map((g) => g.total))` for the third). Replace that one line:

```typescript
values: derived.churnCounts,
```

Remove the `import { demoChurnTrend, ... } from '@/lib/adminOverviewDemo';` reference to `demoChurnTrend` specifically (keep `DEMO_SERVICES`/`DEMO_SECTIONS` imports, those stay for now — Platform Health domain, out of scope here).

- [ ] **Step 3: Add the real revenue-churn percentage as text, replace the caption**

Find the paragraph directly below the chart: *"New organisations are counted in the month they signed up, and the current month is partial. Active and new are real; churn is a placeholder. Nothing records the month an organisation left."* Replace it with real copy computing the current month's revenue-churn rate:

```tsx
{(() => {
  const now = new Date();
  const planPrices = new Map(data!.plans.map((p) => [p.code, p.monthly_price_pence]));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const churn = revenueChurnForMonth(data!.subscriptions, planPrices, monthStart, nextMonthStart);
  return (
    <p className="mt-1 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
      New organisations are counted in the month they signed up, and the current month
      is partial. Churned counts cancellations by month
      {churn !== null && ` — ${churn}% of MRR lost so far this month`}.
    </p>
  );
})()}
```

(Written as an IIFE inline for locality to the paragraph it annotates — if this file's existing conventions favor computing such values inside the main `derived` `useMemo` instead of inline in JSX, match that convention instead; check a nearby similarly-derived inline value in this same file first and follow whichever pattern it already uses.)

Import `revenueChurnForMonth` from `@/lib/revenue` in this file.

- [ ] **Step 4: Trim `DEMO_SECTIONS`**

`grep -rn DEMO_SECTIONS src/` first to confirm this page is the only consumer (expected, given it's the Overview-specific placeholder-notice list). If so, change it in `adminOverviewDemo.ts` from `['Churn on the growth chart', 'System health history']` to `['System health history']`. If another page also consumes it, leave the shared constant alone and instead stop rendering the "Churn on the growth chart" line specifically wherever this page maps `DEMO_SECTIONS` to text — check that render site before deciding which of the two edits applies.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Manual check**

Run `npm run dev`, sign in as a platform admin, open `/admin` (Overview). Confirm the growth chart's "Churned" line renders (likely flat at 0 today, since no subscription has been canceled yet in production — that is the correct real result, not a bug), and the caption shows real copy, no "placeholder" claim for churn.

- [ ] **Step 7: Commit**

```bash
git add src/lib/platformOverview.ts src/pages/admin/AdminOverviewPage.tsx src/lib/adminOverviewDemo.ts
git commit -m "feat: real revenue churn on the Overview growth chart"
```

---

### Task 3: Real per-row subscription facts on `AdminSubscriptionsPage.tsx`

**Files:**
- Modify: `src/pages/admin/AdminSubscriptionsPage.tsx`

**Interfaces:**
- Consumes: `countMembershipsByOrg(): Promise<Map<string, number>>` (already exists, `src/services/platformService.ts`, already imported elsewhere in this codebase's admin pages).
- Produces: the `facts()` callback keeps its call shape (`facts(row)` still called the same way at every existing site: line ~232's sort comparator, ~234's usage-sort, ~291's `cycle` cell, ~300's `value` destructure, ~335's `payment` destructure, ~349's `usage` cell) — only its internal computation and return type change.

`usage` is real code, not decoration: it's read directly in the sort comparator (`facts(a).usage - facts(b).usage`) and rendered (`` `${facts(row).usage}%` ``) — it cannot become `null` without also changing those two call sites, so this task adds the real headcount query rather than dropping the field.

- [ ] **Step 1: Add a per-org membership-count fetch to this page's data loading**

Find this page's existing data-loading `useEffect` (the one that already calls `listAllOrganisations`/`listAllSubscriptions`/`listPlans`/`listInvoices` — confirmed present via this file's imports). Add `countMembershipsByOrg` from `@/services/platformService` (already imported in sibling admin pages using the same pattern — add it to whatever import from that module this file already has, or add a new one if this file doesn't import from `platformService` yet) to the same `Promise.all`, and store its result in state, e.g. `const [memberCounts, setMemberCounts] = useState<Map<string, number>>(new Map());`.

- [ ] **Step 2: Replace the `facts` callback**

```typescript
type PaymentState = 'paid' | 'pending' | 'failed';

const facts = useCallback(
  (row: Row): { value: number | null; cycle: string; payment: PaymentState; usage: number } => {
    const sub = row.subscription;
    const plan = plans.find((p) => p.code === (sub?.plan ?? row.organisation.plan));
    const seatLimit = plan?.seat_limit ?? null;
    const memberCount = memberCounts.get(row.organisation.id) ?? 0;
    const usage = seatLimit ? Math.round((memberCount / seatLimit) * 100) : 0;

    if (!sub) return { value: null, cycle: 'Monthly', payment: 'pending', usage };

    const value =
      sub.status === 'trialing' ? null : (sub.price_pence ?? plan?.monthly_price_pence ?? null);
    const payment: PaymentState =
      sub.status === 'past_due' ? 'failed' : sub.status === 'trialing' ? 'pending' : 'paid';
    return { value, cycle: 'Monthly', payment, usage };
  },
  [plans, memberCounts],
);
```

Define `PaymentState` locally as shown (three states — `'refunded'` dropped, it has no real mapping from `subscriptions.status`, refund is an invoice-level concept per `0023`). Remove `import { demoSubscriptionFacts, type DemoPaymentState } from '@/lib/adminOverviewDemo';`. Update `PAYMENT_TONE`'s type annotation from `Record<DemoPaymentState, ...>` to `Record<PaymentState, ...>`, and delete its `refunded: 'neutral'` entry.

Also fix this file's own header docblock — it currently says *"no payment provider is integrated... there is nothing here that could be turned into revenue: no invoices, no payments, no MRR, no churn rate"*, directly contradicted by the `money` `useMemo` a few lines below it (already computing real MRR/ARR/trend from `monthlyRecurringPence`/`collectedByMonth`). Same class of stale-doc gap found and fixed elsewhere this session — update it to state what's actually true now: MRR/ARR/subscription-state are real (`0023`, this session's Stripe work); per-row usage is real as of this task; Collected/Outstanding/Refunds/ARPO/invoice-level detail live on `/admin/billing` instead of being duplicated here.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no new errors. If any render site still exhaustively pattern-matches all four original `PaymentState` values, TypeScript will flag the now-impossible fourth case — fix that render code too, do not silence it by leaving `'refunded'` in the type unused.

- [ ] **Step 4: Manual check**

`npm run dev`, `/admin/subscriptions` as a platform admin. Confirm the table renders real values per row — spot-check one org's displayed price against its actual `plans.monthly_price_pence`/negotiated `price_pence`, and its usage % against a manual count of that org's real membership rows over its plan's `seat_limit`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/AdminSubscriptionsPage.tsx
git commit -m "feat: real per-row subscription facts on the Subscriptions page"
```

---

### Task 4: Real MRR on `AdminOrganisationDetailPage.tsx`

**Files:**
- Modify: `src/pages/admin/AdminOrganisationDetailPage.tsx`

**Interfaces:**
- Consumes: the real RPC `subscription_mrr_pence(p_org: uuid): number` (`0023`, already `grant execute ... to authenticated`).

- [ ] **Step 1: Add the RPC call to this page's data loading**

Find this page's existing data-loading `useEffect`/`Promise.all` (it already loads `detail.subscription`, per the file's existing imports/usage) and add a call alongside it:

```typescript
const { data: mrrPence, error: mrrError } = await supabase.rpc('subscription_mrr_pence', {
  p_org: orgId,
});
if (mrrError) throw mrrError;
```

Store it in a new state variable, e.g. `const [orgMrrPence, setOrgMrrPence] = useState<number | null>(null);`, set from the above alongside the page's other loaded state.

- [ ] **Step 2: Replace the `DEMO_ORG_MRR` StatTile**

Replace:
```tsx
<StatTile
  label="MRR"
  value={DEMO_ORG_MRR}
  hint={<span className="text-warning">Placeholder</span>}
/>
```
with:
```tsx
<StatTile
  label="MRR"
  value={orgMrrPence === null ? '—' : formatMoney(orgMrrPence)}
/>
```
(`formatMoney` from `@/lib/money` — check the file's existing imports; it may already be imported for another figure on this page, reuse rather than re-import.)

Remove `DEMO_ORG_MRR` from the `import { DEMO_ORG_MRR, DEMO_ORG_PROFILE, DEMO_ORG_STORAGE } from '@/lib/adminOverviewDemo';` line — leave `DEMO_ORG_PROFILE`/`DEMO_ORG_STORAGE` imported, they are out of scope for this plan (still placeholders, deliberately).

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Manual check**

`npm run dev`, open any organisation's detail page in `/admin/organisations/:id`. Confirm the MRR tile shows a real `£` figure (or `—` for an org with no subscription) with no "Placeholder" hint, while Storage right next to it still correctly shows its own placeholder hint (confirms the partial edit didn't touch the wrong tile).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/AdminOrganisationDetailPage.tsx
git commit -m "feat: real MRR on the organisation detail page"
```

---

### Task 5: Trend-chart honesty threshold on `AdminSubscriptionsPage.tsx`

**Files:**
- Modify: `src/lib/revenue.ts` (one small addition)
- Modify: `src/lib/revenue.test.ts`
- Modify: `src/pages/admin/AdminSubscriptionsPage.tsx`

**Interfaces:**
- Consumes: `InvoiceLike` (already defined in `revenue.ts`).
- Produces: `monthsOfPaidHistory(invoices): number` — Task 5's page code calls this by exact name.

- [ ] **Step 1: Write the failing test**

```typescript
// add to revenue.test.ts
import { monthsOfPaidHistory } from '@/lib/revenue';

describe('monthsOfPaidHistory', () => {
  it('counts distinct months with at least one paid invoice', () => {
    const invoices: InvoiceLike[] = [
      invoice({ status: 'paid', paid_at: '2026-06-05T00:00:00Z' }),
      invoice({ status: 'paid', paid_at: '2026-07-10T00:00:00Z' }),
      invoice({ status: 'paid', paid_at: '2026-07-20T00:00:00Z' }), // same month as above
      invoice({ status: 'open', paid_at: null }), // not paid, excluded
    ];
    expect(monthsOfPaidHistory(invoices)).toBe(2);
  });

  it('is 0 for no paid invoices', () => {
    expect(monthsOfPaidHistory([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/revenue.test.ts`
Expected: FAIL — `monthsOfPaidHistory` not exported.

- [ ] **Step 3: Implement**

Add to `revenue.ts`, near `collectedByMonth`:

```typescript
/**
 * How many distinct calendar months have at least one paid invoice.
 *
 * The gate for whether a trend chart has enough real history to draw, per
 * the design decision to never zero-pad pre-launch months into a fake
 * longer history — see `docs/superpowers/specs/2026-08-19-admin-billing-real-data-design.md`.
 */
export function monthsOfPaidHistory(invoices: readonly InvoiceLike[]): number {
  const months = new Set(
    invoices.filter((i) => i.paid_at !== null).map((i) => monthKey(i.paid_at!)),
  );
  return months.size;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/revenue.test.ts`
Expected: all pass.

- [ ] **Step 5: Gate the Sparkline on `AdminSubscriptionsPage.tsx`**

Find the existing MRR `StatTile`'s `chart={<Sparkline values={money.trend} colour="#1EA06B" />}` (already real data, per the investigation during planning — `money.trend` comes from `collectedByMonth(invoices, 12, new Date())`). Wrap it:

```tsx
chart={
  monthsOfPaidHistory(invoices) >= 3 ? (
    <Sparkline values={money.trend} colour="#1EA06B" />
  ) : undefined
}
hint={
  monthsOfPaidHistory(invoices) >= 3
    ? 'Active and past due'
    : 'Not enough billing history yet for a trend'
}
```

(Check `StatTile`'s actual prop types first — confirm `chart` accepts `undefined`/optional before writing this exact shape; if it requires an element, render a small explanatory `<span>` in its place instead of `undefined`.)

Import `monthsOfPaidHistory` from `@/lib/revenue` (it's likely already importing several names from this module, per the investigation during planning — add to the existing import statement rather than a new one).

- [ ] **Step 6: Type-check and manual check**

Run: `npm run typecheck` — no new errors.
`npm run dev`, `/admin/subscriptions` — given real billing just went live this session, expect the honest-empty-state hint to show today (fewer than 3 real months exist yet), not a sparkline. This is the CORRECT current result, not a bug — confirms the gate is working, not that it's broken.

- [ ] **Step 7: Commit**

```bash
git add src/lib/revenue.ts src/lib/revenue.test.ts src/pages/admin/AdminSubscriptionsPage.tsx
git commit -m "feat: honest empty state for the MRR trend chart until 3 real months exist"
```

---

### Task 6: Delete dead billing exports from `adminOverviewDemo.ts`

**Files:**
- Modify: `src/lib/adminOverviewDemo.ts`

**Interfaces:** None — pure deletion, confirmed unused by Tasks 1–5's investigation (verified via `grep -rl <symbol> src/pages/ src/components/` for each, zero hits outside the demo file itself).

- [ ] **Step 1: Delete the confirmed-dead exports**

Remove these from `adminOverviewDemo.ts` (constants, and the now-unused `DemoPaymentState`/`DemoSubscriptionFacts`/`demoSubscriptionFacts`/`DEMO_VALUES`/`DEMO_USAGE` since Task 3 replaced their only caller): `DEMO_MRR`, `DEMO_MRR_CHANGE`, `DEMO_ARR_SHORT`, `DEMO_ARR_FULL`, `DEMO_ACTIVE_SUBSCRIPTIONS`, `DEMO_TRIALS`, `DEMO_TRIALS_HINT`, `DEMO_PAST_DUE`, `DEMO_PAST_DUE_HINT`, `DEMO_CHURN_RATE`, `DEMO_CHURN_CHANGE`, `DEMO_COLLECTED`, `DEMO_COLLECTED_HINT`, `DEMO_OUTSTANDING`, `DEMO_OUTSTANDING_HINT`, `DEMO_REFUNDS`, `DEMO_REFUNDS_HINT`, `DEMO_ARPO`, `DEMO_REVENUE_BY_PLAN`, `DemoPaymentState`, `DemoSubscriptionFacts`, `DEMO_VALUES`, `DEMO_USAGE`, `demoSubscriptionFacts`, `DEMO_INVOICES`, `DemoInvoice` (interface), `DEMO_FAILED_PAYMENTS`, `DemoFailedPayment` (interface), `DEMO_DUNNING_NOTE`, `DEMO_MONTHLY_REVENUE`, `DEMO_REVENUE_CHANGE`, `DEMO_REVENUE_TREND`, `demoChurnTrend`, `CHURN_SHAPE` (the private const it used), `DEMO_ORG_MRR`.

Before deleting each, run `grep -rn "<exact name>" src/` one more time as a final safety check — Tasks 1–5 already confirmed these are dead, but confirm again immediately before deletion in case an earlier task's edit missed a reference (cheaper to check than to debug a broken build after).

Leave everything else in the file untouched — `DEMO_ORG_PROFILE`, `DEMO_ORG_STORAGE`, `DEMO_SERVICES`, `DEMO_SECTIONS` (now `['System health history']` only, per Task 2), and every other domain's placeholders (Users, Support, Platform Health, Integrations, Notifications, Feature Flags, GDPR, Platform Settings, Incidents) are explicitly out of scope for this plan.

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors. If something still imports a deleted symbol, this is where it surfaces — go fix that call site, do not re-add the deleted export to make the error disappear.

- [ ] **Step 3: Commit**

```bash
git add src/lib/adminOverviewDemo.ts
git commit -m "chore: delete billing/revenue placeholders now that real data replaced them"
```

---

### Task 7: Migration — `set_org_status()` service_role exception

**Files:**
- Create: `supabase/migrations/0052_org_status_service_role.sql` (check `ls supabase/migrations/ | tail -3` at implementation time for the actual next free number — a prior task or concurrent branch may have claimed `0051`/`0052` already; do not assume without checking)

**Interfaces:**
- Produces: `set_org_status(p_org uuid, p_status text, p_reason text)` now additionally accepts a `service_role` caller — Task 8's webhook code calls this by exact name and signature (unchanged).

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- 0052_org_status_service_role.sql — let a service_role caller suspend
-- an org, for dunning-exhausted payment failures
--
-- set_org_status() (0017) only accepted a platform owner/admin's own JWT.
-- stripe-webhook runs as service_role with no user session — Stripe calls
-- it directly, there is no auth.uid() to check. Extends both permission
-- gates in this function with a service_role alternative
-- (auth.uid() is null), matching audit_write()'s own existing convention
-- for exactly this situation (0037: "coalesce(p_metadata, '{}'::jsonb) ||
-- case when auth.uid() is null then jsonb_build_object('via',
-- 'service_role') else '{}'::jsonb end").
--
-- Every existing caller (a real platform admin, with a real JWT) is
-- unaffected — auth.uid() is never null for them, so the new branch
-- never applies.
-- =====================================================================

create or replace function public.set_org_status(
  p_org    uuid,
  p_status text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  if not (
    public.has_platform_role(array['platform_owner','platform_admin'])
    or auth.uid() is null
  ) then
    raise exception 'Only a platform owner or administrator can change an organisation''s status'
      using errcode = '42501';
  end if;

  if p_status not in ('active','suspended','archived') then
    raise exception 'Unknown organisation status: %', p_status using errcode = '22023';
  end if;

  select status into v_current from public.organisations where id = p_org;
  if v_current is null then
    raise exception 'No such organisation' using errcode = 'P0002';
  end if;
  if v_current = p_status then
    return;
  end if;

  if p_status <> 'active' and coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'A reason is required to suspend or archive an organisation'
      using errcode = '22023';
  end if;

  update public.organisations
     set status           = p_status,
         suspended_at     = case when p_status = 'active' then null
                                 else timezone('utc', now()) end,
         suspended_reason = case when p_status = 'active' then null
                                 else btrim(p_reason) end
   where id = p_org;

  perform public.audit_write(
    p_org,
    case p_status when 'suspended' then 'org.suspended'
                  when 'archived'  then 'org.archived'
                  else 'org.reactivated' end,
    'organisation', p_org,
    jsonb_strip_nulls(jsonb_build_object(
      'from_status', v_current, 'to_status', p_status, 'reason', btrim(p_reason))),
    'critical',
    'org');
end;
$$;

grant execute on function public.set_org_status(uuid, text, text) to service_role;
```

(The full function body is reproduced here, not just a diff, because `create or replace function` needs the complete definition — copying `0017`'s original and changing only the one `if not (...)` line, verified against the actual current file at implementation time in case anything else changed it since.)

- [ ] **Step 2: Apply and verify — the two things that must both be true**

This touches the live shared Supabase project. Per this session's established practice, apply it yourself (or hand it to the user, matching how every other live-DB write this session was handled) — do not assume `supabase db push` succeeds unprompted; it has been blocked by this environment's own safety classifier before.

After applying, verify both directions with the Management API's SQL endpoint (`POST /v1/projects/vwqqbdvlskngrqrejzxi/database/query`, pattern used throughout this session):

```sql
-- 1. A real platform admin's own call still works (requires a real
--    platform-admin JWT to test genuinely — if none is available in this
--    context, at minimum confirm the function body's unchanged first
--    condition still requires has_platform_role by reading it back:
select prosrc from pg_proc where proname = 'set_org_status';
-- confirm 'has_platform_role' still appears in the returned source.

-- 2. A non-admin, non-service-role call is still rejected — this is the
--    one that must not have silently widened. Confirmed by reading the
--    function body's exact condition (above) rather than attempting a
--    live call with a non-admin JWT this session may not have on hand.
```

Expected: the function's `if not (...)` now reads exactly the two-branch condition from Step 1, nothing broader.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0052_org_status_service_role.sql
git commit -m "feat: let set_org_status accept a service_role caller"
```

---

### Task 8: Webhook — suspend the org when dunning is exhausted

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

**Interfaces:**
- Consumes: `set_org_status(p_org, p_status, p_reason)` (Task 7).

- [ ] **Step 1: Read the current `handleSubscriptionDeleted`**

This function already exists and sets `subscriptions.status = 'canceled'` (built in this session's original Stripe billing plan). Read its current exact code before editing — do not guess its shape, this session's own earlier work on this exact file already went through two rounds of fixes to it (status-enum mapping, swallowed-error fixes), confirm the current state first.

- [ ] **Step 2: Extend it to check the cancellation reason**

```typescript
async function handleSubscriptionDeleted(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.error('customer.subscription.deleted missing org_id metadata', subscription.id);
    return;
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('provider_ref', subscription.id);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);

  // Verify subscription.cancellation_details.reason's exact shape against
  // the pinned API version (2025-02-24.acacia) via deno check and the
  // installed npm:stripe@17 type declarations before trusting this field
  // access — do not assume it without checking, the same discipline this
  // session's earlier Stripe work already applied to other fields.
  const reason = subscription.cancellation_details?.reason;
  if (reason === 'payment_failed') {
    const { error: statusError } = await supabase.rpc('set_org_status', {
      p_org: orgId,
      p_status: 'suspended',
      p_reason: `Stripe subscription ${subscription.id} canceled after exhausted dunning`,
    });
    if (statusError) {
      throw new Error(`org suspension failed: ${statusError.message}`);
    }
  }
}
```

Keep whatever this function's existing body already does for the plain `subscriptions` update (shown above is the shape from this session's earlier work — reconcile against what Step 1 actually found, do not blindly overwrite unrelated existing logic).

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/stripe-webhook/index.ts`
Expected: no errors. If `cancellation_details` doesn't type-check against the installed `Stripe.Subscription` type, that is real, useful information — read what the actual type does expose for this API version and adjust the field access to match reality rather than forcing it.

- [ ] **Step 4: Deploy and manual verification**

```bash
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref vwqqbdvlskngrqrejzxi
```

Full end-to-end verification needs Smart Retries actually configured in the Stripe dashboard (the user's manual step, per the design spec — not part of this task) and a real test-mode payment failure allowed to exhaust retries, which takes real calendar time (days, per a 1/3/7-day retry schedule) — not something to fake or rush. Until that's genuinely exercised, the correct status for this task is verified-by-code-review-and-type-check, not verified-end-to-end; say so plainly rather than claiming a suspension was observed if it was not.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat: suspend an org when Stripe dunning exhausts payment retries"
```

## Self-review notes (from writing this plan)

- **Spec coverage:** every decision in the design spec's table is implemented (churn definition → Task 1, trend threshold → Task 5, `set_org_status` exception → Task 7, webhook → Task 8). The spec's assumption that Collected/Outstanding/Refunds/ARPO/Revenue-by-plan/Invoices/Dunning-note needed building on `AdminSubscriptionsPage.tsx` was superseded by what investigation during planning found: `AdminBillingPage.tsx` already has all of it for real. No task builds duplicate UI for that reason — recorded here so this isn't mistaken for a dropped requirement later.
- **Placeholder scan:** Task 2's exact JSX/loop edits are deliberately left contingent on reading the actual current file first (its `derived.growth` computation and `TrendChart` axis behavior aren't reproduced verbatim in this plan because they were not the focus of the file reads done while writing it) — flagged explicitly in-task as "read first, do not guess," not left silent.
- **Type consistency:** `PaymentState` (Task 3), `mrrAtDatePence`/`revenueChurnForMonth`/`monthsOfPaidHistory` (Tasks 1 and 5) are used with identical names/signatures everywhere they're referenced across tasks.
