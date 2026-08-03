import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useOrg } from '@/hooks/useOrg';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import type { PlatformRole } from '@/types';

/**
 * Gate for a screen or action inside `/admin/*` that only some platform roles
 * may reach.
 *
 * ## How this differs from `RequirePlatformAdmin`
 *
 * `RequirePlatformAdmin` is the outer gate on the whole area: may you be here
 * at all. This is the inner one: a platform *support* administrator belongs in
 * the console and belongs nowhere near billing or release flags. Both are
 * needed, and they read different sources — the outer one reads
 * `profiles.is_platform_admin` (the flag 0002's RLS helpers fold in), this one
 * reads `platform_admins.role` via `my_platform_role()`.
 *
 * ## Enforcement lives in the database, as always
 *
 * The tables this guards carry policies gated on `has_platform_role(...)`
 * (0015 onward), so someone who defeats this component still gets nothing
 * back. What this prevents is a support administrator being shown a billing
 * screen full of empty tables and reasonably concluding the product is broken.
 *
 * ## Degrading when the role cannot be read
 *
 * `platformRole` is `null` both for "holds no platform role" and for "the
 * grant could not be read" — `OrgContext` swallows that failure deliberately
 * so a missing RPC cannot blank the tenant session. Null therefore denies:
 * for a permission check, unknown must mean no.
 */
export function RequirePlatformRole({
  allow,
  area,
  children,
}: {
  allow: readonly PlatformRole[];
  /** Named in the denial, e.g. "platform billing". */
  area: string;
  children: ReactNode;
}): JSX.Element {
  const { platformRole, loading } = useOrg();

  if (loading) {
    return (
      <p className="p-6 text-content-muted dark:text-content-muted-dark">Loading…</p>
    );
  }

  if (!platformRole || !allow.includes(platformRole)) {
    return (
      <Card className="max-w-xl">
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-warning/15 text-warning">
          <Lock size={20} aria-hidden="true" />
        </span>
        <h1 className="mb-2 font-display text-card-heading font-semibold text-content dark:text-content-dark">
          Not part of your platform role
        </h1>
        <p className="mb-1 text-sm text-content-muted dark:text-content-muted-dark">
          {area} is limited to{' '}
          {allow.map((role) => PLATFORM_ROLE_LABELS[role]).join(' and ')}.
        </p>
        <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
          {platformRole
            ? `You are signed in as ${PLATFORM_ROLE_LABELS[platformRole]}.`
            : 'No platform role could be read for your account.'}
        </p>
        <Link to="/admin">
          <Button variant="secondary">
            <ArrowLeft size={18} aria-hidden="true" />
            Back to platform overview
          </Button>
        </Link>
      </Card>
    );
  }

  return <>{children}</>;
}
