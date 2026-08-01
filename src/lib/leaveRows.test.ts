import { describe, expect, it } from 'vitest';
import {
  countLeaveDaysByType,
  formatLeaveDays,
  formatLeaveDuration,
  formatLeaveRange,
  formatRequestedAt,
  leaveDayCount,
  leaveTypeKey,
} from '@/lib/leaveRows';
import type { LeaveTypeKey } from '@/lib/leaveRows';
import type { LeaveRequest } from '@/types';

/**
 * The Leave screen's date and duration arithmetic.
 *
 * Every function here turns a stored `date` column into something a manager
 * reads before approving or refusing time off. A day lost to a timezone is a
 * shift someone is wrongly rostered for, and it never surfaces as an error —
 * which is the bug class `.github/workflows/ci.yml` pins `TZ: UTC` over. CI
 * runs under UTC; these assertions must hold under any offset.
 */

const LABELS: Record<LeaveTypeKey, string> = {
  annual: 'Annual Leave',
  sick: 'Sick Leave',
  personal: 'Personal Leave',
  carer: "Carer's Leave",
  other: 'Other',
};

let seq = 0;
function request(
  start: string,
  end: string,
  type: string,
  status: LeaveRequest['status'] = 'approved',
): LeaveRequest {
  seq += 1;
  return {
    id: `leave-${seq}`,
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    type,
    start_date: start,
    end_date: end,
    status,
    reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2025-05-01T09:00:00Z',
    updated_at: '2025-05-01T09:00:00Z',
  };
}

describe('leaveTypeKey', () => {
  it("maps the column's default to Annual Leave", () => {
    // `leave_requests.type` defaults to 'holiday' (0002_rotaflow.sql), so every
    // request written before the type picker existed lands here.
    expect(leaveTypeKey('holiday')).toBe('annual');
  });

  it('normalises case, spaces and hyphens', () => {
    expect(leaveTypeKey('Sick Leave')).toBe('sick');
    expect(leaveTypeKey('personal-leave')).toBe('personal');
    expect(leaveTypeKey('  CARERS_LEAVE  ')).toBe('carer');
  });

  it('falls back to `other` rather than dropping an unknown type', () => {
    // The column is free text with no CHECK — an org can write anything.
    expect(leaveTypeKey('sabbatical')).toBe('other');
    expect(leaveTypeKey('')).toBe('other');
    expect(leaveTypeKey(null)).toBe('other');
  });
});

describe('leaveDayCount', () => {
  it('counts a single day as one, not zero', () => {
    expect(leaveDayCount('2025-05-28', '2025-05-28')).toBe(1);
  });

  it('counts inclusively across a range', () => {
    expect(leaveDayCount('2025-06-09', '2025-06-13')).toBe(5);
    expect(leaveDayCount('2025-05-30', '2025-06-01')).toBe(3);
  });

  it('is unaffected by the British Summer Time transition', () => {
    // 30 March 2025 loses an hour. Counting in raw milliseconds without
    // rounding would return 6.958… days and floor to 6.
    expect(leaveDayCount('2025-03-28', '2025-04-03')).toBe(7);
  });

  it('is unaffected by the autumn transition, which gains an hour', () => {
    expect(leaveDayCount('2025-10-24', '2025-10-30')).toBe(7);
  });

  it('never returns less than a day for an inverted range', () => {
    expect(leaveDayCount('2025-05-28', '2025-05-27')).toBe(1);
  });
});

describe('formatLeaveDuration', () => {
  it('singularises exactly one day', () => {
    expect(formatLeaveDuration(1)).toBe('1 day');
    expect(formatLeaveDuration(3)).toBe('3 days');
    expect(formatLeaveDuration(0)).toBe('0 days');
  });
});

describe('formatLeaveRange', () => {
  it('renders a single day without a range', () => {
    expect(formatLeaveRange('2025-05-28', '2025-05-28')).toBe('28 May 2025');
  });

  it('collapses the month when a range stays inside one', () => {
    expect(formatLeaveRange('2025-06-09', '2025-06-13')).toBe('9 – 13 June 2025');
  });

  it('names both months when a range crosses one', () => {
    expect(formatLeaveRange('2025-05-30', '2025-06-01')).toBe('30 May – 1 June 2025');
  });

  it('names both years when a range crosses one', () => {
    expect(formatLeaveRange('2025-12-30', '2026-01-02')).toBe(
      '30 December 2025 – 2 January 2026',
    );
  });

  it('does not shift a date-only column by a day', () => {
    // `new Date('2025-01-01')` is UTC midnight, which formats as 31 December in
    // any negative offset. `parseISO` reads it as local midnight instead.
    expect(formatLeaveRange('2025-01-01', '2025-01-01')).toBe('1 January 2025');
  });
});

describe('formatLeaveDays', () => {
  it('renders one weekday for a single day', () => {
    expect(formatLeaveDays('2025-05-28', '2025-05-28')).toBe('Wed');
  });

  it('renders a weekday span for a range', () => {
    expect(formatLeaveDays('2025-05-30', '2025-06-01')).toBe('Fri – Sun');
    expect(formatLeaveDays('2025-06-09', '2025-06-13')).toBe('Mon – Fri');
  });
});

describe('formatRequestedAt', () => {
  const now = new Date(2025, 4, 26, 14, 0, 0); // 26 May 2025, local

  it('says Today for anything since local midnight', () => {
    expect(formatRequestedAt(new Date(2025, 4, 26, 9, 15).toISOString(), now)).toBe(
      'Today, 09:15',
    );
  });

  it('says Yesterday for the previous calendar day', () => {
    expect(formatRequestedAt(new Date(2025, 4, 25, 16, 30).toISOString(), now)).toBe(
      'Yesterday, 16:30',
    );
  });

  it('falls back to a date beyond yesterday', () => {
    expect(formatRequestedAt(new Date(2025, 4, 21, 16, 30).toISOString(), now)).toBe(
      '21 May 2025',
    );
  });

  it('treats one minute past local midnight as Today, not Yesterday', () => {
    expect(formatRequestedAt(new Date(2025, 4, 26, 0, 1).toISOString(), now)).toBe(
      'Today, 00:01',
    );
  });
});

describe('countLeaveDaysByType', () => {
  it('sums approved days per type, largest first', () => {
    const rows = countLeaveDaysByType(
      [
        request('2025-06-09', '2025-06-13', 'holiday'), // 5 annual
        request('2025-05-28', '2025-05-28', 'sick'), // 1 sick
        request('2025-05-19', '2025-05-20', 'sick'), // 2 sick
      ],
      LABELS,
    );
    expect(rows).toEqual([
      { type: 'annual', label: 'Annual Leave', days: 5 },
      { type: 'sick', label: 'Sick Leave', days: 3 },
    ]);
  });

  it('ignores anything not approved', () => {
    // Pending and declined requests are not days taken. Counting them would
    // overstate the donut and make an org look like it had used leave it had
    // not granted.
    const rows = countLeaveDaysByType(
      [
        request('2025-06-09', '2025-06-13', 'holiday', 'pending'),
        request('2025-06-16', '2025-06-20', 'holiday', 'rejected'),
        request('2025-06-23', '2025-06-27', 'holiday', 'cancelled'),
        request('2025-07-01', '2025-07-02', 'holiday', 'approved'),
      ],
      LABELS,
    );
    expect(rows).toEqual([{ type: 'annual', label: 'Annual Leave', days: 2 }]);
  });

  it('returns nothing when there is nothing approved', () => {
    expect(countLeaveDaysByType([], LABELS)).toEqual([]);
  });
});
