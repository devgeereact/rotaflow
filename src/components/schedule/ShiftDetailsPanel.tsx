import { AlarmClock, CalendarDays, CheckCircle2, Copy, Lock, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { CoverageRing } from '@/components/schedule/CoverageRing';

export interface ShiftDetailsAssignee {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  /** Short role code shown in the bordered chip, e.g. "RN". */
  roleCode: string | null;
  confirmed: boolean;
}

export interface ShiftDetails {
  id: string;
  typeName: string;
  colour: string | null;
  locationName: string;
  /** Pre-formatted, e.g. "Tue, 27 May 2025". */
  dateLabel: string;
  /** Pre-formatted, e.g. "07:00 – 15:00 (8h)". */
  timeLabel: string;
  published: boolean;
  assigned: ShiftDetailsAssignee[];
  /** Total slots for this shift — assigned plus still-open. */
  slots: number;
  /** Union of the skills the assigned staff hold. */
  skills: string[];
  notes: string | null;
}

interface ShiftDetailsPanelProps {
  shift: ShiftDetails;
  onClose: () => void;
  /** Omitted when the calling screen has no way to honour the action. */
  onCopy?: () => void;
  onUnpublish?: () => void;
  onEditStaff?: () => void;
  onEditNotes?: () => void;
}

const SECTION_RULE = 'my-4 border-t border-dashed border-surface-border dark:border-surface-border-dark';

/**
 * The expandable shift-details rail beside the grid
 * (design/published-schedule.png). Everything shown is derived from the
 * selected shift and the people on it — nothing here is a target or a
 * forecast, because the schema has neither.
 */
export function ShiftDetailsPanel({
  shift,
  onClose,
  onCopy,
  onUnpublish,
  onEditStaff,
  onEditNotes,
}: ShiftDetailsPanelProps): JSX.Element {
  const filled = shift.assigned.length;
  // Floor, not round: 6 of 7 slots is 85% covered, and rounding it up to 86%
  // would overstate cover on exactly the shifts a manager is checking.
  const coverage = shift.slots === 0 ? 0 : Math.floor((filled / shift.slots) * 100);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          Shift Details
        </h2>
        <Badge tone={shift.published ? 'success' : 'warning'} className="ml-auto">
          {shift.published ? 'Published' : 'Draft'}
        </Badge>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close shift details"
          className="rounded-lg p-1 text-content-muted transition-colors hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn('h-2.5 w-2.5 rounded-full', paletteTokenForColour(shift.colour))}
        />
        <p className="text-card-heading font-semibold text-content dark:text-content-dark">
          {shift.typeName} Shift
        </p>
      </div>
      <p className="ml-5 text-sm text-content-muted dark:text-content-muted-dark">
        {shift.locationName}
      </p>

      <dl className="mt-4 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <dt className="text-primary">
            <CalendarDays size={16} aria-label="Date" />
          </dt>
          <dd className="text-sm font-semibold text-content dark:text-content-dark">
            {shift.dateLabel}
          </dd>
        </div>
        <div className="flex items-center gap-2.5">
          <dt className="text-primary">
            <AlarmClock size={16} aria-label="Time" />
          </dt>
          <dd className="text-sm font-semibold text-content dark:text-content-dark">
            {shift.timeLabel}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2.5">
          <Users
            size={16}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
          <p className="text-sm font-semibold text-content dark:text-content-dark">
            {filled} / {shift.slots} Staff
          </p>
        </div>
        <span
          aria-hidden="true"
          className="h-8 w-px bg-surface-border dark:bg-surface-border-dark"
        />
        <div className="flex flex-1 items-center gap-2">
          <CoverageRing value={coverage} />
          <div>
            <p className="text-sm font-bold text-content dark:text-content-dark">
              {coverage}%
            </p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Coverage
            </p>
          </div>
        </div>
      </div>

      <hr className={SECTION_RULE} />

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[0.8rem] font-semibold text-content dark:text-content-dark">
          Assigned Staff ({filled})
        </h3>
        {onEditStaff && (
          <button
            type="button"
            onClick={onEditStaff}
            className="text-xs font-medium text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {shift.assigned.map((person) => (
          <li key={person.id} className="flex items-center gap-2.5">
            <StaffAvatar
              firstName={person.firstName}
              lastName={person.lastName}
              photoUrl={person.photoUrl}
              size="sm"
            />
            <span className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold text-content dark:text-content-dark">
              {person.firstName} {person.lastName}
            </span>
            {person.roleCode && (
              <span className="rounded-md border border-surface-border px-1.5 py-0.5 text-[0.7rem] font-medium text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                {person.roleCode}
              </span>
            )}
            <CheckCircle2
              size={16}
              className={cn(
                person.confirmed
                  ? 'text-success'
                  : 'text-content-muted/50 dark:text-content-muted-dark/50',
              )}
              aria-label={person.confirmed ? 'Confirmed' : 'Not yet confirmed'}
            />
          </li>
        ))}
      </ul>

      {shift.skills.length > 0 && (
        <>
          <hr className={SECTION_RULE} />
          <h3 className="mb-2 text-[0.8rem] font-semibold text-content dark:text-content-dark">
            Skills on Shift
          </h3>
          <div className="flex flex-wrap gap-2">
            {shift.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-lg bg-shift-tint-violet px-2 py-1 text-xs font-medium text-shift-tint-violet-fg dark:bg-shift-deep-violet dark:text-shift-violet"
              >
                {skill}
              </span>
            ))}
          </div>
        </>
      )}

      <hr className={SECTION_RULE} />

      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[0.8rem] font-semibold text-content dark:text-content-dark">
          Notes
        </h3>
        {onEditNotes && (
          <button
            type="button"
            onClick={onEditNotes}
            className="text-xs font-medium text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      <p className="text-xs text-content-muted dark:text-content-muted-dark">
        {shift.notes ?? 'No notes on this shift.'}
      </p>

      <div className="mt-4 space-y-2">
        {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-surface-border text-sm font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
        >
          <Copy size={16} aria-hidden="true" />
          Copy Shift
        </button>
        )}
        {onUnpublish && (
        <button
          type="button"
          onClick={onUnpublish}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger/10 text-sm font-semibold text-danger transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <Lock size={16} aria-hidden="true" />
          Unpublish Shift
        </button>
        )}
      </div>
    </Card>
  );
}
