import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOrg } from '@/hooks/useOrg';

function initialsFor(label: string): string {
  return label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** Avatar + name/role, dropdown with sign out. */
export function UserMenu(): JSX.Element {
  const { user, signOut } = useSupabaseAuth();
  const { role } = useOrg();
  const [open, setOpen] = useState(false);

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
          {initialsFor(displayName)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium text-content dark:text-content-dark">
            {displayName}
          </span>
          {role && (
            <span className="block text-xs capitalize text-content-muted dark:text-content-muted-dark">
              {role}
            </span>
          )}
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-surface-border bg-surface py-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
