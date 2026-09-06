import { describe, expect, it } from 'vitest';
import {
  canSwitchWorkMode,
  defaultWorkMode,
  resolveWorkMode,
  workModeStorageKey,
  WORK_MODE_KEY_PREFIX,
} from '@/lib/workMode';

/**
 * The assumption this file exists to change.
 *
 * `sidebarNav.ts` used to give every owner and manager a personal Clock In,
 * Availability editor and timesheet, on the reasoning that in a small care
 * home they are usually on the rota themselves. Ownership is an authorisation
 * fact and says nothing about whether somebody works shifts, so an owner with
 * no staff record was handed four screens that could not function.
 */
describe('defaults', () => {
  it('an owner defaults to management, even with a staff profile', () => {
    expect(defaultWorkMode('owner', true)).toBe('management');
    expect(defaultWorkMode('owner', false)).toBe('management');
  });

  it('a manager who works shifts keeps the personal controls they already had', () => {
    expect(defaultWorkMode('manager', true)).toBe('my-work');
  });

  it('a manager with no staff profile does not', () => {
    expect(defaultWorkMode('manager', false)).toBe('management');
  });

  it('staff are always personal', () => {
    expect(defaultWorkMode('staff', true)).toBe('my-work');
    expect(defaultWorkMode('staff', false)).toBe('my-work');
  });
});

describe('resolveWorkMode', () => {
  it('honours a stored preference for somebody who can work shifts', () => {
    expect(
      resolveWorkMode({ role: 'owner', canWorkShifts: true, stored: 'my-work' }),
    ).toBe('my-work');
    expect(
      resolveWorkMode({ role: 'manager', canWorkShifts: true, stored: 'management' }),
    ).toBe('management');
  });

  it('ignores a stored my-work for somebody with no staff profile', () => {
    // The preference can outlive the staff record it was set against — the
    // person is archived, or the preference was carried from another
    // organisation. Honouring it would show a clock-in screen with nothing to
    // clock into.
    expect(
      resolveWorkMode({ role: 'owner', canWorkShifts: false, stored: 'my-work' }),
    ).toBe('management');
  });

  it('ignores a nonsense stored value', () => {
    expect(
      resolveWorkMode({ role: 'manager', canWorkShifts: true, stored: 'banana' }),
    ).toBe('my-work');
  });

  it('never puts a staff member into management', () => {
    expect(
      resolveWorkMode({ role: 'staff', canWorkShifts: true, stored: 'management' }),
    ).toBe('my-work');
  });

  it('treats an unknown role as management, because unknown must mean no', () => {
    expect(resolveWorkMode({ role: null, canWorkShifts: false, stored: null })).toBe(
      'management',
    );
  });
});

describe('canSwitchWorkMode', () => {
  it('is offered to an owner or manager who has a staff profile', () => {
    expect(canSwitchWorkMode({ role: 'owner', canWorkShifts: true })).toBe(true);
    expect(canSwitchWorkMode({ role: 'manager', canWorkShifts: true })).toBe(true);
  });

  it('is not offered where it would do nothing', () => {
    // An inert toggle that explains itself only after being pressed is worse
    // than no toggle.
    expect(canSwitchWorkMode({ role: 'owner', canWorkShifts: false })).toBe(false);
    expect(canSwitchWorkMode({ role: 'staff', canWorkShifts: true })).toBe(false);
    expect(canSwitchWorkMode({ role: null, canWorkShifts: true })).toBe(false);
  });
});

describe('storage key', () => {
  it('is scoped to the user AND the organisation', () => {
    // The same person can own one organisation and work shifts in another.
    expect(workModeStorageKey('u1', 'o1')).not.toBe(workModeStorageKey('u1', 'o2'));
    expect(workModeStorageKey('u1', 'o1')).not.toBe(workModeStorageKey('u2', 'o1'));
  });

  it('carries the prefix the sign-out teardown sweeps', () => {
    expect(workModeStorageKey('u1', 'o1').startsWith(WORK_MODE_KEY_PREFIX)).toBe(true);
  });
});
