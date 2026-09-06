import { WORK_MODE_KEY_PREFIX } from '@/lib/workMode';

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
 * replays and displays only theirs. See `belongsTo` there.
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
