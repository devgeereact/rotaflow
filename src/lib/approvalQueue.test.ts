import { describe, expect, it } from 'vitest';
import { buildApprovalQueue, type SwapForQueue } from '@/lib/approvalQueue';
import type { LeaveRequest, OvertimeRequest, StaffProfile } from '@/types';

/**
 * One queue over the three things a manager decides (CAP-093).
 *
 * The assertions that matter are about what is deliberately NOT in it: a
 * queue containing rows the reader cannot clear stops being read.
 */

const NOW = new Date('2026-09-10T09:00:00Z');

const staff = [
  { id: 'staff-1', first_name: 'Ada', last_name: 'Lovelace' },
  { id: 'staff-2', first_name: 'Grace', last_name: 'Hopper' },
] as unknown as StaffProfile[];

function leave(over: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'leave-1',
    status: 'pending',
    staff_profile_id: 'staff-1',
    type: 'Annual leave',
    start_date: '2026-09-20',
    end_date: '2026-09-24',
    created_at: '2026-09-09T09:00:00Z',
    ...over,
  } as LeaveRequest;
}

function swap(over: Partial<SwapForQueue> = {}): SwapForQueue {
  return {
    id: 'swap-1',
    status: 'accepted',
    requested_by: 'staff-1',
    target_staff_profile_id: 'staff-2',
    created_at: '2026-09-08T09:00:00Z',
    ...over,
  };
}

function overtime(over: Partial<OvertimeRequest> = {}): OvertimeRequest {
  return {
    id: 'ot-1',
    status: 'pending',
    staff_profile_id: 'staff-2',
    hours: 3,
    date: '2026-09-05',
    created_at: '2026-09-07T09:00:00Z',
    ...over,
  } as OvertimeRequest;
}

const empty = { leave: [], swaps: [], overtime: [], staff, now: NOW };

describe('buildApprovalQueue', () => {
  it('puts all three kinds in one list', () => {
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave()],
      swaps: [swap()],
      overtime: [overtime()],
    });
    // Oldest first, so the order is overtime (7th), swap (8th), leave (9th).
    expect(rows.map((r) => r.kind)).toEqual(['overtime', 'swap', 'leave']);
  });

  it('orders oldest first', () => {
    // The queue exists so nothing is forgotten. Newest-first buries the
    // request somebody has been chasing for a fortnight under this morning's.
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave({ created_at: '2026-09-01T09:00:00Z' })],
      overtime: [overtime({ created_at: '2026-09-09T09:00:00Z' })],
    });
    expect(rows[0]?.kind).toBe('leave');
  });

  it('counts whole days waiting', () => {
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave({ created_at: '2026-09-07T09:00:00Z' })],
    });
    expect(rows[0]?.waitingDays).toBe(3);
  });

  it('leaves out anything already decided', () => {
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave({ status: 'approved' })],
      overtime: [overtime({ status: 'rejected' })],
    });
    expect(rows).toEqual([]);
  });

  it('leaves out a swap that is waiting on a colleague, not a manager', () => {
    // The assertion this design turns on. A row the reader cannot clear makes
    // the whole queue less useful than the three screens it replaces.
    const rows = buildApprovalQueue({
      ...empty,
      swaps: [swap({ status: 'pending', target_staff_profile_id: 'staff-2' })],
    });
    expect(rows).toEqual([]);
  });

  it('includes a swap offered to nobody in particular', () => {
    const rows = buildApprovalQueue({
      ...empty,
      swaps: [swap({ status: 'pending', target_staff_profile_id: null })],
    });
    expect(rows[0]?.summary).toBe('Shift offered up, nobody has taken it');
  });

  it('says so when the person has left, rather than showing a blank', () => {
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave({ staff_profile_id: 'gone' })],
    });
    expect(rows[0]?.personName).toBe('A former team member');
  });

  it('writes a single day as one date, not a range to itself', () => {
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave({ start_date: '2026-09-20', end_date: '2026-09-20' })],
    });
    // Not asserting the month's abbreviation — "Sep" and "Sept" are both
    // valid en-GB depending on the ICU build, and the point of this test is
    // that a one-day request does not read as a range to itself.
    expect(rows[0]?.summary).toMatch(/^Annual leave on 20 Sept?$/);
  });

  it('never reports a negative wait for a clock skew', () => {
    const rows = buildApprovalQueue({
      ...empty,
      leave: [leave({ created_at: '2026-09-30T09:00:00Z' })],
    });
    expect(rows[0]?.waitingDays).toBe(0);
  });
});
