import { useState } from 'react';
import { format } from 'date-fns';
import { ManagerTimesheets } from '@/components/timesheets/ManagerTimesheets';
import { StaffTimesheets } from '@/components/timesheets/StaffTimesheets';
import type { TimesheetDisplayRow } from '@/components/timesheets/TimesheetRowsTable';
import type { TimesheetDayStatus } from '@/lib/timesheetDayRows';
import { PreviewCanvas } from '@/components/ui/PreviewCanvas';

const TODAY_LABEL = format(new Date(), 'EEE d MMM');

const ROWS: TimesheetDisplayRow[] = [
  {
    staffId: 'staff-0',
    shiftId: 'shift-0',
    firstName: 'Amara',
    lastName: 'Osei',
    jobTitle: 'Senior Carer',
    photoUrl: null,
    dayLabel: TODAY_LABEL,
    plannedLabel: '07:00, 19:30',
    actualLabel: '06:56, 19:41',
    paidLabel: '12.2h',
    status: 'complete',
    flag: null,
    approved: false,
  },
  {
    staffId: 'staff-1',
    shiftId: 'shift-1',
    firstName: 'Callum',
    lastName: 'Reid',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    dayLabel: TODAY_LABEL,
    plannedLabel: '07:00, 15:00',
    actualLabel: '07:12, 15:02',
    paidLabel: '7.6h',
    status: 'late',
    flag: '12 min late',
    approved: false,
  },
  {
    staffId: 'staff-2',
    shiftId: 'shift-2',
    firstName: 'Tomas',
    lastName: 'Nowak',
    jobTitle: 'Night Lead',
    photoUrl: null,
    dayLabel: TODAY_LABEL,
    plannedLabel: '19:00, 07:30',
    actualLabel: '18:58, -',
    paidLabel: '-',
    status: 'on_shift',
    flag: 'Still clocked in',
    approved: false,
  },
  {
    staffId: 'staff-3',
    shiftId: 'shift-3',
    firstName: 'Ffion',
    lastName: 'Davies',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    dayLabel: TODAY_LABEL,
    plannedLabel: '07:00, 15:00',
    actualLabel: '-',
    paidLabel: '-',
    status: 'absent',
    flag: 'No clock-in recorded',
    approved: false,
  },
  {
    staffId: 'staff-4',
    shiftId: 'shift-4',
    firstName: 'Idris',
    lastName: 'Okafor',
    jobTitle: 'Activities Lead',
    photoUrl: null,
    dayLabel: TODAY_LABEL,
    plannedLabel: '09:00, 17:00',
    actualLabel: '09:01, 17:04',
    paidLabel: '7.0h',
    status: 'complete',
    flag: null,
    approved: true,
  },
];

/**
 * Design-loop preview only, at `/timesheets-preview`. The real
 * `/app/timesheets` needs a live Supabase session and a seeded organisation,
 * neither of which a screenshot tool has. Renders the real
 * `ManagerTimesheets`/`StaffTimesheets` against fixed mock data shaped to
 * match `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.timesheets`.
 * `?role=staff` switches branch.
 */
export function TimesheetsPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TimesheetDayStatus | ''>('');

  const filtered = ROWS.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (
      search.trim() &&
      !`${r.firstName} ${r.lastName}`.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <PreviewCanvas>
      {role === 'staff' ? (
        <StaffTimesheets
          rows={[ROWS[0]!]}
          hoursThisWeekLabel="32h 10m"
          contractedLabel="37.5h"
          overtimeLabel="0h"
          payrollCutOff="Fri 14 Aug"
        />
      ) : (
        <ManagerTimesheets
          rows={filtered}
          totalRowCount={ROWS.length}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          tiles={{
            hoursRecordedLabel: '38.8h',
            plannedLabel: '44.0h',
            varianceLabel: '-5.2h',
            varianceIsShort: true,
            lateStarts: 1,
            stillClockedIn: 1,
            awaitingApproval: 4,
            payrollCutOff: 'Fri 14 Aug',
          }}
          onExportCsv={() => {}}
          onApproveWeek={() => {}}
          approveWeekBusy={false}
          onAmend={async () => {}}
          onApprovePerson={() => {}}
          timezoneForRow={() => 'Europe/London'}
          clockEventsForRow={() => ({ clockIn: null, clockOut: null })}
        />
      )}
    </PreviewCanvas>
  );
}
