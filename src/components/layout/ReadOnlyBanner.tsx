import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useOrgBillingState } from '@/hooks/useOrgBillingState';
import { READ_ONLY_BANNER } from '@/lib/billingState';

/**
 * Tells an owner or manager that the organisation is read-only (D2, 0154):
 * the trial has ended, or a cancelled plan has run out, and nothing has been
 * paid since.
 *
 * Staff see nothing. They can still see the published rota, clock in and ask
 * for leave, so nothing has changed for them, and a banner about billing would
 * only worry somebody who cannot act on it.
 *
 * The control is in the database, not here: `enforce_org_not_read_only`
 * refuses the writes whether or not this banner rendered.
 */
export function ReadOnlyBanner(): JSX.Element | null {
  const { role } = useOrg();
  const { snapshot } = useOrgBillingState();

  if (role !== 'owner' && role !== 'manager') return null;
  if (!snapshot?.readOnly) return null;

  return (
    <div
      role="status"
      className="border-b border-danger/30 bg-danger-wash px-6 py-3 md:px-10 dark:bg-danger-wash-dark"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Lock size={18} className="shrink-0 text-danger" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-content dark:text-content-dark">
          <span className="font-medium">{READ_ONLY_BANNER}</span> Everything already
          recorded is still here and can be exported. Staff can still clock in and request
          leave.
          {role === 'manager' && ' Only the organisation owner can choose a plan.'}
        </p>
        <Link
          to="/app/settings/billing"
          className="text-sm font-medium text-primary-ink underline-offset-2 hover:underline dark:text-primary-ink-dark"
        >
          {role === 'owner' ? 'Choose a plan' : 'Billing'}
        </Link>
      </div>
    </div>
  );
}
