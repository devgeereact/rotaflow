import { api, orgPath, seg } from '@/lib/api';
import { PHOTO_SIGNED_URL_SECONDS } from '@/lib/staffPhoto';
import { getStaffProfile } from '@/services/staffService';
import type { StaffProfile } from '@/types';

/**
 * Upload a photo to the private bucket and point the staff row at it.
 *
 * The object goes first so the row never names a file that is not there. The
 * row update then clears any legacy pasted link, and if it replaces an earlier
 * stored photo, a trigger queues that file for `purge-storage` (0162). If the
 * update fails, the new object is removed again; if that fails too, it sits in
 * the person's folder until the person is erased or deleted, which sweeps it.
 */
export async function uploadStaffPhoto(
  staff: Pick<StaffProfile, 'id' | 'org_id'>,
  file: File,
): Promise<StaffProfile> {
  // The API stores the picture in its private store, checks the type from the bytes (JPEG, PNG or WebP, 2 MB at
  // most) and queues the replaced one for deletion, all in one request.
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  await api.post(orgPath(staff.org_id, `/staff/${seg(staff.id)}/photo`), {
    data: btoa(binary),
  });
  const updated = await getStaffProfile(staff.id);
  if (!updated) throw new Error('Staff record could not be read back.');
  return updated;
}

/** Clearing the row is what removes the file: the trigger queues it (0162). */
export async function removeStaffPhoto(staffId: string): Promise<StaffProfile> {
  const current = await getStaffProfile(staffId);
  if (!current) throw new Error('Staff record not found.');
  await api.post(orgPath(current.org_id, `/staff/${seg(staffId)}/photo/delete`));
  const updated = await getStaffProfile(staffId);
  return updated ?? current;
}

// One signed link per path for most of its life, so a rota of forty people
// asks Storage forty times on first paint and not on every re-render.
const signed = new Map<string, { url: string; expires: number }>();
const REUSE_MS = (PHOTO_SIGNED_URL_SECONDS - 5 * 60) * 1000;

/** A signed link to show a stored photo, reused until shortly before it expires. */
export async function signedPhotoUrl(path: string): Promise<string> {
  const cached = signed.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  // A stored path is `<org>/<staff>/<file>`, which names the record whose link to ask for.
  const [orgId, staffId] = path.split('/');
  if (!orgId || !staffId) throw new Error('Not a staff photo path.');
  const r = await api.get<{ url: string | null }>(
    orgPath(orgId, `/staff/${seg(staffId)}/photo-link`),
  );
  if (!r.url) throw new Error('This person has no photo.');
  signed.set(path, { url: r.url, expires: Date.now() + REUSE_MS });
  return r.url;
}
