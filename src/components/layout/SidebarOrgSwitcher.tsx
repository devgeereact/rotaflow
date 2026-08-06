import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

interface SidebarOrgSwitcherProps {
  collapsed: boolean;
}

/**
 * Organisation identity and switcher, at the top of the sidebar.
 *
 * ## Why it renders even for a single-organisation user
 *
 * The header's `OrgSwitcher` returns `null` below two memberships, which is
 * right for a control whose only job is switching. This one also answers
 * "which organisation am I looking at". The question behind every
 * cross-tenant mistake in a multi-tenant product, so it always shows the
 * name, and only becomes interactive when there is somewhere to switch to.
 *
 * ## Why it shows the role rather than a location count
 *
 * The reference shows "3 locations" under the name. That needs a locations
 * query on every app load purely to label a nav element, and the sidebar
 * currently issues none. The role is already in `OrgContext`, costs nothing,
 * and answers a question the user is more likely to have. What am I allowed
 * to do here. Particularly for someone who is a manager in one organisation
 * and staff in another. Revisit if a location count lands in the context for
 * another reason.
 */
export function SidebarOrgSwitcher({
  collapsed,
}: SidebarOrgSwitcherProps): JSX.Element | null {
  const { orgId, orgName, role, memberships, switchOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const canSwitch = memberships.length > 1;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!orgName) return null;

  const summary = role ? (ROLE_LABEL[role] ?? role) : 'No role';

  if (collapsed) {
    return (
      <div className="px-3 pb-3">
        <span
          title={`${orgName} · ${summary}`}
          className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"
        >
          <Building2 size={18} aria-hidden="true" />
          <span className="sr-only">{orgName}</span>
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative px-3 pb-3">
      <button
        type="button"
        onClick={() => canSwitch && setOpen((v) => !v)}
        aria-haspopup={canSwitch ? 'listbox' : undefined}
        aria-expanded={canSwitch ? open : undefined}
        // A button that cannot do anything should not take focus or announce
        // itself as pressable, for a single-org user this is a label.
        disabled={!canSwitch}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-left',
          'dark:border-surface-border-dark dark:bg-surface-dark',
          canSwitch &&
            'hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark',
          !canSwitch && 'cursor-default',
        )}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Building2 size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-content dark:text-content-dark">
            {orgName}
          </span>
          <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
            {canSwitch ? `${summary} · ${memberships.length} organisations` : summary}
          </span>
        </span>
        {canSwitch && (
          <ChevronsUpDown
            size={16}
            aria-hidden="true"
            className="shrink-0 text-content-muted"
          />
        )}
      </button>

      {open && canSwitch && (
        <ul
          role="listbox"
          aria-label="Switch organisation"
          className="absolute inset-x-3 z-40 mt-1 overflow-hidden rounded-xl border border-surface-border bg-surface py-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
        >
          {memberships.map((m) => (
            <li key={m.orgId} role="option" aria-selected={m.orgId === orgId}>
              <button
                type="button"
                onClick={() => {
                  switchOrg(m.orgId);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.orgName}</span>
                  <span className="block truncate text-xs capitalize text-content-muted dark:text-content-muted-dark">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </span>
                {m.orgId === orgId && (
                  <Check size={16} aria-hidden="true" className="shrink-0 text-primary" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
