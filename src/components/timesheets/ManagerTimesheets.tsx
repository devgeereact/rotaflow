import { useState, type JSX } from 'react';
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
import { exportRangeProblem, TIMESHEET_MAX_DAYS } from '@/lib/timesheetRules';
import { Label } from '@/components/ui/Label';
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

/**
 * The payroll CSV export (slice S13, `timesheet_tools` flag). Absent with the flag off, so the
 * header shows only the existing "Export CSV".
 */
export interface PayrollExportProps {
  defaultFrom: string;
  defaultTo: string;
  toleranceMinutes: number;
  onExport: (from: string, to: string) => Promise<void>;
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
  payrollExport?: PayrollExportProps;
}

/**
 * The manager's Timesheets (`docs/design/ORGANISATION_WORKSPACE.html`'s
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
  payrollExport,
}: ManagerTimesheetsProps): JSX.Element {
  const [amendTarget, setAmendTarget] = useState<AmendTarget | null>(null);
  const [payrollOpen, setPayrollOpen] = useState(false);
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
            {payrollExport && (
              <Button variant="secondary" onClick={() => setPayrollOpen(true)}>
                <Download size={14} aria-hidden="true" className="mr-1.5" />
                Export payroll CSV
              </Button>
            )}
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
              <span className="text-danger-ink dark:text-danger-ink-dark">
                below plan
              </span>
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

      {payrollExport && (
        <PayrollExportModal
          open={payrollOpen}
          onClose={() => setPayrollOpen(false)}
          {...payrollExport}
        />
      )}

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

function PayrollExportModal({
  open,
  onClose,
  defaultFrom,
  defaultTo,
  toleranceMinutes,
  onExport,
}: PayrollExportProps & { open: boolean; onClose: () => void }): JSX.Element {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  const problem = exportRangeProblem(from, to);

  return (
    <Modal open={open} onClose={onClose} title="Export payroll CSV">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        Approved periods only, one row per person per period, with the approved minutes
        and hours, who approved them, and how many lines were late, finished early or ran
        over (by more than {toleranceMinutes} minutes). A period that lies partly outside
        these dates is left out. At most {TIMESHEET_MAX_DAYS} days.
      </p>
      <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
        Downloading marks the approved periods in the file as exported, so they are not
        sent to payroll twice. Periods exported before are still included, and their
        Status column says exported.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="payroll-from">From</Label>
          <Input
            id="payroll-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="payroll-to">To</Label>
          <Input
            id="payroll-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      {problem && (
        <p
          role="alert"
          className="mt-3 text-sm text-danger-ink dark:text-danger-ink-dark"
        >
          {problem}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          disabled={busy || problem !== null}
          onClick={() => {
            setBusy(true);
            void onExport(from, to).finally(() => {
              setBusy(false);
              onClose();
            });
          }}
        >
          {busy ? 'Exporting…' : 'Download CSV'}
        </Button>
      </div>
    </Modal>
  );
}
