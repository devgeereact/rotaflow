import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  ShieldCheck,
  Umbrella,
  UserPlus,
  Users,
} from 'lucide-react';
import { todayIso } from '@/lib/schedulePeriod';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/dashboard/StatCard';
import type {
  DashboardOverview,
  PendingRequest,
  ShiftGroup,
} from '@/services/dashboardService';

interface QuickAction {
  icon: typeof CalendarPlus;
  label: string;
  to?: string; // omitted = not built yet, rendered disabled — same convention as Sidebar
  tint: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: CalendarPlus, label: 'Build Rota', to: '/app/rota', tint: 'text-primary' },
  { icon: UserPlus, label: 'Add Staff', to: '/app/staff', tint: 'text-shift-violet' },
  { icon: Umbrella, label: 'Request Leave', to: '/app/leave', tint: 'text-success' },
  {
    icon: CheckCircle2,
    label: 'Approve Requests',
    to: '/app/leave',
    tint: 'text-warning',
  },
  {
    icon: BarChart3,
    label: 'View Reports',
    to: '/app/reports',
    tint: 'text-shift-indigo',
  },
  {
    icon: Megaphone,
    label: 'Send Announcement',
    to: '/app/announcements',
    tint: 'text-shift-violet',
  },
];

function timeRange(startsAt: string, endsAt: string, timezone: string): [string, string] {
  return [
    format(toZonedTime(new Date(startsAt), timezone), 'HH:mm'),
    format(toZonedTime(new Date(endsAt), timezone), 'HH:mm'),
  ];
}

/** "On going" / "Starts in 2h" / "Ended" — read against the live clock, not a snapshot. */
function shiftStatusLabel(group: ShiftGroup, now: Date): { label: string; tone: string } {
  const start = new Date(group.startsAt).getTime();
  const end = new Date(group.endsAt).getTime();
  const t = now.getTime();

  if (t >= start && t < end) {
    return { label: 'On going', tone: 'bg-success/10 text-success' };
  }
  if (t >= end) {
    return {
      label: 'Ended',
      tone: 'bg-surface-border/60 text-content-muted dark:bg-surface-border-dark/60 dark:text-content-muted-dark',
    };
  }
  const hours = Math.round((start - t) / 3_600_000);
  return {
    label: hours < 1 ? 'Starting soon' : `Starts in ${hours}h`,
    tone: 'bg-info/10 text-info',
  };
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export interface DashboardViewProps {
  firstName: string | null;
  overview: DashboardOverview;
  pending: PendingRequest[];
  dayGroups: ShiftGroup[];
  dayLoading: boolean;
  dayLabel: string;
  timezone: string;
  now: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onSelectDate: (date: string) => void;
}

/**
 * Pure presentation for `/app/dashboard` (design/Workforce-Dashboard.png) —
 * separated from `DashboardPage` so the same markup can be driven by real
 * Supabase data there and by fixed mock data in `DashboardPreviewPage`
 * (`/dashboard-preview`, design-loop only: the real page needs a live
 * session and a seeded org, neither of which a screenshot tool has).
 *
 * Uses the product's muted `primary`/`content` tokens rather than the vivid
 * `brand` blue the newer marketing/auth screens (splash, sign-in, sign-up,
 * onboarding) sample from their references. This screen sits in the same
 * sidebar/shell as SchedulePage, RotaBuilderPage and StaffPage, which are
 * already built against `primary` — matching those neighbours matters more
 * here than matching this one reference's exact hue, which would make the
 * dashboard look like a different app from the pages one click away from it.
 */
export function DashboardView({
  firstName,
  overview,
  pending,
  dayGroups,
  dayLoading,
  dayLabel,
  timezone,
  now,
  onPrevDay,
  onNextDay,
  onToday,
  onSelectDate,
}: DashboardViewProps): JSX.Element {
  const todaySlots = dayGroups.reduce((sum, g) => sum + g.total, 0);
  const todayFilled = dayGroups.reduce((sum, g) => sum + g.filled, 0);
  const todayShortages = dayGroups.reduce(
    (sum, g) => sum + Math.max(g.total - g.filled, 0),
    0,
  );
  const staffOnShiftPercent =
    todaySlots === 0 ? 0 : Math.round((todayFilled / todaySlots) * 100);

  return (
    <div className="max-w-[1600px]">
      <div className="mb-6">
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
          Dashboard
        </h1>
        <p className="text-content-muted dark:text-content-muted-dark">
          Welcome back{firstName ? `, ${firstName}` : ''} 👋
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={CalendarDays}
          tint="bg-primary/10 text-primary"
          label="Today's Shifts"
          value={todaySlots}
          hint={`Across ${overview.locations.length} location${overview.locations.length === 1 ? '' : 's'}`}
        />
        <StatCard
          icon={Users}
          tint="bg-shift-violet/15 text-shift-violet"
          label="Staff On Shift"
          value={todayFilled}
          hint={
            <div>
              <p className="mb-1.5">{staffOnShiftPercent}% of required</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-border dark:bg-surface-border-dark">
                <div
                  className="h-full rounded-full bg-shift-violet"
                  style={{ width: `${staffOnShiftPercent}%` }}
                />
              </div>
            </div>
          }
        />
        <StatCard
          icon={AlertTriangle}
          tint="bg-warning/10 text-warning"
          label="Pending Requests"
          value={pending.length}
          hint={`${pending.filter((p) => p.kind === 'leave').length} leave · ${pending.filter((p) => p.kind === 'swap').length} swaps`}
        />
        <StatCard
          icon={ShieldCheck}
          tint="bg-success/10 text-success"
          label="Compliance"
          value={`${overview.compliancePercent}%`}
          hint="Staff with valid documents"
        />
        <StatCard
          icon={AlertTriangle}
          tint="bg-danger/10 text-danger"
          label="Shortages"
          value={todayShortages}
          hint={
            todayShortages === 1
              ? '1 shift needs cover'
              : `${todayShortages} shifts need cover`
          }
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Today&rsquo;s Schedule
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous day"
                onClick={onPrevDay}
                className="grid h-8 w-8 place-items-center rounded-lg text-content-muted hover:bg-surface-subtle dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onToday}
                className="rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                Today
              </button>
              <button
                type="button"
                aria-label="Next day"
                onClick={onNextDay}
                className="grid h-8 w-8 place-items-center rounded-lg text-content-muted hover:bg-surface-subtle dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-content-muted dark:text-content-muted-dark">
            {dayLabel}
          </p>

          {dayLoading ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Loading…
            </p>
          ) : dayGroups.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No shifts scheduled.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {dayGroups.map((group) => {
                const [start, end] = timeRange(group.startsAt, group.endsAt, timezone);
                const status = shiftStatusLabel(group, now);
                return (
                  <li
                    key={group.key}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      className="h-10 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: group.colour }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {start} – {end}
                      </p>
                      <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                        {group.shiftTypeName}
                      </p>
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {group.locationName}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        status.tone,
                      )}
                    >
                      {status.label}
                    </span>
                    <p className="w-16 shrink-0 text-right text-sm font-medium text-content dark:text-content-dark">
                      {group.filled}/{group.total}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            to="/app/schedule"
            className="mt-4 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View full schedule <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </Card>

        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Pending Requests
            </h2>
            <Link
              to="/app/leave"
              className="text-sm font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>

          {pending.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Nothing needs your attention.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {pending.slice(0, 3).map((request) => (
                <li
                  key={request.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(request.staffName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                      {request.staffName}
                    </p>
                    <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                      {request.detail}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    Pending
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            to="/app/leave"
            className="mt-4 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all requests <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </Card>

        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Announcements
            </h2>
            <Link
              to="/app/announcements"
              className="text-sm font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>

          {overview.announcements.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No announcements yet.
            </p>
          ) : (
            <ul className="space-y-4">
              {overview.announcements.slice(0, 3).map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                      a.urgent
                        ? 'bg-danger/10 text-danger'
                        : 'bg-primary/10 text-primary',
                    )}
                  >
                    <Megaphone size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-content dark:text-content-dark">
                      {a.title}
                    </p>
                    <p className="line-clamp-2 text-xs text-content-muted dark:text-content-muted-dark">
                      {a.body}
                    </p>
                    <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                      {timeAgo(a.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Link
            to="/app/announcements"
            className="mt-4 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all announcements <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Upcoming Shifts
            </h2>
            <Link
              to="/app/schedule"
              className="text-sm font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          {overview.upcomingGroups.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Nothing scheduled in the next 7 days.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {overview.upcomingGroups.map((group) => {
                const [start, end] = timeRange(group.startsAt, group.endsAt, timezone);
                return (
                  <li
                    key={group.key}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="w-20 shrink-0 text-xs text-content-muted dark:text-content-muted-dark">
                      <p className="font-medium text-content dark:text-content-dark">
                        {format(new Date(group.startsAt), 'EEE d MMM')}
                      </p>
                      <p>
                        {start} – {end}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                        {group.shiftTypeName}
                      </p>
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {group.locationName}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                      {group.filled >= group.total ? 'Confirmed' : 'Open'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-1">
          <h2 className="mb-4 font-semibold text-content dark:text-content-dark">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {QUICK_ACTIONS.map(({ icon: Icon, label, to, tint }) =>
              to ? (
                <Link
                  key={label}
                  to={to}
                  className="flex flex-col items-center gap-2 rounded-xl border border-surface-border p-4 text-center transition-transform duration-150 ease-in-out active:scale-[0.98] hover:scale-[1.02] hover:bg-surface-subtle dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
                >
                  <Icon size={22} aria-hidden="true" className={tint} />
                  <span className="text-xs font-medium text-content dark:text-content-dark">
                    {label}
                  </span>
                </Link>
              ) : (
                <div
                  key={label}
                  aria-disabled="true"
                  className="flex cursor-not-allowed flex-col items-center gap-2 rounded-xl border border-surface-border p-4 text-center opacity-50 dark:border-surface-border-dark"
                >
                  <Icon size={22} aria-hidden="true" className={tint} />
                  <span className="text-xs font-medium text-content dark:text-content-dark">
                    {label}
                  </span>
                  <span className="text-[0.65rem] text-content-muted dark:text-content-muted-dark">
                    Soon
                  </span>
                </div>
              ),
            )}
          </div>
        </Card>

        <MonthlyOverview overview={overview} onSelectDate={onSelectDate} />
      </div>
    </div>
  );
}

interface MonthlyOverviewProps {
  overview: DashboardOverview;
  onSelectDate: (date: string) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The current month's dates arranged into fixed Mon–Sun weeks, with leading/trailing days from neighbouring months for grid alignment. */
function MonthlyOverview({ overview, onSelectDate }: MonthlyOverviewProps): JSX.Element {
  const monthLabel = format(new Date(), 'MMMM yyyy');
  const today = todayIso();

  const cells = useMemo(() => {
    const first = new Date(`${format(new Date(), 'yyyy-MM')}-01T00:00:00`);
    const firstWeekday = (first.getDay() + 6) % 7; // 0 = Monday
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

    const out: { date: string; inMonth: boolean }[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      const d = new Date(first);
      d.setDate(d.getDate() - (firstWeekday - i));
      out.push({ date: format(d, 'yyyy-MM-dd'), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      out.push({
        date: format(new Date(first.getFullYear(), first.getMonth(), day), 'yyyy-MM-dd'),
        inMonth: true,
      });
    }
    while (out.length % 7 !== 0) {
      const last = new Date(out[out.length - 1]!.date);
      last.setDate(last.getDate() + 1);
      out.push({ date: format(last, 'yyyy-MM-dd'), inMonth: false });
    }
    return out;
  }, []);

  return (
    <Card className="p-5 lg:col-span-1">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-content dark:text-content-dark">
          Monthly Overview
        </h2>
        <span className="text-sm text-content-muted dark:text-content-muted-dark">
          {monthLabel}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAYS.map((d) => (
          <span
            key={d}
            className="pb-1 font-medium text-content-muted dark:text-content-muted-dark"
          >
            {d}
          </span>
        ))}
        {cells.map(({ date, inMonth }) => {
          const bucket = overview.monthShiftsByDate.get(date);
          const isToday = date === today;
          const dayNum = Number(date.slice(-2));
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg py-1.5',
                !inMonth && 'text-content-muted/40 dark:text-content-muted-dark/40',
                inMonth &&
                  !isToday &&
                  'text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark',
                isToday && 'bg-primary text-primary-fg',
              )}
            >
              {dayNum}
              {bucket && bucket.total > 0 ? (
                <span
                  className={cn(
                    'h-1 w-1 rounded-full',
                    isToday
                      ? 'bg-primary-fg'
                      : bucket.filled >= bucket.total
                        ? 'bg-success'
                        : 'bg-warning',
                  )}
                />
              ) : (
                <span className="h-1 w-1" />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
