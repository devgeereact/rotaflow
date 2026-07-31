import { useState } from 'react';
import { Calendar, Check, MapPin, Pencil, Users as UsersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fromIsoInTimezone,
  jobTitleInitials,
  shiftGroup,
  type DailyTotal,
  type RotaWarning,
} from '@/lib/rotaGrid';
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
  warnings: RotaWarning[];
  timezone: string;
  rotaStatusForLocation: (locationId: string | null) => 'draft' | 'published' | null;
  onEdit: (shift: Shift) => void;
  onDuplicate: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
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
}: ShiftInspectorPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('details');
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Shift Details' },
    { key: 'coverage', label: 'Coverage' },
    { key: 'warnings', label: `Warnings${warnings.length ? ` (${warnings.length})` : ''}` },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex gap-1 border-b border-surface-border pb-2 dark:border-surface-border-dark">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-semibold',
              tab === t.key
                ? 'bg-primary/10 text-primary'
                : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
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
        <WarningsList
          warnings={warnings}
          locationById={locationById}
          typeById={typeById}
          timezone={timezone}
        />
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

  const group = shiftGroup(shifts, shift).filter((s) => s.staff_profile_id);
  const groupTotal = shiftGroup(shifts, shift).length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                paletteTokenForColour(type?.colour),
              )}
            />
            <h3 className="font-display text-base font-semibold text-content dark:text-content-dark">
              {type?.name ?? 'Shift'}
            </h3>
          </div>
          {location && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-content-muted dark:text-content-muted-dark">
              <MapPin size={12} aria-hidden="true" />
              {location.name}
            </p>
          )}
        </div>
        {status && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[0.65rem] font-medium',
              status === 'published'
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning',
            )}
          >
            {status === 'published' ? 'Published' : 'Draft'}
          </span>
        )}
      </div>

      <p className="mb-1 flex items-center gap-1.5 text-sm text-content dark:text-content-dark">
        <Calendar size={14} aria-hidden="true" className="text-content-muted" />
        {new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>
      <p className="mb-4 font-mono text-sm text-content-muted dark:text-content-muted-dark">
        {startTime} – {endTime} ({durationHours}h)
      </p>

      <p className="mb-4 flex items-center gap-1.5 text-sm text-content dark:text-content-dark">
        <UsersIcon size={14} aria-hidden="true" className="text-content-muted" />
        {group.length} / {groupTotal} staff
      </p>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
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
      <ul className="mb-4 space-y-2">
        {group.map((s) => {
          const person = s.staff_profile_id ? staffById.get(s.staff_profile_id) : undefined;
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
              <span className="flex-1 text-sm text-content dark:text-content-dark">
                {person.first_name} {person.last_name}
              </span>
              {badge && (
                <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[0.65rem] font-medium text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark">
                  {badge}
                </span>
              )}
              {s.status === 'confirmed' && (
                <Check size={14} aria-hidden="true" className="text-success" />
              )}
            </li>
          );
        })}
      </ul>

      {shift.notes && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
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
          <p className="text-sm text-content dark:text-content-dark">{shift.notes}</p>
        </div>
      )}

      <div className="mt-auto space-y-2 pt-4">
        <Button variant="secondary" className="w-full" onClick={() => onDuplicate(shift)}>
          Duplicate Shift
        </Button>
        <Button
          variant="secondary"
          className="w-full border-danger/30 text-danger hover:bg-danger/5"
          onClick={() => onDelete(shift)}
        >
          Delete Shift
        </Button>
      </div>
    </div>
  );
}

function CoverageList({ dailyTotals }: { dailyTotals: DailyTotal[] }): JSX.Element {
  return (
    <ul className="space-y-2">
      {dailyTotals.map((t) => (
        <li
          key={t.date}
          className="flex items-center justify-between rounded-lg border border-surface-border px-3 py-2 text-sm dark:border-surface-border-dark"
        >
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
              {t.status === 'understaffed' ? 'Understaffed' : t.status === 'empty' ? '—' : 'Optimal'}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function WarningsList({
  warnings,
  locationById,
  typeById,
  timezone,
}: {
  warnings: RotaWarning[];
  locationById: Map<string, Location>;
  typeById: Map<string, ShiftType>;
  timezone: string;
}): JSX.Element {
  if (warnings.length === 0) {
    return (
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        No unfilled shifts this week.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {warnings.map((w, i) => {
        const location = w.locationId ? locationById.get(w.locationId) : undefined;
        const type = w.shiftTypeId ? typeById.get(w.shiftTypeId) : undefined;
        const { time: startTime } = fromIsoInTimezone(w.startsAt, timezone);
        const { time: endTime } = fromIsoInTimezone(w.endsAt, timezone);
        return (
          <li
            key={i}
            className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm"
          >
            <p className="font-medium text-content dark:text-content-dark">
              {type?.name ?? 'Shift'} · {location?.name ?? 'Unassigned location'}
            </p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              {new Date(`${w.date}T00:00:00`).toLocaleDateString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}{' '}
              · {startTime}–{endTime} · {w.openCount} unfilled
            </p>
          </li>
        );
      })}
    </ul>
  );
}
