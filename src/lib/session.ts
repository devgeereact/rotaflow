import { WORK_MODE_KEY_PREFIX } from '@/lib/workMode';
import { reportError } from '@/lib/sentry';

/**
 * Client-side teardown that must run whenever a session ends.
 *
 * `supabase.auth.signOut()` only drops the auth token. Everything below
 * survives it, and on a shared device, a ward tablet, a warehouse terminal,
 * a site office PC, which is most of RotaFlow's market, that means the next
 * person to sign in can be served the previous user's tenant data.
 *
 * Two stores hold that data, both configured in `vite.config.ts`:
 *   - `supabase-api`   authenticated REST responses, NetworkFirst, 5 min TTL
 *   - `imagekit-media` staff photos, CacheFirst, 30 days
 *
 * Neither is keyed by user, so neither can be left for the next session.
 */

/**
 * What this deliberately does NOT touch: the IndexedDB outbox
 * (`lib/offlineOutbox.ts`). It holds writes that have not reached the server
 * — a clock-in somebody made on a ward with no signal — and clearing it on
 * sign-out would destroy the one copy that exists, which is the single
 * outcome the whole queue was built to prevent. Signing out is not a
 * statement that you did not clock in.
 *
 * The shared-device problem it raises is answered by ownership instead: every
 * record carries the id of the user who queued it, and `services/syncQueue.ts`
 * replays and displays only theirs. See `belongsTo` there. A record queued
 * before that field existed belongs to nobody and is never replayed.
 *
 * The browser's push subscription is released separately, by
 * `releasePushSubscription` below, because its server row can only be
 * deleted while the session still exists.
 */

/** Runtime cache names. Must match `workbox.runtimeCaching` in vite.config.ts. */
const TENANT_CACHE_NAMES = ['supabase-api', 'imagekit-media'] as const;

/** Which organisation the user last had selected. */
export const ACTIVE_ORG_STORAGE_KEY = 'rotaflow:activeOrgId';

/** localStorage keys scoped to the signed-in user. */
const TENANT_STORAGE_KEYS: readonly string[] = [ACTIVE_ORG_STORAGE_KEY];

/**
 * Key prefixes whose every entry belongs to the outgoing user.
 *
 * A fixed list cannot cover a key that carries an id in it. The work-mode
 * preference is written per user per organisation
 * (`rotaflow:workMode:<user>:<org>`), so the only way to remove the outgoing
 * user's entries is to sweep by prefix.
 */
const TENANT_STORAGE_PREFIXES: readonly string[] = [WORK_MODE_KEY_PREFIX];

/**
 * Purge every client-side store that holds data belonging to the outgoing
 * user. Safe to call more than once, and safe to call offline.
 */
export async function clearTenantState(): Promise<void> {
  if (typeof window !== 'undefined') {
    for (const key of TENANT_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
    // Collected first, then removed: removing while iterating `key(i)`
    // reindexes the store underneath the loop and skips entries.
    const prefixed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && TENANT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        prefixed.push(key);
      }
    }
    for (const key of prefixed) window.localStorage.removeItem(key);
  }

  if (typeof caches === 'undefined') return;
  await Promise.all(TENANT_CACHE_NAMES.map((name) => caches.delete(name)));
}

/** Longest a sign-out will wait for push teardown before going ahead without it. */
export const PUSH_TEARDOWN_TIMEOUT_MS = 3_000;

/**
 * Stop this browser receiving the outgoing user's push notifications (plan S4).
 *
 * A push subscription belongs to the browser, not the account. Left in place
 * on a shared device, the next person to pick it up is shown the last
 * person's notifications: their shift changes, their leave decisions.
 *
 * Order matters. The server row is deleted first, because RLS only lets its
 * owner delete it and that is only possible while the session still exists,
 * so this must run before `supabase.auth.signOut()`. The browser subscription
 * is then unsubscribed whether or not that worked: with the endpoint dead,
 * nothing sent to an orphaned row can reach this device anyway.
 *
 * Never throws and never holds sign-out up for long: every failure is
 * reported and swallowed, and the whole thing gives up after `timeoutMs`.
 * Signing out offline, or with no service worker, has to work.
 *
 * `deleteServerRow` is passed in rather than imported, because `src/lib` may
 * not take a runtime import from `src/services` (`moduleBoundaries.test.ts`).
 * Callers pass `deletePushSubscription`.
 */
export async function releasePushSubscription(
  deleteServerRow: (endpoint: string) => Promise<void>,
  timeoutMs: number = PUSH_TEARDOWN_TIMEOUT_MS,
): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const teardown = async (): Promise<void> => {
    // `getRegistration`, not `ready`: `ready` never settles when no worker
    // is registered, and a sign-out must not wait on that.
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;

    try {
      await deleteServerRow(subscription.endpoint);
    } catch (err) {
      reportError(err, { area: 'session:push-row-delete' });
    }
    try {
      await subscription.unsubscribe();
    } catch (err) {
      reportError(err, { area: 'session:push-unsubscribe' });
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([
      teardown().catch((err: unknown) =>
        reportError(err, { area: 'session:push-teardown' }),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
