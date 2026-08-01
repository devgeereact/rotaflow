import { supabase } from '@/lib/supabase';
import type { Subscription } from '@/types';

/**
 * Reader for `subscriptions`.
 *
 * The table is real (org-unique, plan/status CHECKed, RLS owner-only) but
 * nothing writes it: `provider` and `provider_ref` are a deliberate seam for a
 * payment provider that has not been chosen yet, and no invoice, payment
 * method or usage-metering table exists at all.
 *
 * So this returns `null` for every organisation today. The Billing screen
 * renders that as "no billing set up", names the plan the org is actually on,
 * and does **not** draw an invoice table with nothing in it — an empty table
 * with column headings reads as "your invoices failed to load".
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
