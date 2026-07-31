import type { TimesheetStatus } from '@/lib/timesheetRows';

/**
 * Token classes per timesheet status, written out in full so Tailwind's content
 * scan can see every one (a concatenated class name is purged).
 *
 * These are the reserved *status* colours, never reused as chart series
 * colours, and every place they appear is paired with the status spelled out in
 * words (docs/DESIGN.md §5).
 */

export const STATUS_LABEL: Record<TimesheetStatus, string> = {
  pending: 'Pending Approval',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Pill fill + ink. */
export const STATUS_TONE: Record<TimesheetStatus, string> = {
  pending: 'bg-warning/10 text-warning',
  submitted: 'bg-primary/10 text-primary',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  cancelled:
    'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

/** Legend dot. */
export const STATUS_DOT: Record<TimesheetStatus, string> = {
  pending: 'bg-warning',
  submitted: 'bg-primary',
  approved: 'bg-success',
  rejected: 'bg-danger',
  cancelled: 'bg-secondary dark:bg-secondary-dark',
};

/** Donut arc. */
export const STATUS_STROKE: Record<TimesheetStatus, string> = {
  pending: 'stroke-warning',
  submitted: 'stroke-primary',
  approved: 'stroke-success',
  rejected: 'stroke-danger',
  cancelled: 'stroke-secondary dark:stroke-secondary-dark',
};
