/**
 * Staff document files: what may be uploaded, and where it is kept.
 *
 * The bucket (`staff-documents`, migration 0159) is private. An object's path
 * is `<org_id>/<staff_profile_id>/<file>`, and the Storage policies decide who
 * may read, upload or remove it from that path alone, so building it is the
 * one place a mistake would put a file in the wrong person's folder. The limits
 * below repeat the bucket's own so the browser can say no before uploading;
 * Storage enforces them either way.
 */

export const DOCUMENT_BUCKET = 'staff-documents';

/** Matches `file_size_limit` on the bucket (0159). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Matches `allowed_mime_types` on the bucket (0159). */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

/** For the file input's `accept` attribute. */
export const DOCUMENT_ACCEPT = DOCUMENT_MIME_TYPES.join(',');

/** A signed link lives this long: long enough to open, too short to share. */
export const SIGNED_URL_SECONDS = 60;

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/** Why a file cannot be uploaded, in words for the person choosing it, or null. */
export function documentFileProblem(file: FileLike): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_DOCUMENT_BYTES) return 'Choose a file of 10 MB or less.';
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Choose a PDF, JPEG, PNG, WebP or HEIC file.';
  }
  return null;
}

/**
 * A file name safe to use as the last path segment: no slashes, no control
 * characters, nothing Storage would reject, and short enough to read. The
 * extension is kept so the downloaded copy opens in the right application.
 */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const clean = (s: string): string =>
    s
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
  const safeStem = clean(stem).slice(0, 60) || 'document';
  const safeExt = clean(ext).toLowerCase().slice(0, 8);
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

/**
 * The object path for a new upload. `uniqueId` keeps two uploads of
 * "passport.pdf" apart; the caller passes `crypto.randomUUID()`.
 */
export function documentObjectPath(
  orgId: string,
  staffProfileId: string,
  uniqueId: string,
  fileName: string,
): string {
  return `${orgId}/${staffProfileId}/${uniqueId}-${safeFileName(fileName)}`;
}
