import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ReportChip } from '@/components/reports/ReportChip';
import { ReportIcon } from '@/components/reports/ReportIcon';
import {
  REPORT_CATEGORY_TONE,
  REPORT_FORMAT_TONE,
  type ReportCategory,
  type ReportFormat,
} from '@/lib/reportRows';

export interface RecentReport {
  id: string;
  name: string;
  icon: LucideIcon;
  category: ReportCategory;
  /** The scope it was run over, e.g. "All Locations". */
  scope: string;
  /** Pre-formatted, e.g. "Today, 09:15". */
  runLabel: string;
  format: ReportFormat;
}

interface RecentReportsCardProps {
  items: RecentReport[];
  onViewAll?: () => void;
  emptyMessage: string;
}

/** The last handful of generated reports (docs/design/Reports-Dashboard.png). */
export function RecentReportsCard({
  items,
  onViewAll,
  emptyMessage,
}: RecentReportsCardProps): JSX.Element {
  return (
    <Card className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-content dark:text-content-dark">
          Recent Reports
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            // `text-primary` is a FILL and measures 4.08:1 as small text: the ink
            // pair is the text colour (docs/DESIGN.md §5). And a 19px-tall
            // control was under WCAG 2.2 AA's own 24px floor.
            className="inline-flex min-h-11 items-center rounded-lg text-[0.78rem] font-semibold text-primary-ink transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
          >
            View all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-4 text-sm text-content-muted dark:text-content-muted-dark">
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3">
              <ReportIcon icon={item.icon} tone={REPORT_CATEGORY_TONE[item.category]} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8rem] font-semibold leading-5 text-content dark:text-content-dark">
                  {item.name}
                </p>
                <p className="truncate text-[0.78rem] font-medium leading-5 text-content-muted dark:text-content-muted-dark">
                  {item.scope}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="whitespace-nowrap text-[0.72rem] font-medium leading-5 text-content-muted dark:text-content-muted-dark">
                  {item.runLabel}
                </span>
                <ReportChip
                  tone={REPORT_FORMAT_TONE[item.format]}
                  className="px-2 py-0.5 text-[0.68rem]"
                >
                  {item.format}
                </ReportChip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
