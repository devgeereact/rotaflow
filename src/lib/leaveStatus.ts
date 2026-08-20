import {
  CalendarDays,
  CircleDashed,
  ClipboardPlus,
  ContactRound,
  HeartHandshake,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LeaveStatus, LeaveTypeKey } from '@/lib/leaveRows';

/**
 * Token classes per leave status and leave type, written out in full so
 * Tailwind's content scan can see every one (a concatenated class name is
 * purged at build time).
 *
 * Every colour here is paired with the status or type spelled out in words
 * wherever it renders. Leave state is never carried by colour alone
 * (docs/DESIGN.md §5).
 */

/** The reference calls a rejected request "Declined"; the column value is `rejected`. */
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};

/** Pill fill + ink. */
export const LEAVE_STATUS_TONE: Record<LeaveStatus, string> = {
  pending: 'bg-warning/10 text-warning dark:bg-warning/20',
  approved: 'bg-success/10 text-success dark:bg-success/20',
  rejected: 'bg-danger/10 text-danger dark:bg-danger/20',
  cancelled:
    'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

export const LEAVE_TYPE_LABEL: Record<LeaveTypeKey, string> = {
  annual: 'Annual Leave',
  sick: 'Sick Leave',
  personal: 'Personal Leave',
  carer: "Carer's Leave",
  other: 'Other',
};

/**
 * Glyph per leave type. The chip, the balance tile and nothing else.
 *
 * Read off design/Leave.png. `personal` is the one inference: the reference
 * draws a badge-with-a-head that `ContactRound` matches most closely in the
 * Lucide set; the other four are unambiguous.
 */
export const LEAVE_TYPE_ICON: Record<LeaveTypeKey, LucideIcon> = {
  annual: CalendarDays,
  sick: ClipboardPlus,
  personal: ContactRound,
  carer: HeartHandshake,
  other: CircleDashed,
};

/** Table chip: tinted wash + saturated ink. */
export const LEAVE_TYPE_CHIP: Record<LeaveTypeKey, string> = {
  annual: 'bg-leave-annual-wash text-leave-annual dark:bg-leave-annual-deep',
  sick: 'bg-leave-sick-wash text-leave-sick dark:bg-leave-sick-deep',
  personal: 'bg-leave-personal-wash text-leave-personal dark:bg-leave-personal-deep',
  carer: 'bg-leave-carer-wash text-leave-carer dark:bg-leave-carer-deep',
  other: 'bg-leave-other-wash text-leave-other dark:bg-leave-other-deep',
};
