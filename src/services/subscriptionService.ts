import { supabase } from '@/lib/supabase';
import type { Subscription } from '@/types';

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
