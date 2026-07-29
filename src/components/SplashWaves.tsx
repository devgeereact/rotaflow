/**
 * Decorative wave field behind the splash screen (design/splash-screen.png).
 *
 * Purely presentational: a stack of layered swooshes that sweep from the upper
 * left, trough under the centre and climb out to the right, plus the dotted
 * texture over the right-hand crest. Curves are fitted to boundary samples
 * taken from the reference at its native 1672×941, so the SVG stretches
 * (`preserveAspectRatio="none"`) to keep the silhouette anchored to the frame
 * at any viewport.
 *
 * An inline SVG rather than a lucide icon or an image asset: it is an
 * illustration, not iconography, and the fills must follow the design tokens
 * through the light/dark switch.
 */
export function SplashWaves(): JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full dark:opacity-30"
      viewBox="0 0 1672 941"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="rf-splash-glow" cx="0.5" cy="0.42" r="0.55">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <pattern id="rf-splash-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.4" className="fill-primary-fg" opacity="0.22" />
        </pattern>
      </defs>

      {/* Soft lift behind the lockup */}
      <rect width="1672" height="941" fill="url(#rf-splash-glow)" />

      {/* Palest swoosh */}
      <path
        d="M0 455C200 545 380 700 560 810C700 890 860 880 1050 865C1220 850 1330 760 1440 630C1520 540 1600 520 1672 505V941H0Z"
        className="fill-surface"
        opacity="0.75"
      />
      {/* Pale blue echo */}
      <path
        d="M0 520C190 605 375 730 555 838C700 922 870 930 1060 915C1235 900 1345 800 1455 670C1535 578 1605 552 1672 535V941H0Z"
        className="fill-brand-mist"
        opacity="0.45"
      />

      {/* Main deep wave */}
      <path
        d="M0 585C150 650 320 760 480 850C620 928 780 985 950 995C1150 1050 1400 960 1520 760C1570 700 1620 650 1672 612V941H0Z"
        className="fill-brand"
      />
      {/* Mid-tone ribbon riding the deep wave */}
      <path
        d="M0 712C160 780 330 878 500 941H0Z"
        className="fill-brand-light"
        opacity="0.55"
      />
      <path
        d="M1672 735C1610 800 1540 860 1470 941H1672Z"
        className="fill-brand-light"
        opacity="0.55"
      />
      {/* Bottom-centre highlight */}
      <path
        d="M470 941C640 890 800 862 960 872C1120 882 1250 916 1350 941Z"
        className="fill-brand-pale"
      />
      <path
        d="M600 941C720 902 850 886 980 895C1090 903 1180 920 1250 941Z"
        className="fill-brand-mist"
        opacity="0.8"
      />

      {/* Dotted texture over the right-hand crest */}
      <path
        d="M1230 941C1330 860 1430 730 1520 600C1570 528 1620 490 1672 462V941Z"
        fill="url(#rf-splash-dots)"
      />
    </svg>
  );
}
