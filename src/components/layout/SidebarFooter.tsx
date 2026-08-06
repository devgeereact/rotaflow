import { Link } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
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

const ROW =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-content-muted hover:bg-primary-wash hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark';

interface SidebarFooterProps {
  collapsed: boolean;
  /** Omitted on the mobile drawer, which has no collapsed state to toggle. */
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}

/**
 * The rail's quiet second nav group (Settings/My Profile, Help & Support,
 * Platform console, Sign out) plus the profile identity card, pinned to the
 * bottom. Mirrors `docs/ORGANISATION_WORKSPACE.html`'s `.railfoot`: a short
 * list of plain rows, then `.whoami`.
 *
 * The reference's chrome has no sign-out control at all, its shell is a
 * role-switcher demo, not a signed-in session. A real one still needs to end
 * a session from the device it is on, so that stays here as one more row in
 * the same style rather than reviving a separate header dropdown menu, which
 * would be the one piece of chrome in this rail that is not a flat list of
 * rows. Full "sign out everywhere" lives on `/app/account/security`.
 */
export function SidebarFooter({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: SidebarFooterProps): JSX.Element {
  const { user, signOut } = useSupabaseAuth();
  const { role, isPlatformAdmin } = useOrg();

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '';

  if (collapsed) {
    return (
      <div className="mt-auto border-t border-surface-border px-3 py-3 dark:border-surface-border-dark">
        {footerNavItemsForRole(role).map(({ label, icon: Icon, to }) => (
          <Link
            key={label}
            to={to}
            onClick={onNavigate}
            title={label}
            className={cn(ROW, 'mb-0.5 justify-center px-0')}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </Link>
        ))}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className={cn(ROW, 'mb-0.5 w-full justify-center px-0')}
          >
            <PanelLeftOpen size={18} aria-hidden="true" />
          </button>
        )}
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
      {footerNavItemsForRole(role).map(({ label, icon: Icon, to }) => (
        <Link key={label} to={to} onClick={onNavigate} className={cn(ROW, 'mb-0.5')}>
          <Icon size={18} aria-hidden="true" />
          {label}
        </Link>
      ))}

      {isPlatformAdmin && (
        <Link
          to="/admin"
          onClick={onNavigate}
          className={cn(
            ROW,
            'mb-0.5 text-danger hover:bg-danger/5 hover:text-danger dark:hover:text-danger',
          )}
        >
          <ShieldCheck size={18} aria-hidden="true" />
          Platform console
        </Link>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        className={cn(ROW, 'mb-0.5 w-full')}
      >
        <LogOut size={18} aria-hidden="true" />
        Sign out
      </button>

      {onToggleCollapsed && (
        <button type="button" onClick={onToggleCollapsed} className={cn(ROW, 'w-full')}>
          <PanelLeftClose size={18} aria-hidden="true" />
          Collapse
        </button>
      )}

      <Link
        to="/app/account"
        onClick={onNavigate}
        className="mt-2 flex items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
    </div>
  );
}
