import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationThumbProps {
  name: string;
  photoUrl: string | null;
  size?: 'row' | 'panel';
  className?: string;
}

const SIZES = {
  row: { box: 'h-9 w-9 rounded-lg', icon: 18 },
  panel: { box: 'h-24 w-28 rounded-xl', icon: 32 },
} as const;

/**
 * Site photograph in a location row and at the top of the detail panel.
 *
 * The references show a real photograph of each building; the repo ships no
 * such assets and `locations` has no `photo_url` column (docs/SCHEMA.md §3),
 * so `photoUrl` is optional and falls back to a tinted building mark.
 */
export function LocationThumb({
  name,
  photoUrl,
  size = 'row',
  className,
}: LocationThumbProps): JSX.Element {
  const spec = SIZES[size];

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={cn('shrink-0 object-cover', spec.box, className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center bg-primary/10 text-primary',
        spec.box,
        className,
      )}
    >
      <Building2 size={spec.icon} strokeWidth={2} />
    </span>
  );
}
