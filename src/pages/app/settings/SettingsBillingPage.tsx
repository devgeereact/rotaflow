import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getOrgBillingState, getSubscription } from '@/services/subscriptionService';
import { listStaff } from '@/services/staffService';
import { getOrganisation } from '@/services/orgService';
import { listLocations } from '@/services/locationService';
import { listOwnerInvoices } from '@/services/billingService';
import { orgProfileFields } from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import {
  ALREADY_SUBSCRIBED,
  billingStatus,
  entitledPlan,
  orgStateBadge,
  planName,
  planPriceLabel,
  type OrgBillingSnapshot,
  type OwnerInvoiceRow,
} from '@/lib/billingState';
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
import { BillingInvoices } from '@/components/settings/BillingInvoices';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';
import type { Subscription } from '@/types';

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
 * on this screen. Invoices are listed here since 0156 (plan F3): the last
 * twelve, each linking to the hosted page and PDF Stripe issued, so an owner
 * can file one without a trip through the portal. Saved payment methods and
 * cancellation stay in Stripe's hosted Customer Portal (via
 * `openBillingPortal`), which also keeps the full invoice history. There is still no usage metering or credits ledger, so this screen
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
  const [orgPlan, setOrgPlan] = useState<string | null>(null);
  const [orgState, setOrgState] = useState<OrgBillingSnapshot | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<OwnerInvoiceRow[]>([]);
  const [invoicesFailed, setInvoicesFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || role !== 'owner') return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [sub, staff, sites, org, planList, state, invoiceList] = await Promise.all([
          getSubscription(orgId),
          listStaff(orgId).catch(() => null),
          listLocations(orgId).catch(() => null),
          getOrganisation(orgId).catch(() => null),
          listPlans().catch(() => []),
          getOrgBillingState(orgId).catch(() => null),
          // Its own failure, said in its own section: the rest of the screen
          // is still right without it.
          listOwnerInvoices(orgId).catch((err: unknown) => {
            reportError(err, { area: 'settings-billing:invoices' });
            return null;
          }),
        ]);
        if (!active) return;
        setSubscription(sub);
        setStaffCount(staff?.length ?? null);
        setSiteCount(sites?.length ?? null);
        setBillingContact(org ? orgProfileFields(org.settings, org).contactEmail : '');
        setOrgPlan(org?.plan ?? null);
        setPlans(planList);
        setOrgState(state);
        setInvoices(invoiceList ?? []);
        setInvoicesFailed(invoiceList === null);
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
      // The organisation already has a subscription that is billing (this
      // screen may be stale, or open in a second tab). A second Checkout would
      // create a second Stripe subscription, so the server refuses with a 409
      // and plan changes go through the portal instead.
      if (err instanceof Error && err.message === ALREADY_SUBSCRIBED) {
        setActionPending(null);
        await handleManageBilling();
        return;
      }
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

  // No subscription is "No plan yet", never a trial (B4). With one, the
  // heading names the entitled plan from `organisations.plan`, which is what
  // the limits are enforced against, rather than the subscription's own plan.
  const status = subscription?.status ?? null;
  // The organisation-level state (0154) says what the subscription row cannot:
  // the free trial has no row at all, and read-only is the absence of
  // everything. Otherwise the subscription's own status is the answer.
  const now = new Date();
  const badge = orgStateBadge(orgState, now) ?? billingStatus(subscription, now);
  const inFreeTrial = orgState?.state === 'trial';
  const readOnly = orgState?.readOnly === true;
  const formatDay = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const plan = subscription ? entitledPlan(orgPlan, subscription) : null;
  const subscribedPlanDiffers =
    subscription !== null && plan !== null && plan !== subscription.plan;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Current plan"
        description="The plan this organisation is on."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-display text-section-heading font-semibold text-content dark:text-content-dark">
              {plan ? planName(plan) : inFreeTrial ? 'Free trial' : 'No plan yet'}
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {!subscription
                ? 'Choose a plan below to start billing for this organisation.'
                : subscription.current_period_end
                  ? `Current period ends ${new Date(subscription.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                  : 'No billing period set.'}
            </p>
            {!subscription && inFreeTrial && orgPlan && (
              <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                Your free trial has {planName(orgPlan)} limits
                {orgState?.trialEndsAt ? ` until ${formatDay(orgState.trialEndsAt)}` : ''}
                . Choosing a plan now keeps the days you have left: your card is first
                charged when the trial ends.
              </p>
            )}
            {subscribedPlanDiffers && subscription && plan && (
              <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                Subscribed to {planName(subscription.plan)}. Limits currently follow{' '}
                {planName(plan)}.
              </p>
            )}
          </div>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>

        {/* A past-due badge on its own is an alarm with no action (CAP-041).
            `grace_until` is the date the subscription is actually at risk, and
            it comes from the row rather than being computed here — the
            database derives it from the status so the two cannot disagree.

            It says "at risk", not "will be cancelled": Stripe's dunning
            decides that, and this system does not take the payments. */}
        {readOnly && (
          <p
            className="mt-4 rounded-xl bg-danger-wash px-4 py-3 text-sm text-content dark:bg-danger-wash-dark dark:text-content-dark"
            role="status"
          >
            {subscription?.status === 'canceled'
              ? 'Your plan has ended, so this organisation is read-only.'
              : 'Your free trial has ended, so this organisation is read-only.'}{' '}
            Everyone can still sign in, see and export everything, and staff can still
            clock in and request leave. Choose a plan below to publish rotas and invite
            people again.
          </p>
        )}

        {status === 'past_due' && subscription?.grace_until && (
          <p
            className="mt-4 rounded-xl bg-warning-wash px-4 py-3 text-sm text-content dark:bg-warning-wash-dark dark:text-content-dark"
            role="status"
          >
            A payment has failed. Your card will be retried, and the subscription is at
            risk from{' '}
            <strong>
              {new Date(subscription.grace_until).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </strong>
            . Updating your card in the billing portal resolves it immediately.
          </p>
        )}

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
                  Your subscription was cancelled. Choose a plan below to resubscribe, or
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
              {inFreeTrial && ' Nothing is charged until your free trial ends.'}
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
                    {planPriceLabel(p)}
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

      <SettingsSection
        title="Invoices"
        description="Your most recent invoices, with the copy Stripe issued for each."
      >
        <BillingInvoices invoices={invoices} failed={invoicesFailed} />
      </SettingsSection>
    </div>
  );
}
