/**
 * Normalising a name into a URL-safe slug.
 *
 * In `lib` rather than in `orgService` because it is pure and the unit suite
 * runs under Node: anything importing `orgService` pulls in the Supabase
 * client, which constructs at module load and dies on Node 20's missing
 * `WebSocket`. It moved here when the platform console's bulk import needed
 * it, and `orgService` re-exports it so no caller had to change.
 */

/** No random suffix. The user owns it. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'org'
  );
}
