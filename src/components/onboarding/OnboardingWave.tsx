import type { JSX } from 'react';
/**
 * The single soft wave anchoring the onboarding marketing panel's bottom
 * third (docs/design/Organisation-Onboarding.png, Organisation-about.png,
 * Onboarding-Complete.png). Deliberately not `SplashWaves`: that illustration
 * is fitted to a wide ~16:9 canvas, and stretching it into this panel's
 * narrow, tall aspect ratio (`preserveAspectRatio="none"` over a very
 * different box) squashed its five layered curves into steep, unrecognisable
 * triangles. This is drawn fresh in a percentage-based viewBox instead, which
 * tolerates the stretch because the shape is simple.
 *
 * It fills only the panel's bottom band, the same 23:12 box the illustration
 * is drawn in (`OnboardingLayout` reserves exactly that much). Stretched over
 * the whole panel it rose with the copy, so on the longer panels the hills
 * sat behind the last feature's text (2026-10-22 design-match pass).
 */
export function OnboardingWave(): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 aspect-[23/12] w-full"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 52C22 38 38 62 55 64C72 66 86 56 100 60V100H0Z"
        className="fill-brand-mist"
        opacity="0.5"
      />
      <path
        d="M0 80C20 68 34 90 52 91C68 92 84 87 100 89V100H0Z"
        className="fill-brand"
      />
    </svg>
  );
}
