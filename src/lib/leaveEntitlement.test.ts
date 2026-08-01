import { describe, expect, it } from 'vitest';
import { sumApprovedLeaveDays } from '@/lib/leaveEntitlement';
import type { LeaveRequest } from '@/types';

/**
 * Leave entitlement. Over-counting refuses someone leave they are owed;
 * under-counting hands out leave the org has not budgeted for. Both are
 * arguments with a real person, and neither surfaces as an error.
 *
 * The aggregate lives in `src/lib/leaveEntitlement.ts` rather than in
 * `leaveService.ts` precisely so this file can import it without constructing a
 * Supabase client — see that module's header.
 */

let seq = 0;
function request(
  start: string,
  end: string,
  status: LeaveRequest['status'] = 'approved',
): LeaveRequest {
  seq += 1;
  return {
    id: `leave-${seq}`,
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    start_date: start,
    end_date: end,
    status,
    type: 'annual',
    reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: `${start}T00:00:00Z`,
    updated_at: `${start}T00:00:00Z`,
  };
}

const YEAR_START = '2026-01-01';
const YEAR_END = '2027-01-01';

describe('sumApprovedLeaveDays', () => {
  it('counts a single day as one day, not zero', () => {
    // start === end is one day off, not a zero-length range. The classic
    // fencepost, and the most common leave request there is.
    expect(
      sumApprovedLeaveDays([request('2026-06-15', '2026-06-15')], YEAR_START, YEAR_END),
    ).toBe(1);
  });

  it('counts an inclusive range', () => {
    // Mon-Fri is five days off, not four.
    expect(
      sumApprovedLeaveDays([request('2026-06-15', '2026-06-19')], YEAR_START, YEAR_END),
    ).toBe(5);
  });

  it('sums several requests', () => {
    const total = sumApprovedLeaveDays(
      [request('2026-06-15', '2026-06-19'), request('2026-08-03', '2026-08-07')],
      YEAR_START,
      YEAR_END,
    );
    expect(total).toBe(10);
  });

  it('ignores requests that are not approved', () => {
    const total = sumApprovedLeaveDays(
      [
        request('2026-06-15', '2026-06-19', 'approved'),
        request('2026-07-01', '2026-07-10', 'pending'),
        request('2026-07-15', '2026-07-20', 'rejected'),
        request('2026-08-01', '2026-08-05', 'cancelled'),
      ],
      YEAR_START,
      YEAR_END,
    );

    // Only the approved five days. Counting a pending request against someone's
    // allowance would refuse them leave they have not been granted or denied.
    expect(total).toBe(5);
  });

  it('counts nothing for an empty list', () => {
    expect(sumApprovedLeaveDays([], YEAR_START, YEAR_END)).toBe(0);
  });

  it('excludes leave entirely outside the window', () => {
    const total = sumApprovedLeaveDays(
      [request('2025-06-15', '2025-06-19'), request('2027-06-15', '2027-06-19')],
      YEAR_START,
      YEAR_END,
    );
    expect(total).toBe(0);
  });

  it('is unaffected by DST — a week off is seven days in any season', () => {
    // Leave dates are 'YYYY-MM-DD', which parse as UTC midnight, so the day
    // arithmetic here is exact multiples of 24h regardless of local clocks.
    // This is the invariant that the schedule window helper got wrong.
    const acrossFallBack = sumApprovedLeaveDays(
      [request('2026-10-22', '2026-10-28')],
      YEAR_START,
      YEAR_END,
    );
    const acrossSpringForward = sumApprovedLeaveDays(
      [request('2026-03-26', '2026-04-01')],
      YEAR_START,
      YEAR_END,
    );
    const ordinaryWeek = sumApprovedLeaveDays(
      [request('2026-06-15', '2026-06-21')],
      YEAR_START,
      YEAR_END,
    );

    expect(acrossFallBack).toBe(7);
    expect(acrossSpringForward).toBe(7);
    expect(ordinaryWeek).toBe(7);
  });

  it('counts a leap day', () => {
    expect(
      sumApprovedLeaveDays(
        [request('2028-02-27', '2028-03-01')],
        '2028-01-01',
        '2029-01-01',
      ),
    ).toBe(4);
  });

  it('never returns a negative for an inverted range', () => {
    // Bad data — end before start. Clamped rather than subtracting from the
    // rest of the year's total.
    expect(
      sumApprovedLeaveDays([request('2026-06-19', '2026-06-15')], YEAR_START, YEAR_END),
    ).toBeGreaterThanOrEqual(0);
  });

  it('counts leave spanning the year boundary in full, in both years', () => {
    // DOCUMENTS CURRENT BEHAVIOUR, and it is arguably wrong.
    //
    // A request running 28 Dec 2026 -> 3 Jan 2027 is seven days. It overlaps
    // both entitlement years, and this function counts all seven against each,
    // because it filters by overlap and then measures the whole request rather
    // than the part inside the window.
    //
    // So a person taking one week off across new year loses seven days from
    // BOTH years' allowance — fourteen days for a seven-day holiday.
    //
    // Left as-is rather than silently changed: clamping is the obvious fix but
    // it alters every existing entitlement figure the moment it ships, and that
    // is a product decision (which year does a straddling day belong to?) not a
    // refactor. Tracked as P2 in docs/audit01.md. This test exists so the
    // behaviour cannot change by accident before that decision is made.
    const straddling = [request('2026-12-28', '2027-01-03')];

    expect(sumApprovedLeaveDays(straddling, YEAR_START, YEAR_END)).toBe(7);
    expect(sumApprovedLeaveDays(straddling, '2027-01-01', '2028-01-01')).toBe(7);
  });
});
