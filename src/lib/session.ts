/**
 * Client-side teardown that must run whenever a session ends.
 *
 * `supabase.auth.signOut()` only drops the auth token. Everything below
 * survives it, and on a shared device — a ward tablet, a warehouse terminal,
 * a site office PC, which is most of RotaFlow's market — that means the next
 * person to sign in can be served the previous user's tenant data.
 *
 * Two stores hold that data, both configured in `vite.config.ts`:
 *   - `supabase-api`   authenticated REST responses, NetworkFirst, 5 min TTL
 *   - `imagekit-media` staff photos, CacheFirst, 30 days
 *
 * Neither is keyed by user, so neither can be left for the next session.
 */

/** Runtime cache names. Must match `workbox.runtimeCaching` in vite.config.ts. */
const TENANT_CACHE_NAMES = ['supabase-api', 'imagekit-media'] as const;

/** Which organisation the user last had selected. */
export const ACTIVE_ORG_STORAGE_KEY = 'rotaflow:activeOrgId';

/** localStorage keys scoped to the signed-in user. */
const TENANT_STORAGE_KEYS: readonly string[] = [ACTIVE_ORG_STORAGE_KEY];

/**
 * Purge every client-side store that holds data belonging to the outgoing
 * user. Safe to call more than once, and safe to call offline.
 */
export async function clearTenantState(): Promise<void> {
  if (typeof window !== 'undefined') {
    for (const key of TENANT_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  }

  if (typeof caches === 'undefined') return;
  await Promise.all(TENANT_CACHE_NAMES.map((name) => caches.delete(name)));
}
