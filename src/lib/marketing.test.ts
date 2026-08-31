import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLANS } from '@/lib/marketing';

/**
 * The pricing page against the table that actually charges (BUG-053).
 *
 * `PLANS` is hardcoded, and it has to be: the marketing page is
 * unauthenticated and `plans` has an RLS policy requiring a signed-in user
 * (0023), so it cannot be fetched at render time. `marketing.ts` says as much
 * and says which side wins — "that table, not this array, is what checkout
 * actually charges".
 *
 * What was missing is anything that notices when the two disagree. A price
 * changed in the migration and not here leaves a page quoting a number the
 * customer will not be charged, which is the kind of wrong that ends up in a
 * complaint rather than a bug report.
 *
 * So this reads the seed out of the migration and compares. It is not elegant
 * — it parses SQL with a regular expression — but the alternative is a
 * duplicated constant nothing checks, and that is what the register already
 * has a row about. A brittle test that fails loudly when the two drift beats a
 * comment asking people to remember.
 */

const MIGRATION = 'supabase/migrations/0023_commercials.sql';

interface SeededPlan {
  code: string;
  name: string;
  pricePence: number;
  summary: string;
}

/**
 * The `insert into public.plans ... values (...)` rows, as seeded.
 *
 * Anchored on the plan codes rather than on the statement's shape, so
 * reformatting the migration does not break this — only changing a price,
 * a name or a summary does, which is exactly when it should break.
 */
function seededPlans(): SeededPlan[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const row =
    /\('(starter|professional|business|enterprise)',\s*'([^']+)',\s*(\d+),\s*(?:\d+|null),\s*(?:\d+|null),\s*'([^']+)'/g;

  const plans: SeededPlan[] = [];
  for (const match of sql.matchAll(row)) {
    plans.push({
      code: match[1] ?? '',
      name: match[2] ?? '',
      pricePence: Number(match[3]),
      summary: match[4] ?? '',
    });
  }
  return plans;
}

describe('the pricing page and the plans table', () => {
  const seeded = seededPlans();

  it('finds all four seeded plans, or this test is checking nothing', () => {
    // Without this the regex could silently match zero rows and every
    // assertion below would pass vacuously — the failure mode of any test
    // that parses something.
    expect(seeded.map((p) => p.code)).toEqual([
      'starter',
      'professional',
      'business',
      'enterprise',
    ]);
  });

  it('shows one card per plan, in the same order', () => {
    expect(PLANS.map((p) => p.name)).toEqual(seeded.map((p) => p.name));
  });

  it('quotes the price the customer will actually be charged', () => {
    // The page writes "£29"; the table stores 2900. A plan priced at
    // £29.50 would need the page's format to change too, and this
    // deliberately does not try to guess how — it would fail, and the person
    // changing the price is the right one to decide.
    const asDisplayed = seeded.map((p) => `£${p.pricePence / 100}`);
    expect(PLANS.map((p) => p.price)).toEqual(asDisplayed);
  });

  it('describes each plan the way the table does', () => {
    // The summary carries the seat and site limits — "up to five sites and 60
    // staff" — which are enforced by triggers (0070). A page promising a
    // different number is a promise the database will refuse to keep.
    expect(PLANS.map((p) => p.summary)).toEqual(seeded.map((p) => p.summary));
  });
});
