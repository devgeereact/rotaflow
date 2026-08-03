import type { ReactNode } from 'react';
import { PermissionDenied } from '@/components/PermissionDenied';
import { useOrg } from '@/hooks/useOrg';
import type { MembershipRole } from '@/types';

interface RequireRoleProps {
  /** Roles permitted to see the route. */
  allow: readonly MembershipRole[];
  /** What the route shows, e.g. "the rota builder" — used in the denial copy. */
  area: string;
  children: ReactNode;
}

/**
 * Route-level role gate for `/app/*`.
 *
 * ## Why at the route and not in each page
 *
 * The gate used to live inside whichever page remembered it, as a bare card
 * with a one-line message, phrased differently each time — and four pages had
 * no gate at all, so a staff member who deep-linked to them got the full
 * manager interface. Every write behind it still failed on RLS, so nothing
 * leaked that the database would not hand over; what they got was a screen full
 * of controls that silently did nothing, which is its own kind of broken.
 *
 * Putting it on the route means a new page cannot forget: the `<Route>` either
 * declares who may see it or it is open to every member of the organisation.
 *
 * As `PermissionDenied` says at more length: this is presentation. RLS is the
 * boundary. This exists so an honest wrong turn produces an explanation instead
 * of a dead interface.
 */
export function RequireRole({ allow, area, children }: RequireRoleProps): JSX.Element {
  const { role } = useOrg();

  // `role` is null only while a membership is still resolving or the user
  // belongs to no organisation. AppShell already handles both before rendering
  // any child route, so reaching here with null means genuinely no role.
  if (role === null || !allow.includes(role)) {
    return <PermissionDenied area={area} allowed={allow} />;
  }

  return <>{children}</>;
}
