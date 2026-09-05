import type { Config } from 'tailwindcss';

// Design tokens mirror docs/DESIGN.md — the canonical reference is
// docs/design/designsystem.png. Keep class names NativeWind-compatible (no
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
          // Navigation rail. Light is `subtle`; dark deliberately is not —
          // `subtle-dark` (#15203A) is a *raised* panel and reads as a card
          // floating over the canvas, where a rail should sit behind it. This
          // value falls between `background-dark` and `surface-dark` so the
          // rail recedes and the content column comes forward. Named
          // separately so restyling the rail never restyles every nested
          // panel. From docs/PLATFORM_CONSOLE.html.
          rail: '#FAFBFC',
          'rail-dark': '#0E1729',
        },
        divider: {
          DEFAULT: '#F2F4F6', // subtle in-list separators (light)
          dark: '#1B2740', // subtle in-list separators (dark)
        },
        primary: {
          DEFAULT: '#3B6FE0', // brand blue — CTAs, active state, links
          fg: '#FFFFFF', // text/icons on a solid primary fill
          // Opaque hover/selected fill, for the same reason the status washes
          // are opaque: `primary/10` over a card and over the canvas are two
          // different colours, so a hovered row changed shade depending on
          // what it sat on. From docs/PLATFORM_CONSOLE.html.
          wash: '#EEF3FD',
          'wash-dark': '#182848',
          // `DEFAULT` set as body text on `surface`/`background`/`surface-subtle`
          // reads at 4.08-4.46:1 — under the 4.5:1 AA minimum, confirmed by axe
          // across every `text-primary` link on the public site 2026-08-13. Too
          // close to see with the eye, real under a contrast meter. `DEFAULT`
          // stays unchanged (it is correct as a *fill*, paired with `fg`, and is
          // read elsewhere in the app this session did not touch — changing it
          // would ripple into screens this session never rendered to check).
          // This is additive: a slightly darker value for exactly the
          // link/body-text case, same hue. Not yet applied outside the public
          // marketing/legal/about pages fixed this session; the same
          // `text-primary`-as-link pattern likely exists in authenticated `/app`
          // screens too and needs the same swap as part of the sitewide
          // design-system contrast pass (`docs/SAAS.md`).
          ink: '#2F5BC0',
          // The dark-side counterpart, and the reason it has to exist
          // (docs/SAAS.md GAP-032). `ink` solves "this colour is too light
          // against white". Dark mode has the mirror problem — the same
          // `DEFAULT` is too DARK against a #111A2E surface, at 3.74:1 — and
          // for a while the app answered it with `dark:text-primary`, which
          // does not clear the line either. Worse, an `ink` class with no
          // `dark:` pairing carried #2F5BC0 straight into dark mode at 2.5:1.
          //
          // Derived by mixing `DEFAULT` toward white until the value clears
          // 5:1 against EVERY dark surface in the system — canvas #0B1220,
          // surface #111A2E, subtle, divider, and each `wash-dark` — not just
          // the common one. The washes are the constraint: #182848 is the
          // lightest ground any of this text sits on, and a value tuned to the
          // canvas alone fails there.
          //
          // The pattern is `text-{tone}-ink dark:text-{tone}-ink-dark`, used
          // uniformly. `warning` needs no lightening at all (its `DEFAULT` is
          // already 6.44:1 on the darkest ground) but still gets the token, so
          // the rule has no exception for somebody to apply wrongly.
          'ink-dark': '#769AE9',
        },
        // Vivid marketing blue + navy ink ramp, sampled from
        // docs/design/splash-screen.png (and matching signin/dashboard renders).
        // The brand-expression surfaces — logo mark, wordmark, splash waves —
        // run hotter and cooler than the muted product `primary`/`content`
        // tokens. Kept as a separate namespace so restyling the splash never
        // silently restyles the rota grid. See docs/design/.loop/splash-log.md.
        brand: {
          DEFAULT: '#0C60F8', // logo tile, "Flow", progress fill, feature icons
          deep: '#0A55DE', // deepest wave stop
          light: '#4C8CFB', // logo accent square, mid wave
          pale: '#87B4FA', // bottom-centre wave
          mist: '#C9DCFB', // palest blue wave
          wash: '#E5EAF4', // progress track, hairline rules
          // Pending-stage icon/ring tint on docs/design/appboot.png — sampled
          // directly (not a `brand` opacity blend; alpha-over-white lands
          // much lighter than this). See docs/design/.loop/appboot-log.md.
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
        //
        // Each carries a `wash` / `wash-dark` pair: the surface a status pill,
        // callout or feed icon sits on. These are NOT `success/10` and cannot
        // be — an alpha of the solid hue over `background` and the same alpha
        // over `surface` land on two different colours, so a pill drifted every
        // time it moved between a card and the canvas. The washes are opaque,
        // so a pill reads identically wherever it is placed, and the dark pair
        // is a separate value rather than an inversion (a light wash on
        // `surface-dark` blows out). Sampled from the platform console
        // reference, docs/PLATFORM_CONSOLE.html.
        success: {
          DEFAULT: '#1EA06B', // published / valid / confirmed / available
          wash: '#E7F5EE',
          'wash-dark': '#102A21',
          // See `primary.ink` — same gap, same fix. `DEFAULT` as small caption
          // text on white reads 3.33:1, under the 4.5:1 AA minimum.
          ink: '#12724E',
          'ink-dark': '#35AA7A',
        },
        // Attendance green — the Clock In CTA, its "ready" ring, and the
        // on-shift status washes in docs/design/clockin.png. Sampled off that PNG:
        // it runs markedly deeper than `success` (#1EA06B), which reads too
        // mint next to a solid fill at this size. Kept as its own namespace so
        // restyling attendance never shifts every "published" chip in the rota.
        // See docs/design/.loop/clockin-log.md.
        clock: {
          // #068D41 in the reference. White on it is 4.29 : 1, which fails AA
          // for the button label it exists to carry — the one control on the
          // clock-in screen. Darkened the minimum that clears the line with
          // margin (4.86 : 1); at this delta the fill is indistinguishable
          // from the reference beside it, and the alternative was a signature
          // control that fails the gate. Same reasoning as the `ink` tokens.
          DEFAULT: '#05833C', // CTA fill + ready ring stroke
          tint: '#D6F4E1', // status badge wash (Starts in / Day Shift / Upcoming)
          fg: '#0A5522', // ink on `tint`
          wash: '#EDFAF2', // larger panel wash (Attendance "On Track")
        },
        warning: {
          DEFAULT: '#E0A030', // pending / needs attention / expiring
          wash: '#FBF2E1',
          'wash-dark': '#2C2416',
          // See `primary.ink` — same gap, same fix. `DEFAULT` as small caption
          // text on white reads 2.27:1, the worst of the three status inks
          // against the 4.5:1 AA minimum.
          ink: '#7A5410',
          // Unchanged from `DEFAULT`: amber is already 6.44:1 on the
          // darkest ground here. The token exists so the rule stays uniform.
          'ink-dark': '#E0A030',
        },
        danger: {
          DEFAULT: '#D94A3A', // conflict / rejected / absent / error
          wash: '#FAEAE7',
          'wash-dark': '#2E1A17',
          // See `primary.ink` — same gap, same fix. `DEFAULT` as small caption
          // text on white reads 4.2:1, under the 4.5:1 AA minimum.
          ink: '#B23A2C',
          'ink-dark': '#E48075',
        },
        info: {
          DEFAULT: '#388FD4', // informational / neutral status
          wash: '#E8F2FA',
          'wash-dark': '#12253A',
          // The one status family that had no `ink`, which only showed up when
          // a `Badge tone="info"` finally landed on a public page where the
          // axe gate runs. `DEFAULT` on `wash` is 3.06:1; this is 6.09:1.
          ink: '#1B5E8E',
          'ink-dark': '#56A0DA',
        },
        content: {
          DEFAULT: '#16191F', // headings, body (light)
          dark: '#F8FAFC', // headings, body (dark)
          muted: '#6B7280', // captions, hints (light)
          'muted-dark': '#94A3B8', // captions, hints (dark)
        },
        // Availability matrix cell washes (docs/design/Availability.png). Four
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
        // the light inks measured 2.6–3.9 : 1. See docs/design/.loop/availability-log.md.
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
        // docs/design/Rota-Builder.png is a pale wash with saturated ink, NOT the
        // solid `shift` fill (that stays the Schedule screen's chip style).
        // A plain `/10` of the solid swatch lands too grey-olive to match, so
        // the three swatches the reference actually shows — moss (Morning),
        // violet (Evening), indigo (Night) — are sampled straight off the PNG.
        // The other five are interpolated to the same lightness/chroma so the
        // set stays coherent. See docs/design/.loop/rota-log.md.
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
        // Leave-type palette — the chips, balance meters, icon tiles and donut
        // arcs on docs/design/Leave.png. Sampled off that PNG.
        //
        // Deliberately NOT `shift-tint`: that palette is the rota grid's, and
        // `shift_types.colour` is per-org configurable, so a tenant recolouring
        // its Night shift must not recolour Sick Leave. Leave types are a fixed,
        // product-level set. The washes land within a couple of points of the
        // `shift-tint` family so the two read as one system; the inks are the
        // reference's, which run brighter — Carer's especially (a true orange,
        // where `shift-tint.amber-fg` is a brown-gold that reads as "expiring").
        //
        // `-deep` is the dark-mode wash: the light washes are near-white and
        // would blow out on `background-dark`.
        leave: {
          annual: '#7C3AED',
          'annual-wash': '#F5F1FE',
          'annual-deep': '#2A1D45',
          sick: '#12874C',
          'sick-wash': '#ECF8F1',
          'sick-deep': '#12301F',
          personal: '#2563EB',
          'personal-wash': '#F1F6FE',
          'personal-deep': '#16224A',
          carer: '#F97316',
          'carer-wash': '#FEF8EE',
          'carer-deep': '#352A14',
          other: '#8A93A8',
          'other-wash': '#F1F4FB',
          'other-deep': '#1B2740',
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
        // "Inter Variable" per docs/DESIGN.md — the full variable weight range
        // (100..900). Self-hosted from /fonts since 2026-09-03 (see
        // public/fonts/README.md); the family name is still "Inter", which is
        // what Google served it under too, so nothing here changed with the
        // move.
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        // Custom type scale from docs/DESIGN.md §2 (size/line-height).
        'page-title': ['2rem', { lineHeight: '2.5rem' }], // 32/40
        // The same role at phone width. 32/40 is a desktop measure: on a
        // 390px canvas a two-word title plus a pair of action buttons cannot
        // share a line, and the title block is what loses, so "Team" rendered
        // as "Tea". Shrinking the type is not the fix for the overflow (the
        // header stacks below `sm` for that), but 32px is oversized for the
        // column it now owns. 24/32 is the same semibold weight and the same
        // tracking, one step down the existing scale.
        //
        // Applied as `text-page-title-mobile sm:text-page-title` by the two
        // header components, never by a page.
        'page-title-mobile': ['1.5rem', { lineHeight: '2rem' }], // 24/32
        'section-heading': ['1.5rem', { lineHeight: '2rem' }], // 24/32
        'card-heading': ['1rem', { lineHeight: '1.5rem' }], // 16/24
        // Splash/marketing lockup only — 120/120, tight tracking, measured off
        // docs/design/splash-screen.png. Not part of the product type scale.
        wordmark: ['7.375rem', { lineHeight: '1', letterSpacing: '-0.026em' }],
      },
      transitionDuration: {
        // Centralised motion durations (docs/DESIGN.md §4). Before these, a
        // duration was a number typed at the call site — `duration-150` on
        // Button, `duration-200` on a menu, nothing at all on a dialog — so
        // "how fast does this product move" had no answer and no way to
        // change.
        //
        // Four values, named for what they are attached to rather than for
        // their length, so a new control picks the role and inherits the
        // number:
        press: '100ms', // a button's own press/hover transform
        control: '140ms', // hover/focus colour on any control, row or link
        overlay: '180ms', // a menu, popover, dropdown or dialog appearing
        entrance: '300ms', // the existing `animate-fade-up` page entrance
      },
      spacing: {
        // 266px — the splash logo mark at its reference size; sits between
        // Tailwind's w-64 (256) and w-72 (288).
        66: '16.625rem',
        // 272px — the announcements search field measures exactly between
        // Tailwind's w-64 (256) and w-72 (288) in
        // docs/design/Announcements-Dashboard.png. See docs/design/.loop/announcements-log.md.
        68: '17rem',
      },
      letterSpacing: {
        // Splash subtitle caps — measured at 0.0625em on
        // docs/design/splash-screen.png, between Tailwind's `wider` and `widest`.
        lockup: '0.0625em',
      },
      borderRadius: {
        // One radius for the whole product: 0.5rem (8px), everywhere
        // (owner's decision, 2026-08-05 — first sections only, then all of it).
        //
        // Every named size resolves to the same value, so `rounded-sm`,
        // `rounded-lg` and `rounded-2xl` are interchangeable and no screen can
        // drift by picking a different one. Prefer `rounded-lg` in new code;
        // the others are kept as aliases so the ~350 existing usages did not
        // all have to be rewritten to say the same thing.
        //
        // `rounded-full` is deliberately NOT redefined. It is a *shape*, not a
        // radius — avatars, status dots and pills are round because they are
        // round, and flattening them to 8px would turn every avatar into a
        // square and every status dot into a tile.
        sm: '0.5rem',
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.5rem',
        xl: '0.5rem',
        '2xl': '0.5rem',
        '3xl': '0.5rem',
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
