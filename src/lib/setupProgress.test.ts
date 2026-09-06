import { describe, expect, it } from 'vitest';
import {
  buildSetupSteps,
  summariseSetup,
  type SetupFacts,
  type SetupStepId,
} from '@/lib/setupProgress';
import type { Organisation } from '@/types';

const ORG = {
  id: 'org',
  name: 'Sunnyvale Care',
  slug: 'sunnyvale',
  timezone: 'Europe/London',
  industry: 'care',
  settings: {},
  plan: 'starter',
  status: 'active',
  created_by: 'u1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as unknown as Organisation;

/** A brand-new organisation: the wizard has run and nothing else has. */
const EMPTY: SetupFacts = {
  organisation: ORG,
  locations: 0,
  departments: 0,
  jobTitles: 0,
  shiftTypes: 0,
  minimumCoverRules: 0,
  staff: 0,
  staffWithoutAccount: 0,
  invitesPending: 0,
  invitesAccepted: 0,
  invitesExpired: 0,
  invitesNeverSent: 0,
  invitesFailed: 0,
  rotasAny: 0,
  rotasPublished: 0,
};

function statusOf(facts: SetupFacts, id: SetupStepId): string {
  return buildSetupSteps(facts).find((step) => step.id === id)?.status ?? 'missing';
}

function detailOf(facts: SetupFacts, id: SetupStepId): string {
  return buildSetupSteps(facts).find((step) => step.id === id)?.detail ?? '';
}

describe('an organisation with zero seed data', () => {
  it('produces a checklist rather than an error', () => {
    const steps = buildSetupSteps(EMPTY);
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.every((step) => step.to.startsWith('/app/'))).toBe(true);
  });

  it('marks what can be done now and what is waiting on something else', () => {
    // A rota needs somewhere to put it, somebody to put on it and a shift
    // type to make it out of. Saying "create a rota" first would send a new
    // customer to a screen that refuses them.
    expect(statusOf(EMPTY, 'locations')).toBe('todo');
    expect(statusOf(EMPTY, 'shift_types')).toBe('todo');
    expect(statusOf(EMPTY, 'staff')).toBe('todo');
    expect(statusOf(EMPTY, 'rota')).toBe('blocked');
    expect(statusOf(EMPTY, 'publish')).toBe('blocked');
  });

  it('names what each blocked step is waiting for', () => {
    const rota = buildSetupSteps(EMPTY).find((s) => s.id === 'rota');
    expect(rota?.blockedBy).toBe('locations');
    const publish = buildSetupSteps(EMPTY).find((s) => s.id === 'publish');
    expect(publish?.blockedBy).toBe('rota');
  });

  it('points at the first thing that can actually be done', () => {
    const next = summariseSetup(buildSetupSteps(EMPTY)).next;
    expect(next?.status).toBe('todo');
    // Organisation details are already filled in by the fixture, so the first
    // outstanding essential is the site.
    expect(next?.id).toBe('locations');
  });

  it('does not nag about the recommended steps', () => {
    // Departments and staffing minimums are blocked only because there is no
    // site yet; job titles are simply optional. None is an error.
    expect(statusOf(EMPTY, 'job_titles')).toBe('optional');
    expect(statusOf(EMPTY, 'departments')).toBe('blocked');
    // Six essentials: organisation details, locations, shift types, staff,
    // a rota and publishing it. Everything else is an improvement.
    expect(
      buildSetupSteps(EMPTY)
        .filter((s) => s.required)
        .map((s) => s.id),
    ).toEqual(['organisation', 'locations', 'shift_types', 'staff', 'rota', 'publish']);
  });
});

describe('the chain unblocks in order', () => {
  const withSite: SetupFacts = { ...EMPTY, locations: 2 };

  it('a site unblocks departments and minimums, and nothing else', () => {
    expect(statusOf(withSite, 'departments')).toBe('optional');
    expect(statusOf(withSite, 'cover')).toBe('optional');
    expect(statusOf(withSite, 'rota')).toBe('blocked');
  });

  it('a rota becomes possible once there is a site, staff and a shift type', () => {
    const ready: SetupFacts = { ...withSite, staff: 4, shiftTypes: 3 };
    expect(statusOf(ready, 'rota')).toBe('todo');
    expect(statusOf(ready, 'publish')).toBe('blocked');
  });

  it('publishing becomes possible once a rota exists', () => {
    const drafted: SetupFacts = {
      ...withSite,
      staff: 4,
      shiftTypes: 3,
      rotasAny: 1,
    };
    expect(statusOf(drafted, 'publish')).toBe('todo');
    expect(detailOf(drafted, 'publish')).toContain('Staff can see no shifts');
  });
});

describe('progress is a query, not a flag', () => {
  it('goes back down when the rows do', () => {
    const set: SetupFacts = { ...EMPTY, locations: 1 };
    expect(statusOf(set, 'locations')).toBe('done');
    // Delete the last site and the checklist says so again. A stored "step
    // done" flag would still claim it was finished.
    expect(statusOf({ ...set, locations: 0 }, 'locations')).toBe('todo');
  });

  it('reports what is actually there, not just a tick', () => {
    expect(detailOf({ ...EMPTY, locations: 1 }, 'locations')).toBe('1 site');
    expect(detailOf({ ...EMPTY, locations: 3 }, 'locations')).toBe('3 sites');
  });

  it('counts only the required steps towards completeness', () => {
    const done: SetupFacts = {
      ...EMPTY,
      locations: 1,
      shiftTypes: 1,
      staff: 1,
      rotasAny: 1,
      rotasPublished: 1,
    };
    const summary = summariseSetup(buildSetupSteps(done));
    expect(summary.complete).toBe(true);
    // Job titles, departments and minimums are still untouched, and that is
    // not an incomplete setup.
    expect(summary.done).toBeLessThan(summary.total);
    expect(summary.next).toBeNull();
  });
});

describe('the organisation step', () => {
  it('says which detail is missing rather than only that something is', () => {
    const noTimezone = {
      ...EMPTY,
      organisation: { ...ORG, timezone: null } as unknown as Organisation,
    };
    expect(statusOf(noTimezone, 'organisation')).toBe('todo');
    expect(detailOf(noTimezone, 'organisation')).toContain('no timezone set');
  });

  it('degrades rather than throwing when the organisation could not be read', () => {
    expect(detailOf({ ...EMPTY, organisation: null }, 'organisation')).toBe(
      'Nothing recorded yet.',
    );
  });
});

describe('sign-ins tell four states apart', () => {
  /**
   * The distinction `listPendingInvites` cannot draw. Anything unaccepted,
   * unrevoked and unexpired is "pending" there, which puts an invitation the
   * SMTP server refused in the same bucket as one somebody is slow to answer.
   * They need opposite actions.
   */
  it('a delivered, unanswered invitation is done — it is waiting on them', () => {
    const facts: SetupFacts = { ...EMPTY, staff: 2, invitesPending: 2 };
    expect(statusOf(facts, 'invites')).toBe('done');
    expect(detailOf(facts, 'invites')).toBe('2 waiting');
  });

  it('a failed send is a to-do — it is waiting on the manager', () => {
    const facts: SetupFacts = {
      ...EMPTY,
      staff: 2,
      invitesPending: 2,
      invitesFailed: 1,
    };
    expect(statusOf(facts, 'invites')).toBe('todo');
    expect(detailOf(facts, 'invites')).toContain('1 failed to send');
  });

  it('so is an invitation that was never emailed at all', () => {
    const facts: SetupFacts = {
      ...EMPTY,
      staff: 2,
      invitesPending: 1,
      invitesNeverSent: 1,
    };
    expect(statusOf(facts, 'invites')).toBe('todo');
    expect(detailOf(facts, 'invites')).toContain('1 never emailed');
  });

  it('separates accepted from expired', () => {
    const facts: SetupFacts = {
      ...EMPTY,
      staff: 3,
      invitesAccepted: 2,
      invitesExpired: 1,
    };
    expect(detailOf(facts, 'invites')).toBe('2 accepted · 1 expired');
  });

  it('says how many staff cannot sign in when nobody has been invited', () => {
    const facts: SetupFacts = { ...EMPTY, staff: 5, staffWithoutAccount: 5 };
    expect(statusOf(facts, 'invites')).toBe('optional');
    expect(detailOf(facts, 'invites')).toContain('5 staff cannot sign in');
    // And the staff step says the same thing from its own side.
    expect(detailOf(facts, 'staff')).toContain('5 cannot sign in yet');
  });
});

describe('minimum cover wording', () => {
  it('does not let an empty policy read as "fully covered"', () => {
    const facts: SetupFacts = { ...EMPTY, locations: 1 };
    expect(detailOf(facts, 'cover')).toContain('no day can be reported as short');
  });
});
