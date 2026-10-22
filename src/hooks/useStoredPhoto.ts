import { useEffect, useState } from 'react';
import { storedPhotoPath } from '@/lib/staffPhoto';
import { signedPhotoUrl } from '@/services/staffPhotoService';

/**
 * The address to show a photo at. A legacy link is returned as it is; a stored
 * photo (`stored-photo:<path>`, see `src/lib/staffPhoto.ts`) resolves to a
 * signed link, and is null until it does or if signing fails, so the caller
 * shows initials rather than a broken image.
 */
export function useStoredPhoto(source: string | null | undefined): string | null {
  const path = storedPhotoPath(source);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    setSignedUrl(null);
    if (!path) return;
    let active = true;
    signedPhotoUrl(path)
      .then((url) => {
        if (active) setSignedUrl(url);
      })
      .catch(() => {
        // Initials are the fallback; a photo that cannot be signed is not an error
        // worth interrupting anybody for.
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (path) return signedUrl;
  return source ?? null;
}
