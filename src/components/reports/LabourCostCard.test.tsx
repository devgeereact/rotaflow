/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getLabourCost = vi.fn();
vi.mock('@/services/payRateService', () => ({
  getLabourCost: (...args: unknown[]): unknown => getLabourCost(...args) as unknown,
}));
vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));

import { LabourCostCard } from '@/components/reports/LabourCostCard';

/**
 * What a rostered week costs (docs/SAAS.md CAP-086, CAP-100).
 *
 * ## Why this component earns a test
 *
 * It shows a number that looks like an answer, and there is a case where it
 * is not: somebody rostered with no pay rate on file contributes nothing to
 * the total, which makes the figure wrong in the direction that looks fine.
 * The warning is the whole safeguard, so a change that dropped it would be
 * invisible to every other kind of test in this repository.
 *
 * The other branch is the refusal. `labour_cost` raises `42501` for anybody
 * who is not an owner or manager — correct rather than broken — and the card
 * must render nothing at all rather than an error, because a staff member
 * seeing "could not load labour cost" would reasonably report a bug.
 *
 * No `@testing-library/jest-dom`: this repository does without it on purpose.
 */

afterEach(() => {
  cleanup();
  getLabourCost.mockReset();
});

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  locationId: 'loc-1',
  locationName: 'Ward A',
  scheduledMinutes: 600,
  costPence: 12_000,
  unratedStaff: 0,
  ...over,
});

describe('LabourCostCard', () => {
  it('shows the total as money, not pence', async () => {
    getLabourCost.mockResolvedValue([row()]);
    render(
      <LabourCostCard
        orgId="org-1"
        from="2026-09-01"
        to="2026-09-07"
        rangeLabel="This week"
        paidBreaks={false}
      />,
    );

    // Twice on purpose: once as the headline and once as the site's row. With
    // one location those are the same number, so the assertion counts rather
    // than expecting a single match.
    await waitFor(() => expect(screen.getAllByText('£120.00').length).toBe(2));
  });

  it('names the people it could not price', async () => {
    // The safeguard. A total that quietly values somebody at zero is wrong in
    // the direction that looks fine, and nothing else in the suite would
    // notice if this sentence disappeared.
    getLabourCost.mockResolvedValue([row({ unratedStaff: 3 })]);
    render(
      <LabourCostCard
        orgId="org-1"
        from="2026-09-01"
        to="2026-09-07"
        rangeLabel="This week"
        paidBreaks={false}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/3 rostered people have no pay rate on file/i),
      ).toBeDefined(),
    );
  });

  it('says it in the singular for one person', async () => {
    getLabourCost.mockResolvedValue([row({ unratedStaff: 1 })]);
    render(
      <LabourCostCard
        orgId="org-1"
        from="2026-09-01"
        to="2026-09-07"
        rangeLabel="This week"
        paidBreaks={false}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/One rostered person has no pay rate on file/i),
      ).toBeDefined(),
    );
  });

  it('says nothing about rates when everyone has one', async () => {
    getLabourCost.mockResolvedValue([row()]);
    const { container } = render(
      <LabourCostCard
        orgId="org-1"
        from="2026-09-01"
        to="2026-09-07"
        rangeLabel="This week"
        paidBreaks={false}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('£120.00').length).toBe(2));
    expect(container.textContent).not.toContain('no pay rate on file');
  });

  it('renders nothing at all when the database refuses the caller', async () => {
    // 42501 is correct, not broken: a staff member may not see labour cost.
    // "Could not load" would be reported as a bug by somebody being told no.
    getLabourCost.mockRejectedValue({ code: '42501' });
    const { container } = render(
      <LabourCostCard
        orgId="org-1"
        from="2026-09-01"
        to="2026-09-07"
        rangeLabel="This week"
        paidBreaks={false}
      />,
    );

    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('says whether breaks are in the figure', async () => {
    // The same roster costs two different numbers depending on this, and the
    // reader cannot tell which they are looking at without being told.
    getLabourCost.mockResolvedValue([row()]);
    render(
      <LabourCostCard
        orgId="org-1"
        from="2026-09-01"
        to="2026-09-07"
        rangeLabel="This week"
        paidBreaks
      />,
    );

    await waitFor(() => expect(screen.getByText(/breaks paid/i)).toBeDefined());
  });
});
