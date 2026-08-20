/**
 * The office-building illustration anchoring the onboarding marketing panel
 * (docs/design/Organisation-Onboarding.png, Organisation-about.png,
 * Onboarding-Complete.png). Identical across all three reference screens, so
 * built once and reused. Sits above `SplashWaves` in the left panel, behind
 * the feature list.
 */
export function BuildingIllustration(): JSX.Element {
  return (
    <svg
      viewBox="0 0 460 240"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-auto w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* Clouds */}
      <g className="fill-surface" opacity="0.8">
        <ellipse cx="70" cy="40" rx="26" ry="14" />
        <ellipse cx="95" cy="34" rx="20" ry="12" />
        <ellipse cx="400" cy="55" rx="22" ry="12" />
      </g>

      {/* Trees */}
      <g>
        <rect
          x="126"
          y="150"
          width="6"
          height="30"
          className="fill-ink-muted"
          opacity="0.4"
        />
        <circle cx="129" cy="140" r="20" className="fill-brand-mist" />
        <rect
          x="358"
          y="160"
          width="5"
          height="24"
          className="fill-ink-muted"
          opacity="0.4"
        />
        <circle cx="360" cy="152" r="15" className="fill-brand-pale" />
      </g>
      <g className="fill-brand-light">
        <ellipse cx="180" cy="182" rx="12" ry="16" />
        <ellipse cx="200" cy="186" rx="10" ry="13" />
        <ellipse cx="300" cy="184" rx="11" ry="15" />
        <ellipse cx="320" cy="187" rx="9" ry="12" />
      </g>

      {/* Secondary building (right) */}
      <g>
        <rect x="290" y="120" width="90" height="70" className="fill-surface" />
        <path d="M285 120 L335 92 L385 120Z" className="fill-brand" />
        <rect x="310" y="140" width="14" height="18" className="fill-brand-mist" />
        <rect x="336" y="140" width="14" height="18" className="fill-brand-mist" />
        <rect x="310" y="164" width="14" height="18" className="fill-brand-mist" />
        <rect x="336" y="164" width="14" height="18" className="fill-brand-mist" />
      </g>

      {/* Main building */}
      <g>
        <rect x="150" y="70" width="140" height="120" className="fill-surface" />
        <path d="M145 70 L220 40 L295 70Z" className="fill-brand" />
        {/* Signpost + R mark */}
        <rect
          x="217"
          y="14"
          width="6"
          height="26"
          className="fill-ink-muted"
          opacity="0.5"
        />
        <rect x="204" y="4" width="32" height="24" rx="7" className="fill-brand" />
        <path
          d="M213 10h9a4 4 0 0 1 1.2 7.8L227 20h-4l-3-2h-3v2h-3Zm3 2.4v3.2h5.6a1.6 1.6 0 0 0 0-3.2Z"
          className="fill-primary-fg"
        />
        {/* Window grid */}
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={166 + col * 26}
              y={84 + row * 24}
              width={16}
              height={16}
              className="fill-brand-mist"
            />
          )),
        )}
        {/* Door */}
        <rect
          x="204"
          y="160"
          width="32"
          height="30"
          rx="2"
          className="fill-ink"
          opacity="0.75"
        />
      </g>
    </svg>
  );
}
