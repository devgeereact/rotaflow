import type { Config } from 'tailwindcss';

// Design tokens mirror docs/DESIGN.md. Keep class names NativeWind-compatible
// (no arbitrary web-only selectors) so the tree can be ported to Expo later.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // RotaFlow — clean & professional, blue accent.
        // Single-value tokens are the DARK canvas; light mode is expressed with
        // Tailwind `dark:` variants in components, driven by ThemeContext
        // (which follows the device `prefers-color-scheme` by default).
        background: '#0b1220', // slate-950-ish app canvas (dark)
        surface: {
          DEFAULT: '#111a2e', // cards, sheets (dark)
          border: '#22304d', // dividers, card outlines (dark)
        },
        primary: {
          DEFAULT: '#2563eb', // blue-600 — CTAs, active state, brand
          fg: '#eff6ff', // blue-50 — text on primary
        },
        secondary: {
          DEFAULT: '#3b82f6', // blue-500 — dark-mode accent, links, secondary CTA
        },
        // Status colours for rota states (used with text/icon, never colour alone)
        success: { DEFAULT: '#16a34a' }, // confirmed / available
        warning: { DEFAULT: '#d97706' }, // pending / needs attention
        danger: { DEFAULT: '#dc2626' }, // conflict / rejected / absent
        content: {
          DEFAULT: '#f8fafc', // slate-50 — headings, body (on dark)
          muted: '#94a3b8', // slate-400 — captions, hints
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
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
