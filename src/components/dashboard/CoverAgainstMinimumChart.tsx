import { useId, useState } from 'react';

export interface CoverDay {
  /** X-axis label, pre-formatted (e.g. "Sat 8"). */
  label: string;
  /** 'YYYY-MM-DD', used only as the React key and in the tooltip/table. */
  date: string;
  /** Summed staffing minimum across every site that has one set for this weekday. 0 = no site has a minimum set. */
  required: number;
  onShift: number;
}

interface CoverAgainstMinimumChartProps {
  days: CoverDay[];
}

const PLOT_H = 150;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * One bar per day: on-shift headcount against that day's summed staffing
 * minimum, with a dashed tick marking the minimum itself.
 *
 * ## Why a single coloured bar, not two series
 *
 * The question this answers is binary. Did today clear the bar, not "compare
 * these two numbers". Colour carries that directly (`primary` met it,
 * `danger` fell short), the same status-colour idiom `StatCard` already uses
 * for `Open Shifts`, rather than asking the reader to compare bar heights
 * across a legend. A day with no minimum set for any site (`required === 0`)
 * renders muted with no threshold tick: absence of a policy, not a minimum
 * of zero.
 */
export function CoverAgainstMinimumChart({
  days,
}: CoverAgainstMinimumChartProps): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const max = niceMax(Math.max(0, ...days.flatMap((d) => [d.required, d.onShift])));
  const slotWidth = 100 / Math.max(days.length, 1);
  const barWidth = Math.min(slotWidth * 0.5, 10);
  const barOffset = (slotWidth - barWidth) / 2;

  const table = (
    <table className="w-full text-sm">
      <caption className="sr-only">Cover against minimum, by day</caption>
      <thead>
        <tr className="border-b border-surface-border text-left dark:border-surface-border-dark">
          <th scope="col" className="py-1.5 pr-3 font-semibold">
            Day
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-semibold">
            On shift
          </th>
          <th scope="col" className="py-1.5 pl-3 text-right font-semibold">
            Minimum
          </th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr
            key={d.date}
            className="border-b border-divider last:border-0 dark:border-divider-dark"
          >
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              {d.label}
            </th>
            <td className="py-1.5 pl-3 text-right tabular-nums">{d.onShift}</td>
            <td className="py-1.5 pl-3 text-right tabular-nums">
              {d.required > 0 ? d.required : 'Not set'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-muted dark:text-content-muted-dark">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary"
          />
          Meets minimum
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-sm bg-danger"
          />
          Below minimum
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0 w-3 shrink-0 border-t-2 border-dashed border-warning"
          />
          Minimum set
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Cover against minimum, by day. The same figures are available as a table below."
          className="h-40 w-full"
        >
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

          {days.map((d, i) => {
            const h = max === 0 ? 0 : (d.onShift / max) * (PLOT_H - 4);
            const x = i * slotWidth + barOffset;
            const short = d.required > 0 && d.onShift < d.required;
            const active = hover === i;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={PLOT_H - h}
                  width={barWidth}
                  height={h}
                  rx="1.5"
                  className={
                    d.required === 0
                      ? 'fill-surface-border dark:fill-surface-border-dark'
                      : short
                        ? 'fill-danger'
                        : 'fill-primary'
                  }
                  opacity={hover !== null && !active ? 0.45 : 1}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {d.required > 0 && (
                  <line
                    x1={x - 1}
                    x2={x + barWidth + 1}
                    y1={PLOT_H - (d.required / max) * (PLOT_H - 4)}
                    y2={PLOT_H - (d.required / max) * (PLOT_H - 4)}
                    className="stroke-warning"
                    strokeWidth="1.5"
                    strokeDasharray="2.5 2"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          })}
        </svg>

        {hover !== null && days[hover] && (
          <div
            role="status"
            className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs shadow-md dark:border-surface-border-dark dark:bg-surface-dark"
          >
            <span className="font-semibold text-content dark:text-content-dark">
              {days[hover].label}
            </span>
            <span className="ml-2 font-semibold tabular-nums text-content dark:text-content-dark">
              {days[hover].onShift} on shift
            </span>
            {days[hover].required > 0 && (
              <span className="ml-2 text-content-muted dark:text-content-muted-dark">
                of {days[hover].required} minimum
              </span>
            )}
          </div>
        )}
      </div>

      <ul
        className="mt-1.5 grid text-center text-[0.65rem] text-content-muted dark:text-content-muted-dark"
        style={{ gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, 1fr)` }}
      >
        {days.map((d) => (
          <li key={d.date} className="truncate px-0.5">
            {d.label}
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
