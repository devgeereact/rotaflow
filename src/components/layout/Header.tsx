import { useOrg } from '@/hooks/useOrg';
import { OrgSwitcher } from '@/components/layout/OrgSwitcher';
import { UserMenu } from '@/components/layout/UserMenu';
import { NotificationBell } from '@/components/layout/NotificationBell';

/** Slim top bar for the /app/* shell. Page-specific chrome (e.g. rota week nav) lives in the page itself. */
export function Header(): JSX.Element {
  const { orgName } = useOrg();

  return (
    <header className="flex h-16 items-center justify-between border-b border-surface-border bg-surface px-6 dark:border-surface-border-dark dark:bg-surface-dark">
      <span className="font-display text-sm font-semibold text-content-muted dark:text-content-muted-dark">
        {orgName}
      </span>
      <div className="flex items-center gap-4">
        <NotificationBell />
        <OrgSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
