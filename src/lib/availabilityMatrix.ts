/**
 * Shapes and helpers for the team availability matrix
 * (design/Availability.png). Kept in `lib` so the live page and the design
 * preview compute identical rows, `pages → services → lib`, per RULES.md §1.
 */

/**
 * A matrix cell's state. `partial` and `preference` both read "Preference" in
 * the reference but are tinted differently: `partial` is someone available for
 * only part of the day, `preference` is someone who has expressed a preferred
 * window without committing. Keeping them distinct is what lets the legend's
 * "Partially Available" and "Preference Only" counts differ.
 */
export type AvailabilityState =
  'available' | 'partial' | 'unavailable' | 'preference' | 'pending';

export interface AvailabilityCellData {
  state: AvailabilityState;
  /** Omitted for `unavailable`, which shows only its label in the reference. */
  timeRange?: string;
}

export interface AvailabilityRowData {
  id: string;
  firstName: string;
  lastName: string;
  /** Payroll reference under the name, e.g. "RN12345". */
  payrollId: string;
  role: string;
  /** Short role code shown as a pill, e.g. "RN" / "CA". */
  roleCode: string;
  photoUrl?: string | null;
  /** Exactly one entry per column in `days`. */
  cells: AvailabilityCellData[];
}

export interface AvailabilityDay {
  /** Column heading, e.g. "Mon 26 May". */
  label: string;
  /** Weekend columns are tinted red in the reference. */
  weekend: boolean;
  /** Staff available that day. */
  covered: number;
  /** Staff in scope that day. */
  total: number;
}

export const STATE_LABEL: Record<AvailabilityState, string> = {
  available: 'Available',
  partial: 'Preference',
  unavailable: 'Unavailable',
  preference: 'Preference',
  pending: 'Pending',
};

/** Cell fill + ink per state, light and dark. */
export const STATE_CELL: Record<AvailabilityState, string> = {
  available:
    'bg-avail-free text-avail-free-fg dark:bg-avail-free-dark dark:text-avail-free-fg-dark',
  partial:
    'bg-avail-partial text-avail-partial-fg dark:bg-avail-partial-dark dark:text-avail-partial-fg-dark',
  unavailable:
    'bg-avail-off text-avail-off-fg dark:bg-avail-off-dark dark:text-avail-off-fg-dark',
  preference:
    'bg-avail-pref text-avail-pref-fg dark:bg-avail-pref-dark dark:text-avail-pref-fg-dark',
  pending:
    'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

/** Legend / donut swatch per state. */
export const STATE_DOT: Record<AvailabilityState, string> = {
  available: 'bg-success',
  partial: 'bg-warning',
  unavailable: 'bg-danger',
  preference: 'bg-primary',
  pending: 'bg-secondary dark:bg-secondary-dark',
};

/** Donut stroke per state. SVG needs a stroke colour, not a fill class. */
export const STATE_STROKE: Record<AvailabilityState, string> = {
  available: 'stroke-success',
  partial: 'stroke-warning',
  unavailable: 'stroke-danger',
  preference: 'stroke-primary',
  pending: 'stroke-secondary dark:stroke-secondary-dark',
};

export interface AvailabilityBreakdown {
  state: AvailabilityState;
  label: string;
  percent: number;
  count: number;
}

/**
 * Coverage ratio as a percentage, guarding the divide-by-zero a day with no
 * staff in scope would otherwise produce.
 */
export function coveragePercent(day: AvailabilityDay): number {
  return day.total === 0 ? 0 : Math.round((day.covered / day.total) * 100);
}
