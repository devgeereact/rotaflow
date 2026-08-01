import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface LeaveQuickAction {
  id: string;
  icon: LucideIcon;
  label: string;
  /** Internal route. Omit for an action with no destination yet. */
  to?: string;
  onClick?: () => void;
}

interface LeaveQuickActionsCardProps {
  actions: LeaveQuickAction[];
}

const ROW =
  'flex h-9 w-full items-center gap-2.5 rounded-xl border border-surface-border px-3 text-[0.85rem] font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark';

/** Shortcuts at the foot of the leave rail (design/Leave.png). */
export function LeaveQuickActionsCard({
  actions,
}: LeaveQuickActionsCardProps): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-[0.95rem] font-bold text-content dark:text-content-dark">
        Quick Actions
      </h2>
      <ul className="space-y-1">
        {actions.map(({ id, icon: Icon, label, to, onClick }) => {
          const body = (
            <>
              <Icon size={17} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-secondary dark:text-secondary-dark"
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
