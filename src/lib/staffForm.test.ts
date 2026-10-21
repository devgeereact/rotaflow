import { describe, expect, it } from 'vitest';
import type { StaffFormValues } from '@/components/staff/StaffFormModal';
import { staffFormToWrite } from './staffForm';

/**
 * BUG-010, re-tested 2026-10-21 under GAP-115: an edited email address must
 * reach the row that is written. The defect was a field missing from this
 * object, and a missing field fails silently, so the test names every column
 * the form edits rather than checking one.
 */

const filled: StaffFormValues = {
  firstName: '  Ada ',
  lastName: ' Lovelace  ',
  jobTitleId: 'jt-1',
  jobTitle: ' Senior carer ',
  departmentId: 'dept-1',
  contractType: 'full_time',
  weeklyHours: '37.5',
  holidayAllowance: '28',
  skills: 'manual handling, , medication ',
  payrollId: ' P-104 ',
  startDate: '2026-01-05',
  phone: ' 07700 900123 ',
  email: '  Ada.Lovelace@Example.org ',
  locationIds: [],
};

const blank: StaffFormValues = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  jobTitleId: '',
  jobTitle: '',
  departmentId: '',
  contractType: '',
  weeklyHours: '',
  holidayAllowance: '',
  skills: '',
  payrollId: '',
  startDate: '',
  phone: '',
  email: '   ',
  locationIds: [],
};

describe('staffFormToWrite', () => {
  it('carries the email address, trimmed and lower-cased (BUG-010)', () => {
    expect(staffFormToWrite('org-1', filled).email).toBe('ada.lovelace@example.org');
  });

  it('writes every column the form edits', () => {
    expect(staffFormToWrite('org-1', filled)).toEqual({
      org_id: 'org-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      job_title_id: 'jt-1',
      job_title: 'Senior carer',
      department_id: 'dept-1',
      contract_type: 'full_time',
      weekly_hours: 37.5,
      holiday_allowance: 28,
      skills: ['manual handling', 'medication'],
      payroll_id: 'P-104',
      start_date: '2026-01-05',
      phone: '07700 900123',
      email: 'ada.lovelace@example.org',
    });
  });

  it('clears an emptied field to null rather than leaving it out', () => {
    const row = staffFormToWrite('org-1', blank);
    expect(row).toHaveProperty('email', null);
    expect(row).toHaveProperty('phone', null);
    expect(row).toHaveProperty('payroll_id', null);
    expect(row.skills).toEqual([]);
  });
});
