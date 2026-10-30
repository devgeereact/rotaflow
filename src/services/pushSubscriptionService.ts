import { api } from '@/lib/api';
import type { PushSubscriptionInsert } from '@/types';

/**
 * This browser's web push subscription for the signed-in person (`/me/push-subscriptions`). Saving the same
 * endpoint again replaces it, so re-subscribing is harmless.
 */
export async function savePushSubscription(input: PushSubscriptionInsert): Promise<void> {
  await api.post('/me/push-subscriptions', {
    endpoint: input.endpoint,
    keys: { p256dh: input.p256dh, auth: input.auth_key },
  });
}

/** Never sent for someone else's endpoint: the API deletes only the caller's own. */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  await api.post('/me/push-subscriptions/delete', { endpoint });
}
