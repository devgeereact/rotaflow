import { useId, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { seriesColour } from '@/lib/chartPalette';
import { cn } from '@/lib/utils';

export interface BarSeries {
  /** Stable key. Colour follows this, never the position after filtering. */
  id: string;
  label: string;
}

export interface BarGroup {
  /** X-axis label, pre-formatted (e.g. "Mon 4"). */
  label: string;
  /** One value per series, in `series` order. */
  values: number[];
}

interface BarChartProps {
  series: BarSeries[];
  groups: BarGroup[];
  /** Appended to every value in the tooltip and the table, e.g. "h". */
  unit?: string;
  /** Names the single series when `series.length === 1` (no legend is drawn). */
  title: string;
  className?: string;
  /** Renders the accessible table instead of the plot. */
  tableOnly?: boolean;
}

const PLOT_H = 150;
const GAP = 2; // surface gap between adjacent bars, per the mark spec

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * A grouped bar chart.
 *
 * ## Why bars
 *
 * Every measure this is used for. Hours per day, requests per week, is a
 * *magnitude* read against a common baseline and compared between a handful of
 * named categories. That is the bar's job. A line would imply continuity
 * between days that are really discrete buckets.
 *
 * ## What makes it readable rather than decorative
 *
 * - **Anchored to zero.** A bar's length *is* the value; a truncated axis makes
 *   a 3% difference look like a doubling. There is no `min` prop for that
 *   reason.
 * - **One axis.** Never two y-scales, two measures of different magnitude go
 *   in two charts. (Dual axes are the single most common charting mistake.)
 * - **Thin marks, 4px rounded ends** at the top only, so the bar still reads as
 *   sitting *on* the baseline.
 * - **A 2px surface gap** between adjacent bars, so touching fills do not read
 *   as one shape.
 * - **Recessive grid**. Three hairlines behind the marks, never over them.
 * - **Text wears text tokens**, never the series colour; the swatch beside a
 *   label carries identity.
 *
 * ## Accessibility
 *
 * A legend is always drawn for two or more series, and never for one (the title
 * names it). Identity is therefore never colour-alone, which also discharges
 * the secondary-encoding requirement the palette's CVD band carries (see
 * `chartPalette.ts`). The same data is available as a real `<table>` behind a
 * disclosure, so a screen reader and a colourblind reader both have a path that
 * does not depend on the plot at all.
 */
export function BarChart({
  series,
  groups,
  unit = '',
  title,
  className,
  tableOnly = false,
}: BarChartProps): JSX.Element {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [hover, setHover] = useState<{ group: number; series: number } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const max = niceMax(Math.max(0, ...groups.flatMap((g) => g.values)));
  const groupWidth = 100 / Math.max(groups.length, 1);

  /*
   * Thin marks, centred in their slot.
   *
   * The first cut sized bars at the full group width minus a hair, which made
   * a single-series chart a row of slabs touching each other. The ink was the
   * chart rather than the data, and the rounded ends were invisible at that
   * width. The cluster is capped at 62% of the slot and centred, so there is
   * real space between groups and the bar reads as a mark on an axis.
   */
  const slotFill = 0.62;
  const barWidth = Math.min(
    (groupWidth * slotFill - GAP * (series.length - 1)) / Math.max(series.length, 1),
    9,
  );
  const clusterWidth = barWidth * series.length + GAP * (series.length - 1);
  const clusterOffset = (groupWidth - clusterWidth) / 2;

  const table = (
    <table className="w-full text-sm">
      <caption className="sr-only">{title}</caption>
      <thead>
        <tr className="border-b border-surface-border text-left dark:border-surface-border-dark">
          <th scope="col" className="py-1.5 pr-3 font-semibold">
            Period
          </th>
          {series.map((s) => (
            <th key={s.id} scope="col" className="py-1.5 pl-3 text-right font-semibold">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr
            key={group.label}
            className="border-b border-divider last:border-0 dark:border-divider-dark"
          >
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              {group.label}
            </th>
            {group.values.map((value, i) => (
              <td
                key={series[i]?.id ?? i}
                className="py-1.5 pl-3 text-right tabular-nums"
              >
                {value}
                {unit}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (tableOnly) return <div className={className}>{table}</div>;

  return (
    <div className={cn('min-w-0', className)}>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {series.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-1.5 text-xs text-content-muted dark:text-content-muted-dark"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: seriesColour(i, dark) }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}. The same figures are available as a table below.`}
          className="h-40 w-full"
        >
          {/* Recessive grid. Behind the marks, hairline, never labelled twice. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2="100"
              y1={PLOT_H * f}
              y2={PLOT_H * f}
              className="stroke-surface-border dark:stroke-surface-border-dark"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {groups.map((group, gi) =>
            group.values.map((value, si) => {
              const h = max === 0 ? 0 : (value / max) * (PLOT_H - 4);
              const x = gi * groupWidth + clusterOffset + si * (barWidth + GAP);
              const active = hover?.group === gi && hover.series === si;
              return (
                <rect
                  key={`${group.label}-${series[si]?.id ?? si}`}
                  x={x}
                  y={PLOT_H - h}
                  width={barWidth}
                  height={h}
                  rx="1.5"
                  fill={seriesColour(si, dark)}
                  opacity={hover && !active ? 0.45 : 1}
                  onMouseEnter={() => setHover({ group: gi, series: si })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            }),
          )}
        </svg>

        {hover && (
          <div
            role="status"
            className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs shadow-md dark:border-surface-border-dark dark:bg-surface-dark"
          >
            <span className="font-semibold text-content dark:text-content-dark">
              {groups[hover.group]?.label}
            </span>
            <span className="ml-2 text-content-muted dark:text-content-muted-dark">
              {series[hover.series]?.label}
            </span>
            <span className="ml-2 font-semibold tabular-nums text-content dark:text-content-dark">
              {groups[hover.group]?.values[hover.series]}
              {unit}
            </span>
          </div>
        )}
      </div>

      {/* One equal column per group, matching the SVG's `groupWidth` track, so
          a label sits under its own bar. `justify-between` drifted: it spreads
          labels edge-to-edge while the bars are centred in fixed slots, so the
          first and last were offset and everything between was slightly wrong. */}
      <ul
        className="mt-1.5 grid text-center text-[0.65rem] text-content-muted dark:text-content-muted-dark"
        style={{ gridTemplateColumns: `repeat(${Math.max(groups.length, 1)}, 1fr)` }}
      >
        {groups.map((group) => (
          <li key={group.label} className="truncate px-0.5">
            {group.label}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
        aria-controls={tableId}
        className="mt-2 text-xs font-medium text-primary hover:underline"
      >
        {showTable ? 'Hide figures' : 'Show figures'}
      </button>
      {showTable && (
        <div id={tableId} className="mt-2 overflow-x-auto">
          {table}
        </div>
      )}
    </div>
  );
}
