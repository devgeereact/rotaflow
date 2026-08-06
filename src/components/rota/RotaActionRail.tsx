import {
  CalendarClock,
  ClipboardCopy,
  ClipboardPaste,
  FileStack,
  Printer,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RailAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Rendered as `title` and as the accessible description. */
  hint: string;
  disabled?: boolean;
}

interface RotaActionRailProps {
  onTemplates: () => void;
  onCopyShifts: () => void;
  onPasteShifts: () => void;
  onCopyPreviousWeek: () => void;
  onAutoFill: () => void;
  onClearShifts: () => void;
  onPrint: () => void;
  /** How many shifts are on the clipboard; 0 disables Paste. */
  clipboardCount: number;
  /** Identifier of the action currently running, if any. */
  busyAction: string | null;
}

/**
 * Far-right quick-actions rail.
 *
 * Every one of these used to report "coming soon" on click except Auto-fill.
 * They now do the things §8 of the build prompt names. Copy previous week,
 * copy rota, clear rota, shift templates, print. Against the same rota
 * service the rest of the screen uses.
 *
 * The old "More" button is gone. It had no defined contents, and a menu
 * invented to justify a button is worse than one fewer button; its slot went
 * to Copy Previous Week, which the prompt does ask for.
 */
export function RotaActionRail({
  onTemplates,
  onCopyShifts,
  onPasteShifts,
  onCopyPreviousWeek,
  onAutoFill,
  onClearShifts,
  onPrint,
  clipboardCount,
  busyAction,
}: RotaActionRailProps): JSX.Element {
  const actions: RailAction[] = [
    {
      icon: FileStack,
      label: 'Templates',
      hint: 'Manage the shift types this rota assigns from',
      onClick: onTemplates,
    },
    {
      icon: ClipboardCopy,
      label: 'Copy Shifts',
      hint: 'Copy every shift currently in view',
      onClick: onCopyShifts,
    },
    {
      icon: ClipboardPaste,
      label: 'Paste Shifts',
      hint:
        clipboardCount > 0
          ? `Paste ${clipboardCount} copied shifts into this week`
          : 'Copy some shifts first',
      onClick: onPasteShifts,
      disabled: clipboardCount === 0,
    },
    {
      icon: CalendarClock,
      label: 'Last Week',
      hint: "Copy the previous week's shifts into this one",
      onClick: onCopyPreviousWeek,
      disabled: busyAction === 'previous-week',
    },
    {
      icon: Sparkles,
      label: 'Auto-fill',
      hint: 'Suggest assignments for the open shifts',
      onClick: onAutoFill,
    },
    {
      icon: Trash2,
      label: 'Clear Shifts',
      hint: 'Delete every draft shift in view',
      onClick: onClearShifts,
      disabled: busyAction === 'clear',
    },
    {
      icon: Printer,
      label: 'Print',
      hint: 'Print or save this rota as a PDF',
      onClick: onPrint,
    },
  ];

  return (
    <div className="flex flex-row gap-1 overflow-x-auto xl:flex-col xl:overflow-visible">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.hint}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center text-[0.65rem] font-medium leading-tight transition-colors',
            'text-content-muted hover:bg-surface-subtle hover:text-content',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
            'dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark',
          )}
        >
          <action.icon size={18} aria-hidden="true" />
          {action.label}
        </button>
      ))}
    </div>
  );
}
