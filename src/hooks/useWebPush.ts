import { useCallback, useEffect, useState } from 'react';
import { env } from '@/lib/env';
import {
  savePushSubscription,
  deletePushSubscription,
} from '@/services/pushSubscriptionService';
import { reportError } from '@/lib/sentry';

export type WebPushStatus = 'unsupported' | 'default' | 'granted' | 'denied';

export interface UseWebPush {
  status: WebPushStatus;
  subscribing: boolean;
  /** Requests permission (if needed) and subscribes this device. */
  subscribe: (userId: string) => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}

/**
 * VAPID key from Vite's base64url form to the raw bytes pushManager.subscribe expects.
 *
 * Returns `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: since TS 5.7 the typed
 * arrays are generic over their buffer, and `applicationServerKey` requires a
 * `BufferSource` backed by `ArrayBuffer`. The default `ArrayBufferLike` also admits
 * `SharedArrayBuffer` and is rejected.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * Subscribes this device to Web Push, storing the subscription in
 * `push_subscriptions` for the `send-notification` Edge Function to read.
 *
 * Requires `VITE_VAPID_PUBLIC_KEY` and a registered service worker, both are
 * already in place (vite-plugin-pwa registers one on every build). The
 * *sending* side (the Edge Function, VAPID-signed push) is written but not
 * deployed in this environment. See supabase/functions/send-notification,
 * so a real push cannot be verified end-to-end from here.
 */
export function useWebPush(): UseWebPush {
  const [status, setStatus] = useState<WebPushStatus>('default');
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      !('serviceWorker' in navigator)
    ) {
      setStatus('unsupported');
      return;
    }
    setStatus(Notification.permission);
  }, []);

  const subscribe = useCallback(
    async (userId: string): Promise<boolean> => {
      if (status === 'unsupported') return false;
      if (!env.vapidPublicKey) {
        reportError(new Error('VITE_VAPID_PUBLIC_KEY not configured'), {
          area: 'webPush:subscribe',
        });
        return false;
      }

      setSubscribing(true);
      try {
        const permission = await Notification.requestPermission();
        setStatus(permission);
        if (permission !== 'granted') return false;

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
        });

        const json = subscription.toJSON();
        const p256dh = json.keys?.p256dh;
        const authKey = json.keys?.auth;
        if (!p256dh || !authKey) {
          throw new Error('Push subscription is missing encryption keys');
        }

        await savePushSubscription({
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh,
          auth_key: authKey,
        });
        return true;
      } catch (err) {
        reportError(err, { area: 'webPush:subscribe' });
        return false;
      } finally {
        setSubscribing(false);
      }
    },
    [status],
  );

  const unsubscribe = useCallback(async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      await subscription.unsubscribe();
      await deletePushSubscription(subscription.endpoint);
    } catch (err) {
      reportError(err, { area: 'webPush:unsubscribe' });
    }
  }, []);

  return { status, subscribing, subscribe, unsubscribe };
}
