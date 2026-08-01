import type { InviteRow, InviteStats } from '@/lib/staffInvites';

/**
 * Fixtures for `/staff-preview/invitations`, the design-loop route.
 *
 * The Invitations tab has no reference PNG, so unlike the other demo modules
 * these numbers reproduce no mockup — they exist to exercise every state the
 * table can draw at once: three role tones, an expiring row, a same-day row
 * and an ordinary pending row. DEV-only; `import.meta.env.DEV` gates the route
 * so Rollup tree-shakes this out of the production bundle.
 */

export const DEMO_INVITES: InviteRow[] = [
  {
    id: 'invite-1',
    email: 'rachel.okafor@sunnyvale.co.uk',
    role: 'manager',
    roleLabel: 'Manager',
    invitedOn: '28 Jul 2026',
    invitedDaysAgo: 4,
    daysLeft: 1,
    expiresLabel: 'tomorrow',
    expiringSoon: true,
  },
  {
    id: 'invite-2',
    email: 'tom.bennett@sunnyvale.co.uk',
    role: 'staff',
    roleLabel: 'Staff',
    invitedOn: '30 Jul 2026',
    invitedDaysAgo: 2,
    daysLeft: 5,
    expiresLabel: 'in 5 days',
    expiringSoon: false,
  },
  {
    id: 'invite-3',
    email: 'priya.shah@sunnyvale.co.uk',
    role: 'owner',
    roleLabel: 'Owner',
    invitedOn: '27 Jul 2026',
    invitedDaysAgo: 5,
    daysLeft: 0,
    expiresLabel: 'today',
    expiringSoon: true,
  },
  {
    id: 'invite-4',
    email: 'callum.wright@riversidehouse.co.uk',
    role: 'staff',
    roleLabel: 'Staff',
    invitedOn: '31 Jul 2026',
    invitedDaysAgo: 1,
    daysLeft: 6,
    expiresLabel: 'in 6 days',
    expiringSoon: false,
  },
  {
    id: 'invite-5',
    email: 'nadia.hassan@oakview.co.uk',
    role: 'staff',
    roleLabel: 'Staff',
    invitedOn: '31 Jul 2026',
    invitedDaysAgo: 1,
    daysLeft: 7,
    expiresLabel: 'in 7 days',
    expiringSoon: false,
  },
];

/** `?state=empty` — an org that has no invitation outstanding. */
export const EMPTY_INVITE_STATS: InviteStats = {
  pending: 0,
  expiringSoon: 0,
  elevated: 0,
  staff: 0,
  sentThisWeek: 0,
};

/**
 * `?state=link` — the callout shown once, immediately after minting. The token
 * is obviously fake; a real one is 32 random bytes and never leaves the tab.
 */
export const DEMO_INVITE_LINK = {
  email: 'rachel.okafor@sunnyvale.co.uk',
  url: 'https://rota.gakinz.com/invite/pv7k2m9x4rq8tn3wzc6hd5fjb1sy0gla',
};

export const DEMO_INVITE_STATS: InviteStats = {
  pending: 5,
  expiringSoon: 2,
  elevated: 2,
  staff: 3,
  sentThisWeek: 5,
};
