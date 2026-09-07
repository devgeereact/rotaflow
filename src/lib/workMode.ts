import type { MembershipRole } from '@/types';

/**
 * Whether a manager is looking at the organisation or at their own work.
 *
 * ## What changed, and why
 *
 * `sidebarNav.ts` used to argue, in a comment, that Clock In should be shown
 * to owners and managers because "in a small care home the owner and the
 * manager are usually on the rota themselves". That is true of some
 * organisations and false of most, and the cost fell on the wrong side: every
 * owner was given a personal rota, a personal availability editor, a personal
 * clock-in and a personal timesheet whether or not they had a staff record to
 * hang any of it on. An owner with no staff profile clicked Clock In and got a
 * screen with nothing on it and no explanation.
 *
 * Ownership is an authorisation fact. It says what somebody may do to the
 * organisation; it says nothing about whether they work shifts. So the default
 * for an owner is management, the personal controls are an explicit opt-in,
 * and the opt-in is only offered to somebody who actually has a staff profile
 * in the active organisation — because without one there is nothing to clock
 * into.
 *
 * "The owner does not have to sign in" is read here as "the owner does not
 * have to clock in for attendance". Account sign-in, session handling and
 * authorisation are untouched, and nothing about an employee becomes readable
 * without a session.
 *
 * ## Why managers default the other way
 *
 * A manager who works shifts is the common case and has had these controls
 * since the product shipped. Turning them off by default would take a working
 * feature away from every existing manager to fix a problem owners have. So a
 * manager with a staff profile starts in `my-work` and can switch to
 * `management`; an owner starts in `management` and can switch to `my-work`.
 * Both keep every management function in either mode — the mode adds personal
 * controls, it never removes managerial ones.
 */
export type WorkMode = 'management' | 'my-work';

/**
 * Where the preference is kept.
 *
 * Per user AND per organisation: the same person can be an owner of one
 * organisation and a working manager in another, and a single global flag
 * would carry the wrong answer across a switch. Keyed rather than shared for
 * the same reason `clearTenantState` exists — nothing that describes one
 * identity may be read by the next one.
 */
export function workModeStorageKey(userId: string, orgId: string): string {
  return `rotaflow:workMode:${userId}:${orgId}`;
}

/** The prefix `clearTenantState` sweeps on an identity change. */
export const WORK_MODE_KEY_PREFIX = 'rotaflow:workMode:';

export function defaultWorkMode(
  role: MembershipRole | null,
  canWorkShifts: boolean,
): WorkMode {
  if (role === 'staff') return 'my-work';
  if (role === 'manager' && canWorkShifts) return 'my-work';
  return 'management';
}

/**
 * The mode actually in force.
 *
 * A stored `my-work` is ignored when the person has no staff profile: the
 * preference may have been set before their staff record was archived, and
 * honouring it would put them back on a clock-in screen with nothing to clock
 * into. Staff are never in `management` — they have no managerial function to
 * be in.
 */
export function resolveWorkMode(input: {
  role: MembershipRole | null;
  canWorkShifts: boolean;
  stored: string | null;
}): WorkMode {
  if (input.role === 'staff') return 'my-work';
  if (!input.canWorkShifts) return 'management';
  if (input.stored === 'my-work' || input.stored === 'management') return input.stored;
  return defaultWorkMode(input.role, input.canWorkShifts);
}

/**
 * Whether the switch should be offered at all.
 *
 * Not offered to staff (nothing to switch to) and not offered to a manager or
 * owner with no staff profile — an inert toggle that explains itself only
 * after being pressed is worse than no toggle.
 */
export function canSwitchWorkMode(input: {
  role: MembershipRole | null;
  canWorkShifts: boolean;
}): boolean {
  if (input.role !== 'owner' && input.role !== 'manager') return false;
  return input.canWorkShifts;
}
