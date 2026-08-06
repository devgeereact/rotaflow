import { env } from '@/lib/env';

export interface ImageTransform {
  width?: number;
  height?: number;
  /** 1-100; defaults to 80. */
  quality?: number;
  crop?: 'maintain_ratio' | 'force' | 'at_max';
}

/**
 * Build a real-time ImageKit delivery URL.
 * Transformations are passed via the `tr:` query segment, e.g.
 *   .../image.jpg?tr=w-400,h-300,q-80,f-auto
 */
export function buildImageKitUrl(path: string, t: ImageTransform = {}): string {
  const endpoint = env.imagekitUrlEndpoint.replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');

  const params: string[] = [];
  if (t.width) params.push(`w-${t.width}`);
  if (t.height) params.push(`h-${t.height}`);
  params.push(`q-${t.quality ?? 80}`);
  params.push('f-auto'); // let ImageKit pick webp/avif per browser
  if (t.crop) params.push(`c-${t.crop}`);

  return `${endpoint}/${cleanPath}?tr=${params.join(',')}`;
}
