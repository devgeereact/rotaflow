import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  Clock3,
  Coffee,
  HelpCircle,
  PlayCircle,
  TimerOff,
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { AttendanceStatus } from '@/lib/attendance';
import { ATTENDANCE_STATUS_META } from '@/lib/attendance';

const ICONS: Record<AttendanceStatus, typeof CircleCheck> = {
  scheduled: CircleDashed,
  late: Clock3,
  working: PlayCircle,
  on_break: Coffee,
  completed: CircleCheck,
  missing_clock_out: TimerOff,
  not_recorded: HelpCircle,
  unscheduled: AlertTriangle,
};

/**
 * `attendance.ts` names five tones; `Badge` accepts nine. `neutral` is the
 * ordinary state (rostered, finished) rather than a colour, which is the rule
 * docs/DESIGN.md §5 states: a completed shift is not a success message and a
 * draft is not a warning.
 */
const TONES: Record<AttendanceStatus, BadgeTone> = {
  scheduled: 'neutral',
  late: 'warning',
  working: 'success',
  on_break: 'info',
  completed: 'neutral',
  missing_clock_out: 'danger',
  not_recorded: 'warning',
  unscheduled: 'info',
};

/**
 * One attendance state, as a labelled chip with an icon.
 *
 * Colour is never the only signal: every chip carries its word and its own
 * glyph, so the eight states stay apart in greyscale, at 200% zoom and for
 * anybody who cannot tell the amber from the green.
 *
 * `title` carries the definition. Every count on the dashboard drills into a
 * list of these, and a manager has to be able to find out what "Not recorded"
 * means without leaving the row — particularly that one, which is deliberately
 * not a claim of absence.
 */
export function AttendanceStatusBadge({
  status,
  className,
}: {
  status: AttendanceStatus;
  className?: string;
}): JSX.Element {
  const meta = ATTENDANCE_STATUS_META[status];
  const Icon = ICONS[status];
  return (
    <Badge tone={TONES[status]} className={className}>
      <span title={meta.definition} className="inline-flex items-center gap-1.5">
        <Icon size={13} aria-hidden="true" />
        {meta.label}
      </span>
    </Badge>
  );
}
