import { CircleCheck, FileText, Repeat, Umbrella } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffLinkButton } from '@/components/staff/StaffLinkButton';
import { StaffSectionHeader } from '@/components/staff/StaffSectionHeader';
import { cn } from '@/lib/utils';
import type { ActivityKind, StaffActivityEntry } from '@/lib/staffProfile';

interface RecentActivityCardProps {
  entries: StaffActivityEntry[];
  onViewAll: () => void;
}

const ICONS: Record<ActivityKind, LucideIcon> = {
  shift: CircleCheck,
  swap: Repeat,
  leave: Umbrella,
  document: FileText,
};

const TINTS: Record<ActivityKind, string> = {
  shift: 'bg-success text-primary-fg',
  swap: 'bg-success text-primary-fg',
  leave: 'bg-warning text-primary-fg',
  document: 'bg-shift-violet text-primary-fg',
};

/** Audit trail for this person, newest first (docs/design/Staff-Profile.png). */
export function RecentActivityCard({
  entries,
  onViewAll,
}: RecentActivityCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <StaffSectionHeader
        title="Recent Activity"
        action={
          entries.length > 0 && (
            <StaffLinkButton onClick={onViewAll}>View all</StaffLinkButton>
          )
        }
      />
      {entries.length === 0 && (
        <p className="mt-4 text-sm text-content-muted dark:text-content-muted-dark">
          Nothing recorded for this person yet.
        </p>
      )}
      <ul className="mt-4 space-y-4">
        {entries.map((entry) => {
          const Icon = ICONS[entry.kind];
          return (
            <li key={entry.id} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full',
                  TINTS[entry.kind],
                )}
              >
                <Icon size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
                  {entry.title}
                </p>
                <p className="truncate text-sm text-content-muted dark:text-content-muted-dark">
                  {entry.detail}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs text-content-muted dark:text-content-muted-dark">
                {entry.timeLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
