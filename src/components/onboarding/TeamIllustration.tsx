/**
 * The "team collaborating" illustration for the invite-team step
 * (design/Team-onboarding.png) — three simplified flat figures at a table,
 * replacing that step's marketing panel `BuildingIllustration`.
 *
 * Deliberately flat/geometric (circles, rounded rectangles), not the
 * reference's detailed illustrated-photo style: every other illustration in
 * this app (`BrandMark`, `BuildingIllustration`, the wave backgrounds) is
 * flat vector shapes, and matching the reference's more realistic figure
 * style would be a one-off inconsistent with that system.
 */
export function TeamIllustration(): JSX.Element {
  return (
    <svg
      viewBox="0 0 460 240"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-auto w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* Clouds */}
      <g className="fill-surface" opacity="0.8">
        <ellipse cx="80" cy="36" rx="24" ry="13" />
        <ellipse cx="390" cy="50" rx="20" ry="11" />
      </g>

      {/* Table */}
      <rect x="90" y="176" width="270" height="10" rx="3" className="fill-surface" />
      <rect
        x="110"
        y="186"
        width="10"
        height="40"
        className="fill-surface"
        opacity="0.7"
      />
      <rect
        x="330"
        y="186"
        width="10"
        height="40"
        className="fill-surface"
        opacity="0.7"
      />

      {/* Laptop */}
      <g>
        <rect x="150" y="152" width="56" height="34" rx="3" className="fill-surface" />
        <rect x="154" y="156" width="48" height="24" className="fill-brand-mist" />
        <rect x="142" y="184" width="72" height="6" rx="2" className="fill-surface" />
      </g>

      {/* Plant */}
      <g>
        <rect
          x="378"
          y="166"
          width="20"
          height="20"
          rx="3"
          className="fill-brand-light"
        />
        <circle cx="388" cy="152" r="14" className="fill-brand-pale" />
      </g>

      {/* Person 1 — left */}
      <g>
        <rect x="72" y="140" width="46" height="52" rx="14" className="fill-brand" />
        <circle cx="95" cy="118" r="20" className="fill-brand-light" />
      </g>
      {/* Person 2 — centre, taller */}
      <g>
        <rect
          x="204"
          y="118"
          width="52"
          height="70"
          rx="16"
          className="fill-brand-deep"
        />
        <circle cx="230" cy="94" r="22" className="fill-brand-mist" />
      </g>
      {/* Person 3 — right */}
      <g>
        <rect
          x="296"
          y="142"
          width="46"
          height="50"
          rx="14"
          className="fill-brand-light"
        />
        <circle cx="319" cy="120" r="19" className="fill-brand-pale" />
      </g>
    </svg>
  );
}
