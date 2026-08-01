import { Check, Clock, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export type SwapActivityKind = 'approved' | 'declined' | 'requested';

export interface SwapActivityEntry {
  id: string;
  kind: SwapActivityKind;
  /** "Aisha Patel's swap was approved". */
  title: string;
  /** "With Grace Thompson" — the other party. */
  detail: string;
  /** Pre-formatted, e.g. "Today, 10:15". */
  timeLabel: string;
}

interface SwapActivityCardProps {
  entries: SwapActivityEntry[];
  onViewAll: () => void;
}

const ICONS: Record<SwapActivityKind, LucideIcon> = {
  approved: Check,
  declined: X,
  requested: Clock,
};

const TINTS: Record<SwapActivityKind, string> = {
  approved: 'bg-success text-primary-fg',
  declined: 'bg-danger text-primary-fg',
  requested: 'bg-warning text-primary-fg',
};

/** What happened to swap requests lately, newest first (design/Swap-Request.png). */
export function SwapActivityCard({
  entries,
  onViewAll,
}: SwapActivityCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[0.9rem] font-semibold text-content dark:text-content-dark">
          Recent Activity
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded text-[0.78rem] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          View all
        </button>
      </div>

      <ul className="space-y-2.5">
        {entries.map((entry) => {
          const Icon = ICONS[entry.kind];
          return (
            <li key={entry.id} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                  TINTS[entry.kind],
                )}
              >
                <Icon size={13} strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.74rem] font-semibold leading-5 text-content dark:text-content-dark">
                  {entry.title}
                </p>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[0.68rem] leading-5 text-content-muted dark:text-content-muted-dark">
                    {entry.detail}
                  </p>
                  <span className="shrink-0 whitespace-nowrap text-[0.66rem] text-content-muted dark:text-content-muted-dark">
                    {entry.timeLabel}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
