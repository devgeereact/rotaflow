import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TrendSeries {
  name: string;
  /** One value per label, same length and order as `labels`. */
  values: readonly number[];
  /** A colour token, e.g. `var(--chart-primary)` is not used. Pass a class-free CSS colour. */
  colour: string;
  /** Line only, no area fill. Use for secondary series so fills do not stack up. */
  lineOnly?: boolean;
}

interface TrendChartProps {
  series: readonly TrendSeries[];
  labels: readonly string[];
  /** Names the plot for screen readers and titles the accessible table. */
  title: string;
  /** Appended to every value in the table, e.g. " orgs". */
  unit?: string;
  height?: number;
  className?: string;
}

const PAD = { l: 8, r: 8, t: 12, b: 22 };
const VIEW_W = 720;

/**
 * Multi-series trend plot. The shape the platform console opens with.
 *
 * ## Why not `BarChart`
 *
 * `BarChart` answers "how do these categories compare"; this answers "which way
 * is it going", and a twelve-month series drawn as thirty-six grouped bars
 * makes the reader do the joining-up themselves. They are deliberately separate
 * components rather than a `variant` prop, because almost none of the internals
 * are shared: no grouping, no per-bar hit area, a continuous x axis.
 *
 * ## Accessibility
 *
 * A plot is not readable by a screen reader, and "chart of platform growth" is
 * not a substitute for the numbers. As in `BarChart`, the same data is always
 * available as a table behind a toggle rather than hidden in a `title`
 * attribute. The figures are the point, the line is the convenience.
 */
export function TrendChart({
  series,
  labels,
  title,
  unit = '',
  height = 190,
  className,
}: TrendChartProps): JSX.Element {
  const gradientId = useId();
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const paths = useMemo(() => {
    const all = series.flatMap((s) => [...s.values]);
    // A flat zero series would divide by zero; a max of 1 keeps the baseline
    // flat at the bottom rather than throwing.
    const max = Math.max(...all, 1) * 1.14;
    const innerW = VIEW_W - PAD.l - PAD.r;
    const innerH = height - PAD.t - PAD.b;
    const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
    const x = (i: number): number => PAD.l + i * stepX;
    const y = (v: number): number => PAD.t + innerH - (v / max) * innerH;

    return series.map((s, index) => {
      const line = s.values
        .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
        .join(' ');
      const lastIndex = s.values.length - 1;
      return {
        id: `${gradientId}-${index}`,
        line,
        area: `${line} L${x(lastIndex).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L${PAD.l} ${(PAD.t + innerH).toFixed(1)} Z`,
        endX: x(lastIndex),
        endY: y(s.values[lastIndex] ?? 0),
        series: s,
      };
    });
  }, [series, labels.length, height, gradientId]);

  const innerH = height - PAD.t - PAD.b;
  // Every label would collide below about seven columns' worth of width.
  const labelEvery = Math.max(1, Math.ceil(labels.length / 7));

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {series.map((s) => (
          <span
            key={s.name}
            className="inline-flex items-center gap-1.5 text-xs text-content-muted dark:text-content-muted-dark"
          >
            <span
              aria-hidden="true"
              className="block h-2.5 w-2.5 rounded-lg"
              style={{ background: s.colour }}
            />
            {s.name}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls={tableId}
          className="ml-auto text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {showTable ? 'Hide figures' : 'Show figures'}
        </button>
      </div>

      {showTable ? (
        <div id={tableId} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-surface-border dark:border-surface-border-dark">
                <th className="py-1.5 pr-3 text-left text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted dark:text-content-muted-dark">
                  Period
                </th>
                {series.map((s) => (
                  <th
                    key={s.name}
                    className="py-1.5 pl-3 text-right text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted dark:text-content-muted-dark"
                  >
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr
                  key={label}
                  className="border-b border-divider last:border-0 dark:border-divider-dark"
                >
                  <td className="py-1.5 pr-3 text-content dark:text-content-dark">
                    {label}
                  </td>
                  {series.map((s) => (
                    <td
                      key={s.name}
                      className="py-1.5 pl-3 text-right font-mono tabular-nums text-content dark:text-content-dark"
                    >
                      {(s.values[i] ?? 0).toLocaleString('en-GB')}
                      {unit}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={title}
          preserveAspectRatio="none"
          className="overflow-visible"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={PAD.l}
              x2={VIEW_W - PAD.r}
              y1={PAD.t + innerH * f}
              y2={PAD.t + innerH * f}
              className="stroke-divider dark:stroke-divider-dark"
              strokeWidth={1}
            />
          ))}
          {paths.map(({ id, line, area, endX, endY, series: s }) => (
            <g key={s.name}>
              {!s.lineOnly && (
                <>
                  <defs>
                    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={s.colour} stopOpacity="0.2" />
                      <stop offset="1" stopColor={s.colour} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={area} fill={`url(#${id})`} />
                </>
              )}
              <path
                d={line}
                fill="none"
                stroke={s.colour}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx={endX} cy={endY} r={3.2} fill={s.colour} />
            </g>
          ))}
          {labels.map((label, i) =>
            i % labelEvery === 0 || i === labels.length - 1 ? (
              <text
                key={label}
                x={
                  PAD.l +
                  (labels.length > 1
                    ? i * ((VIEW_W - PAD.l - PAD.r) / (labels.length - 1))
                    : 0)
                }
                y={height - 5}
                fontSize={10}
                textAnchor={
                  i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'
                }
                className="fill-content-muted font-mono dark:fill-content-muted-dark"
              >
                {label}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
}

interface SparklineProps {
  values: readonly number[];
  colour?: string;
  /** Described by the tile's own label, so this is decorative by default. */
  className?: string;
}

/**
 * The shape of a figure's recent history, inside a metric tile.
 *
 * `aria-hidden`: it carries no value the tile does not already state, and a
 * screen reader announcing "graphic" after every number is noise. Where the
 * trend itself is the information, use `TrendChart`.
 */
export function Sparkline({
  values,
  colour = '#3B6FE0',
  className,
}: SparklineProps): JSX.Element | null {
  const w = 110;
  const h = 26;
  const gradientId = useId();

  const { line, area, endX, endY } = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = values.length > 1 ? w / (values.length - 1) : 0;
    const points = values.map(
      (v, i) => [i * stepX, h - 2 - ((v - min) / span) * (h - 5)] as const,
    );
    const d = points
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    const [lastX = 0, lastY = 0] = points[points.length - 1] ?? [];
    return { line: d, area: `${d} L${w} ${h} L0 ${h} Z`, endX: lastX, endY: lastY };
  }, [values]);

  // A flat line says nothing and reads as a rendering fault. Two probes that
  // both returned "<1 ms" produced a dead horizontal rule beside the row.
  if (values.length < 2 || Math.max(...values) === Math.min(...values)) return null;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className={cn('mt-1', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity="0.22" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={colour}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={endX} cy={endY} r={2.4} fill={colour} />
    </svg>
  );
}
