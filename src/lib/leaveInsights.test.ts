import { describe, expect, it } from 'vitest';
import {
  computeAwaitingDecision,
  computeStaffLeaveTiles,
  countApprovedOverlapping,
  findCoverRisk,
  formatCoverRiskRange,
  roundDays,
  sumSicknessDaysInMonth,
  teamEntitlementUsedFraction,
} from '@/lib/leaveInsights';
import type { LeaveRequest, StaffProfile } from '@/types';

function mkRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'r1',
    org_id: 'org-1',
    staff_profile_id: 's1',
    type: 'holiday',
    start_date: '2026-08-10',
    end_date: '2026-08-10',
    status: 'pending',
    reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function mkStaff(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    id: 's1',
    org_id: 'org-1',
    user_id: null,
    first_name: 'Amara',
    last_name: 'Osei',
    job_title: null,
    department_id: null,
    photo_url: null,
    phone: null,
    active: true,
    contract_type: null,
    holiday_allowance: 28,
    payroll_id: null,
    skills: [],
    start_date: null,
    weekly_hours: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeAwaitingDecision', () => {
  it('is empty when nothing is pending', () => {
    expect(computeAwaitingDecision([], new Date('2026-08-12'))).toEqual({
      count: 0,
      oldestPendingDays: null,
    });
  });

  it('counts pending requests and ages the oldest one', () => {
    const requests = [
      mkRequest({ id: 'a', status: 'pending', created_at: '2026-08-10T09:00:00.000Z' }),
      mkRequest({ id: 'b', status: 'pending', created_at: '2026-07-27T09:00:00.000Z' }),
      mkRequest({ id: 'c', status: 'approved', created_at: '2026-07-01T09:00:00.000Z' }),
    ];
    const result = computeAwaitingDecision(
      requests,
      new Date('2026-08-12T09:00:00.000Z'),
    );
    expect(result).toEqual({ count: 2, oldestPendingDays: 16 });
  });
});

describe('countApprovedOverlapping', () => {
  it('counts only approved requests overlapping the window', () => {
    const requests = [
      mkRequest({
        id: 'a',
        status: 'approved',
        start_date: '2026-08-20',
        end_date: '2026-08-22',
      }),
      mkRequest({
        id: 'b',
        status: 'pending',
        start_date: '2026-08-20',
        end_date: '2026-08-22',
      }),
      mkRequest({
        id: 'c',
        status: 'approved',
        start_date: '2026-09-20',
        end_date: '2026-09-22',
      }),
    ];
    expect(countApprovedOverlapping(requests, '2026-08-12', 30)).toBe(1);
  });
});

describe('sumSicknessDaysInMonth', () => {
  it('sums only approved sick-type days within the anchor month', () => {
    const requests = [
      mkRequest({
        id: 'a',
        type: 'sick',
        status: 'approved',
        start_date: '2026-08-05',
        end_date: '2026-08-07',
      }),
      mkRequest({
        id: 'b',
        type: 'sick',
        status: 'pending',
        start_date: '2026-08-08',
        end_date: '2026-08-08',
      }),
      mkRequest({
        id: 'c',
        type: 'holiday',
        status: 'approved',
        start_date: '2026-08-08',
        end_date: '2026-08-08',
      }),
      mkRequest({
        id: 'd',
        type: 'sick',
        status: 'approved',
        start_date: '2026-07-31',
        end_date: '2026-07-31',
      }),
    ];
    expect(sumSicknessDaysInMonth(requests, '2026-08-12')).toBe(3);
  });
});

describe('findCoverRisk', () => {
  it('returns null when nothing overlaps', () => {
    expect(findCoverRisk([], '2026-08-12', 60)).toBeNull();
  });

  it('finds the soonest day two or more staff overlap and extends the run', () => {
    const requests = [
      mkRequest({
        id: 'a',
        staff_profile_id: 's1',
        status: 'approved',
        start_date: '2026-08-25',
        end_date: '2026-08-27',
      }),
      mkRequest({
        id: 'b',
        staff_profile_id: 's2',
        status: 'approved',
        start_date: '2026-08-26',
        end_date: '2026-08-29',
      }),
      mkRequest({
        id: 'c',
        staff_profile_id: 's3',
        status: 'pending',
        start_date: '2026-08-28',
        end_date: '2026-08-29',
      }),
    ];
    const risk = findCoverRisk(requests, '2026-08-12', 60);
    expect(risk).toEqual({
      startDate: '2026-08-26',
      endDate: '2026-08-29',
      approvedCount: 2,
      pendingCount: 1,
    });
  });

  it('ignores rejected and cancelled requests', () => {
    const requests = [
      mkRequest({
        id: 'a',
        staff_profile_id: 's1',
        status: 'rejected',
        start_date: '2026-08-20',
        end_date: '2026-08-22',
      }),
      mkRequest({
        id: 'b',
        staff_profile_id: 's2',
        status: 'cancelled',
        start_date: '2026-08-20',
        end_date: '2026-08-22',
      }),
    ];
    expect(findCoverRisk(requests, '2026-08-12', 60)).toBeNull();
  });
});

describe('formatCoverRiskRange', () => {
  it('formats a single day', () => {
    expect(formatCoverRiskRange('2026-08-25', '2026-08-25')).toBe('Aug 25');
  });

  it('formats a same-month range', () => {
    expect(formatCoverRiskRange('2026-08-25', '2026-08-29')).toBe('Aug 25-29');
  });

  it('formats a cross-month range', () => {
    expect(formatCoverRiskRange('2026-08-30', '2026-09-02')).toBe('Aug 30-Sep 2');
  });
});

describe('teamEntitlementUsedFraction', () => {
  it('is null when nobody has an allowance recorded', () => {
    const staff = [mkStaff({ id: 's1', holiday_allowance: 0 })];
    expect(teamEntitlementUsedFraction(staff, [], '2026-08-12')).toBeNull();
  });

  it('sums allowance and approved annual-year usage across staff', () => {
    const staff = [
      mkStaff({ id: 's1', holiday_allowance: 20 }),
      mkStaff({ id: 's2', holiday_allowance: 30 }),
    ];
    const requests = [
      mkRequest({
        id: 'a',
        staff_profile_id: 's1',
        status: 'approved',
        start_date: '2026-03-01',
        end_date: '2026-03-10',
      }),
      mkRequest({
        id: 'b',
        staff_profile_id: 's2',
        status: 'approved',
        start_date: '2026-06-01',
        end_date: '2026-06-15',
      }),
    ];
    // s1 uses 10 days of 20, s2 uses 15 days of 30 → 25 / 50 = 0.5
    expect(teamEntitlementUsedFraction(staff, requests, '2026-08-12')).toBe(0.5);
  });
});

describe('computeStaffLeaveTiles', () => {
  it('reads entitlement, taken (annual only), remaining and pending (any type)', () => {
    const profile = mkStaff({ id: 's1', holiday_allowance: 28 });
    const requests = [
      mkRequest({
        id: 'a',
        staff_profile_id: 's1',
        type: 'holiday',
        status: 'approved',
        start_date: '2026-05-30',
        end_date: '2026-06-01',
      }),
      mkRequest({
        id: 'b',
        staff_profile_id: 's1',
        type: 'sick',
        status: 'approved',
        start_date: '2026-06-10',
        end_date: '2026-06-10',
      }),
      mkRequest({
        id: 'c',
        staff_profile_id: 's1',
        type: 'holiday',
        status: 'pending',
        start_date: '2026-09-01',
        end_date: '2026-09-05',
      }),
    ];
    expect(computeStaffLeaveTiles(profile, requests, '2026-08-12')).toEqual({
      entitlementDays: 28,
      takenDays: 3,
      remainingDays: 25,
      pendingDays: 5,
    });
  });

  it('reports entitlement and remaining as null when no allowance is recorded', () => {
    const profile = mkStaff({ id: 's1', holiday_allowance: null });
    expect(computeStaffLeaveTiles(profile, [], '2026-08-12')).toEqual({
      entitlementDays: null,
      takenDays: 0,
      remainingDays: null,
      pendingDays: 0,
    });
  });
});

describe('roundDays', () => {
  it('rounds to one decimal place', () => {
    expect(roundDays(3.456)).toBe(3.5);
    expect(roundDays(3)).toBe(3);
  });
});
