import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export interface ScheduleLocationOption {
  id: string;
  name: string;
}

interface ScheduleToolbarProps {
  /** Pre-formatted period, e.g. "26 May-1 June 2025". */
  periodLabel: string;
  locations: ScheduleLocationOption[];
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onFilters: () => void;
  onExport: () => void;
  onPrint: () => void;
}

const CONTROL =
  'flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm font-medium text-content transition-colors hover:bg-surface-subtle ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

/**
 * Period navigation, location scope and the export controls above the grid
 * (design/published-schedule.png).
 */
export function ScheduleToolbar({
  periodLabel,
  locations,
  locationId,
  onLocationChange,
  onPrev,
  onNext,
  onToday,
  onFilters,
  onExport,
  onPrint,
}: ScheduleToolbarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous period"
        className={cn(CONTROL, 'w-10 justify-center px-0')}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next period"
        className={cn(CONTROL, 'w-10 justify-center px-0')}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <button type="button" onClick={onToday} className={cn(CONTROL, 'px-4')}>
        Today
      </button>

      <div className={cn(CONTROL, 'relative min-w-[13.5rem] justify-center pr-8')}>
        <span className="font-semibold">{periodLabel}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="absolute right-3 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <div className={cn(CONTROL, 'relative gap-2 py-0 pr-8')}>
        <select
          value={locationId ?? ''}
          onChange={(event) => onLocationChange(event.target.value || null)}
          aria-label="Filter by location"
          className="appearance-none bg-transparent pr-1 text-sm font-medium text-content outline-none dark:text-content-dark"
        >
          <option value="">All Locations</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button type="button" onClick={onFilters} className={cn(CONTROL, 'px-4')}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filters
        </button>
        <button type="button" onClick={onExport} className={cn(CONTROL, 'px-4')}>
          <Download size={16} aria-hidden="true" />
          Export
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
        </button>
        <Button onClick={onPrint} className="h-10 px-5 text-sm">
          <Printer size={16} aria-hidden="true" />
          Print / PDF
        </Button>
      </div>
    </div>
  );
}
