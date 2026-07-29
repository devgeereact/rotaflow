/**
 * Decorative wave field behind the splash screen (design/splash-screen.png).
 *
 * Purely presentational: layered swooshes that sweep in from the upper left,
 * trough under the centre and climb out to the right, with a dotted texture
 * over the right-hand crest. Every curve is fitted to boundary samples taken
 * from the reference at its native 1672×941, so the SVG stretches
 * (`preserveAspectRatio="none"`) to keep the silhouette anchored to the frame
 * at any viewport.
 *
 * Inline SVG rather than a lucide icon or an image asset: it is an
 * illustration, not iconography, and the fills must follow the design tokens
 * through the light/dark switch.
 */
export function SplashWaves(): JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full dark:opacity-25"
      viewBox="0 0 1672 941"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="rf-splash-glow" cx="0.5" cy="0.42" r="0.55">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <pattern id="rf-splash-dots" width="15" height="15" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" className="fill-brand" opacity="0.07" />
        </pattern>
      </defs>

      {/* Soft lift behind the lockup */}
      <rect width="1672" height="941" fill="url(#rf-splash-glow)" />

      {/* Palest swoosh — a cool tint, not white: the reference crease reads
          bluer and slightly darker than the canvas */}
      <path
        d="M0 390C90 460 300 620 480 760C600 852 800 878 1050 865C1220 852 1330 760 1440 630C1520 540 1600 520 1672 505V941H0Z"
        className="fill-brand-mist"
        opacity="0.25"
      />
      {/* Pale blue echo */}
      <path
        d="M0 455C95 528 305 685 490 822C610 910 810 936 1060 922C1230 909 1340 820 1450 690C1530 600 1608 578 1672 562V941H0Z"
        className="fill-brand-mist"
        opacity="0.4"
      />
      {/* Dotted texture over the right-hand crest */}
      <path
        d="M1180 941C1300 860 1400 730 1490 600C1550 512 1610 480 1672 455V941Z"
        fill="url(#rf-splash-dots)"
      />

      {/* Mid-tone wave — surfaces above the deep wave on the right shoulder */}
      <path
        d="M0 700C170 800 300 845 420 890C620 965 800 1000 1000 960C1130 933 1270 880 1400 795C1520 745 1620 680 1672 645V941H0Z"
        className="fill-brand-light"
      />

      {/* Main deep wave */}
      <path
        d="M0 588C160 690 280 745 400 812C520 878 700 960 950 985C1120 1010 1240 970 1330 900C1410 830 1540 690 1672 612V941H0Z"
        className="fill-brand"
      />

      {/* Lighter ribbon riding the deep wave down the left flank */}
      <path
        d="M0 712C170 810 330 880 560 941H0Z"
        className="fill-brand-light"
        opacity="0.45"
      />

      {/* Bottom-centre highlight — two stacked crests so the trough grades
          out into the deep wave instead of ending on a hard edge */}
      <path
        d="M520 941C660 903 770 881 880 879C1000 878 1150 905 1290 941Z"
        className="fill-brand-light"
      />
      <path
        d="M790 941C845 916 870 903 900 902C940 901 1010 918 1070 941Z"
        className="fill-brand-pale"
      />
    </svg>
  );
}
