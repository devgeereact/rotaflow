import type { StaffFormValues } from '@/components/staff/StaffFormModal';
import type { StaffProfileInsert } from '@/types';

/**
 * The row the Team screen writes when a staff record is added or edited.
 *
 * Here rather than inside `StaffPage` so a test can hold it to its job.
 * BUG-010 was "staff email edits silently discarded": an edit saved, the
 * screen said so, and the address never changed, because the field did not
 * reach the patch. Every column the form edits has to appear in this object;
 * one that is left out is dropped without an error, which is why it went
 * unnoticed. `staffForm.test.ts` lists them.
 */
export function staffFormToWrite(
  orgId: string,
  values: StaffFormValues,
): StaffProfileInsert {
  return {
    org_id: orgId,
    first_name: values.firstName.trim(),
    last_name: values.lastName.trim(),
    // Both columns, deliberately: `job_title_id` is authoritative and
    // `job_title` is kept in step so a client bundle still in a service
    // worker cache can render the title it cannot resolve. See 0127.
    job_title_id: values.jobTitleId || null,
    job_title: values.jobTitle.trim() || null,
    department_id: values.departmentId || null,
    contract_type: values.contractType || null,
    weekly_hours: values.weeklyHours ? Number(values.weeklyHours) : null,
    holiday_allowance: values.holidayAllowance ? Number(values.holidayAllowance) : null,
    skills: values.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    payroll_id: values.payrollId.trim() || null,
    start_date: values.startDate || null,
    phone: values.phone.trim() || null,
    email: values.email.trim() ? values.email.trim().toLowerCase() : null,
  };
}
