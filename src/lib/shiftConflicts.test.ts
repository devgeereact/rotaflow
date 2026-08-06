import { describe, expect, it } from 'vitest';
import {
  findClashingShift,
  findExistingClashes,
  windowsOverlap,
} from '@/lib/shiftConflicts';
import type { Shift } from '@/types';

const SHIFT_DEFAULTS: Shift = {
  id: 's-default',
  org_id: 'org-1',
  rota_id: 'rota-1',
  location_id: 'loc-1',
  department_id: null,
  staff_profile_id: 'p-1',
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

function shift(
  over: Partial<Shift> & { id: string; starts_at: string; ends_at: string },
): Shift {
  return { ...SHIFT_DEFAULTS, ...over };
}

describe('windowsOverlap', () => {
  const base = {
    staffProfileId: 'p-1',
    startsAt: '2026-08-19T06:00:00Z',
    endsAt: '2026-08-19T14:00:00Z',
  };

  it('detects a partial overlap', () => {
    expect(
      windowsOverlap(base, {
        staffProfileId: 'p-1',
        startsAt: '2026-08-19T13:00:00Z',
        endsAt: '2026-08-19T21:00:00Z',
      }),
    ).toBe(true);
  });

  it('detects an identical window. The copy-previous-week case', () => {
    expect(windowsOverlap(base, { ...base })).toBe(true);
  });

  it('treats back-to-back shifts as not overlapping', () => {
    expect(
      windowsOverlap(base, {
        staffProfileId: 'p-1',
        startsAt: '2026-08-19T14:00:00Z',
        endsAt: '2026-08-19T22:00:00Z',
      }),
    ).toBe(false);
  });

  it('compares instants, not ISO text, across differing UTC offsets', () => {
    // 07:00 BST is 06:00Z. The same moment written two ways.
    expect(
      windowsOverlap(base, {
        staffProfileId: 'p-1',
        startsAt: '2026-08-19T07:00:00+01:00',
        endsAt: '2026-08-19T15:00:00+01:00',
      }),
    ).toBe(true);
  });
});

describe('findClashingShift', () => {
  const existing = [
    shift({
      id: 's-1',
      starts_at: '2026-08-19T06:00:00Z',
      ends_at: '2026-08-19T14:00:00Z',
    }),
  ];

  it('blocks a duplicate of a shift the person already has', () => {
    const clash = findClashingShift(
      {
        staffProfileId: 'p-1',
        startsAt: '2026-08-19T06:00:00Z',
        endsAt: '2026-08-19T14:00:00Z',
      },
      existing,
    );
    expect(clash?.id).toBe('s-1');
  });

  it('allows the same window for a different person', () => {
    expect(
      findClashingShift(
        {
          staffProfileId: 'p-2',
          startsAt: '2026-08-19T06:00:00Z',
          endsAt: '2026-08-19T14:00:00Z',
        },
        existing,
      ),
    ).toBeNull();
  });

  it('never clashes an open shift. Several may await cover in one window', () => {
    expect(
      findClashingShift(
        {
          staffProfileId: null,
          startsAt: '2026-08-19T06:00:00Z',
          endsAt: '2026-08-19T14:00:00Z',
        },
        existing,
      ),
    ).toBeNull();
  });

  it('ignores cancelled shifts', () => {
    const cancelled = [shift({ ...existing[0]!, id: 's-1', status: 'cancelled' })];
    expect(
      findClashingShift(
        {
          staffProfileId: 'p-1',
          startsAt: '2026-08-19T06:00:00Z',
          endsAt: '2026-08-19T14:00:00Z',
        },
        cancelled,
      ),
    ).toBeNull();
  });

  it('excludes the shift being edited from its own check', () => {
    expect(
      findClashingShift(
        {
          staffProfileId: 'p-1',
          startsAt: '2026-08-19T06:00:00Z',
          endsAt: '2026-08-19T15:00:00Z',
        },
        existing,
        { ignoreShiftId: 's-1' },
      ),
    ).toBeNull();
  });

  it('returns the earliest clash when several overlap', () => {
    const many = [
      shift({
        id: 'late',
        starts_at: '2026-08-19T10:00:00Z',
        ends_at: '2026-08-19T18:00:00Z',
      }),
      shift({
        id: 'early',
        starts_at: '2026-08-19T05:00:00Z',
        ends_at: '2026-08-19T12:00:00Z',
      }),
    ];
    expect(
      findClashingShift(
        {
          staffProfileId: 'p-1',
          startsAt: '2026-08-19T09:00:00Z',
          endsAt: '2026-08-19T11:00:00Z',
        },
        many,
      )?.id,
    ).toBe('early');
  });
});

describe('findExistingClashes', () => {
  it('flags the later half of each overlapping pair', () => {
    const rows = [
      shift({
        id: 'a',
        starts_at: '2026-08-19T06:00:00Z',
        ends_at: '2026-08-19T14:00:00Z',
      }),
      shift({
        id: 'b',
        starts_at: '2026-08-19T06:00:00Z',
        ends_at: '2026-08-19T14:00:00Z',
      }),
    ];
    expect(findExistingClashes(rows).map((s) => s.id)).toEqual(['b']);
  });

  it('is clean for a healthy rota of back-to-back shifts', () => {
    const rows = [
      shift({
        id: 'a',
        starts_at: '2026-08-19T06:00:00Z',
        ends_at: '2026-08-19T14:00:00Z',
      }),
      shift({
        id: 'b',
        starts_at: '2026-08-19T14:00:00Z',
        ends_at: '2026-08-19T22:00:00Z',
      }),
    ];
    expect(findExistingClashes(rows)).toEqual([]);
  });

  it('does not pair shifts belonging to different people', () => {
    const rows = [
      shift({
        id: 'a',
        staff_profile_id: 'p-1',
        starts_at: '2026-08-19T06:00:00Z',
        ends_at: '2026-08-19T14:00:00Z',
      }),
      shift({
        id: 'b',
        staff_profile_id: 'p-2',
        starts_at: '2026-08-19T06:00:00Z',
        ends_at: '2026-08-19T14:00:00Z',
      }),
    ];
    expect(findExistingClashes(rows)).toEqual([]);
  });
});
