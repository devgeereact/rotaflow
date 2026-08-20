import { useLocation } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { navItemsForRole, footerNavItemsForRole } from '@/lib/sidebarNav';

/**
 * `Organisation name / Current screen`, top-left of the topbar.
 *
 * The screen name is resolved from the same catalogue the rail renders, the
 * longest `to` that prefixes the current path wins, so `/app/settings/roles`
 * still reads "Settings" rather than falling through to nothing. A page that
 * wants a third, more specific crumb (a staff member's name, a location) adds
 * it itself; this component only ever knows about the rail.
 */
export function Breadcrumbs(): JSX.Element {
  const { orgName, role } = useOrg();
  const { pathname } = useLocation();

  const candidates = [...navItemsForRole(role), ...footerNavItemsForRole(role)];
  const current = candidates
    .filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-content-muted dark:text-content-muted-dark">
      <span className="truncate">{orgName}</span>
      {current && (
        <>
          <span aria-hidden="true">/</span>
          <span className="truncate font-semibold text-content dark:text-content-dark">
            {current.label}
          </span>
        </>
      )}
    </div>
  );
}
