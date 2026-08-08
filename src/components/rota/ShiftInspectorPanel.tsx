import { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Copy,
  Info,
  MapPin,
  Pencil,
  TrendingUp,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fromIsoInTimezone,
  jobTitleInitials,
  shiftGroup,
  type DailyTotal,
} from '@/lib/rotaGrid';
import type { RotaInsight } from '@/lib/rotaInsights';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import { Button } from '@/components/ui/Button';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

type Tab = 'details' | 'coverage' | 'warnings';

interface ShiftInspectorPanelProps {
  selectedShift: Shift | null;
  shifts: Shift[];
  staff: StaffProfile[];
  shiftTypes: ShiftType[];
  locations: Location[];
  dailyTotals: DailyTotal[];
  /**
   * Everything wrong with the visible rota, worst first, not just unfilled
   * shifts. Comes from `computeRotaInsights`, which is the same engine the
   * assistant and the publish gate read, so all three agree.
   */
  warnings: RotaInsight[];
  timezone: string;
  rotaStatusForLocation: (locationId: string | null) => 'draft' | 'published' | null;
  onEdit: (shift: Shift) => void;
  onDuplicate: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  /** Jump the grid to the shift a warning is about. */
  onSelectShiftId: (shiftId: string) => void;
}

/** Right rail: the currently selected shift, or the week's coverage/warnings. */
export function ShiftInspectorPanel({
  selectedShift,
  shifts,
  staff,
  shiftTypes,
  locations,
  dailyTotals,
  warnings,
  timezone,
  rotaStatusForLocation,
  onEdit,
  onDuplicate,
  onDelete,
  onSelectShiftId,
}: ShiftInspectorPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('details');
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Shift Details' },
    { key: 'coverage', label: 'Coverage' },
    {
      key: 'warnings',
      label: `Warnings${warnings.length ? ` (${warnings.length})` : ''}`,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex gap-4 border-b border-surface-border dark:border-surface-border-dark">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px border-b-2 pb-2.5 text-xs font-semibold transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' &&
        (selectedShift ? (
          <ShiftDetails
            shift={selectedShift}
            shifts={shifts}
            staffById={staffById}
            locationById={locationById}
            typeById={typeById}
            timezone={timezone}
            rotaStatusForLocation={rotaStatusForLocation}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        ) : (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Select a shift on the grid to see its details.
          </p>
        ))}

      {tab === 'coverage' && <CoverageList dailyTotals={dailyTotals} />}

      {tab === 'warnings' && (
        <WarningsList warnings={warnings} onSelectShiftId={onSelectShiftId} />
      )}
    </div>
  );
}

function ShiftDetails({
  shift,
  shifts,
  staffById,
  locationById,
  typeById,
  timezone,
  rotaStatusForLocation,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  shift: Shift;
  shifts: Shift[];
  staffById: Map<string, StaffProfile>;
  locationById: Map<string, Location>;
  typeById: Map<string, ShiftType>;
  timezone: string;
  rotaStatusForLocation: (locationId: string | null) => 'draft' | 'published' | null;
  onEdit: (shift: Shift) => void;
  onDuplicate: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
}): JSX.Element {
  const type = shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;
  const location = shift.location_id ? locationById.get(shift.location_id) : undefined;
  const { date, time: startTime } = fromIsoInTimezone(shift.starts_at, timezone);
  const { time: endTime } = fromIsoInTimezone(shift.ends_at, timezone);
  const durationHours = Math.round(
    (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 3_600_000,
  );
  const status = rotaStatusForLocation(shift.location_id);

  const wholeGroup = shiftGroup(shifts, shift);
  const group = wholeGroup.filter((s) => s.staff_profile_id);
  const groupTotal = wholeGroup.length;
  // Filled slots ÷ total slots for this shift. Derived from rows that exist,
  // not a target-vs-actual figure (the schema carries no required headcount).
  const coveragePct = groupTotal > 0 ? Math.round((group.length / groupTotal) * 100) : 0;

  // `shifts` has no required-skills column, so this is the union of skills the
  // assigned staff actually hold. Hence "Skills on Shift", not the
  // reference's "Required Skills". See design/.loop/rota-log.md.
  const skills = [
    ...new Set(
      group.flatMap((s) =>
        s.staff_profile_id ? (staffById.get(s.staff_profile_id)?.skills ?? []) : [],
      ),
    ),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'grid h-6 w-6 shrink-0 place-items-center rounded-md text-white',
                paletteTokenForColour(type?.colour),
              )}
            >
              <CalendarClock size={13} aria-hidden="true" />
            </span>
            <h3 className="truncate font-display text-base font-bold text-content dark:text-content-dark">
              {type?.name ?? 'Shift'} Shift
            </h3>
          </div>
          {location && (
            <p className="mt-1.5 flex items-center gap-1.5 pl-0.5 text-xs text-content-muted dark:text-content-muted-dark">
              <MapPin size={12} aria-hidden="true" />
              {location.name}
            </p>
          )}
        </div>
        {status && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold',
              status === 'published'
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning',
            )}
          >
            {status === 'published' ? 'Published' : 'Draft'}
          </span>
        )}
      </div>

      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-content dark:text-content-dark">
        <Calendar size={14} aria-hidden="true" className="text-content-muted" />
        {new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>
      <p className="mb-4 pl-[1.4rem] font-mono text-sm text-content-muted dark:text-content-muted-dark">
        {startTime}, {endTime} ({durationHours}h)
      </p>

      {/* Staffing and coverage sit side by side, split by a hairline. */}
      <div className="mb-4 flex items-center border-y border-surface-border py-3 dark:border-surface-border-dark">
        <p className="flex flex-1 items-center gap-1.5 text-sm font-medium text-content dark:text-content-dark">
          <UsersIcon size={14} aria-hidden="true" className="text-content-muted" />
          {group.length} / {groupTotal} Staff
        </p>
        <span
          aria-hidden="true"
          className="h-8 w-px bg-surface-border dark:bg-surface-border-dark"
        />
        <div className="flex-1 pl-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
            <TrendingUp size={14} aria-hidden="true" />
            {coveragePct}%
          </p>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Coverage
          </p>
        </div>
      </div>

      {skills.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold text-content dark:text-content-dark">
            Skills on Shift
          </p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-primary/10 px-2 py-1 text-[0.7rem] font-medium text-primary"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-content dark:text-content-dark">
          Assigned Staff ({group.length})
        </p>
        <button
          type="button"
          onClick={() => onEdit(shift)}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Pencil size={12} aria-hidden="true" />
          Edit
        </button>
      </div>
      <ul className="mb-4 space-y-2.5">
        {group.map((s) => {
          const person = s.staff_profile_id
            ? staffById.get(s.staff_profile_id)
            : undefined;
          if (!person) return null;
          const badge = jobTitleInitials(person.job_title);
          return (
            <li key={s.id} className="flex items-center gap-2">
              <StaffAvatar
                firstName={person.first_name}
                lastName={person.last_name}
                photoUrl={person.photo_url}
                size="sm"
              />
              <span className="flex-1 truncate text-sm font-medium text-content dark:text-content-dark">
                {person.first_name} {person.last_name}
              </span>
              {badge && (
                <span className="rounded-md border border-surface-border px-1.5 py-0.5 text-[0.6rem] font-semibold text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                  {badge}
                </span>
              )}
              {s.status === 'confirmed' && (
                <CheckCircle2 size={15} aria-hidden="true" className="text-success" />
              )}
            </li>
          );
        })}
      </ul>

      {shift.notes && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-content dark:text-content-dark">
              Notes
            </p>
            <button
              type="button"
              onClick={() => onEdit(shift)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Edit
            </button>
          </div>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {shift.notes}
          </p>
        </div>
      )}

      <div className="mt-auto space-y-2 pt-4">
        <Button variant="secondary" className="w-full" onClick={() => onDuplicate(shift)}>
          <Copy size={15} aria-hidden="true" className="text-primary" />
          Duplicate Shift
        </Button>
        <Button
          className="w-full bg-danger/10 text-danger hover:bg-danger/15"
          onClick={() => onDelete(shift)}
        >
          <Trash2 size={15} aria-hidden="true" />
          Delete Shift
        </Button>
      </div>
    </div>
  );
}

function CoverageList({ dailyTotals }: { dailyTotals: DailyTotal[] }): JSX.Element {
  return (
    <ul className="space-y-2">
      {dailyTotals.map((t) => {
        const short = t.required > 0 && t.staffCount < t.required;
        return (
          <li
            key={t.date}
            className="rounded-lg border border-surface-border px-3 py-2 text-sm dark:border-surface-border-dark"
          >
            <div className="flex items-center justify-between">
              <span className="text-content dark:text-content-dark">
                {new Date(`${t.date}T00:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-content-muted dark:text-content-muted-dark">
                  {t.staffCount} / {t.shiftCount}
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    t.status === 'understaffed' ? 'text-danger' : 'text-success',
                  )}
                >
                  {t.status === 'understaffed'
                    ? 'Understaffed'
                    : t.status === 'empty'
                      ? '-'
                      : 'Optimal'}
                </span>
              </span>
            </div>
            {/* Separate from the row above on purpose: shift-fill and the
                staffing minimum are different questions. Every shift on the
                rota could be filled and the day still fall short of the
                minimum, if too few shifts were ever created for it. */}
            {t.required > 0 && (
              <p
                className={cn(
                  'mt-1 font-mono text-xs',
                  short
                    ? 'text-danger'
                    : 'text-content-muted dark:text-content-muted-dark',
                )}
              >
                {t.staffCount} / {t.required} against the staffing minimum
                {short ? ' — below minimum' : ''}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Severity is carried by an icon and a word as well as by colour, so the
 * distinction survives for anyone who cannot rely on the red/amber difference
 * (§26, and §3's "colour to support meaning, not as the only method").
 */
const INSIGHT_SEVERITY: Record<
  RotaInsight['severity'],
  { icon: typeof AlertTriangle; className: string; label: string }
> = {
  critical: {
    icon: CircleAlert,
    className: 'border-danger/30 bg-danger/5',
    label: 'Critical',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-warning/30 bg-warning/5',
    label: 'Warning',
  },
  info: {
    icon: Info,
    className:
      'border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark',
    label: 'For information',
  },
};

const SEVERITY_TEXT: Record<RotaInsight['severity'], string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-content-muted dark:text-content-muted-dark',
};

function WarningsList({
  warnings,
  onSelectShiftId,
}: {
  warnings: RotaInsight[];
  onSelectShiftId: (shiftId: string) => void;
}): JSX.Element {
  if (warnings.length === 0) {
    return (
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        No problems found. Nobody is double-booked, rostered on leave or short of rest
        this week.
      </p>
    );
  }

  const counts = warnings.reduce<Record<string, number>>((acc, w) => {
    acc[w.severity] = (acc[w.severity] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <p className="text-xs text-content-muted dark:text-content-muted-dark">
        {[
          counts.critical ? `${counts.critical} critical` : null,
          counts.warning ? `${counts.warning} warning` : null,
          counts.info ? `${counts.info} for information` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <ul className="space-y-2">
        {warnings.map((w) => {
          const style = INSIGHT_SEVERITY[w.severity];
          const Icon = style.icon;
          const shiftId = w.shiftId;
          const body = (
            <>
              <p className="flex items-start gap-1.5 font-medium text-content dark:text-content-dark">
                <Icon
                  size={14}
                  className={cn('mt-0.5 shrink-0', SEVERITY_TEXT[w.severity])}
                  aria-hidden="true"
                />
                <span>
                  <span className="sr-only">{style.label}: </span>
                  {w.title}
                </span>
              </p>
              <p className="mt-0.5 pl-[1.375rem] text-xs text-content-muted dark:text-content-muted-dark">
                {w.detail}
              </p>
            </>
          );

          return (
            <li key={w.id}>
              {shiftId ? (
                <button
                  type="button"
                  onClick={() => onSelectShiftId(shiftId)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:brightness-95',
                    style.className,
                  )}
                >
                  {body}
                </button>
              ) : (
                <div
                  className={cn('rounded-lg border px-3 py-2 text-sm', style.className)}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
