import { Fragment, useState } from 'react';
import {
  ArrowUpDown,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { PublishedScheduleChip } from '@/components/schedule/PublishedScheduleChip';
import type {
  ScheduleDayTotal,
  ScheduleLocationGroup,
} from '@/lib/publishedSchedule';

/**
 * Staff column, seven day columns, then the trailing per-row menu column. The
 * header band, every staff row and the totals footer share it — if one band
 * uses a different template the grid visibly goes out of true.
 */
const GRID_COLS =
  'grid grid-cols-[minmax(0,10.5rem)_repeat(7,minmax(0,1fr))_minmax(0,6.5rem)]';

interface PublishedScheduleGridProps {
  dates: string[];
  groups: ScheduleLocationGroup[];
  totals: ScheduleDayTotal[];
  /** 'YYYY-MM-DD' — highlighted in the column header. */
  today: string;
  selectedChipId: string | null;
  onSelectChip: (chipId: string) => void;
  /** Locations collapsed on first render — the reference opens only the first. */
  initiallyCollapsed?: string[];
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

export function PublishedScheduleGrid({
  dates,
  groups,
  totals,
  today,
  selectedChipId,
  onSelectChip,
  initiallyCollapsed = [],
}: PublishedScheduleGridProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(initiallyCollapsed),
  );
  const totalByDate = new Map(totals.map((t) => [t.date, t]));

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-w-[62rem]">
      {/* ---- Column header: day, plus that day's staff and shift counts ---- */}
      <div
        className={cn(GRID_COLS, 'border-b border-surface-border dark:border-surface-border-dark')}
      >
        <div className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-content dark:text-content-dark">
          Staff
          <ArrowUpDown
            size={13}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
        </div>
        {dates.map((date) => {
          const total = totalByDate.get(date);
          const weekend = isWeekend(date);
          const isToday = date === today;
          return (
            <div
              key={date}
              className="border-l border-divider px-2 py-2.5 text-center dark:border-divider-dark"
            >
              <p
                className={cn(
                  'text-[0.8rem] font-semibold leading-5',
                  weekend
                    ? 'text-danger'
                    : isToday
                      ? 'text-primary'
                      : 'text-content dark:text-content-dark',
                )}
              >
                {format(new Date(`${date}T00:00:00`), 'EEE d MMM')}
              </p>
              <p
                className={cn(
                  'mt-0.5 flex items-center justify-center gap-2.5 text-[0.7rem] leading-4',
                  weekend
                    ? 'text-danger'
                    : isToday
                      ? 'text-primary'
                      : 'text-content-muted dark:text-content-muted-dark',
                )}
              >
                <span className="inline-flex items-center gap-1">
                  <Users size={11} aria-hidden="true" />
                  {total?.staff ?? 0}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarDays size={11} aria-hidden="true" />
                  {total?.shifts ?? 0}
                </span>
              </p>
            </div>
          );
        })}
        <div className="border-l border-divider dark:border-divider-dark" />
      </div>

      {/* ---- Location groups ---- */}
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return (
          <Fragment key={group.id}>
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 border-b border-divider bg-surface-subtle px-3 py-1.5 text-left transition-colors hover:bg-divider dark:border-divider-dark dark:bg-surface-subtle-dark dark:hover:bg-surface-border-dark/40"
            >
              <Building2
                size={15}
                aria-hidden="true"
                className="text-content-muted dark:text-content-muted-dark"
              />
              <span className="rounded-lg bg-divider px-2 py-0.5 text-[0.8rem] font-semibold text-content dark:bg-surface-border-dark/60 dark:text-content-dark">
                {group.name}
              </span>
              <span className="text-xs text-content-muted dark:text-content-muted-dark">
                {group.staffCount} staff
              </span>
              <span className="ml-auto text-content-muted dark:text-content-muted-dark">
                {isCollapsed ? (
                  <ChevronRight size={16} aria-hidden="true" />
                ) : (
                  <ChevronDown size={16} aria-hidden="true" />
                )}
              </span>
            </button>

            {!isCollapsed &&
              group.rows.map((row) => (
                <div
                  key={`${group.id}:${row.id}`}
                  className={cn(
                    GRID_COLS,
                    'border-b border-divider dark:border-divider-dark',
                  )}
                >
                  <div className="flex items-center gap-2.5 px-3 py-1.5">
                    <StaffAvatar
                      firstName={row.firstName}
                      lastName={row.lastName}
                      photoUrl={row.photoUrl}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[0.8rem] font-semibold leading-5 text-content dark:text-content-dark">
                        {row.firstName} {row.lastName}
                      </p>
                      {row.jobTitle && (
                        <p className="truncate text-[0.7rem] leading-4 text-content-muted dark:text-content-muted-dark">
                          {row.jobTitle}
                        </p>
                      )}
                    </div>
                  </div>

                  {dates.map((date) => {
                    const chips = row.cells[date] ?? [];
                    return (
                      <div
                        key={date}
                        className="flex flex-col justify-center gap-1 border-l border-divider px-1.5 py-2 dark:border-divider-dark"
                      >
                        {chips.length === 0 ? (
                          <span
                            className="block text-center text-sm text-content-muted/60 dark:text-content-muted-dark/60"
                            aria-label="Day off"
                          >
                            –
                          </span>
                        ) : (
                          chips.map((chip) => (
                            <PublishedScheduleChip
                              key={chip.id}
                              chip={chip}
                              selected={chip.id === selectedChipId}
                              staffName={`${row.firstName} ${row.lastName}`}
                              onSelect={() => onSelectChip(chip.id)}
                            />
                          ))
                        )}
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-center border-l border-divider dark:border-divider-dark">
                    <span
                      aria-hidden="true"
                      className="grid h-8 w-8 place-items-center rounded-lg text-content-muted dark:text-content-muted-dark"
                    >
                      <MoreVertical size={16} />
                    </span>
                  </div>
                </div>
              ))}
          </Fragment>
        );
      })}

      {/* ---- Daily totals ---- */}
      <div className={GRID_COLS}>
        <div className="px-4 py-3">
          <p className="text-[0.8rem] font-semibold leading-5 text-content dark:text-content-dark">
            Daily Totals
          </p>
          <p className="text-[0.7rem] leading-4 text-content-muted dark:text-content-muted-dark">
            (Staff / Shifts)
          </p>
        </div>
        {dates.map((date) => {
          const total = totalByDate.get(date);
          const weekend = isWeekend(date);
          return (
            <div
              key={date}
              className="border-l border-divider px-2 py-2.5 text-center dark:border-divider-dark"
            >
              <p
                className={cn(
                  'text-[0.85rem] font-bold leading-5',
                  weekend ? 'text-danger' : 'text-content dark:text-content-dark',
                )}
              >
                {total ? `${total.staff} / ${total.shifts}` : '—'}
              </p>
              <p
                className={cn(
                  'text-[0.75rem] font-semibold leading-4',
                  weekend ? 'text-danger' : 'text-success',
                )}
              >
                {total?.coverage === null || total === undefined
                  ? '—'
                  : `${total.coverage}%`}
              </p>
            </div>
          );
        })}
        <div className="border-l border-divider dark:border-divider-dark" />
      </div>
    </div>
  );
}
