import { describe, expect, it } from 'vitest';
import {
  computeRotaInsights,
  suggestCoverForShift,
  summariseInsights,
  type RotaInsightInput,
} from '@/lib/rotaInsights';
import type {
  Availability,
  LeaveRequest,
  Location,
  Shift,
  ShiftType,
  StaffDocument,
  StaffProfile,
} from '@/types';

/**
 * Every case pins `now` explicitly. The rules are all relative to it — past
 * shifts are skipped, "within a week" escalates a shortage — so a suite that
 * read the wall clock would pass in the morning and fail after lunch.
 *
 * TZ is Europe/London throughout, which is what the app uses and what the test
 * runner is configured for; the dates below are BST, so 09:00 local is 08:00Z.
 */
const TZ = 'Europe/London';
const NOW = new Date('2026-08-10T09:00:00Z').getTime(); // Mon 10 Aug, 10:00 BST

const ORG = 'org-1';

const STAFF_DEFAULTS: StaffProfile = {
  id: 'p-default',
  org_id: ORG,
  user_id: null,
  first_name: 'Test',
  last_name: 'Person',
  job_title: 'Care Assistant',
  department_id: null,
  contract_type: 'full_time',
  weekly_hours: 37.5,
  holiday_allowance: 28,
  skills: [],
  payroll_id: null,
  start_date: null,
  phone: null,
  photo_url: null,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const SHIFT_DEFAULTS: Shift = {
  id: 's-default',
  org_id: ORG,
  rota_id: 'rota-1',
  location_id: 'loc-1',
  department_id: null,
  staff_profile_id: null,
  shift_type_id: 'type-early',
  starts_at: '2026-08-19T06:00:00Z',
  ends_at: '2026-08-19T14:00:00Z',
  break_minutes: 0,
  status: 'assigned',
  colour: null,
  notes: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

function staff(over: Partial<StaffProfile> & { id: string }): StaffProfile {
  return { ...STAFF_DEFAULTS, ...over };
}

function shift(
  over: Partial<Shift> & { id: string; starts_at: string; ends_at: string },
): Shift {
  return { ...SHIFT_DEFAULTS, ...over };
}

const SHIFT_TYPES: ShiftType[] = [
  {
    id: 'type-early',
    org_id: ORG,
    name: 'Early',
    colour: '#56AACD',
    default_start: '07:00:00',
    default_end: '15:00:00',
    is_paid: true,
    category: 'day',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const LOCATIONS: Location[] = [
  { id: 'loc-1', org_id: ORG, name: 'Northgate House', timezone: TZ } as Location,
];

function input(over: Partial<RotaInsightInput> = {}): RotaInsightInput {
  return {
    shifts: [],
    staff: [],
    shiftTypes: SHIFT_TYPES,
    locations: LOCATIONS,
    leave: [],
    availability: [],
    documents: [],
    timezone: TZ,
    now: NOW,
    ...over,
  };
}

describe('computeRotaInsights', () => {
  it('flags an unfilled shift, and escalates it inside a week', () => {
    const soon = shift({
      id: 's-soon',
      starts_at: '2026-08-12T06:00:00Z',
      ends_at: '2026-08-12T14:00:00Z',
      status: 'open',
    });
    const later = shift({
      id: 's-later',
      starts_at: '2026-09-12T06:00:00Z',
      ends_at: '2026-09-12T14:00:00Z',
      status: 'open',
    });

    const found = computeRotaInsights(input({ shifts: [soon, later] }));
    const open = found.filter((i) => i.kind === 'open_shift');

    expect(open).toHaveLength(2);
    expect(open.find((i) => i.shiftId === 's-soon')?.severity).toBe('critical');
    expect(open.find((i) => i.shiftId === 's-later')?.severity).toBe('warning');
  });

  it('ignores shifts that have already finished — nothing can be done about them', () => {
    const past = shift({
      id: 's-past',
      starts_at: '2026-08-03T06:00:00Z',
      ends_at: '2026-08-03T14:00:00Z',
      status: 'open',
    });

    expect(computeRotaInsights(input({ shifts: [past] }))).toHaveLength(0);
  });

  it('flags someone rostered inside their own approved leave', () => {
    const person = staff({ id: 'p-1', first_name: 'Maya', last_name: 'Whitfield' });
    const rostered = shift({
      id: 's-1',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });
    const leave: LeaveRequest[] = [
      {
        id: 'l-1',
        org_id: ORG,
        staff_profile_id: 'p-1',
        type: 'holiday',
        start_date: '2026-08-17',
        end_date: '2026-08-21',
        status: 'approved',
      } as LeaveRequest,
    ];

    const found = computeRotaInsights(
      input({ shifts: [rostered], staff: [person], leave }),
    );
    const clash = found.find((i) => i.kind === 'leave_clash');

    expect(clash?.severity).toBe('critical');
    expect(clash?.title).toContain('Maya Whitfield');
  });

  it('does not treat pending leave as a clash', () => {
    const person = staff({ id: 'p-1' });
    const rostered = shift({
      id: 's-1',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });
    const leave: LeaveRequest[] = [
      {
        id: 'l-1',
        org_id: ORG,
        staff_profile_id: 'p-1',
        type: 'holiday',
        start_date: '2026-08-17',
        end_date: '2026-08-21',
        status: 'pending',
      } as LeaveRequest,
    ];

    const found = computeRotaInsights(
      input({ shifts: [rostered], staff: [person], leave }),
    );
    expect(found.some((i) => i.kind === 'leave_clash')).toBe(false);
  });

  it('flags overlapping shifts for the same person', () => {
    const person = staff({ id: 'p-1' });
    const a = shift({
      id: 's-a',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });
    const b = shift({
      id: 's-b',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T11:00:00Z',
      ends_at: '2026-08-19T19:00:00Z',
    });

    const found = computeRotaInsights(input({ shifts: [a, b], staff: [person] }));
    expect(found.find((i) => i.kind === 'double_booked')?.severity).toBe('critical');
  });

  it('flags less than eleven hours between consecutive shifts', () => {
    const person = staff({ id: 'p-1' });
    // Off at 22:00 BST, back at 07:00 BST — nine hours.
    const late = shift({
      id: 's-late',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T13:00:00Z',
      ends_at: '2026-08-19T21:00:00Z',
    });
    const early = shift({
      id: 's-early',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-20T06:00:00Z',
      ends_at: '2026-08-20T14:00:00Z',
    });

    const found = computeRotaInsights(input({ shifts: [late, early], staff: [person] }));
    const rest = found.find((i) => i.kind === 'rest_breach');

    expect(rest).toBeDefined();
    expect(rest?.title).toContain('9.0h rest');
  });

  it('leaves a compliant rest gap alone', () => {
    const person = staff({ id: 'p-1' });
    const first = shift({
      id: 's-1',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });
    const second = shift({
      id: 's-2',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-20T06:00:00Z',
      ends_at: '2026-08-20T14:00:00Z',
    });

    const found = computeRotaInsights(
      input({ shifts: [first, second], staff: [person] }),
    );
    expect(found.some((i) => i.kind === 'rest_breach')).toBe(false);
  });

  it('flags a shift on a recurring unavailable weekday', () => {
    const person = staff({ id: 'p-1' });
    // 19 Aug 2026 is a Wednesday; Postgres/JS weekday 3.
    const rostered = shift({
      id: 's-1',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });
    const availability: Availability[] = [
      {
        id: 'a-1',
        org_id: ORG,
        staff_profile_id: 'p-1',
        weekday: 3,
        date: null,
        start_time: null,
        end_time: null,
        status: 'unavailable',
        recurring: true,
      } as Availability,
    ];

    const found = computeRotaInsights(
      input({ shifts: [rostered], staff: [person], availability }),
    );
    expect(found.some((i) => i.kind === 'unavailable')).toBe(true);
  });

  it('flags a week scheduled well over the contract, but tolerates a small overrun', () => {
    const person = staff({ id: 'p-1', weekly_hours: 20 });
    // Mon 17 to Thu 20 Aug, four eight-hour days: 32h against a 20h contract.
    const shifts = [17, 18, 19, 20].map((day) =>
      shift({
        id: `s-${day}`,
        staff_profile_id: 'p-1',
        starts_at: `2026-08-${day}T06:00:00Z`,
        ends_at: `2026-08-${day}T14:00:00Z`,
      }),
    );

    const found = computeRotaInsights(input({ shifts, staff: [person] }));
    expect(found.some((i) => i.kind === 'over_contract')).toBe(true);

    const oneShift = computeRotaInsights(
      input({ shifts: shifts.slice(0, 2), staff: [person] }),
    );
    expect(oneShift.some((i) => i.kind === 'over_contract')).toBe(false);
  });

  it('flags an expired document only while the person is still rostered', () => {
    const person = staff({ id: 'p-1' });
    const documents: StaffDocument[] = [
      {
        id: 'd-1',
        org_id: ORG,
        staff_profile_id: 'p-1',
        type: 'dbs',
        name: 'DBS certificate',
        file_url: 'https://example.test/d.pdf',
        issued_at: '2024-01-01',
        expires_at: '2026-07-29',
      } as StaffDocument,
    ];
    const rostered = shift({
      id: 's-1',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });

    const flagged = computeRotaInsights(
      input({ shifts: [rostered], staff: [person], documents }),
    ).find((i) => i.kind === 'document_expiry');
    expect(flagged?.severity).toBe('critical');

    // Nobody rostered — the certificate is still expired, but not a rota problem.
    const notRostered = computeRotaInsights(
      input({ shifts: [], staff: [person], documents }),
    );
    expect(notRostered.some((i) => i.kind === 'document_expiry')).toBe(false);
  });

  it('sorts blocking problems above ones merely worth a look', () => {
    const person = staff({ id: 'p-1' });
    const open = shift({
      id: 's-open',
      starts_at: '2026-08-12T06:00:00Z',
      ends_at: '2026-08-12T14:00:00Z',
      status: 'open',
    });
    const late = shift({
      id: 's-late',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T13:00:00Z',
      ends_at: '2026-08-19T21:00:00Z',
    });
    const early = shift({
      id: 's-early',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-20T06:00:00Z',
      ends_at: '2026-08-20T14:00:00Z',
    });

    const found = computeRotaInsights(
      input({ shifts: [open, late, early], staff: [person] }),
    );
    expect(found[0]?.severity).toBe('critical');
  });
});

describe('summariseInsights', () => {
  it('reports full coverage and a publishable week when nothing is flagged', () => {
    const covered = shift({
      id: 's-1',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    });
    const summary = summariseInsights([], [covered], NOW);

    expect(summary.coveragePct).toBe(100);
    expect(summary.openShifts).toBe(0);
    expect(summary.headline).toContain('ready to publish');
  });

  it('counts only upcoming shifts towards coverage', () => {
    const past = shift({
      id: 's-past',
      starts_at: '2026-08-03T06:00:00Z',
      ends_at: '2026-08-03T14:00:00Z',
      status: 'open',
    });
    const upcomingOpen = shift({
      id: 's-open',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
      status: 'open',
    });
    const upcomingFilled = shift({
      id: 's-filled',
      staff_profile_id: 'p-1',
      starts_at: '2026-08-20T06:00:00Z',
      ends_at: '2026-08-20T14:00:00Z',
    });

    const summary = summariseInsights([], [past, upcomingOpen, upcomingFilled], NOW);
    expect(summary.openShifts).toBe(1);
    expect(summary.coveragePct).toBe(50);
  });
});

describe('suggestCoverForShift', () => {
  const open = shift({
    id: 's-open',
    starts_at: '2026-08-19T06:00:00Z',
    ends_at: '2026-08-19T14:00:00Z',
    status: 'open',
  });

  it('excludes anyone on approved leave, already working, or unavailable', () => {
    const onLeave = staff({ id: 'p-leave', first_name: 'Leave' });
    const working = staff({ id: 'p-busy', first_name: 'Busy' });
    const unavailable = staff({ id: 'p-away', first_name: 'Away' });
    const free = staff({ id: 'p-free', first_name: 'Free' });

    const candidates = suggestCoverForShift({
      shift: open,
      shifts: [
        open,
        shift({
          id: 's-busy',
          staff_profile_id: 'p-busy',
          starts_at: '2026-08-19T07:00:00Z',
          ends_at: '2026-08-19T15:00:00Z',
        }),
      ],
      staff: [onLeave, working, unavailable, free],
      leave: [
        {
          id: 'l-1',
          org_id: ORG,
          staff_profile_id: 'p-leave',
          type: 'holiday',
          start_date: '2026-08-18',
          end_date: '2026-08-20',
          status: 'approved',
        } as LeaveRequest,
      ],
      availability: [
        {
          id: 'a-1',
          org_id: ORG,
          staff_profile_id: 'p-away',
          weekday: 3,
          date: null,
          start_time: null,
          end_time: null,
          status: 'unavailable',
          recurring: true,
        } as Availability,
      ],
      timezone: TZ,
    });

    expect(candidates.map((c) => c.staffProfileId)).toEqual(['p-free']);
  });

  it('ranks someone who already works the pattern above someone who does not', () => {
    const regular = staff({ id: 'p-regular', first_name: 'Regular' });
    const stranger = staff({ id: 'p-stranger', first_name: 'Stranger' });

    const candidates = suggestCoverForShift({
      shift: open,
      shifts: [
        open,
        // Same shift type, same site, comfortably clear of the open slot.
        shift({
          id: 's-history',
          staff_profile_id: 'p-regular',
          starts_at: '2026-08-17T06:00:00Z',
          ends_at: '2026-08-17T14:00:00Z',
        }),
      ],
      staff: [regular, stranger],
      leave: [],
      availability: [],
      timezone: TZ,
    });

    expect(candidates[0]?.staffProfileId).toBe('p-regular');
    expect(candidates[0]?.reasons.join(' ')).toContain('works this pattern');
  });

  it('keeps someone who would go over contract, but says so', () => {
    // 30h already booked in the same week as the open shift, against a 32h
    // contract — the 8h slot takes them over. Deliberately on other days, so
    // the only finding is the contract, not an overlap.
    const stretched = staff({ id: 'p-stretched', weekly_hours: 32 });
    const booked = [17, 18, 20].map((day) =>
      shift({
        id: `s-booked-${day}`,
        staff_profile_id: 'p-stretched',
        starts_at: `2026-08-${day}T06:00:00Z`,
        ends_at: `2026-08-${day}T16:00:00Z`,
      }),
    );

    const candidates = suggestCoverForShift({
      shift: open,
      shifts: [open, ...booked],
      staff: [stretched],
      leave: [],
      availability: [],
      timezone: TZ,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.eligible).toBe(true);
    expect(candidates[0]?.blockers.join(' ')).toContain('over their 32h contract');
  });
});
