import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useOrg } from '@/hooks/useOrg';
import type { MembershipRole } from '@/types';

const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

interface PermissionDeniedProps {
  /** What the screen tried to show, e.g. "the rota builder". Reads inside a sentence. */
  area: string;
  /** Roles that can see it, in the order they should be listed. */
  allowed: readonly MembershipRole[];
}

/**
 * Shown when someone reaches a route their role cannot see.
 *
 * ## Why this exists rather than a redirect
 *
 * Silently bouncing to the dashboard is the common pattern and it is the wrong
 * one here. A carer who follows a manager's link to `/app/reports` and lands on
 * the dashboard with no explanation concludes the link is broken and asks
 * someone; told plainly that reports are for owners and managers, they do not.
 * The same applies to a manager who has genuinely lost access after a role
 * change — a redirect makes that look like a bug rather than a permission
 * change somebody made deliberately.
 *
 * So it names the area, states the role actually held, states what the area
 * needs, and offers the way back. Four facts, which is what turns "it's broken"
 * into "I need to ask for access".
 *
 * ## This is presentation, not enforcement
 *
 * Row-level security in Postgres is the real boundary (`docs/SCHEMA.md`), and
 * it holds whether or not this screen renders. Hiding a route stops an honest
 * mistake; it stops nothing else, and must never be treated as though it does.
 */
export function PermissionDenied({ area, allowed }: PermissionDeniedProps): JSX.Element {
  const { role } = useOrg();

  const allowedLabel = allowed.map((r) => ROLE_LABEL[r]);
  const allowedText =
    allowedLabel.length > 1
      ? `${allowedLabel.slice(0, -1).join(', ')} and ${allowedLabel[allowedLabel.length - 1]}`
      : (allowedLabel[0] ?? 'an administrator');

  return (
    <Card className="mx-auto max-w-lg text-center" role="alert" aria-live="polite">
      <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-warning/10 text-warning">
        <ShieldAlert size={28} aria-hidden="true" />
      </span>

      <h1 className="font-display text-xl font-bold text-content dark:text-content-dark">
        You don&rsquo;t have access to {area}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
        Your account is signed in and nothing is wrong — this part of RotaFlow is limited
        to certain roles in your organisation.
      </p>

      <dl className="mx-auto mt-6 max-w-xs space-y-2 rounded-xl border border-surface-border p-4 text-left text-sm dark:border-surface-border-dark">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-content-muted dark:text-content-muted-dark">Your role</dt>
          <dd className="font-semibold text-content dark:text-content-dark">
            {role ? ROLE_LABEL[role] : 'No role assigned'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-content-muted dark:text-content-muted-dark">Requires</dt>
          <dd className="text-right font-semibold text-content dark:text-content-dark">
            {allowedText}
          </dd>
        </div>
      </dl>

      <p className="mt-5 text-sm text-content-muted dark:text-content-muted-dark">
        If you think you should have access, ask an owner in your organisation to change
        your role.
      </p>

      <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
        <Link to="/app/dashboard">
          <Button className="w-full sm:w-auto">
            <ArrowLeft size={18} aria-hidden="true" />
            Back to dashboard
          </Button>
        </Link>
      </div>
    </Card>
  );
}
