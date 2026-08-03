import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useOrg } from '@/hooks/useOrg';

/**
 * Route gate for `/admin/*`.
 *
 * ## Why this is not `RequireRole`
 *
 * NEW_STRUCTURE §2 is explicit: "Do not treat Super Admin as a standard
 * organisation membership role. Super Admin is a separate platform-level
 * permission." `RequireRole` compares `memberships.role`, which is
 * `owner | manager | staff` — an owner of one tenant is not a platform
 * administrator, and conflating the two would hand every customer's owner the
 * keys to every other customer's data.
 *
 * The flag is `profiles.is_platform_admin`, surfaced through `OrgContext`.
 *
 * ## This is presentation, not enforcement
 *
 * Exactly as `PermissionDenied` says at more length: RLS is the boundary. Every
 * cross-tenant read behind this gate goes through `public.is_platform_admin()`
 * inside `is_org_member`/`has_org_role` (0002_rotaflow.sql), so a non-admin who
 * defeats this component still gets nothing back from the database. This exists
 * so an honest wrong turn produces an explanation instead of a screen of empty
 * tables.
 */
export function RequirePlatformAdmin({ children }: { children: ReactNode }): JSX.Element {
  const { isPlatformAdmin, loading } = useOrg();

  // Resolving the profile is what sets the flag. Rendering the denial before
  // it lands would flash "access denied" at a genuine administrator on every
  // hard refresh.
  if (loading) {
    return (
      <p className="p-6 text-content-muted dark:text-content-muted-dark">Loading…</p>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-subtle p-6 dark:bg-surface-subtle-dark">
        <Card className="max-w-md text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-danger/10 text-danger">
            <ShieldAlert size={22} aria-hidden="true" />
          </span>
          <h1 className="mb-2 font-display text-xl font-semibold text-content dark:text-content-dark">
            Platform administration
          </h1>
          <p className="mb-1 text-sm text-content-muted dark:text-content-muted-dark">
            This area manages every organisation on RotaFlow, so it is limited to platform
            administrators.
          </p>
          <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
            Being an owner of your own organisation does not grant it — that is a separate
            permission held on your RotaFlow account.
          </p>
          <Link to="/app/dashboard">
            <Button>
              <ArrowLeft size={18} aria-hidden="true" />
              Back to your dashboard
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
