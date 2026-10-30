/**
 * Staff document files: what may be uploaded.
 *
 * Files go to the API (compliance, slice S10), which keeps them in its private store at
 * `<org_id>/<staff_profile_id>/<file>`, checks the type from the bytes, and refuses anything over
 * 10 MB. The limits below repeat the API's so the browser can say no before uploading; the API
 * enforces them either way (backend/src/Mod/Compliance.php).
 */

export const DOCUMENT_BUCKET = 'staff-documents';

/** Matches Compliance::MAX_BYTES in the API. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Matches ComplianceRules::sniff in the API. */
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
