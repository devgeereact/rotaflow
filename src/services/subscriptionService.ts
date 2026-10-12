import { supabase } from '@/lib/supabase';
import type { Subscription } from '@/types';
import { toOrgBillingSnapshot, type OrgBillingSnapshot } from '@/lib/billingState';

/**
 * Reader for `subscriptions`.
 *
 * The table is real (org-unique, plan/status CHECKed, RLS owner-only) and is
 * now written by `supabase/functions/stripe-webhook` on
 * `checkout.session.completed`, `customer.subscription.updated`,
 * `customer.subscription.deleted` and the invoice events — `provider`,
 * `provider_ref` and `stripe_customer_id` are populated from Stripe rather
 * than being an empty seam.
 *
 * An organisation with no subscription row yet (never completed checkout)
 * still returns `null` here. The Billing screen renders that as "no billing
 * set up" and offers the plan picker; it does **not** draw an invoice table
 * with nothing in it, an empty table with column headings reads as "your
 * invoices failed to load".
 */
export async function getSubscription(orgId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * The organisation's trial and read-only state, for any member (0154).
 *
 * Not read from `subscriptions`: that table is owner-only, and a manager is
 * the person the read-only banner is for. `my_org_billing_state` computes the
 * state on the server from the clock, so the screen never decides by itself
 * whether a trial has ended. Null for a non-member or an unknown organisation.
 */
export async function getOrgBillingState(
  orgId: string,
): Promise<OrgBillingSnapshot | null> {
  const { data, error } = await supabase.rpc('my_org_billing_state', { p_org: orgId });
  if (error) throw error;
  const row = data?.[0];
  return row ? toOrgBillingSnapshot(row) : null;
}
