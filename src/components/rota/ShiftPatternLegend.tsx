import { cn } from '@/lib/utils';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import type { ShiftType } from '@/types';
import { formatTimeRange } from '@/lib/timeRange';

interface ShiftPatternLegendProps {
  shiftTypes: ShiftType[];
  /** The active shift-type filter, or 'all'. */
  activeId: string;
  /** Shifts of each type in the week currently on screen, keyed by shift-type id. */
  countsByType: Map<string, number>;
  onSelect: (shiftTypeId: string) => void;
}

/** '07:00:00' → '07:00'. Shift-type times come back from Postgres as `time`. */
function hhmm(value: string): string {
  return value.slice(0, 5);
}

/**
 * The pattern's default times, or `null` where the org has not set them.
 *
 * This used to print `--:--, --:--`. A placeholder in place of a time is worse
 * than no time: it reads as a value that failed to load rather than as a
 * pattern with no default, and the legend's job is the colour key and the
 * count either way. It also wrote the two times comma-separated, which reads
 * as two separate times rather than a span (`@/lib/timeRange`).
 */
function patternRange(type: {
  default_start: string | null;
  default_end: string | null;
}): string | null {
  if (!type.default_start || !type.default_end) return null;
  return formatTimeRange(hhmm(type.default_start), hhmm(type.default_end));
}

/**
 * The week's shift patterns as a colour key that is also a filter.
 *
 * A rota grid is read by colour long before it is read by text, but a colour
 * key that only *explains* leaves you scanning hundreds of chips by eye to
 * find "who is on nights". Making each swatch a filter turns the same strip
 * into the fastest way to isolate one pattern, and it puts the times on
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
          activeId === 'all'
            ? 'border-primary bg-primary/10 text-primary-ink dark:text-primary-ink-dark'
            : 'border-surface-border text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:text-content-dark',
        )}
      >
        {/* Inherits the button's own colour rather than a flat muted one:
            when active that's `text-primary-ink dark:text-primary-ink-dark` against `bg-primary/10`,
            and `text-content-muted` fails there at 4.26:1. */}
        All <span className="tabular-nums">({total})</span>
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
            title={[type.name, patternRange(type)].filter(Boolean).join(' · ')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'border-primary bg-primary/10 text-primary-ink dark:text-primary-ink-dark'
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
            {/* Inherits the button's own colour, same reasoning as the "All"
                count above — a flat muted colour fails when the button is
                active (`text-primary-ink dark:text-primary-ink-dark` on `bg-primary/10`), and opacity
                on top of an inherited colour is the exact bug this whole
                pass has been fixing elsewhere. */}
            {patternRange(type) && (
              <span className="font-mono text-[0.65rem] tabular-nums">
                {patternRange(type)}
              </span>
            )}
            <span className="tabular-nums">({count})</span>
          </button>
        );
      })}
    </div>
  );
}
