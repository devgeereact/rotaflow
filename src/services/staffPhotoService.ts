import { supabase } from '@/lib/supabase';
import {
  PHOTO_BUCKET,
  PHOTO_SIGNED_URL_SECONDS,
  photoObjectPath,
} from '@/lib/staffPhoto';
import { updateStaffProfile } from '@/services/staffService';
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
  const path = photoObjectPath(staff.org_id, staff.id, crypto.randomUUID(), file.name);
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  try {
    return await updateStaffProfile(staff.id, { photo_path: path, photo_url: null });
  } catch (err) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw err;
  }
}

/** Clearing the row is what removes the file: the trigger queues it (0162). */
export async function removeStaffPhoto(staffId: string): Promise<StaffProfile> {
  return updateStaffProfile(staffId, { photo_path: null, photo_url: null });
}

// One signed link per path for most of its life, so a rota of forty people
// asks Storage forty times on first paint and not on every re-render.
const signed = new Map<string, { url: string; expires: number }>();
const REUSE_MS = (PHOTO_SIGNED_URL_SECONDS - 5 * 60) * 1000;

/** A signed link to show a stored photo, reused until shortly before it expires. */
export async function signedPhotoUrl(path: string): Promise<string> {
  const cached = signed.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, PHOTO_SIGNED_URL_SECONDS);
  if (error) throw error;
  signed.set(path, { url: data.signedUrl, expires: Date.now() + REUSE_MS });
  return data.signedUrl;
}
