import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface AvailabilityToolbarProps {
  periodLabel: string;
  locationLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPeriodClick: () => void;
  onLocationClick: () => void;
  onFilters: () => void;
  onExport: () => void;
  onAdd: () => void;
}

const CONTROL =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface px-3.5 text-sm font-medium text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

const ICON_CONTROL =
  'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

/** Period stepper, scope pickers and the row's actions. */
export function AvailabilityToolbar({
  periodLabel,
  locationLabel,
  onPrev,
  onNext,
  onToday,
  onPeriodClick,
  onLocationClick,
  onFilters,
  onExport,
  onAdd,
}: AvailabilityToolbarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous week"
        className={ICON_CONTROL}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next week"
        className={ICON_CONTROL}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <button type="button" onClick={onToday} className={CONTROL}>
        Today
      </button>
      <button type="button" onClick={onPeriodClick} className={CONTROL}>
        {periodLabel}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="text-content-muted dark:text-content-muted-dark"
        />
      </button>
      <button type="button" onClick={onLocationClick} className={CONTROL}>
        {locationLabel}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="text-content-muted dark:text-content-muted-dark"
        />
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button type="button" onClick={onFilters} className={CONTROL}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filters
        </button>
        <button type="button" onClick={onExport} className={CONTROL}>
          <Download size={16} aria-hidden="true" />
          Export
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
        </button>
        <Button onClick={onAdd} className="h-10 px-4 text-sm">
          <Plus size={16} aria-hidden="true" />
          Add Availability
        </Button>
      </div>
    </div>
  );
}
