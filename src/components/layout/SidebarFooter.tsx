import { Link } from 'react-router-dom';
import { LifeBuoy, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOrg } from '@/hooks/useOrg';
import { cn } from '@/lib/utils';

function initialsFor(label: string): string {
  return label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

interface SidebarFooterProps {
  collapsed: boolean;
  /** Omitted on the mobile drawer, which has no collapsed state to toggle. */
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}

/**
 * Profile, help and the collapse control, pinned to the bottom of the sidebar.
 *
 * The profile block is a link to `/app/account`, not a menu: the header's
 * `UserMenu` already owns sign-out and account actions, and two dropdowns
 * doing the same thing on one screen is how a nav ends up with the same
 * destination behind three different affordances.
 *
 * Help routes to `/contact` on the public site rather than opening a support
 * widget — there is no helpdesk product wired up, and the contact page reaches
 * the same people. See `ContactPage` for why that is a real destination and
 * not a placeholder.
 */
export function SidebarFooter({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: SidebarFooterProps): JSX.Element {
  const { user } = useSupabaseAuth();
  const { role } = useOrg();

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '';

  // Ink Navy re-skin: pinned to the bottom of the now-permanently-dark
  // `Sidebar`, so every control here is styled for graphite rather than the
  // light `bg-surface` hover every other footer-style control in the app uses.
  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-graphite';

  return (
    <div className="mt-auto border-t border-white/10 px-3 py-3">
      <Link
        to="/app/account"
        onClick={onNavigate}
        title={collapsed ? `${displayName} — your profile` : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-xl px-2 py-2 text-left',
          'hover:bg-white/5',
          focusRing,
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
          {initialsFor(displayName)}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">
              {displayName}
            </span>
            <span className="block truncate text-xs capitalize text-white/50">
              {role ?? 'No role'}
            </span>
          </span>
        )}
        {collapsed && <span className="sr-only">{displayName} — your profile</span>}
      </Link>

      <Link
        to="/contact"
        onClick={onNavigate}
        title={collapsed ? 'Help and support' : undefined}
        className={cn(
          'mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
          'text-white/60 hover:bg-white/5 hover:text-white',
          focusRing,
          collapsed && 'justify-center px-0',
        )}
      >
        <LifeBuoy size={18} aria-hidden="true" />
        {collapsed ? <span className="sr-only">Help and support</span> : 'Help & Support'}
      </Link>

      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
            'text-white/60 hover:bg-white/5 hover:text-white',
            focusRing,
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={18} aria-hidden="true" />
          )}
          {!collapsed && 'Collapse'}
        </button>
      )}
    </div>
  );
}
