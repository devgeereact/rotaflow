import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import {
  TimesheetRowsTable,
  type TimesheetDisplayRow,
} from '@/components/timesheets/TimesheetRowsTable';

export interface StaffTimesheetsProps {
  rows: TimesheetDisplayRow[];
  hoursThisWeekLabel: string;
  /**
   * Set when this week's worked hours pass the organisation's overtime
   * threshold, e.g. "2h 30m over the 37.5h overtime threshold". Null otherwise.
   */
  overThresholdLabel?: string | null;
  contractedLabel: string;
  overtimeLabel: string;
  payrollCutOff: string;
}

/**
 * A staff member's own Timesheets (`docs/design/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.timesheets` staff branch): their row(s) for today only, no
 * per-row actions — corrections go through their manager.
 */
export function StaffTimesheets({
  rows,
  hoursThisWeekLabel,
  overThresholdLabel = null,
  contractedLabel,
  overtimeLabel,
  payrollCutOff,
}: StaffTimesheetsProps): JSX.Element {
  return (
    <div>
      <WorkspaceHeader
        title="Timesheets"
        subtitle="Your recorded hours. Anything that looks wrong should go to your manager before the payroll cut-off."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Your hours this week"
          value={
            overThresholdLabel ? (
              <span className="text-warning">{hoursThisWeekLabel}</span>
            ) : (
              hoursThisWeekLabel
            )
          }
          hint={overThresholdLabel}
        />
        <StatTile label="Contracted" value={contractedLabel} />
        <StatTile label="Overtime" value={overtimeLabel} to="/app/overtime" />
        <StatTile label="Payroll cut-off" value={payrollCutOff} />
      </div>

      <Card className="p-0">
        <TimesheetRowsTable
          rows={rows}
          showActions={false}
          emptyMessage="You have no shift recorded today."
        />
      </Card>
    </div>
  );
}
