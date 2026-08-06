import { cn } from '@/lib/utils';

interface BrandMarkProps {
  /** Sizing/spacing classes. The mark is square. Set both height and width. */
  className?: string;
  /**
   * Accessible name. Pass `null` when the mark sits next to a visible
   * "RotaFlow" wordmark so screen readers don't announce it twice.
   */
  label?: string | null;
}

/**
 * The RotaFlow app icon. Rounded-square brand tile with the stylised "R"
 * (bar + bowl + leg), the accent tile and the 2×2 shift-grid dots.
 *
 * The single source of the mark across the whole product. App sidebar and
 * header, marketing nav and footer, auth, onboarding, splash, app boot, the
 * invitation screen and the platform console. Geometry is traced from
 * design/splash-screen.png at its native 266×269.
 *
 * Vector, not raster. The old `assets/logo.png` was a glow-on-dark-blue export
 * that could not sit on a light canvas, so six surfaces shipped a mark that
 * fought the background it was on; it was retired in favour of this. The same
 * geometry also generates `public/favicon.svg` and the three PWA icons, so the
 * installed app, the browser tab and the sidebar are one mark rather than
 * three near-misses.
 */
export function BrandMark({
  className,
  label = 'RotaFlow',
}: BrandMarkProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 266 269"
      className={cn('shrink-0', className)}
      role={label === null ? 'presentation' : 'img'}
      aria-label={label ?? undefined}
      aria-hidden={label === null || undefined}
    >
      <rect width="266" height="269" rx="46" className="fill-brand" />
      {/* Accent tile tucked under the R's leg */}
      <rect x="60" y="120" width="48" height="48" rx="12" className="fill-brand-light" />
      {/* Bar + bowl */}
      <path
        d="M72 41H156A66 66 0 0 1 166 166L135 126A24 24 0 0 0 150 87H72A12 12 0 0 1 60 75V53A12 12 0 0 1 72 41Z"
        className="fill-primary-fg"
      />
      {/* Diagonal leg */}
      <path
        d="M86 121H134L204.3 221.8Q210 230 200 230H167Q157 230 150.9 222L81.3 130.6Q74 121 86 121Z"
        className="fill-primary-fg"
      />
      {/* Shift grid */}
      <g className="fill-primary-fg">
        <rect x="60" y="179" width="20" height="20" rx="5" />
        <rect x="89" y="179" width="20" height="20" rx="5" />
        <rect x="60" y="208" width="20" height="20" rx="5" />
        <rect x="89" y="208" width="20" height="20" rx="5" />
      </g>
    </svg>
  );
}
