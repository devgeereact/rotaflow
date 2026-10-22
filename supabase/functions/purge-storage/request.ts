// The part of purge-storage that decides what it is allowed to delete.
//
// No Deno globals, so it runs under vitest (vitest.config.ts includes
// `supabase/functions/**/*.test.ts`). The handler in index.ts holds the
// service-role key, which can remove ANY object in ANY bucket, so the one
// thing worth testing outside Deno is that a request it accepts can only ever
// name something under an organisation's folder in `staff-documents` (0159)
// or `staff-photos` (0162).

export const PURGE_BUCKETS = ['staff-documents', 'staff-photos'] as const;

export type PurgeBucket = (typeof PURGE_BUCKETS)[number];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `<org>` or `<org>/<person>`, the two folders the queue names. */
const FOLDER = new RegExp(`^${UUID}(/${UUID})?$`);

/** `<org>/<person>/<file>`, the shape documents.storage_path and staff_profiles.photo_path are held to. */
const OBJECT = new RegExp(`^${UUID}/${UUID}/[^/]+$`);

export interface PurgeRequest {
  bucket: PurgeBucket;
  path: string;
  isFolder: boolean;
}

/**
 * Validate a body posted by `dispatch_storage_deletions()`.
 *
 * Returns null for anything else: a bucket not named above, a path outside the two
 * shapes above, `..`, a leading slash, an empty folder (which would mean "the
 * whole bucket"). Refusing is always safe here: a refused row is retried and
 * then abandoned in the queue, where it is visible, whereas a delete that
 * reached further than it should cannot be undone.
 */
export function parsePurgeRequest(body: unknown): PurgeRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { bucket, path, isFolder } = body as Record<string, unknown>;
  if (!(PURGE_BUCKETS as readonly unknown[]).includes(bucket)) return null;
  if (typeof path !== 'string' || typeof isFolder !== 'boolean') return null;
  if (isFolder ? !FOLDER.test(path) : !OBJECT.test(path)) return null;
  return { bucket: bucket as PurgeBucket, path, isFolder };
}

/** A listed entry with no id is a sub-folder, not an object (Storage `list`). */
export interface ListedEntry {
  name: string;
  id: string | null;
}

/** Split one `list` page into object paths to remove and folders to descend into. */
export function splitListing(
  prefix: string,
  entries: ListedEntry[],
): { objects: string[]; folders: string[] } {
  const objects: string[] = [];
  const folders: string[] = [];
  for (const entry of entries) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id === null) folders.push(full);
    else objects.push(full);
  }
  return { objects, folders };
}
