/**
 * Staff photos: what may be uploaded, where it is kept, and how a row names it.
 *
 * The bucket (`staff-photos`, migration 0162) is private, laid out like
 * `staff-documents`: `<org_id>/<staff_profile_id>/<file>`. Any member of the
 * organisation may see a photo; only the person and the organisation's owners
 * and managers may change it. A row holds either a legacy pasted link
 * (`photo_url`) or an object path (`photo_path`), never both.
 *
 * Every screen shows a photo through `StaffAvatar`, which takes one string. A
 * stored photo is passed to it as `stored-photo:<path>`, so the mappers that
 * build rows stay pure and the one component that renders a photo is the one
 * place that asks Storage for a signed link.
 */

import { safeFileName, type FileLike } from '@/lib/documentFiles';

export const PHOTO_BUCKET = 'staff-photos';

/** Matches `file_size_limit` on the bucket (0162). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Matches `allowed_mime_types` on the bucket (0162). */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** For the file input's `accept` attribute. */
export const PHOTO_ACCEPT = PHOTO_MIME_TYPES.join(',');

/** A signed photo link lives an hour: photos are shown on every rota screen. */
export const PHOTO_SIGNED_URL_SECONDS = 60 * 60;

const STORED_PREFIX = 'stored-photo:';

/** Why a file cannot be used as a photo, in words for the person choosing it, or null. */
export function photoFileProblem(file: FileLike): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_PHOTO_BYTES) return 'Choose a picture of 2 MB or less.';
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Choose a JPEG, PNG or WebP picture.';
  }
  return null;
}

/** The object path for a new photo. `uniqueId` is `crypto.randomUUID()`. */
export function photoObjectPath(
  orgId: string,
  staffProfileId: string,
  uniqueId: string,
  fileName: string,
): string {
  return `${orgId}/${staffProfileId}/${uniqueId}-${safeFileName(fileName)}`;
}

/** The fields of a staff row that say where its photo is. */
export interface PhotoFields {
  photo_url: string | null;
  photo_path?: string | null;
}

/** What to hand `StaffAvatar` for this row: a stored photo, a legacy link, or null. */
export function photoSource(row: PhotoFields | null | undefined): string | null {
  if (!row) return null;
  if (row.photo_path) return `${STORED_PREFIX}${row.photo_path}`;
  return row.photo_url;
}

/** The object path inside a `photoSource` value, or null for a link or nothing. */
export function storedPhotoPath(source: string | null | undefined): string | null {
  if (!source?.startsWith(STORED_PREFIX)) return null;
  return source.slice(STORED_PREFIX.length) || null;
}
