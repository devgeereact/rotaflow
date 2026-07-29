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
        warning: { DEFAULT: '#E0A030' }, // pending / needs attention / expiring
        danger: { DEFAULT: '#D94A3A' }, // conflict / rejected / absent / error
        info: { DEFAULT: '#388FD4' }, // informational / neutral status
        content: {
          DEFAULT: '#16191F', // headings, body (light)
          dark: '#F8FAFC', // headings, body (dark)
          muted: '#6B7280', // captions, hints (light)
          'muted-dark': '#94A3B8', // captions, hints (dark)
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
