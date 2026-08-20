import { cn } from '@/lib/utils';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface StatusPillProps {
  className?: string;
}

/**
 * The "● Online | v1.0.0" pill in the top-right corner of the splash and
 * app-boot screens (docs/design/splash-screen.png, docs/design/appboot.png).
 */
export function StatusPill({ className }: StatusPillProps): JSX.Element {
  const online = useOnlineStatus();

  return (
    <div
      className={cn(
        'flex h-11 items-center gap-4 rounded-full border border-surface-border px-5 dark:border-surface-border-dark',
        className,
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn('h-2.5 w-2.5 rounded-full', online ? 'bg-success' : 'bg-warning')}
        />
        <span className="text-base text-ink-soft dark:text-content-muted-dark">
          {online ? 'Online' : 'Offline'}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="h-5 w-px bg-surface-border dark:bg-surface-border-dark"
      />
      <span className="text-base text-ink-soft dark:text-content-muted-dark">
        v{__APP_VERSION__}
      </span>
    </div>
  );
}
