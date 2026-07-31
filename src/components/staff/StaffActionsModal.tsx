import type { LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

export interface StaffAction {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

interface StaffActionsModalProps {
  open: boolean;
  staffName: string;
  actions: StaffAction[];
  onClose: () => void;
}

/**
 * What the directory's row kebab opens. A sheet rather than an anchored
 * popover: the same control has to work one-handed on a phone, where a
 * floating menu next to a table cell does not (docs/DESIGN.md §5).
 */
export function StaffActionsModal({
  open,
  staffName,
  actions,
  onClose,
}: StaffActionsModalProps): JSX.Element | null {
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={staffName}>
      <ul className="space-y-1">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              disabled={action.disabled}
              onClick={() => {
                action.onSelect();
                onClose();
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                'disabled:pointer-events-none disabled:opacity-50',
                action.tone === 'danger'
                  ? 'text-danger hover:bg-danger/10'
                  : 'text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark',
              )}
            >
              <action.icon size={16} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0">
                {action.label}
                {action.description && (
                  <span className="block text-xs font-normal text-content-muted dark:text-content-muted-dark">
                    {action.description}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
