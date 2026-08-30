import { CircleAlert, CircleCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';
import { cn } from '@/lib/utils';
import type { AttendanceTone } from '@/lib/clockRows';

interface AttendanceStatusCardProps {
  /** The reference only shows `good`; the other two reuse its geometry. */
  tone: AttendanceTone;
  statusTitle: string;
  statusBody: string;
  thisWeekLabel: string;
  thisWeekValue: string;
  lastWeekLabel: string;
  lastWeekValue: string;
  onViewReport?: () => void;
}

const TONES: Record<
  AttendanceTone,
  { wash: string; icon: typeof CircleCheck; fill: string }
> = {
  good: {
    wash: 'bg-clock-wash dark:bg-clock/15',
    icon: CircleCheck,
    fill: 'fill-clock text-surface dark:text-surface-dark',
  },
  warning: {
    wash: 'bg-warning/10 dark:bg-warning/15',
    icon: TriangleAlert,
    fill: 'text-warning',
  },
  bad: {
    wash: 'bg-danger/10 dark:bg-danger/15',
    icon: CircleAlert,
    fill: 'text-danger',
  },
};

/** "Attendance Status" card. The reassurance panel plus two-week accuracy. */
export function AttendanceStatusCard({
  tone,
  statusTitle,
  statusBody,
  thisWeekLabel,
  thisWeekValue,
  lastWeekLabel,
  lastWeekValue,
  onViewReport,
}: AttendanceStatusCardProps): JSX.Element {
  const { wash, icon: ToneIcon, fill } = TONES[tone];

  return (
    <Card className="flex h-full flex-col rounded-xl p-6">
      <ClockCardHeading icon={ShieldCheck} title="Attendance Status" />

      <div className={cn('mt-5 flex items-start gap-3 rounded-lg px-4 py-3', wash)}>
        <ToneIcon size={22} aria-hidden="true" className={cn('mt-0.5 shrink-0', fill)} />
        <div>
          <p className="text-base font-semibold text-content dark:text-content-dark">
            {statusTitle}
          </p>
          {/* `content`, not `content-muted`: this line sits inside the toned
              wash above, where muted grey lands at 4.49 : 1 against a 4.5 : 1
              minimum (GAP-030). One hundredth under is still under. The rows
              below keep `content-muted` — they sit on the card, not the
              wash. */}
          <p className="text-sm text-content dark:text-content-muted-dark">
            {statusBody}
          </p>
        </div>
      </div>

      <dl className="mt-5 flex gap-24">
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
        className="mt-auto self-center rounded pt-5 text-sm font-semibold text-primary dark:text-primary-ink-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        View Attendance Report
      </button>
    </Card>
  );
}
