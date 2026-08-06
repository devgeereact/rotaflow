import { cn } from '@/lib/utils';

export interface MeterRow {
  label: string;
  value: number;
  /** Overrides the right-hand figure, e.g. "42%" or "£1,240". */
  display?: string;
  /** CSS colour for the fill. Defaults to the brand blue. */
  colour?: string;
}

interface MeterRowsProps {
  rows: readonly MeterRow[];
  /** Names the set for screen readers, e.g. "Organisations by plan". */
  caption: string;
  className?: string;
}

/**
 * A ranked breakdown: label, proportional bar, figure.
 *
 * The platform console uses this wherever a total splits into four or five
 * parts. Plans, organisation health, hours by department. A donut was the
 * obvious alternative and is worse here: these lists are read for *rank and
 * magnitude* ("which plan is biggest, by how much"), and arc lengths are the
 * hardest encoding to compare. `DonutChart` stays for the one-number-plus-
 * remainder case it already serves.
 *
 * Bars are scaled against the largest row rather than the sum, so a set where
 * one value dominates still shows the small ones as visible bars instead of
 * hairlines.
 */
export function MeterRows({ rows, caption, className }: MeterRowsProps): JSX.Element {
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <table className={cn('w-full border-collapse', className)}>
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th
              scope="row"
              className="w-[9.5rem] py-[7px] pr-2.5 text-left text-sm font-normal leading-snug text-content-muted dark:text-content-muted-dark"
            >
              {row.label}
            </th>
            <td className="py-[7px]">
              <span className="block h-2 overflow-hidden rounded-full border border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${((row.value / max) * 100).toFixed(1)}%`,
                    background: row.colour ?? '#3B6FE0',
                  }}
                />
              </span>
            </td>
            <td className="w-[68px] py-[7px] pl-2.5 text-right font-mono text-xs tabular-nums text-content dark:text-content-dark">
              {row.display ?? row.value.toLocaleString('en-GB')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
