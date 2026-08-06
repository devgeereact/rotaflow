import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Required. The switch renders no text of its own. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The switch used by the notification matrices and preference rows
 * (design/ProfileSettings.png, design/SettingsNotifications.png).
 *
 * A real `<button role="switch">` with `aria-checked`, not a styled checkbox:
 * the notification grid is five rows × three channels, so fifteen of these sit
 * in one table and a screen reader has to announce the state of each without
 * a visible label beside it. `aria-label` carries "Email for Rota published",
 * which the caller composes, that is why `label` is not optional.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-border dark:bg-surface-border-dark',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
