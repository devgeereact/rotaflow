import { ChevronDown, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LanguagePillProps {
  className?: string;
}

/**
 * The "English (UK)" indicator (design/signin.png, design/signup.png,
 * design/Organisation-about.png). Static, not a `<button>`: there is no
 * locale switcher behind it yet (single-locale app), and a focusable control
 * that does nothing on click/Enter is worse than a plain indicator.
 */
export function LanguagePill({ className }: LanguagePillProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 text-sm text-content-muted shadow-sm dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark',
        className,
      )}
    >
      <Globe size={16} aria-hidden="true" />
      English (UK)
      <ChevronDown size={14} aria-hidden="true" />
    </div>
  );
}
