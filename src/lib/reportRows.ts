import type { LucideIcon } from 'lucide-react';

/**
 * Shapes and tint maps for the Reports & Exports table
 * (docs/design/Reports-Dashboard.png). Kept out of the components so the live page
 * and the design preview build identical rows from different sources.
 */

/** The chip in the Category column. Also picks the row's icon tint. */
export type ReportCategory =
  | 'Scheduling'
  | 'Staffing'
  | 'Timesheets'
  | 'Finance'
  | 'Leave'
  | 'Swaps'
  | 'Analytics'
  | 'Compliance'
  | 'Operations'
  | 'HR';

export type ReportFormat = 'PDF' | 'Excel' | 'CSV';

export type ReportFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'On demand';

export interface ReportRow {
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  icon: LucideIcon;
  /** Pre-formatted, e.g. "Today, 09:15". Null when it has never been run. */
  lastRunLabel: string | null;
  /** Who ran it last. Null alongside a null `lastRunLabel`. */
  lastRunBy: string | null;
  frequency: ReportFrequency;
  format: ReportFormat;
  favourite: boolean;
  /** False for a catalogue entry with no export behind it yet. */
  runnable: boolean;
}

// Four tints cycle through the categories, matching the reference. Violet
// comes from the `shift-tint` pair (its `-fg` is the only deep violet ink in
// the system, `shift-violet` itself is a pale chip fill and would be
// illegible as text). See docs/DESIGN.md §2.
const VIOLET =
  'bg-shift-tint-violet text-shift-tint-violet-fg dark:bg-shift-deep-violet dark:text-shift-violet';
// Light mode uses the `ink` tokens, dark mode keeps `DEFAULT` — the same
// pairing Badge.tsx settled on. At 0.72rem these are small text, and the
// DEFAULT status colours run 2.02-4.08 : 1 on their own washes against a
// 4.5 : 1 minimum. GAP-030.
const BLUE =
  'bg-primary/10 text-primary-ink dark:bg-primary/15 dark:text-primary-ink-dark';
const AMBER = 'bg-warning/15 text-warning-ink dark:text-warning-ink-dark';
const GREEN = 'bg-success/10 text-success-ink dark:text-success-ink-dark';
// `content-muted` on `divider` is 4.38 : 1 — under the line by a hair, and a
// hair is a fail. `content` is the body ink and reads correctly on a fill this
// pale.
const NEUTRAL =
  'bg-divider text-content dark:bg-surface-subtle-dark dark:text-content-muted-dark';

/** `id` of a tab button in the reports tab bar, and the panel's `aria-labelledby`. */
export function reportsTabId(tab: string): string {
  return `reports-tab-${tab}`;
}

export const REPORT_CATEGORY_TONE: Record<ReportCategory, string> = {
  Scheduling: VIOLET,
  Staffing: BLUE,
  Timesheets: AMBER,
  Finance: GREEN,
  Leave: VIOLET,
  Swaps: BLUE,
  Analytics: AMBER,
  Compliance: GREEN,
  Operations: VIOLET,
  HR: BLUE,
};

export const REPORT_FREQUENCY_TONE: Record<ReportFrequency, string> = {
  Daily: BLUE,
  Weekly: GREEN,
  Monthly: AMBER,
  Quarterly: VIOLET,
  'On demand': NEUTRAL,
};

export const REPORT_FORMAT_TONE: Record<ReportFormat, string> = {
  PDF: NEUTRAL,
  Excel: GREEN,
  CSV: BLUE,
};
