import { api, orgPath } from '@/lib/api';
import type { Subscription } from '@/types';
import { toOrgBillingSnapshot, type OrgBillingSnapshot } from '@/lib/billingState';

/**
 * The organisation's subscription and billing state. The API computes the state (active, trialing, grace, trial,
 * read_only) the same way for the banner and for every write it refuses, so the screen and the server agree.
 */

interface BillingAccount {
  billing: {
    state: string;
    plan: string;
    trial_ends_at: string | null;
    grace_until: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
    stripe_mode: string | null;
    has_billing_account: boolean;
  };
}

/** Owner only (Settings, Billing). Null when the organisation has never subscribed. */
export async function getSubscription(orgId: string): Promise<Subscription | null> {
  const r = await api.get<BillingAccount>(orgPath(orgId, '/billing'));
  const b = r.billing;
  if (b.subscription_status === null) return null;
  return {
    id: orgId,
    org_id: orgId,
    plan: b.plan,
    status: b.subscription_status,
    current_period_end: b.current_period_end,
    grace_until: b.grace_until,
    trial_ends_at: b.trial_ends_at,
    stripe_mode: b.stripe_mode ?? 'test',
    stripe_customer_id: b.has_billing_account ? 'on-file' : null,
    canceled_at: null,
    created_at: '',
    currency: 'GBP',
    past_due_since: null,
    price_pence: null,
    provider: 'stripe',
    provider_ref: null,
    started_at: '',
    updated_at: '',
  };
}

/** Any member: enough to show the banner and to disable writes the API would refuse. */
export async function getOrgBillingState(
  orgId: string,
): Promise<OrgBillingSnapshot | null> {
  const r = await api.get<{ state: string; trial_ends_at: string | null }>(
    orgPath(orgId, '/billing/state'),
  );
  return toOrgBillingSnapshot({
    state: r.state,
    trial_ends_at: r.trial_ends_at,
    read_only: r.state === 'read_only',
  });
}
