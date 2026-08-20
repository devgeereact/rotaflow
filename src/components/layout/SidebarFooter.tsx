import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, MoreVertical, ShieldCheck } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOrg } from '@/hooks/useOrg';
import { footerNavItemsForRole } from '@/lib/sidebarNav';
import { cn } from '@/lib/utils';

function initialsFor(label: string): string {
  return label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const MENU_ITEM =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-content-muted hover:bg-primary-wash hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark';

/**
 * The small "..." trigger next to the profile card holding Settings/My
 * Profile, Help & Support, Sign out and (platform admins only) Platform
 * console. Everything that used to be its own always-visible row now lives
 * behind one click, so the rail reads as nav links plus one identity card,
 * not a stack of secondary rows competing with the primary nav above it.
 *
 * Opens upward (`bottom-full`): the trigger sits at the very bottom of the
 * viewport, so a panel opening downward like `ui/Popover` would run off
 * screen.
 */
function AccountMenu({
  role,
  isPlatformAdmin,
  collapsed,
  onNavigate,
  onSignOut,
}: {
  role: Parameters<typeof footerNavItemsForRole>[0];
  isPlatformAdmin: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  onSignOut: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const closeAndNavigate = (): void => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account options"
        title="Account options"
        className="rounded-lg p-1.5 text-content-muted hover:bg-primary-wash hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account options"
          className={cn(
            'absolute bottom-full z-30 mb-2 w-52 space-y-0.5 rounded-xl border border-surface-border bg-surface p-1.5 shadow-lg',
            'dark:border-surface-border-dark dark:bg-surface-dark',
            collapsed ? 'left-0' : 'right-0',
          )}
        >
          {footerNavItemsForRole(role).map(({ label, icon: Icon, to }) => (
            <Link
              key={label}
              to={to}
              role="menuitem"
              onClick={closeAndNavigate}
              className={MENU_ITEM}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          ))}

          {isPlatformAdmin && (
            <Link
              to="/admin"
              role="menuitem"
              onClick={closeAndNavigate}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-danger hover:bg-danger/5 dark:hover:text-danger"
            >
              <ShieldCheck size={18} aria-hidden="true" />
              Platform console
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className={cn(MENU_ITEM, 'w-full')}
          >
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

interface SidebarFooterProps {
  collapsed: boolean;
  onNavigate?: () => void;
}

/**
 * The profile identity card, pinned to the bottom, plus the account menu
 * that hides behind it — see `AccountMenu` above for what moved off the
 * always-visible rail and why. The collapse toggle isn't here either; it
 * moved to the top of the rail next to the logo, see `Sidebar.tsx`.
 */
export function SidebarFooter({
  collapsed,
  onNavigate,
}: SidebarFooterProps): JSX.Element {
  const { user, signOut } = useSupabaseAuth();
  const { role, isPlatformAdmin } = useOrg();

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '';

  if (collapsed) {
    return (
      <div className="mt-auto flex flex-col items-center gap-1 border-t border-surface-border px-3 py-3 dark:border-surface-border-dark">
        <AccountMenu
          role={role}
          isPlatformAdmin={isPlatformAdmin}
          collapsed
          onNavigate={onNavigate}
          onSignOut={() => void signOut()}
        />
        <Link
          to="/app/account"
          onClick={onNavigate}
          title={`${displayName}. Your profile`}
          className="flex items-center justify-center rounded-xl px-0 py-2 hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
            {initialsFor(displayName)}
          </span>
          <span className="sr-only">{displayName}. Your profile</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-auto border-t border-surface-border px-3 py-3 dark:border-surface-border-dark">
      <div className="flex items-center gap-1">
        <Link
          to="/app/account"
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
            {initialsFor(displayName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-content dark:text-content-dark">
              {displayName}
            </span>
            <span className="block truncate text-xs capitalize text-content-muted dark:text-content-muted-dark">
              {role ?? 'No role'}
            </span>
          </span>
        </Link>
        <AccountMenu
          role={role}
          isPlatformAdmin={isPlatformAdmin}
          collapsed={false}
          onNavigate={onNavigate}
          onSignOut={() => void signOut()}
        />
      </div>
    </div>
  );
}
