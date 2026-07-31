import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Users as UsersIcon,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayLabel, shiftCellKey, type DailyTotal } from '@/lib/rotaGrid';
import { todayIso } from '@/lib/schedulePeriod';
import { RotaGridRow } from '@/components/rota/RotaGridRow';
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
  const today = todayIso();
  const totalByDate = new Map(dailyTotals.map((t) => [t.date, t]));

  return (
    <div className="min-w-[1000px]">
      {/* ---- Header: org-wide totals + per-day mini counts ---- */}
      <div className="grid grid-cols-[8rem_8rem_repeat(7,1fr)] gap-2 border-b border-surface-border pb-3 dark:border-surface-border-dark">
        <div>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Total Staff
          </p>
          <p className="font-mono text-lg font-semibold text-content dark:text-content-dark">
            {totalStaff}
          </p>
        </div>
        <div>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Total Shifts
          </p>
          <p className="font-mono text-lg font-semibold text-content dark:text-content-dark">
            {totalShifts}
          </p>
        </div>
        {dates.map((date) => {
          const { weekday, day } = formatDayLabel(date);
          const isToday = date === today;
          const total = totalByDate.get(date);
          return (
            <div
              key={date}
              className={cn('rounded-lg px-1 py-1 text-center', isToday && 'bg-primary')}
            >
              <p
                className={cn(
                  'text-xs font-semibold uppercase',
                  isToday
                    ? 'text-white'
                    : 'text-content-muted dark:text-content-muted-dark',
                )}
              >
                {weekday}
              </p>
              <p
                className={cn(
                  'text-sm font-medium',
                  isToday ? 'text-white' : 'text-content dark:text-content-dark',
                )}
              >
                {day}
              </p>
              {total && (
                <p
                  className={cn(
                    'mt-1 flex items-center justify-center gap-1.5 font-mono text-[0.7rem]',
                    isToday ? 'text-white' : statusColour(total.status),
                  )}
                >
                  <span className="inline-flex items-center gap-0.5">
                    <UsersIcon size={11} aria-hidden="true" />
                    {total.staffCount}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <FileText size={11} aria-hidden="true" />
                    {total.shiftCount}
                  </span>
                </p>
              )}
            </div>
          );
        })}
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
                    selectedShiftId={selectedShiftId}
                    onAddShift={(staffProfileId, date) =>
                      onAddShift(staffProfileId, date, group.location.id)
                    }
                    onSelectShift={onSelectShift}
                  />
                )}

                <Link
                  to="/app/staff"
                  className="mt-1 flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Plus size={14} aria-hidden="true" />
                  Add staff
                </Link>
              </>
            )}
          </div>
        );
      })}

      {/* ---- Daily totals footer ---- */}
      <div className="mt-4 grid grid-cols-[8rem_8rem_repeat(7,1fr)] gap-2 border-t border-surface-border pt-3 dark:border-surface-border-dark">
        <div className="col-span-2 text-xs font-medium text-content-muted dark:text-content-muted-dark">
          Daily Totals
          <br />
          (Staff / Shifts)
        </div>
        {dates.map((date) => {
          const total = totalByDate.get(date);
          if (!total) return <div key={date} />;
          return (
            <div key={date} className="text-center">
              <p className="font-mono text-sm font-semibold text-content dark:text-content-dark">
                {total.staffCount} / {total.shiftCount}
              </p>
              <p
                className={cn(
                  'text-[0.7rem] font-medium',
                  total.status === 'understaffed' ? 'text-danger' : 'text-success',
                )}
              >
                {total.status === 'understaffed'
                  ? 'Understaffed'
                  : total.status === 'empty'
                    ? '—'
                    : 'Optimal'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
