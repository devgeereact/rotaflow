import { CalendarDays, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterOption {
  id: string;
  name: string;
}

interface TimesheetFilterBarProps {
  /** Pre-formatted period, e.g. "26 May – 1 June 2025". */
  periodLabel: string;
  onPeriodClick: () => void;
  locations: FilterOption[];
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
  departments: FilterOption[];
  departmentId: string | null;
  onDepartmentChange: (id: string | null) => void;
  staff: FilterOption[];
  staffId: string | null;
  onStaffChange: (id: string | null) => void;
  status: string;
  onStatusChange: (status: string) => void;
  onFilters: () => void;
}

const CONTROL =
  'flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-[0.82rem] font-medium text-content transition-colors hover:bg-surface-subtle ' +
  'focus-within:ring-2 focus-within:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

const SELECT =
  'w-full appearance-none bg-transparent pr-4 text-[0.82rem] font-medium text-content outline-none dark:text-content-dark';

const STATUSES = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** The six scope controls between the tabs and the summary tiles. */
export function TimesheetFilterBar({
  periodLabel,
  onPeriodClick,
  locations,
  locationId,
  onLocationChange,
  departments,
  departmentId,
  onDepartmentChange,
  staff,
  staffId,
  onStaffChange,
  status,
  onStatusChange,
  onFilters,
}: TimesheetFilterBarProps): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.35fr_1fr_1.1fr_1fr_1fr_0.85fr]">
      <button type="button" onClick={onPeriodClick} className={cn(CONTROL, 'relative')}>
        <CalendarDays
          size={16}
          aria-hidden="true"
          className="text-content-muted dark:text-content-muted-dark"
        />
        <span className="truncate">{periodLabel}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="ml-auto shrink-0 text-content-muted dark:text-content-muted-dark"
        />
      </button>

      <div className={cn(CONTROL, 'relative')}>
        <select
          value={locationId ?? ''}
          onChange={(event) => onLocationChange(event.target.value || null)}
          aria-label="Filter by location"
          className={SELECT}
        >
          <option value="">All Locations</option>
          {locations.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <div className={cn(CONTROL, 'relative')}>
        <select
          value={departmentId ?? ''}
          onChange={(event) => onDepartmentChange(event.target.value || null)}
          aria-label="Filter by department"
          className={SELECT}
        >
          <option value="">All Departments</option>
          {departments.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <div className={cn(CONTROL, 'relative')}>
        <select
          value={staffId ?? ''}
          onChange={(event) => onStaffChange(event.target.value || null)}
          aria-label="Filter by staff"
          className={SELECT}
        >
          <option value="">All Staff</option>
          {staff.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <div className={cn(CONTROL, 'relative')}>
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          aria-label="Filter by status"
          className={SELECT}
        >
          {STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <button
        type="button"
        onClick={onFilters}
        className={cn(CONTROL, 'justify-center gap-2')}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        Filters
      </button>
    </div>
  );
}
