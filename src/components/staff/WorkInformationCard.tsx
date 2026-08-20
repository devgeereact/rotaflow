import { Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import type { RoleCodeTone } from '@/lib/staffDirectory';
import type { StaffWorkInfoRow } from '@/lib/staffProfile';

interface WorkInformationCardProps {
  rows: StaffWorkInfoRow[];
  onEdit: () => void;
}

const BADGE_TONES: Record<RoleCodeTone, string> = {
  violet: 'bg-shift-violet/15 text-shift-violet',
  neutral:
    'border border-surface-border bg-surface text-content-muted dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark',
};

/** Employment facts as a label/value list (docs/design/Staff-Profile.png). */
export function WorkInformationCard({
  rows,
  onEdit,
}: WorkInformationCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-content dark:text-content-dark">
          Work Information
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-surface-border px-2 text-xs font-medium text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
        >
          <Pencil size={12} aria-hidden="true" />
          Edit
        </button>
      </div>

      <dl className="mt-4 space-y-3.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-sm text-content-muted dark:text-content-muted-dark">
              {row.label}
            </dt>
            <dd className="flex min-w-0 items-center gap-2 text-sm font-semibold text-content dark:text-content-dark">
              <span className="truncate">{row.value}</span>
              {row.badge && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-semibold',
                    BADGE_TONES[row.badge.tone],
                  )}
                >
                  {row.badge.code}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
