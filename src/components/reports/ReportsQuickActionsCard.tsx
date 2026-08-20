import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface ReportQuickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  /** Internal route. Omit for an action that runs in place. */
  to?: string;
  onClick?: () => void;
}

interface ReportsQuickActionsCardProps {
  actions: ReportQuickAction[];
}

const ROW =
  'flex w-full items-center gap-4 rounded-xl px-1 py-2 text-left transition-colors hover:bg-surface-subtle ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark';

/** Shortcuts at the foot of the reports rail (docs/design/Reports-Dashboard.png). */
export function ReportsQuickActionsCard({
  actions,
}: ReportsQuickActionsCardProps): JSX.Element {
  return (
    <Card className="px-6 py-4">
      <h2 className="mb-1 text-base font-semibold text-content dark:text-content-dark">
        Quick Actions
      </h2>
      <ul className="divide-y divide-divider dark:divide-divider-dark">
        {actions.map(({ id, icon: Icon, label, description, to, onClick }) => {
          const body = (
            <>
              <Icon
                size={20}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 text-primary"
              />
              <span className="min-w-0">
                <span className="block truncate text-[0.8rem] font-semibold text-primary">
                  {label}
                </span>
                <span className="block truncate text-[0.78rem] font-medium text-content-muted dark:text-content-muted-dark">
                  {description}
                </span>
              </span>
            </>
          );
          return (
            <li key={id}>
              {to ? (
                <Link to={to} className={ROW}>
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={onClick} className={ROW}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
