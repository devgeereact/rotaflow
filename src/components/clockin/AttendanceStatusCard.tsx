import { CircleCheck, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';

interface AttendanceStatusCardProps {
  statusTitle: string;
  statusBody: string;
  thisWeekLabel: string;
  thisWeekValue: string;
  lastWeekLabel: string;
  lastWeekValue: string;
  onViewReport?: () => void;
}

/** "Attendance Status" card — the reassurance panel plus two-week accuracy. */
export function AttendanceStatusCard({
  statusTitle,
  statusBody,
  thisWeekLabel,
  thisWeekValue,
  lastWeekLabel,
  lastWeekValue,
  onViewReport,
}: AttendanceStatusCardProps): JSX.Element {
  return (
    <Card className="flex h-full flex-col rounded-xl p-5">
      <ClockCardHeading icon={ShieldCheck} title="Attendance Status" />

      <div className="mt-5 flex items-start gap-3 rounded-lg bg-clock-wash px-4 py-3 dark:bg-clock/15">
        <CircleCheck
          size={22}
          aria-hidden="true"
          className="mt-0.5 shrink-0 fill-clock text-surface dark:text-surface-dark"
        />
        <div>
          <p className="text-base font-semibold text-content dark:text-content-dark">
            {statusTitle}
          </p>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {statusBody}
          </p>
        </div>
      </div>

      <dl className="mt-5 flex gap-10">
        <div>
          <dt className="text-sm text-content-muted dark:text-content-muted-dark">
            {thisWeekLabel}
          </dt>
          <dd className="mt-1 text-base font-semibold text-content dark:text-content-dark">
            {thisWeekValue}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-content-muted dark:text-content-muted-dark">
            {lastWeekLabel}
          </dt>
          <dd className="mt-1 text-base font-semibold text-content dark:text-content-dark">
            {lastWeekValue}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onViewReport}
        className="mt-auto self-center rounded pt-5 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        View Attendance Report
      </button>
    </Card>
  );
}
