import { useState } from 'react';
import { Download } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import {
  AmendClockEventModal,
  type AmendClockEventInput,
} from '@/components/timesheets/AmendClockEventModal';
import {
  TimesheetRowsTable,
  type TimesheetDisplayRow,
} from '@/components/timesheets/TimesheetRowsTable';
import type { TimesheetDayStatus } from '@/lib/timesheetDayRows';
import type { ClockEvent } from '@/types';

export interface ManagerTimesheetTiles {
  hoursRecordedLabel: string;
  plannedLabel: string;
  varianceLabel: string;
  varianceIsShort: boolean;
  lateStarts: number;
  stillClockedIn: number;
  awaitingApproval: number;
  payrollCutOff: string;
}

interface AmendTarget {
  row: TimesheetDisplayRow;
  timezone: string;
}

export interface ManagerTimesheetsProps {
  rows: TimesheetDisplayRow[];
  totalRowCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: TimesheetDayStatus | '';
  onStatusFilterChange: (value: TimesheetDayStatus | '') => void;
  tiles: ManagerTimesheetTiles;
  onExportCsv: () => void;
  onApproveWeek: () => void;
  approveWeekBusy: boolean;
  onAmend: (row: TimesheetDisplayRow, input: AmendClockEventInput) => Promise<void>;
  onApprovePerson: (row: TimesheetDisplayRow) => void;
  /** For the amend modal's own time inputs, resolved per row by the caller. */
  timezoneForRow: (row: TimesheetDisplayRow) => string;
  clockEventsForRow: (row: TimesheetDisplayRow) => {
    clockIn: ClockEvent | null;
    clockOut: ClockEvent | null;
  };
}

/**
 * The manager's Timesheets (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.timesheets` manager branch): today's attendance against the plan,
 * real hours from clock events rather than the rota. "Approve week" and the
 * per-row Approve both approve a *week*, the only grain `timesheets` actually
 * stores (`period_start`/`period_end`), a day has no approval record of its
 * own to set.
 */
export function ManagerTimesheets({
  rows,
  totalRowCount,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  tiles,
  onExportCsv,
  onApproveWeek,
  approveWeekBusy,
  onAmend,
  onApprovePerson,
  timezoneForRow,
  clockEventsForRow,
}: ManagerTimesheetsProps): JSX.Element {
  const [amendTarget, setAmendTarget] = useState<AmendTarget | null>(null);
  const [amendBusy, setAmendBusy] = useState(false);
  const [approveWeekOpen, setApproveWeekOpen] = useState(false);

  const events = amendTarget ? clockEventsForRow(amendTarget.row) : null;

  return (
    <div>
      <WorkspaceHeader
        title="Timesheets"
        subtitle="Real hours from clock events, not the plan. Variances are flagged before payroll, not after."
        actions={
          <>
            <Button variant="secondary" onClick={onExportCsv}>
              <Download size={14} aria-hidden="true" className="mr-1.5" />
              Export CSV
            </Button>
            <Button onClick={() => setApproveWeekOpen(true)}>Approve week</Button>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Hours recorded"
          value={tiles.hoursRecordedLabel}
          hint={`vs ${tiles.plannedLabel} planned`}
        />
        <StatTile
          label="Variance"
          value={tiles.varianceLabel}
          hint={
            tiles.varianceIsShort ? (
              <span className="text-danger-ink">below plan</span>
            ) : (
              <span className="text-success">on or above plan</span>
            )
          }
        />
        <StatTile label="Late starts" value={tiles.lateStarts} />
        <StatTile label="Still clocked in" value={tiles.stillClockedIn} />
        <StatTile label="Awaiting approval" value={tiles.awaitingApproval} />
        <StatTile label="Payroll cut-off" value={tiles.payrollCutOff} />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4 dark:border-surface-border-dark">
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search staff or day…"
            aria-label="Search timesheets"
            className="w-auto flex-1 sm:max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) =>
              onStatusFilterChange(e.target.value as TimesheetDayStatus | '')
            }
            aria-label="Status"
            className="w-auto py-2"
          >
            <option value="">Any status</option>
            <option value="complete">Complete</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
            <option value="on_shift">On shift</option>
          </Select>
          <span className="ml-auto font-mono text-xs text-content-muted dark:text-content-muted-dark">
            {rows.length} of {totalRowCount}
          </span>
        </div>

        <TimesheetRowsTable
          rows={rows}
          showActions
          onAmend={(row) => setAmendTarget({ row, timezone: timezoneForRow(row) })}
          onApprove={onApprovePerson}
          emptyMessage="No timesheets match these filters."
        />
      </Card>

      <AmendClockEventModal
        open={amendTarget !== null}
        onClose={() => setAmendTarget(null)}
        staffName={
          amendTarget ? `${amendTarget.row.firstName} ${amendTarget.row.lastName}` : ''
        }
        dayLabel={amendTarget?.row.dayLabel ?? ''}
        timezone={amendTarget?.timezone ?? 'Europe/London'}
        clockInEvent={events?.clockIn ?? null}
        clockOutEvent={events?.clockOut ?? null}
        busy={amendBusy}
        onConfirm={(input) => {
          if (!amendTarget) return;
          setAmendBusy(true);
          void onAmend(amendTarget.row, input).finally(() => {
            setAmendBusy(false);
            setAmendTarget(null);
          });
        }}
      />

      <Modal
        open={approveWeekOpen}
        onClose={() => setApproveWeekOpen(false)}
        title="Approve the whole week?"
      >
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          {tiles.lateStarts + tiles.stillClockedIn > 0
            ? `${tiles.lateStarts + tiles.stillClockedIn} row${tiles.lateStarts + tiles.stillClockedIn === 1 ? '' : 's'} carry a variance today. Approving accepts them as recorded.`
            : 'This approves every staff timesheet for the current week.'}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setApproveWeekOpen(false)}
            disabled={approveWeekBusy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApproveWeek();
              setApproveWeekOpen(false);
            }}
            disabled={approveWeekBusy}
          >
            Approve week
          </Button>
        </div>
      </Modal>
    </div>
  );
}
