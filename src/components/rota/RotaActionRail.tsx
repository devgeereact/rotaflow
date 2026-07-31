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

interface RailAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

interface RotaActionRailProps {
  onAutoFill: () => void;
  onComingSoon: (label: string) => void;
}

/**
 * Far-right quick-actions rail. Only Auto-fill has a built feature behind it
 * (opens the existing AutoFillPanel) — the rest match the reference visually
 * (not greyed out — greying them out would misrepresent them as permanently
 * broken rather than not-yet-built) but every click reports "coming soon"
 * instead of doing nothing silently. See rota-log.md.
 */
export function RotaActionRail({ onAutoFill, onComingSoon }: RotaActionRailProps): JSX.Element {
  const actions: RailAction[] = [
    { icon: FileStack, label: 'Templates', onClick: () => onComingSoon('Templates') },
    { icon: ClipboardCopy, label: 'Copy Shifts', onClick: () => onComingSoon('Copy Shifts') },
    { icon: ClipboardPaste, label: 'Paste Shifts', onClick: () => onComingSoon('Paste Shifts') },
    { icon: Sparkles, label: 'Auto-fill', onClick: onAutoFill },
    { icon: Trash2, label: 'Clear Shifts', onClick: () => onComingSoon('Clear Shifts') },
    { icon: Printer, label: 'Print', onClick: () => onComingSoon('Print') },
    { icon: MoreHorizontal, label: 'More', onClick: () => onComingSoon('More') },
  ];

  return (
    <div className="flex flex-col gap-1">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className="flex flex-col items-center gap-1 rounded-xl px-3 py-2.5 text-center text-[0.65rem] font-medium text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
        >
          <action.icon size={18} aria-hidden="true" />
          {action.label}
        </button>
      ))}
    </div>
  );
}
