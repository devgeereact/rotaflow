import { BadgeCheck, CalendarPlus, Check, Clock, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SiteActivityEntry, SiteActivityKind } from '@/lib/locationsDirectory';

const ICONS: Record<SiteActivityKind, LucideIcon> = {
  complete: Check,
  staff: CalendarPlus,
  maintenance: Clock,
  settings: Settings,
  qualification: BadgeCheck,
};

/**
 * `complete` is the one entry the references draw as a filled disc; the rest
 * are outline marks in their own tint.
 */
const MARKS: Record<SiteActivityKind, string> = {
  complete: 'bg-success text-primary-fg',
  staff: 'text-shift-violet',
  maintenance: 'text-warning',
  settings: 'text-primary',
  qualification: 'text-primary',
};

/** Audit trail for the selected site or department, newest first. */
export function SiteActivityList({
  entries,
}: {
  entries: SiteActivityEntry[];
}): JSX.Element {
  return (
    <ul className="space-y-4">
      {entries.map((entry) => {
        const Icon = ICONS[entry.kind];
        return (
          <li key={entry.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full',
                MARKS[entry.kind],
              )}
            >
              <Icon size={entry.kind === 'complete' ? 12 : 16} />
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
  );
}
