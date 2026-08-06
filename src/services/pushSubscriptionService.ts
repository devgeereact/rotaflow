import { supabase } from '@/lib/supabase';
import type { PushSubscriptionInsert } from '@/types';

export async function savePushSubscription(input: PushSubscriptionInsert): Promise<void> {
  // Upsert on endpoint: re-subscribing on the same device (e.g. after
  // clearing the service worker) must replace the stale row, not duplicate it
  //. The unique constraint on `endpoint` would otherwise reject the insert.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(input, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) throw error;
}
