import {
  ClipboardCopy,
  ClipboardPaste,
  FileStack,
  MoreHorizontal,
  Printer,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RailAction {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}

interface RotaActionRailProps {
  onAutoFill: () => void;
}

/**
 * Far-right quick-actions rail. Only Auto-fill has a built feature behind it
 * (opens the existing AutoFillPanel) — the rest match the reference visually
 * but are inert, same convention as the Grid/Coverage/Staff/Stats tab stubs
 * this page already used before this pass (see rota-log.md).
 */
export function RotaActionRail({ onAutoFill }: RotaActionRailProps): JSX.Element {
  const actions: RailAction[] = [
    { icon: FileStack, label: 'Templates' },
    { icon: ClipboardCopy, label: 'Copy Shifts' },
    { icon: ClipboardPaste, label: 'Paste Shifts' },
    { icon: Sparkles, label: 'Auto-fill', onClick: onAutoFill },
    { icon: Trash2, label: 'Clear Shifts' },
    { icon: Printer, label: 'Print' },
    { icon: MoreHorizontal, label: 'More' },
  ];

  return (
    <div className="flex flex-col gap-1">
      {actions.map((action) => {
        const enabled = Boolean(action.onClick);
        return (
          <button
            key={action.label}
            type="button"
            disabled={!enabled}
            onClick={action.onClick}
            title={enabled ? undefined : `${action.label} — coming soon`}
            className={cn(
              'flex flex-col items-center gap-1 rounded-xl px-3 py-2.5 text-center text-[0.65rem] font-medium',
              enabled
                ? 'text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark'
                : 'cursor-not-allowed text-content-muted/50 dark:text-content-muted-dark/50',
            )}
          >
            <action.icon size={18} aria-hidden="true" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
