import { Card } from '@/components/ui/Card';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import { cn } from '@/lib/utils';
import type { ShiftSummaryColumn } from '@/lib/staffProfile';

interface ShiftSummaryCardProps {
  month: string;
  columns: ShiftSummaryColumn[];
  /** Caption under the last column, e.g. "85% of contracted". */
  hint: string;
  onViewTimesheet: () => void;
}

const BARS: Record<NonNullable<ShiftSummaryColumn['tone']>, string> = {
  total: 'bg-primary',
  morning: 'bg-success',
  evening: 'bg-shift-violet',
  night: 'bg-brand-deep',
};

/** Monthly shift mix with a small bar per column (design/Staff-Profile.png). */
export function ShiftSummaryCard({
  month,
  columns,
  hint,
  onViewTimesheet,
}: ShiftSummaryCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <StaffSectionHeader
        title={`Shift Summary (${month})`}
        action={
          <StaffLinkButton onClick={onViewTimesheet}>View timesheet</StaffLinkButton>
        }
      />
      <div className="mt-5 flex items-start justify-between gap-2">
        {columns.map((column) => (
          <div
            key={column.label}
            className={column.tone ? 'w-16 shrink-0' : 'w-20 shrink-0'}
          >
            <p className="whitespace-nowrap text-xs text-content-muted dark:text-content-muted-dark">
              {column.label}
            </p>
            <p className="mt-1 text-2xl font-bold leading-8 text-content dark:text-content-dark">
              {column.value}
            </p>
            {column.tone ? (
              <span
                aria-hidden="true"
                className={cn('mt-2 block h-1.5 w-full rounded-full', BARS[column.tone])}
              />
            ) : (
              <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                {hint}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
