import type { Config } from 'tailwindcss';

// Design tokens mirror docs/DESIGN.md — the canonical reference is
// design/designsystem.png. Keep class names NativeWind-compatible (no
// arbitrary web-only selectors) so the tree can be ported to Expo later.
//
// Light is the default theme (docs/DESIGN.md §1). Base token values are the
// LIGHT palette; pair every surface/text token with its `-dark` counterpart
// behind a `dark:` variant, e.g. `bg-background dark:bg-background-dark`.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#F5F7FA', // app canvas (light)
          dark: '#0B1220', // app canvas (dark)
        },
        surface: {
          DEFAULT: '#FFFFFF', // cards, sheets, rota cells (light)
          dark: '#111A2E', // cards, sheets, rota cells (dark)
          subtle: '#FAFBFC', // nested panels, hover fills (light)
          'subtle-dark': '#15203A', // nested panels, hover fills (dark)
          border: '#E3E6EA', // card/control outlines (light)
          'border-dark': '#22304D', // card/control outlines (dark)
        },
        divider: {
          DEFAULT: '#F2F4F6', // subtle in-list separators (light)
          dark: '#1B2740', // subtle in-list separators (dark)
        },
        primary: {
          DEFAULT: '#3B6FE0', // brand blue — CTAs, active state, links
          fg: '#FFFFFF', // text/icons on a solid primary fill
        },
        // Vivid marketing blue + navy ink ramp, sampled from
        // design/splash-screen.png (and matching signin/dashboard renders).
        // The brand-expression surfaces — logo mark, wordmark, splash waves —
        // run hotter and cooler than the muted product `primary`/`content`
        // tokens. Kept as a separate namespace so restyling the splash never
        // silently restyles the rota grid. See design/.loop/splash-log.md.
        brand: {
          DEFAULT: '#0C60F8', // logo tile, "Flow", progress fill, feature icons
          deep: '#0A55DE', // deepest wave stop
          light: '#4C8CFB', // logo accent square, mid wave
          pale: '#87B4FA', // bottom-centre wave
          mist: '#C9DCFB', // palest blue wave
          wash: '#E5EAF4', // progress track, hairline rules
          // Pending-stage icon/ring tint on design/appboot.png — sampled
          // directly (not a `brand` opacity blend; alpha-over-white lands
          // much lighter than this). See design/.loop/appboot-log.md.
          faint: '#5275CA',
        },
        ink: {
          DEFAULT: '#0D1934', // wordmark "Rota", feature labels
          muted: '#3E4A6E', // splash subtitle
          soft: '#5A6684', // status pill, "Loading…" caption
        },
        secondary: {
          DEFAULT: '#6B7280', // secondary icons/labels (light)
          dark: '#94A3B8', // secondary icons/labels (dark)
        },
        // Status colours for rota states (used with text/icon, never colour
        // alone). Same hex in both themes — must stay recognisable regardless
        // of mode.
        success: { DEFAULT: '#1EA06B' }, // published / valid / confirmed / available
        // Attendance green — the Clock In CTA, its "ready" ring, and the
        // on-shift status washes in design/clockin.png. Sampled off that PNG:
        // it runs markedly deeper than `success` (#1EA06B), which reads too
        // mint next to a solid fill at this size. Kept as its own namespace so
        // restyling attendance never shifts every "published" chip in the rota.
        // See design/.loop/clockin-log.md.
        clock: {
          DEFAULT: '#068D41', // CTA fill + ready ring stroke
          tint: '#D6F4E1', // status badge wash (Starts in / Day Shift / Upcoming)
          fg: '#0A5522', // ink on `tint`
          wash: '#EDFAF2', // larger panel wash (Attendance "On Track")
        },
        warning: { DEFAULT: '#E0A030' }, // pending / needs attention / expiring
        danger: { DEFAULT: '#D94A3A' }, // conflict / rejected / absent / error
        info: { DEFAULT: '#388FD4' }, // informational / neutral status
        content: {
          DEFAULT: '#16191F', // headings, body (light)
          dark: '#F8FAFC', // headings, body (dark)
          muted: '#6B7280', // captions, hints (light)
          'muted-dark': '#94A3B8', // captions, hints (dark)
        },
        // Availability matrix cell washes (design/Availability.png). Four
        // states, each a pale fill + its own readable ink, following the same
        // `-fg` pairing `shift-tint` already uses. The fills are sampled off
        // the PNG rather than derived: they sit at different effective
        // opacities (the green wash is much lighter than the amber), so a
        // single `success/10`-style rule cannot reproduce the set.
        //
        // The INKS are deliberately NOT the sampled values. Measured against
        // their own wash, the reference's inks land at 4.11 / 3.53 / 4.17 : 1 —
        // under the 4.5:1 DESIGN.md §5 requires, on the densest text on the
        // screen. Each `-fg` is the sampled hue darkened just far enough to
        // clear 4.5 (now 4.67 / 4.67 / 4.61); at 12px the shift is not visible
        // side by side. `-fg-dark` are brightened for the dark washes, where
        // the light inks measured 2.6–3.9 : 1. See design/.loop/availability-log.md.
        avail: {
          free: '#F3FBF5',
          'free-fg': '#1C8056',
          'free-dark': '#0F2E20',
          'free-fg-dark': '#6EE7A8',
          partial: '#FEF8EC',
          'partial-fg': '#A55F1A',
          'partial-dark': '#332714',
          'partial-fg-dark': '#F5BE72',
          off: '#FEEFEF',
          'off-fg': '#CE302A',
          'off-dark': '#361B1B',
          'off-fg-dark': '#FCA5A5',
          pref: '#F3F7FE',
          'pref-fg': '#3055E8',
          'pref-dark': '#16224A',
          'pref-fg-dark': '#9DB8FD',
        },
        // Shift-type chip palette (8) — see docs/DESIGN.md §2. Same in both
        // themes; org shift_types.colour should be seeded from these.
        shift: {
          clay: '#E28273',
          amber: '#C69A45',
          moss: '#86AC6A',
          teal: '#4FB39A',
          sky: '#56AACD',
          indigo: '#6CA0EB',
          violet: '#C48FD6',
          rose: '#E888AB',
        },
        // Tinted counterpart to `shift` — the rota-grid chip in
        // design/Rota-Builder.png is a pale wash with saturated ink, NOT the
        // solid `shift` fill (that stays the Schedule screen's chip style).
        // A plain `/10` of the solid swatch lands too grey-olive to match, so
        // the three swatches the reference actually shows — moss (Morning),
        // violet (Evening), indigo (Night) — are sampled straight off the PNG.
        // The other five are interpolated to the same lightness/chroma so the
        // set stays coherent. See design/.loop/rota-log.md.
        'shift-tint': {
          clay: '#FDF3F1',
          'clay-fg': '#B0432F',
          amber: '#FDF7EC',
          'amber-fg': '#8A6320',
          moss: '#F1FBF5', // sampled
          'moss-fg': '#12714C', // sampled
          teal: '#EFFAF7',
          'teal-fg': '#10705E',
          sky: '#EFF7FC',
          'sky-fg': '#1A6B8E',
          indigo: '#F3F7FE', // sampled
          'indigo-fg': '#1B3FD4', // sampled
          violet: '#F8F5FE', // sampled
          'violet-fg': '#5535C4', // sampled
          rose: '#FDF3F7',
          'rose-fg': '#AE3A62',
        },
        // Dark-mode chip washes — the tints above are near-white and would
        // blow out on the dark canvas. Same hue, pulled down to sit just above
        // `surface-dark`.
        'shift-deep': {
          clay: '#3A211C',
          amber: '#352A14',
          moss: '#12301F',
          teal: '#0F2E28',
          sky: '#122A36',
          indigo: '#16224A',
          violet: '#2A1D45',
          rose: '#381B27',
        },
      },
      fontFamily: {
        // "Inter Variable" per docs/DESIGN.md — loaded as the full variable
        // weight range (100..900) from Google Fonts; the family name Google
        // serves it under is still "Inter".
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        // Custom type scale from docs/DESIGN.md §2 (size/line-height).
        'page-title': ['2rem', { lineHeight: '2.5rem' }], // 32/40
        'section-heading': ['1.5rem', { lineHeight: '2rem' }], // 24/32
        'card-heading': ['1rem', { lineHeight: '1.5rem' }], // 16/24
        // Splash/marketing lockup only — 120/120, tight tracking, measured off
        // design/splash-screen.png. Not part of the product type scale.
        wordmark: ['7.375rem', { lineHeight: '1', letterSpacing: '-0.026em' }],
      },
      spacing: {
        // 266px — the splash logo mark at its reference size; sits between
        // Tailwind's w-64 (256) and w-72 (288).
        66: '16.625rem',
      },
      letterSpacing: {
        // Splash subtitle caps — measured at 0.0625em on
        // design/splash-screen.png, between Tailwind's `wider` and `widest`.
        lockup: '0.0625em',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
      },
      boxShadow: {
        // Elevation levels from docs/DESIGN.md §2 — override the Tailwind
        // defaults so `shadow-sm` / `shadow` / `shadow-lg` match the reference.
        sm: '0 1px 2px rgba(0,0,0,0.05)', // level 1
        DEFAULT: '0 4px 12px rgba(0,0,0,0.08)', // level 2
        lg: '0 8px 24px rgba(0,0,0,0.12)', // level 3
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 300ms ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
