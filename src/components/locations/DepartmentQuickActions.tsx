import {
  Download,
  FileCheck2,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';

/**
 * `Card` renders a `<div>`; these six are buttons, so they carry the same
 * surface tokens directly rather than nesting a button inside a card.
 */
const CARD =
  'rounded-2xl border border-surface-border bg-surface shadow-sm ' +
  'dark:border-surface-border-dark dark:bg-surface-dark';

export type DepartmentAction =
  'add' | 'settings' | 'directory' | 'skills' | 'compliance' | 'export';

const ACTIONS: { id: DepartmentAction; icon: LucideIcon; title: string; hint: string }[] =
  [
    {
      id: 'add',
      icon: UserPlus,
      title: 'Add Department',
      hint: 'Create a new department',
    },
    {
      id: 'settings',
      icon: Settings,
      title: 'Department Settings',
      hint: 'Manage department settings',
    },
    {
      id: 'directory',
      icon: Users,
      title: 'Staff Directory',
      hint: 'View staff by department',
    },
    {
      id: 'skills',
      icon: ShieldCheck,
      title: 'Skills Matrix',
      hint: 'View department skills',
    },
    {
      id: 'compliance',
      icon: FileCheck2,
      title: 'Compliance',
      hint: 'View compliance status',
    },
    {
      id: 'export',
      icon: Download,
      title: 'Export Report',
      hint: 'Export department data',
    },
  ];

/** The six shortcut cards along the foot of design/Location-department.png. */
export function DepartmentQuickActions({
  onSelect,
}: {
  onSelect: (action: DepartmentAction) => void;
}): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onSelect(action.id)}
          className={cn(
            CARD,
            'flex items-center gap-3 p-3.5 text-left transition-colors',
            'hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark',
          )}
        >
          <IconTile icon={action.icon} tone="primary" size="base" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-content dark:text-content-dark">
              {action.title}
            </span>
            <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
              {action.hint}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
