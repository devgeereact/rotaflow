/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ManagerTimesheets } from '@/components/timesheets/ManagerTimesheets';
import {
  TimesheetRowsTable,
  type TimesheetDisplayRow,
} from '@/components/timesheets/TimesheetRowsTable';

// Slice S13: the chips and the payroll export appear only when the page passes them (the
// `timesheet_tools` flag); without them the screen is exactly as before.
afterEach(cleanup);
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

const row = (over: Partial<TimesheetDisplayRow> = {}): TimesheetDisplayRow => ({
  staffId: 'P1',
  shiftId: 'S1',
  firstName: 'Sam',
  lastName: 'Smith',
  jobTitle: null,
  photoUrl: null,
  dayLabel: 'Mon 19 Oct',
  plannedLabel: '09:00 – 17:00',
  actualLabel: '09:12, 17:00',
  paidLabel: '7h 48m',
  status: 'late',
  flag: '12 min late',
  approved: false,
  ...over,
});

const managerProps = {
  rows: [row()],
  totalRowCount: 1,
  search: '',
  onSearchChange: () => undefined,
  statusFilter: '' as const,
  onStatusFilterChange: () => undefined,
  tiles: {
    hoursRecordedLabel: '8h',
    plannedLabel: '8h',
    varianceLabel: '+0h',
    varianceIsShort: false,
    lateStarts: 1,
    stillClockedIn: 0,
    awaitingApproval: 1,
    payrollCutOff: 'Fri 23 Oct',
  },
  onExportCsv: () => undefined,
  onApproveWeek: () => undefined,
  approveWeekBusy: false,
  onAmend: () => Promise.resolve(),
  onApprovePerson: () => undefined,
  timezoneForRow: () => 'Europe/London',
  clockEventsForRow: () => ({ clockIn: null, clockOut: null }),
};

describe('TimesheetRowsTable flag chips', () => {
  it('shows no flag list when the row carries no chips (flag off)', () => {
    render(<TimesheetRowsTable rows={[row()]} showActions={false} emptyMessage="none" />);
    expect(screen.queryByLabelText('Timesheet flags')).toBeNull();
    expect(screen.getByText('12 min late')).toBeTruthy();
  });

  it('shows the chips beside the line, in order', () => {
    render(
      <TimesheetRowsTable
        rows={[
          row({
            chips: [
              { key: 'late', label: 'Late 12 min', tone: 'warning' },
              { key: 'overtime', label: 'Overtime 25 min', tone: 'warning' },
            ],
          }),
        ]}
        showActions={false}
        emptyMessage="none"
      />,
    );
    const list = screen.getByLabelText('Timesheet flags');
    expect(list.textContent).toBe('Late 12 minOvertime 25 min');
  });
});

describe('ManagerTimesheets payroll export', () => {
  it('has only the existing Export CSV without the payroll prop', () => {
    render(<ManagerTimesheets {...managerProps} />);
    expect(screen.getByText('Export CSV')).toBeTruthy();
    expect(screen.queryByText('Export payroll CSV')).toBeNull();
  });

  it('exports the chosen range and refuses more than 31 days', async () => {
    const onExport = vi.fn(() => Promise.resolve());
    render(
      <ManagerTimesheets
        {...managerProps}
        payrollExport={{
          defaultFrom: '2026-10-19',
          defaultTo: '2026-10-25',
          toleranceMinutes: 10,
          onExport,
        }}
      />,
    );
    fireEvent.click(screen.getByText('Export payroll CSV'));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-25' } });
    expect(screen.getByRole('alert').textContent).toBe('Choose at most 31 days.');
    expect(screen.getByText<HTMLButtonElement>('Download CSV').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-25' } });
    fireEvent.click(screen.getByText('Download CSV'));
    await Promise.resolve();
    expect(onExport).toHaveBeenCalledWith('2026-10-19', '2026-10-25');
  });
});
