import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getSubscription } from '@/services/subscriptionService';
import { listStaff } from '@/services/staffService';
import { getOrganisation } from '@/services/orgService';
import { listLocations } from '@/services/locationService';
import { orgProfileFields } from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import {
  listPlans,
  startCheckout,
  openBillingPortal,
  type Plan,
} from '@/services/billingCheckoutService';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';
import type { Subscription } from '@/types';

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
  enterprise: 'Enterprise',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  canceled: 'danger',
};

/**
 * `/app/settings/billing`. Design/Settingsbilling.png.
 *
 * ## Why this screen shows less than the reference
 *
 * A payment provider (Stripe) is now wired in: `subscriptions` is a real
 * table, org-unique, `plan` and `status` both CHECKed, owner-only RLS, with
 * `provider`/`provider_ref`/`stripe_customer_id` populated by
 * `supabase/functions/stripe-webhook`. `invoices` has existed since
 * `0023_commercials.sql` and is written by the same webhook on
 * `invoice.paid`/`invoice.payment_failed`.
 *
 * The reference draws invoice history, saved cards and a usage meter directly
 * on this screen. This screen deliberately doesn't rebuild that UI — Stripe's
 * hosted Customer Portal (via `openBillingPortal`) is the surface for invoice
 * history, saved payment methods and cancellation, per this feature's design
 * spec. There is still no usage metering or credits ledger, so this screen
 * shows what is genuinely known locally: the plan on the row, its status, and
 * the live staff count that any future plan limit will be measured against.
 */
export function SettingsBillingPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { showError } = useToast();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [siteCount, setSiteCount] = useState<number | null>(null);
  const [billingContact, setBillingContact] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || role !== 'owner') return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [sub, staff, sites, org, planList] = await Promise.all([
          getSubscription(orgId),
          listStaff(orgId).catch(() => null),
          listLocations(orgId).catch(() => null),
          getOrganisation(orgId).catch(() => null),
          listPlans().catch(() => []),
        ]);
        if (!active) return;
        setSubscription(sub);
        setStaffCount(staff?.length ?? null);
        setSiteCount(sites?.length ?? null);
        setBillingContact(org ? orgProfileFields(org.settings, org).contactEmail : '');
        setPlans(planList);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-billing:load' });
        showError('Could not load billing information.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, role, showError]);

  async function handleUpgrade(planCode: string): Promise<void> {
    if (!orgId) return;
    setActionPending(planCode);
    try {
      await startCheckout(orgId, planCode);
    } catch (err) {
      reportError(err, { area: 'settings-billing:checkout' });
      showError(
        err instanceof Error
          ? err.message
          : 'Could not start checkout. Please try again.',
      );
      setActionPending(null);
    }
  }

  async function handleManageBilling(): Promise<void> {
    if (!orgId) return;
    setActionPending('manage');
    try {
      await openBillingPortal(orgId);
    } catch (err) {
      reportError(err, { area: 'settings-billing:portal' });
      showError(
        err instanceof Error
          ? err.message
          : 'Could not open the billing portal. Please try again.',
      );
      setActionPending(null);
    }
  }

  if (role !== 'owner') return <OwnerOnlyNotice section="billing" />;

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      </Card>
    );
  }

  const plan = subscription?.plan ?? 'starter';
  const status = subscription?.status ?? 'trialing';

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Current plan"
        description="The plan this organisation is on."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-display text-section-heading font-semibold text-content dark:text-content-dark">
              {PLAN_NAMES[plan] ?? plan}
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {subscription?.current_period_end
                ? `Current period ends ${new Date(subscription.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                : 'No billing period set.'}
            </p>
          </div>
          <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
            {status.replace('_', ' ')}
          </Badge>
        </div>

        <ul className="mt-6 space-y-2.5 border-t border-divider pt-5 text-sm dark:border-divider-dark">
          <li className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-content dark:text-content-dark">
              <Check size={16} className="text-success" aria-hidden="true" />
              Sites
            </span>
            <span className="tabular-nums text-content-muted dark:text-content-muted-dark">
              {siteCount ?? '-'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-content dark:text-content-dark">
              <Check size={16} className="text-success" aria-hidden="true" />
              Staff on the roster
            </span>
            <span className="tabular-nums text-content-muted dark:text-content-muted-dark">
              {staffCount ?? '-'}
            </span>
          </li>
          {billingContact && (
            <li className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-content dark:text-content-dark">
                <Check size={16} className="text-success" aria-hidden="true" />
                Billing contact
              </span>
              <span className="text-content-muted dark:text-content-muted-dark">
                {billingContact}
              </span>
            </li>
          )}
          <li className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-content dark:text-content-dark">
              <Check size={16} className="text-success" aria-hidden="true" />
              Rotas and shifts
            </span>
            <span className="text-content-muted dark:text-content-muted-dark">
              Unlimited
            </span>
          </li>
          <li className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-content dark:text-content-dark">
              <Check size={16} className="text-success" aria-hidden="true" />
              Reports and exports
            </span>
            <span className="text-content-muted dark:text-content-muted-dark">
              Included
            </span>
          </li>
        </ul>
      </SettingsSection>

      <SettingsSection title="Payment">
        {subscription && subscription.status !== 'canceled' ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Manage your payment method, view invoices or cancel from Stripe's secure
              billing portal.
            </p>
            <Button
              variant="secondary"
              onClick={() => void handleManageBilling()}
              disabled={actionPending === 'manage'}
            >
              {actionPending === 'manage' ? 'Opening…' : 'Manage billing'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {subscription?.status === 'canceled' && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-divider bg-surface-subtle p-4 dark:border-divider-dark dark:bg-surface-subtle-dark">
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  Your subscription was canceled. Choose a plan below to resubscribe, or
                  review past invoices in Stripe's billing portal.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void handleManageBilling()}
                  disabled={actionPending === 'manage'}
                >
                  {actionPending === 'manage' ? 'Opening…' : 'Manage billing'}
                </Button>
              </div>
            )}
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Choose a plan to add a payment method and activate billing for this
              organisation.
            </p>
            {plans.map((p) => (
              <div
                key={p.code}
                className="flex items-center justify-between gap-4 rounded-xl border border-divider p-4 dark:border-divider-dark"
              >
                <div>
                  <p className="font-medium text-content dark:text-content-dark">
                    {p.name}
                  </p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    £{(p.monthly_price_pence / 100).toFixed(2)} / month
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleUpgrade(p.code)}
                  disabled={actionPending === p.code}
                >
                  {actionPending === p.code ? 'Redirecting…' : 'Upgrade'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
