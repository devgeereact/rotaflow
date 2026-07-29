import { useMemo } from 'react';
import { buildImageKitUrl, type ImageTransform } from '@/lib/imagekit';

/** Memoized ImageKit URL for a given path + transform. */
export function useOptimizedImage(path: string, transform?: ImageTransform): string {
  // Depend on primitive fields (not the object identity) so a fresh
  // `transform` literal each render doesn't rebuild the URL needlessly.
  return useMemo(
    () => buildImageKitUrl(path, transform),
    // Must sit directly above the dependency array: that is the line the rule
    // reports on, and Prettier will otherwise detach a disable placed higher up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, transform?.width, transform?.height, transform?.quality, transform?.crop],
  );
}
