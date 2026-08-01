import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface QuickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  /** Internal route. Omit for an action with no destination yet. */
  to?: string;
  onClick?: () => void;
}

interface QuickActionsCardProps {
  actions: QuickAction[];
}

const ROW =
  'flex w-full items-center gap-2.5 rounded-lg border border-surface-border px-3 py-1.5 text-[0.72rem] font-semibold leading-4 text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark';

/** Shortcuts under the timesheet rail (design/Timesheets-Dashboard.png). */
export function QuickActionsCard({ actions }: QuickActionsCardProps): JSX.Element {
  return (
    <Card className="p-3.5">
      <h2 className="mb-2.5 text-[0.82rem] font-semibold text-content dark:text-content-dark">
        Quick Actions
      </h2>
      <ul className="space-y-2">
        {actions.map(({ id, icon: Icon, label, to, onClick }) => {
          const body = (
            <>
              <Icon size={15} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <ArrowRight
                size={14}
                aria-hidden="true"
                className="shrink-0 text-content-muted dark:text-content-muted-dark"
              />
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
