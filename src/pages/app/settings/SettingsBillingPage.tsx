import { useEffect, useState } from 'react';
import { CreditCard, Check } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getSubscription } from '@/services/subscriptionService';
import { listStaff } from '@/services/staffService';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';
import type { Subscription } from '@/types';

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  canceled: 'danger',
};

/**
 * `/app/settings/billing` — design/Settingsbilling.png.
 *
 * ## Why this screen shows less than the reference
 *
 * There is no payment provider. `subscriptions` exists as a real table — org-
 * unique, `plan` and `status` both CHECKed, owner-only RLS — but `provider`
 * and `provider_ref` are an empty seam, and there is no invoices table, no
 * payment-methods table, no usage metering and no credits ledger. Choosing the
 * provider is a business decision, not an engineering one.
 *
 * The reference draws invoice history, saved cards and a usage meter. Rendering
 * those as empty tables would be the wrong call: a table with column headings
 * and no rows reads as *"your invoices failed to load"*, and a £0.00 balance
 * reads as *"you owe nothing"* rather than *"billing is not connected"*. So
 * the screen states the real position and shows what is genuinely known — the
 * plan on the row, its status, and the live staff count that any future plan
 * limit will be measured against.
 */
export function SettingsBillingPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { showError } = useToast();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || role !== 'owner') return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [sub, staff] = await Promise.all([
          getSubscription(orgId),
          listStaff(orgId).catch(() => null),
        ]);
        if (!active) return;
        setSubscription(sub);
        setStaffCount(staff?.length ?? null);
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
              Staff on the roster
            </span>
            <span className="tabular-nums text-content-muted dark:text-content-muted-dark">
              {staffCount ?? '—'}
            </span>
          </li>
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
        <div className="flex gap-3 rounded-xl bg-info/5 p-4">
          <CreditCard
            size={18}
            className="mt-0.5 shrink-0 text-info"
            aria-hidden="true"
          />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              Billing is not connected yet
            </p>
            <p className="mt-1">
              RotaFlow is not charging for this organisation. No payment method is stored,
              no invoices have been issued, and nothing will be taken. When a payment
              provider is connected, your plan, invoices and payment methods will appear
              here.
            </p>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
