import { ChevronRight, MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import { cn } from '@/lib/utils';
import type { UpcomingShift } from '@/lib/staffProfile';

interface UpcomingShiftsCardProps {
  shifts: UpcomingShift[];
  onViewSchedule: () => void;
  onShiftActions: (id: string) => void;
}

const TYPE_TONES: Record<UpcomingShift['typeTone'], string> = {
  morning:
    'bg-shift-tint-moss text-shift-tint-moss-fg dark:bg-shift-deep-moss dark:text-shift-moss',
  evening:
    'bg-shift-tint-violet text-shift-tint-violet-fg dark:bg-shift-deep-violet dark:text-shift-violet',
  night:
    'bg-shift-tint-indigo text-shift-tint-indigo-fg dark:bg-shift-deep-indigo dark:text-shift-indigo',
};

/** The next few shifts assigned to this person (docs/design/Staff-Profile.png). */
export function UpcomingShiftsCard({
  shifts,
  onViewSchedule,
  onShiftActions,
}: UpcomingShiftsCardProps): JSX.Element {
  return (
    <Card className="p-0">
      <StaffSectionHeader
        className="px-5 pb-3 pt-4"
        title="Upcoming Shifts"
        action={
          <StaffLinkButton onClick={onViewSchedule}>
            View full schedule
            <ChevronRight size={14} aria-hidden="true" />
          </StaffLinkButton>
        }
      />
      <ul>
        {shifts.map((shift) => (
          <li
            key={shift.id}
            className="flex items-center gap-4 border-t border-divider px-5 py-3 dark:border-divider-dark"
          >
            <span className="w-28 shrink-0 text-sm font-semibold text-content dark:text-content-dark">
              {shift.dateLabel}
            </span>
            <span className="w-28 shrink-0 font-mono text-sm font-semibold text-content dark:text-content-dark">
              {shift.timeLabel}
            </span>
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-semibold',
                TYPE_TONES[shift.typeTone],
              )}
            >
              {shift.typeName}
            </span>
            <span className="w-44 shrink-0 truncate text-sm text-content-muted dark:text-content-muted-dark">
              {shift.locationName}
            </span>
            <span className="w-32 shrink-0 truncate text-sm text-content-muted dark:text-content-muted-dark">
              {shift.areaName}
            </span>
            <Badge
              tone={shift.confirmed ? 'success' : 'warning'}
              className="ml-auto shrink-0 px-2.5 py-1"
            >
              {shift.confirmed ? 'Confirmed' : 'Pending'}
            </Badge>
            <button
              type="button"
              aria-label={`Actions for ${shift.dateLabel} shift`}
              onClick={() => onShiftActions(shift.id)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-surface-border bg-surface text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
            >
              <MoreVertical size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
