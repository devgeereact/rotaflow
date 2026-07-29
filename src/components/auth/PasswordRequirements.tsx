import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PasswordRequirement } from '@/lib/password';

/** The pill checklist under the password field (design/signup.png). */
export function PasswordRequirements({
  requirements,
}: {
  requirements: PasswordRequirement[];
}): JSX.Element {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Password requirements">
      {requirements.map(({ label, met }) => (
        <li
          key={label}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
            met
              ? 'border-success/30 bg-success/10 text-ink dark:text-content-dark'
              : 'border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid h-4 w-4 shrink-0 place-items-center rounded-full',
              met
                ? 'bg-success text-white'
                : 'bg-surface-border text-surface dark:bg-surface-border-dark',
            )}
          >
            <Check size={10} strokeWidth={3} />
          </span>
          {label}
          <span className="sr-only">{met ? ' — met' : ' — not met'}</span>
        </li>
      ))}
    </ul>
  );
}
