import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Users as UsersIcon,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayLabel, shiftCellKey, type DailyTotal } from '@/lib/rotaGrid';
import { todayIso } from '@/lib/schedulePeriod';
import { RotaGridRow, ROTA_GRID_COLS } from '@/components/rota/RotaGridRow';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

export interface RotaGroup {
  location: Location;
  staff: StaffProfile[];
}

interface RotaGridProps {
  dates: string[];
  groups: RotaGroup[];
  totalStaff: number;
  totalShifts: number;
  /** One shift map per location, each built with that location's own timezone. */
  shiftMapByLocation: Map<string, Map<string, Shift[]>>;
  shiftTypes: ShiftType[];
  previewMap: Map<string, AiShiftSuggestion[]>;
  dailyTotals: DailyTotal[];
  selectedShiftId: string | null;
  onAddShift: (staffProfileId: string | null, date: string, locationId: string) => void;
  onSelectShift: (shift: Shift) => void;
}

function statusColour(status: DailyTotal['status']): string {
  if (status === 'understaffed') return 'text-danger';
  if (status === 'empty') return 'text-content-muted dark:text-content-muted-dark';
  return 'text-content dark:text-content-dark';
}

export function RotaGrid({
  dates,
  groups,
  totalStaff,
  totalShifts,
  shiftMapByLocation,
  shiftTypes,
  previewMap,
  dailyTotals,
  selectedShiftId,
  onAddShift,
  onSelectShift,
}: RotaGridProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // One clock for the whole grid. Every chip needs to know whether it is in
  // the past, and hundreds of cells each running their own timer would be
  // hundreds of timers — and they would disagree mid-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = todayIso();
  const totalByDate = new Map(dailyTotals.map((t) => [t.date, t]));

  return (
    <div className="min-w-[860px]">
      {/* ---- Header: org-wide totals + per-day mini counts ---- */}
      <div
        className={cn(
          ROTA_GRID_COLS,
          'border-b border-surface-border pb-3 dark:border-surface-border-dark',
        )}
      >
        {/* Both org-wide totals share the staff column so the day columns
            line up with the rows beneath them. */}
        <div className="flex items-start gap-8 px-2">
          <div>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Total Staff
            </p>
            <p className="text-xl font-bold text-content dark:text-content-dark">
              {totalStaff}
            </p>
          </div>
          <div>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Total Shifts
            </p>
            <p className="text-xl font-bold text-content dark:text-content-dark">
              {totalShifts}
            </p>
          </div>
        </div>
        {dates.map((date) => {
          const { weekday, day } = formatDayLabel(date);
          const isToday = date === today;
          const total = totalByDate.get(date);
          return (
            <div
              key={date}
              className={cn(
                'rounded-lg px-1 py-1.5 text-center',
                isToday && 'bg-primary',
              )}
            >
              <p className="text-[0.8rem] leading-5">
                <span
                  className={cn(
                    'font-semibold',
                    isToday ? 'text-white' : 'text-content dark:text-content-dark',
                  )}
                >
                  {weekday}
                </span>{' '}
                <span
                  className={cn(
                    isToday
                      ? 'text-white/90'
                      : 'text-content-muted dark:text-content-muted-dark',
                  )}
                >
                  {day}
                </span>
              </p>
              {total && (
                <p
                  className={cn(
                    'mt-0.5 flex items-center justify-center gap-2 text-[0.7rem]',
                    isToday ? 'text-white' : statusColour(total.status),
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    <UsersIcon size={11} aria-hidden="true" />
                    {total.staffCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileText size={11} aria-hidden="true" />
                    {total.shiftCount}
                  </span>
                </p>
              )}
            </div>
          );
        })}
        <div />
      </div>

      {/* ---- Location groups ---- */}
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.location.id);
        const locationShiftMap =
          shiftMapByLocation.get(group.location.id) ?? new Map<string, Shift[]>();
        const hasUnfilled = dates.some(
          (d) => (locationShiftMap.get(shiftCellKey(null, d)) ?? []).length > 0,
        );

        return (
          <div key={group.location.id} className="pt-3">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.location.id)) next.delete(group.location.id);
                  else next.add(group.location.id);
                  return next;
                })
              }
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              {isCollapsed ? (
                <ChevronRight size={16} aria-hidden="true" />
              ) : (
                <ChevronDown size={16} aria-hidden="true" />
              )}
              {group.location.name}
            </button>

            {!isCollapsed && (
              <>
                {group.staff.map((person) => (
                  <RotaGridRow
                    key={person.id}
                    staff={person}
                    dates={dates}
                    locationId={group.location.id}
                    timezone={group.location.timezone}
                    shiftMap={locationShiftMap}
                    shiftTypes={shiftTypes}
                    previewMap={previewMap}
                    now={now}
                    selectedShiftId={selectedShiftId}
                    onAddShift={(staffProfileId, date) =>
                      onAddShift(staffProfileId, date, group.location.id)
                    }
                    onSelectShift={onSelectShift}
                  />
                ))}

                {hasUnfilled && (
                  <RotaGridRow
                    staff={null}
                    dates={dates}
                    locationId={group.location.id}
                    timezone={group.location.timezone}
                    shiftMap={locationShiftMap}
                    shiftTypes={shiftTypes}
                    previewMap={previewMap}
                    now={now}
                    selectedShiftId={selectedShiftId}
                    onAddShift={(staffProfileId, date) =>
                      onAddShift(staffProfileId, date, group.location.id)
                    }
                    onSelectShift={onSelectShift}
                  />
                )}
              </>
            )}
          </div>
        );
      })}

      {/* One bordered "Add staff" affordance under the whole grid, as in
          design/Rota-Builder.png — not one per location group. */}
      <Link
        to="/app/team"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface-subtle dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
      >
        <Plus size={14} aria-hidden="true" />
        Add staff
      </Link>

      {/* ---- Daily totals footer ---- */}
      <div
        className={cn(
          ROTA_GRID_COLS,
          'mt-4 border-t border-surface-border pt-3 dark:border-surface-border-dark',
        )}
      >
        <div className="px-2 text-xs font-medium text-content dark:text-content-dark">
          Daily Totals
          <span className="block text-content-muted dark:text-content-muted-dark">
            (Staff / Shifts)
          </span>
        </div>
        {dates.map((date) => {
          const total = totalByDate.get(date);
          if (!total) return <div key={date} />;
          const understaffed = total.status === 'understaffed';
          const empty = total.status === 'empty';
          return (
            <div key={date} className="text-center">
              <p
                className={cn(
                  'text-sm font-bold',
                  understaffed ? 'text-danger' : 'text-content dark:text-content-dark',
                )}
              >
                {total.staffCount} / {total.shiftCount}
              </p>
              <p
                className={cn(
                  'flex items-center justify-center gap-1 text-[0.7rem] font-medium',
                  understaffed
                    ? 'text-danger'
                    : empty
                      ? 'text-content-muted dark:text-content-muted-dark'
                      : 'text-success',
                )}
              >
                {!empty &&
                  (understaffed ? (
                    <AlertTriangle size={11} aria-hidden="true" />
                  ) : (
                    <Check size={11} aria-hidden="true" />
                  ))}
                {understaffed ? 'Understaffed' : empty ? '—' : 'Optimal'}
              </p>
            </div>
          );
        })}
        <div />
      </div>
    </div>
  );
}
