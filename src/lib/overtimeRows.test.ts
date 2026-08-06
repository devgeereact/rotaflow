import { describe, expect, it } from 'vitest';
import {
  buildOvertimeRows,
  formatOvertimeHours,
  overtimeStatus,
  summariseOvertime,
} from '@/lib/overtimeRows';
import type { OvertimeRequest, StaffProfile } from '@/types';

const STAFF_DEFAULTS: StaffProfile = {
  id: 'p-1',
  org_id: 'org-1',
  user_id: 'u-1',
  first_name: 'Priya',
  last_name: 'Raman',
  job_title: 'Senior Nurse',
  department_id: null,
  contract_type: 'full_time',
  weekly_hours: 37.5,
  holiday_allowance: 28,
  skills: [],
  payroll_id: null,
  start_date: null,
  phone: null,
  photo_url: null,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const REQUEST_DEFAULTS: OvertimeRequest = {
  id: 'o-1',
  org_id: 'org-1',
  staff_profile_id: 'p-1',
  date: '2026-08-04',
  hours: 2,
  status: 'pending',
  note: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
};

function request(over: Partial<OvertimeRequest> & { id: string }): OvertimeRequest {
  return { ...REQUEST_DEFAULTS, ...over };
}

const staffById = new Map<string, StaffProfile>([['p-1', STAFF_DEFAULTS]]);

describe('overtimeStatus', () => {
  it('maps the recognised values', () => {
    expect(overtimeStatus('approved')).toBe('approved');
    expect(overtimeStatus('rejected')).toBe('rejected');
    expect(overtimeStatus('cancelled')).toBe('cancelled');
  });

  it('tolerates the American spellings', () => {
    // Not reachable through the CHECK constraint today; cheap insurance if a
    // future writer or an import ever uses them.
    expect(overtimeStatus('declined')).toBe('rejected');
    expect(overtimeStatus('canceled')).toBe('cancelled');
  });

  it('falls back to pending rather than dropping an unknown value', () => {
    // Defensive: a row that fell out of an approval queue because nobody
    // recognised its status is a request nobody ever answers.
    expect(overtimeStatus('escalated')).toBe('pending');
    expect(overtimeStatus(null)).toBe('pending');
  });
});

describe('formatOvertimeHours', () => {
  it('renders whole hours without a minutes part', () => {
    expect(formatOvertimeHours(8)).toBe('8h');
  });

  it('renders a fractional hour as minutes, not a decimal', () => {
    // 0.5 rendered raw reads as an error on a payroll-adjacent screen.
    expect(formatOvertimeHours(2.5)).toBe('2h 30m');
    expect(formatOvertimeHours(0.75)).toBe('45m');
  });

  it('never renders negative time', () => {
    expect(formatOvertimeHours(-3)).toBe('0m');
  });

  it('rounds to the nearest minute', () => {
    // 1.008h is 60.48 minutes. Down to 60, which is a whole hour.
    expect(formatOvertimeHours(1.008)).toBe('1h');
    // 1.02h is 61.2 minutes. Down to 61.
    expect(formatOvertimeHours(1.02)).toBe('1h 1m');
    // 1.999h is 119.94 minutes, up to 120, a whole hour rather than "1h 60m".
    expect(formatOvertimeHours(1.999)).toBe('2h');
  });
});

describe('buildOvertimeRows', () => {
  it('orders newest date first', () => {
    const rows = buildOvertimeRows({
      requests: [
        request({ id: 'old', date: '2026-08-01' }),
        request({ id: 'new', date: '2026-08-09' }),
      ],
      staffById,
      currentUserId: null,
    });
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('keeps a row whose staff profile is missing', () => {
    // A silently dropped row in an approval queue is a request nobody answers.
    const rows = buildOvertimeRows({
      requests: [request({ id: 'o-1', staff_profile_id: 'ghost' })],
      staffById,
      currentUserId: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.staffName).toBe('Unknown staff member');
  });

  it('says "by you" only when the reviewer is the signed-in user', () => {
    const [mine] = buildOvertimeRows({
      requests: [request({ id: 'a', status: 'approved', reviewed_by: 'u-me' })],
      staffById,
      currentUserId: 'u-me',
    });
    const [theirs] = buildOvertimeRows({
      requests: [request({ id: 'b', status: 'approved', reviewed_by: 'u-other' })],
      staffById,
      currentUserId: 'u-me',
    });
    expect(mine?.statusNote).toBe('Approved by you');
    expect(theirs?.statusNote).toBe('Approved');
  });

  it('labels a pending request as needing approval', () => {
    const [row] = buildOvertimeRows({
      requests: [request({ id: 'a' })],
      staffById,
      currentUserId: 'u-me',
    });
    expect(row?.statusNote).toBe('Needs approval');
  });
});

describe('summariseOvertime', () => {
  it('counts approved and pending hours separately', () => {
    const rows = buildOvertimeRows({
      requests: [
        request({ id: 'a', status: 'approved', hours: 3 }),
        request({ id: 'b', status: 'approved', hours: 1.5 }),
        request({ id: 'c', status: 'pending', hours: 2 }),
      ],
      staffById,
      currentUserId: null,
    });
    const summary = summariseOvertime(rows);
    expect(summary.approvedHours).toBe(4.5);
    expect(summary.approvedHoursLabel).toBe('4h 30m');
    expect(summary.pending).toBe(1);
    expect(summary.pendingHoursLabel).toBe('2h');
  });

  it('excludes rejected and withdrawn hours from the totals', () => {
    // Including them would overstate what the organisation owes.
    const rows = buildOvertimeRows({
      requests: [
        request({ id: 'a', status: 'approved', hours: 2 }),
        request({ id: 'b', status: 'rejected', hours: 40 }),
        request({ id: 'c', status: 'cancelled', hours: 40 }),
      ],
      staffById,
      currentUserId: null,
    });
    const summary = summariseOvertime(rows);
    expect(summary.approvedHours).toBe(2);
    expect(summary.pendingHours).toBe(0);
  });
});
