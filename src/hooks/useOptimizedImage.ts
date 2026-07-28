import { useMemo } from 'react';
import { buildImageKitUrl, type ImageTransform } from '@/lib/imagekit';

/** Memoized ImageKit URL for a given path + transform. */
export function useOptimizedImage(path: string, transform?: ImageTransform): string {
  // Depend on primitive fields (not the object identity) so a fresh
  // `transform` literal each render doesn't rebuild the URL needlessly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildImageKitUrl(path, transform), [
    path,
    transform?.width,
    transform?.height,
    transform?.quality,
    transform?.crop,
  ]);
}
