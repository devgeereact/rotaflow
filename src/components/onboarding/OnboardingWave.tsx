/**
 * The single soft wave anchoring the onboarding marketing panel's bottom
 * third (docs/design/Organisation-Onboarding.png, Organisation-about.png,
 * Onboarding-Complete.png). Deliberately not `SplashWaves`: that illustration
 * is fitted to a wide ~16:9 canvas, and stretching it into this panel's
 * narrow, tall aspect ratio (`preserveAspectRatio="none"` over a very
 * different box) squashed its five layered curves into steep, unrecognisable
 * triangles. This is drawn fresh in a percentage-based viewBox instead, which
 * tolerates the stretch because the shape is simple.
 */
export function OnboardingWave(): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 72C22 60 38 82 55 84C72 86 86 78 100 80V100H0Z"
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
