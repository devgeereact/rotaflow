import { useMemo, useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import {
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  buildShiftMap,
  computeDailyTotals,
  computeWarnings,
  getMonday,
  getWeekDates,
} from '@/lib/rotaGrid';

function formatWeekRange(dates: string[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return '';
  return `${format(new Date(`${first}T00:00:00`), 'd MMM')} – ${format(new Date(`${last}T00:00:00`), 'd MMM yyyy')}`;
}
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { RotaGrid, type RotaGroup } from '@/components/rota/RotaGrid';
import { ShiftInspectorPanel } from '@/components/rota/ShiftInspectorPanel';
import { RotaActionRail } from '@/components/rota/RotaActionRail';
import type { Location, Rota, Shift, ShiftType, StaffProfile } from '@/types';

const ORG_ID = 'preview-org';
const now = new Date();
const ISO = (d: Date): string => d.toISOString();
const stamp = (base: Date, days: number, time: string): string => {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return ISO(d);
};

function mkLocation(id: string, name: string): Location {
  return {
    id,
    org_id: ORG_ID,
    name,
    address: null,
    latitude: null,
    longitude: null,
    timezone: 'Europe/London',
    geofence_radius_m: 100,
    created_at: ISO(now),
    updated_at: ISO(now),
  };
}

function mkStaff(
  id: string,
  firstName: string,
  lastName: string,
  jobTitle: string,
  skills: string[] = [],
): StaffProfile {
  return {
    id,
    org_id: ORG_ID,
    user_id: null,
    first_name: firstName,
    last_name: lastName,
    job_title: jobTitle,
    department_id: null,
    contract_type: 'full_time',
    weekly_hours: 37.5,
    holiday_allowance: 28,
    skills,
    payroll_id: null,
    start_date: null,
    phone: null,
    photo_url: null,
    active: true,
    created_at: ISO(now),
    updated_at: ISO(now),
  };
}

function mkShiftType(id: string, name: string, colour: string): ShiftType {
  return {
    id,
    org_id: ORG_ID,
    name,
    colour,
    default_start: null,
    default_end: null,
    is_paid: true,
    category: null,
    created_at: ISO(now),
    updated_at: ISO(now),
  };
}

let shiftSeq = 0;
function mkShift(input: {
  locationId: string;
  staffProfileId: string | null;
  shiftTypeId: string;
  rotaId: string;
  day: number;
  start: string;
  end: string;
  status?: string;
  notes?: string;
}): Shift {
  shiftSeq += 1;
  return {
    id: `shift-${shiftSeq}`,
    org_id: ORG_ID,
    rota_id: input.rotaId,
    location_id: input.locationId,
    department_id: null,
    staff_profile_id: input.staffProfileId,
    shift_type_id: input.shiftTypeId,
    starts_at: stamp(monday, input.day, input.start),
    ends_at: stamp(monday, input.day, input.end),
    break_minutes: 30,
    status: input.status ?? (input.staffProfileId ? 'confirmed' : 'open'),
    colour: null,
    notes: input.notes ?? null,
    created_at: ISO(now),
    updated_at: ISO(now),
  };
}

const monday = new Date(`${getMonday(now)}T00:00:00`);

const LOCATIONS = [
  mkLocation('loc-sunshine', 'Sunshine Care Home'),
  mkLocation('loc-riverside', 'Riverside House'),
];

const SUNSHINE_STAFF = [
  mkStaff('staff-sarah', 'Sarah', 'Johnson', 'Senior Nurse', [
    'Nursing',
    'Manual Handling',
  ]),
  mkStaff('staff-michael', 'Michael', 'Brown', 'Care Assistant', ['Manual Handling']),
  mkStaff('staff-emily', 'Emily', 'Davis', 'Care Assistant', ['Manual Handling']),
  mkStaff('staff-daniel', 'Daniel', 'Lee', 'Care Assistant'),
];
const RIVERSIDE_STAFF = [
  mkStaff('staff-aisha', 'Aisha', 'Patel', 'Senior Nurse', ['Nursing']),
  mkStaff('staff-james', 'James', 'Wilson', 'Care Assistant'),
  mkStaff('staff-olivia', 'Olivia', 'Garcia', 'Care Assistant'),
];
const STAFF = [...SUNSHINE_STAFF, ...RIVERSIDE_STAFF];

// Morning/Evening/Night map to moss/violet/indigo so the chips render the
// green/purple/blue wash design/Rota-Builder.png shows.
const SHIFT_TYPES = [
  mkShiftType('type-morning', 'Morning', '#86AC6A'),
  mkShiftType('type-evening', 'Evening', '#C48FD6'),
  mkShiftType('type-night', 'Night', '#6CA0EB'),
];

const ROTA_SUNSHINE: Rota = {
  id: 'rota-sunshine',
  org_id: ORG_ID,
  location_id: 'loc-sunshine',
  name: 'This week',
  period_start: getMonday(now),
  period_end: getWeekDates(getMonday(now))[6] ?? getMonday(now),
  status: 'draft',
  published_at: null,
  created_at: ISO(now),
  updated_at: ISO(now),
};
const ROTA_RIVERSIDE: Rota = {
  ...ROTA_SUNSHINE,
  id: 'rota-riverside',
  location_id: 'loc-riverside',
};

function buildShifts(): Shift[] {
  const shifts: Shift[] = [];
  const morningPeople = ['staff-sarah', 'staff-michael', 'staff-emily'];
  for (const staffId of morningPeople) {
    for (const day of [0, 1, 2, 4, 5]) {
      shifts.push(
        mkShift({
          locationId: 'loc-sunshine',
          staffProfileId: staffId,
          shiftTypeId: 'type-morning',
          rotaId: ROTA_SUNSHINE.id,
          day,
          start: '07:00',
          end: '15:00',
          ...(staffId === 'staff-sarah' && day === 0
            ? { notes: 'Busy morning due to appointment clinic.' }
            : {}),
        }),
      );
    }
  }
  shifts.push(
    mkShift({
      locationId: 'loc-sunshine',
      staffProfileId: null,
      shiftTypeId: 'type-morning',
      rotaId: ROTA_SUNSHINE.id,
      day: 1,
      start: '07:00',
      end: '15:00',
    }),
  );
  shifts.push(
    mkShift({
      locationId: 'loc-sunshine',
      staffProfileId: 'staff-daniel',
      shiftTypeId: 'type-night',
      rotaId: ROTA_SUNSHINE.id,
      day: 0,
      start: '23:00',
      end: '07:00',
    }),
  );
  shifts.push(
    mkShift({
      locationId: 'loc-sunshine',
      staffProfileId: 'staff-daniel',
      shiftTypeId: 'type-night',
      rotaId: ROTA_SUNSHINE.id,
      day: 2,
      start: '23:00',
      end: '07:00',
    }),
  );
  shifts.push(
    mkShift({
      locationId: 'loc-sunshine',
      staffProfileId: 'staff-emily',
      shiftTypeId: 'type-evening',
      rotaId: ROTA_SUNSHINE.id,
      day: 3,
      start: '15:00',
      end: '23:00',
    }),
  );
  shifts.push(
    mkShift({
      locationId: 'loc-sunshine',
      staffProfileId: null,
      shiftTypeId: 'type-evening',
      rotaId: ROTA_SUNSHINE.id,
      day: 5,
      start: '15:00',
      end: '23:00',
    }),
  );
  shifts.push(
    mkShift({
      locationId: 'loc-sunshine',
      staffProfileId: null,
      shiftTypeId: 'type-night',
      rotaId: ROTA_SUNSHINE.id,
      day: 6,
      start: '23:00',
      end: '07:00',
    }),
  );

  for (const day of [0, 2, 3]) {
    shifts.push(
      mkShift({
        locationId: 'loc-riverside',
        staffProfileId: 'staff-aisha',
        shiftTypeId: 'type-morning',
        rotaId: ROTA_RIVERSIDE.id,
        day,
        start: '07:00',
        end: '15:00',
      }),
    );
  }
  for (const day of [1, 2, 4]) {
    shifts.push(
      mkShift({
        locationId: 'loc-riverside',
        staffProfileId: 'staff-james',
        shiftTypeId: 'type-evening',
        rotaId: ROTA_RIVERSIDE.id,
        day,
        start: '15:00',
        end: '23:00',
      }),
    );
  }
  for (const day of [0, 1, 3, 4]) {
    shifts.push(
      mkShift({
        locationId: 'loc-riverside',
        staffProfileId: 'staff-olivia',
        shiftTypeId: 'type-night',
        rotaId: ROTA_RIVERSIDE.id,
        day,
        start: '23:00',
        end: '07:00',
      }),
    );
  }
  return shifts;
}

const SHIFTS = buildShifts();
const DEFAULT_TZ = 'Europe/London';

/**
 * Design-loop preview only — `/app/rota` needs a real Supabase session, real
 * org data and real shifts. This renders the same components with local mock
 * data so the screen can be screenshotted without auth or a database. Not
 * wired to any service call.
 */
export function RotaBuilderPreviewPage(): JSX.Element {
  const dates = useMemo(() => getWeekDates(getMonday(now)), []);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(
    SHIFTS.find((s) => s.staff_profile_id === 'staff-sarah')?.id ?? null,
  );

  const shiftMapByLocation = useMemo(() => {
    const map = new Map<string, Map<string, Shift[]>>();
    for (const loc of LOCATIONS) {
      map.set(
        loc.id,
        buildShiftMap(
          SHIFTS.filter((s) => s.location_id === loc.id),
          loc.timezone,
        ),
      );
    }
    return map;
  }, []);

  const groups: RotaGroup[] = [
    { location: LOCATIONS[0]!, staff: SUNSHINE_STAFF },
    { location: LOCATIONS[1]!, staff: RIVERSIDE_STAFF },
  ];

  const dailyTotals = useMemo(
    () => computeDailyTotals(SHIFTS, dates, DEFAULT_TZ),
    [dates],
  );
  const warnings = useMemo(() => computeWarnings(SHIFTS, DEFAULT_TZ), []);
  const selectedShift = SHIFTS.find((s) => s.id === selectedShiftId) ?? null;
  const totalStaff = new Set(SHIFTS.map((s) => s.staff_profile_id).filter(Boolean)).size;

  return (
    <div className="min-h-screen bg-background px-6 py-8 dark:bg-background-dark md:px-10">
      <DndContext>
        <div>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-content dark:text-content-dark">
                Rota Builder
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-content-muted dark:text-content-muted-dark">
                Build fair, balanced rotas in minutes.
                <Info size={14} aria-hidden="true" />
              </p>
            </div>
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted"
              />
              <input
                placeholder="Search staff, skills, shifts…"
                className="w-80 rounded-xl border border-surface-border bg-surface py-2.5 pl-10 pr-16 text-sm text-content outline-none dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-surface-border px-1.5 py-0.5 font-sans text-[0.65rem] font-medium text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                ⌘ K
              </kbd>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Previous week"
                className="rounded-lg border border-surface-border p-1.5 text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                aria-label="Next week"
                className="rounded-lg border border-surface-border p-1.5 text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark"
              >
                <ChevronRight size={16} />
              </button>
              <Button size="sm" variant="secondary">
                Today
              </Button>
              <span className="flex items-center gap-1 text-sm font-semibold text-content dark:text-content-dark">
                {formatWeekRange(dates)}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="text-content-muted"
                />
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div
                role="group"
                aria-label="View"
                className="flex rounded-xl border border-surface-border p-1 dark:border-surface-border-dark"
              >
                {['Day', 'Week', '2 Weeks', 'Month'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium',
                      tab === 'Week'
                        ? 'bg-primary text-white'
                        : 'text-content-muted dark:text-content-muted-dark',
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Manage shift types"
                className="rounded-xl border border-surface-border p-2 text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark"
              >
                <Settings2 size={16} />
              </button>
              <div className="flex">
                <Button size="sm" className="rounded-r-none">
                  Publish (3 changes)
                </Button>
                <button
                  type="button"
                  aria-label="Publish options"
                  className="rounded-r-xl border-l border-primary-fg/20 bg-primary px-2 text-primary-fg"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select className="w-auto py-2" defaultValue="all">
              <option value="all">All Locations</option>
            </Select>
            <Select className="w-auto py-2" defaultValue="all">
              <option value="all">All Departments</option>
            </Select>
            <Select className="w-auto py-2" defaultValue="all">
              <option value="all">All Shift Types</option>
            </Select>
            <button
              type="button"
              className="flex items-center gap-1 rounded-xl border border-surface-border px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:text-content-dark"
            >
              More filters
              <ChevronDown size={14} aria-hidden="true" />
            </button>

            <Button
              size="sm"
              className="ml-auto bg-success/10 text-success hover:bg-success/15"
            >
              <Sparkles size={14} aria-hidden="true" />
              Auto-assign
            </Button>
            <Button size="sm" variant="secondary">
              Actions
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <Card className="grid min-w-0 flex-1 grid-cols-1 gap-0 overflow-hidden p-0 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <div className="overflow-x-auto border-b border-surface-border p-5 xl:border-b-0 xl:border-r dark:border-surface-border-dark">
                <RotaGrid
                  dates={dates}
                  groups={groups}
                  totalStaff={totalStaff}
                  totalShifts={SHIFTS.length}
                  shiftMapByLocation={shiftMapByLocation}
                  shiftTypes={SHIFT_TYPES}
                  previewMap={new Map()}
                  dailyTotals={dailyTotals}
                  selectedShiftId={selectedShiftId}
                  onAddShift={() => {}}
                  onSelectShift={(shift) => setSelectedShiftId(shift.id)}
                />
              </div>

              <div className="p-4">
                <ShiftInspectorPanel
                  selectedShift={selectedShift}
                  shifts={SHIFTS}
                  staff={STAFF}
                  shiftTypes={SHIFT_TYPES}
                  locations={LOCATIONS}
                  dailyTotals={dailyTotals}
                  warnings={warnings}
                  timezone={DEFAULT_TZ}
                  rotaStatusForLocation={() => 'published'}
                  onEdit={() => {}}
                  onDuplicate={() => {}}
                  onDelete={() => {}}
                />
              </div>
            </Card>

            <Card className="shrink-0 p-2 xl:w-[5.5rem]">
              {/* Design-preview only: the rail is rendered for layout match,
                  with no rota behind it to act on. */}
              <RotaActionRail
                onTemplates={() => {}}
                onCopyShifts={() => {}}
                onPasteShifts={() => {}}
                onCopyPreviousWeek={() => {}}
                onAutoFill={() => {}}
                onClearShifts={() => {}}
                onPrint={() => {}}
                clipboardCount={0}
                busyAction={null}
              />
            </Card>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-content-muted dark:text-content-muted-dark">
              <CalendarCheck size={14} aria-hidden="true" className="text-success" />
              All changes saved
            </span>
            <div className="flex flex-wrap items-center gap-5 text-xs text-content-muted dark:text-content-muted-dark">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success" /> Optimal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-danger" /> Understaffed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-warning" /> Unpublished
              </span>
            </div>
          </div>
        </div>
      </DndContext>
    </div>
  );
}
