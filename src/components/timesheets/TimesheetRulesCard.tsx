import { Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface TimesheetRule {
  id: string;
  label: string;
  /** Pre-formatted, e.g. "Sunday, 23:59" or "37.5 hours / week". */
  value: string;
}

interface TimesheetRulesCardProps {
  rules: TimesheetRule[];
  onEdit?: () => void;
}

/**
 * The payroll rules a timesheet is measured against
 * (design/Timesheets-Dashboard.png). Every row is passed in — this component
 * never assumes a default threshold, because a wrong one mis-states overtime.
 */
export function TimesheetRulesCard({
  rules,
  onEdit,
}: TimesheetRulesCardProps): JSX.Element {
  return (
    <Card className="p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[0.82rem] font-semibold text-content dark:text-content-dark">
          Timesheet Rules
        </h2>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded text-[0.7rem] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Edit
          </button>
        )}
      </div>

      <ul className="space-y-3">
        {rules.map((rule) => (
          <li key={rule.id} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success"
            >
              <Check size={10} strokeWidth={3.5} className="text-primary-fg" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.69rem] text-content dark:text-content-dark">
              {rule.label}
            </span>
            <span className="shrink-0 text-[0.69rem] font-semibold text-content dark:text-content-dark">
              {rule.value}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
