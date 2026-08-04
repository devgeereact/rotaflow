import { cn } from '@/lib/utils';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import type { ShiftType } from '@/types';

interface ShiftPatternLegendProps {
  shiftTypes: ShiftType[];
  /** The active shift-type filter, or 'all'. */
  activeId: string;
  /** Shifts of each type in the week currently on screen, keyed by shift-type id. */
  countsByType: Map<string, number>;
  onSelect: (shiftTypeId: string) => void;
}

/** '07:00:00' → '07:00'. Shift-type times come back from Postgres as `time`. */
function hhmm(value: string | null): string {
  return value ? value.slice(0, 5) : '--:--';
}

/**
 * The week's shift patterns as a colour key that is also a filter.
 *
 * A rota grid is read by colour long before it is read by text, but a colour
 * key that only *explains* leaves you scanning hundreds of chips by eye to
 * find "who is on nights". Making each swatch a filter turns the same strip
 * into the fastest way to isolate one pattern — and it puts the times on
 * screen, so "the 21:45" is findable without opening a single chip.
 *
 * Counts come from the shifts actually on screen, so a pattern nobody is
 * working this week reads as 0 rather than silently looking available.
 */
export function ShiftPatternLegend({
  shiftTypes,
  activeId,
  countsByType,
  onSelect,
}: ShiftPatternLegendProps): JSX.Element | null {
  if (shiftTypes.length === 0) return null;

  const total = [...countsByType.values()].reduce((sum, n) => sum + n, 0);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold text-content-muted dark:text-content-muted-dark">
        Shift patterns
      </span>

      <button
        type="button"
        onClick={() => onSelect('all')}
        aria-pressed={activeId === 'all'}
        className={cn(
          'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          activeId === 'all'
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-surface-border text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:text-content-dark',
        )}
      >
        All <span className="tabular-nums opacity-70">({total})</span>
      </button>

      {shiftTypes.map((type) => {
        const active = activeId === type.id;
        const count = countsByType.get(type.id) ?? 0;
        return (
          <button
            key={type.id}
            type="button"
            onClick={() => onSelect(active ? 'all' : type.id)}
            aria-pressed={active}
            title={`${type.name} · ${hhmm(type.default_start)}–${hhmm(type.default_end)}`}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : count === 0
                  ? 'border-surface-border text-content-muted/60 dark:border-surface-border-dark dark:text-content-muted-dark/60'
                  : 'border-surface-border text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                paletteTokenForColour(type.colour),
              )}
            />
            {type.name}
            <span className="font-mono text-[0.65rem] opacity-70">
              {hhmm(type.default_start)}–{hhmm(type.default_end)}
            </span>
            <span className="tabular-nums opacity-60">({count})</span>
          </button>
        );
      })}
    </div>
  );
}
