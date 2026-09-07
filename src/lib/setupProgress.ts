/**
 * What an organisation still has to set up, computed from what the database
 * actually holds.
 *
 * ## Why this is not a wizard
 *
 * `/onboarding` is a five-step wizard and it resumes correctly: the
 * organisation is created at the end of step 1, `onboarding_completed_at`
 * records whether setup was ever finished, and `0094` made abandoning it
 * recoverable. What it covers is the *account*: create the organisation, its
 * details, invite some people, choose a plan.
 *
 * It does not cover the workforce. Locations, departments, job titles, shift
 * types, staffing minimums, staff records and a first published rota are each
 * built on their own screen, each persists correctly, and **nothing anywhere
 * says which of them an organisation still has none of**. A new customer
 * finishes the wizard, lands on a dashboard reporting zero of everything, and
 * has to work out for themselves that a rota needs a location before it needs
 * a shift.
 *
 * ## Progress is a query, not a tick box
 *
 * Every status below is derived from a count or a column read back from the
 * database. There is no "setup step 4 done" flag, deliberately: a stored flag
 * and the rows it claims to describe drift the moment somebody deletes their
 * only location, and the flag is the one that gets believed. Delete the last
 * location and this screen says so again.
 *
 * ## Required, recommended, and the difference
 *
 * A `required` step blocks something concrete and the step says what. A
 * `recommended` one improves the product and is never presented as an error:
 * an organisation with one site and no departments is a perfectly ordinary
 * organisation, and a checklist that nags it is a checklist people learn to
 * ignore.
 */
import type { Organisation } from '@/types';

export type SetupStepId =
  | 'organisation'
  | 'locations'
  | 'departments'
  | 'job_titles'
  | 'shift_types'
  | 'cover'
  | 'staff'
  | 'invites'
  | 'rota'
  | 'publish';

export type SetupStepStatus =
  /** The database holds what this step is about. */
  | 'done'
  /** Not done, and something else has to happen first. */
  | 'blocked'
  /** Not done, and it can be done now. */
  | 'todo'
  /** Not done, and nothing is broken by that. */
  | 'optional';

export interface SetupFacts {
  organisation: Organisation | null;
  locations: number;
  departments: number;
  jobTitles: number;
  shiftTypes: number;
  /** Rows in `minimum_cover_rules`. Zero means no staffing policy is recorded. */
  minimumCoverRules: number;
  staff: number;
  /** Staff records with no linked account — they cannot sign in yet. */
  staffWithoutAccount: number;
  invitesPending: number;
  invitesAccepted: number;
  invitesExpired: number;
  /** Pending invitations whose email has never been accepted by the mail endpoint. */
  invitesNeverSent: number;
  /** Pending invitations whose last send failed, with a reason recorded. */
  invitesFailed: number;
  rotasAny: number;
  rotasPublished: number;
}

export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** One sentence on what this unlocks. Never "complete your profile". */
  why: string;
  /** Where to go and do it. Always a real route. */
  to: string;
  status: SetupStepStatus;
  /** What the database currently holds, in words. Shown whatever the status. */
  detail: string;
  /** Required steps are the ones that block something; see the module header. */
  required: boolean;
  /** Set on `blocked`: the step that has to happen first. */
  blockedBy?: SetupStepId;
}

const NONE = 'Nothing recorded yet.';

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Whether the organisation's own details have been filled in beyond the name
 * the wizard required.
 *
 * `timezone` is the one that matters operationally rather than cosmetically:
 * every date on the dashboard and every day boundary in a report is resolved
 * through it, and the column has a default, so "not set" here means "left at
 * the default", which is a different claim from "missing". Stated as such.
 */
function organisationStep(facts: SetupFacts): SetupStep {
  const org = facts.organisation;
  const industry = org?.industry ?? null;
  const timezone = org?.timezone ?? null;
  const done = Boolean(industry) && Boolean(timezone);

  return {
    id: 'organisation',
    title: 'Organisation details',
    why: 'The timezone here decides what "today" means on every screen and in every export.',
    to: '/app/settings/organisation',
    status: done ? 'done' : 'todo',
    required: true,
    detail: org
      ? `${org.name}${timezone ? ` · ${timezone}` : ' · no timezone set'}${industry ? '' : ' · no industry set'}`
      : NONE,
  };
}

/**
 * The steps, in the order somebody would actually do them.
 *
 * Ordering is a dependency chain, not a preference: a shift needs a location,
 * a rota needs a shift type and somebody to put on it, and publishing needs a
 * rota. Each step that depends on an earlier one says which, so a `blocked`
 * row is an explanation rather than a dead end.
 */
export function buildSetupSteps(facts: SetupFacts): SetupStep[] {
  const hasLocation = facts.locations > 0;
  const hasStaff = facts.staff > 0;
  const hasShiftType = facts.shiftTypes > 0;

  return [
    organisationStep(facts),

    {
      id: 'locations',
      title: 'Locations',
      why: 'A shift belongs to a site. Without one there is nowhere to put a rota.',
      to: '/app/locations',
      status: hasLocation ? 'done' : 'todo',
      required: true,
      detail: hasLocation ? plural(facts.locations, 'site') : NONE,
    },

    {
      id: 'departments',
      title: 'Departments',
      why: 'Groups people within a site, so cover and hours can be read per team.',
      to: '/app/locations/departments',
      status: facts.departments > 0 ? 'done' : hasLocation ? 'optional' : 'blocked',
      required: false,
      ...(hasLocation ? {} : { blockedBy: 'locations' as const }),
      detail:
        facts.departments > 0
          ? plural(facts.departments, 'department')
          : 'None. An organisation with one site often needs none.',
    },

    {
      id: 'job_titles',
      title: 'Job titles',
      why: 'What people do, and the colour their work shows in on the rota. A title grants nothing.',
      to: '/app/settings/roles',
      status: facts.jobTitles > 0 ? 'done' : 'optional',
      required: false,
      detail:
        facts.jobTitles > 0
          ? plural(facts.jobTitles, 'title')
          : 'None. Staff records will show no occupation until there are some.',
    },

    {
      id: 'shift_types',
      title: 'Shift types',
      why: 'Early, Late, Night — with their usual times and unpaid break, so a shift is one click rather than four fields.',
      to: '/app/rota',
      status: hasShiftType ? 'done' : 'todo',
      required: true,
      detail: hasShiftType ? plural(facts.shiftTypes, 'shift type') : NONE,
    },

    {
      id: 'cover',
      title: 'Staffing minimums',
      why: 'How many people each site needs on each weekday. This is what the cover chart and the publish gate measure against.',
      to: '/app/locations',
      status: facts.minimumCoverRules > 0 ? 'done' : hasLocation ? 'optional' : 'blocked',
      required: false,
      ...(hasLocation ? {} : { blockedBy: 'locations' as const }),
      detail:
        facts.minimumCoverRules > 0
          ? plural(facts.minimumCoverRules, 'rule')
          : // Silence means no policy, not a minimum of zero — the same rule
            // `requiredForWeekday` applies. Said plainly so nobody reads an
            // empty chart line as "fully covered".
            'None. With no minimum recorded, no day can be reported as short.',
    },

    {
      id: 'staff',
      title: 'Staff records',
      why: 'The people a rota is built from. A staff record is not a sign-in — see the next step.',
      to: '/app/team',
      status: hasStaff ? 'done' : 'todo',
      required: true,
      detail: hasStaff
        ? `${plural(facts.staff, 'person', 'people')}${
            facts.staffWithoutAccount > 0
              ? ` · ${facts.staffWithoutAccount} cannot sign in yet`
              : ' · all can sign in'
          }`
        : NONE,
    },

    {
      id: 'invites',
      title: 'Sign-ins',
      why: 'A staff record holds someone’s hours; an invitation gives them an account to see them.',
      to: '/app/settings/permissions',
      status: inviteStatus(facts),
      required: false,
      detail: inviteDetail(facts),
    },

    {
      id: 'rota',
      title: 'First rota',
      why: 'A week of shifts, saved as a draft. Nothing is visible to staff until it is published.',
      to: '/app/rota',
      status:
        facts.rotasAny > 0
          ? 'done'
          : hasLocation && hasStaff && hasShiftType
            ? 'todo'
            : 'blocked',
      required: true,
      ...(facts.rotasAny > 0 || (hasLocation && hasStaff && hasShiftType)
        ? {}
        : {
            blockedBy: !hasLocation ? 'locations' : !hasStaff ? 'staff' : 'shift_types',
          }),
      detail: facts.rotasAny > 0 ? plural(facts.rotasAny, 'rota') : NONE,
    },

    {
      id: 'publish',
      title: 'Publish it',
      why: 'Publishing is what makes the rota visible to staff and what notifies them.',
      to: '/app/rota',
      status: facts.rotasPublished > 0 ? 'done' : facts.rotasAny > 0 ? 'todo' : 'blocked',
      required: true,
      ...(facts.rotasPublished > 0 || facts.rotasAny > 0
        ? {}
        : { blockedBy: 'rota' as const }),
      detail:
        facts.rotasPublished > 0
          ? plural(facts.rotasPublished, 'published rota')
          : 'Nothing published. Staff can see no shifts at all.',
    },
  ];
}

/**
 * The sign-in step's state.
 *
 * Four distinct facts, and the request that prompted this asked for all four
 * to be told apart: a saved staff record, an invitation issued, an invitation
 * accepted, and an email that actually left. Before `0129` the last of those
 * was not persisted at all — a failed send was a toast and then nothing — so
 * a pending invitation that had never been delivered was indistinguishable
 * from one somebody was simply slow to accept.
 *
 * A failure outranks everything: it is the only one of the four that is
 * waiting on the manager rather than on the invitee.
 */
function inviteStatus(facts: SetupFacts): SetupStepStatus {
  if (facts.invitesFailed > 0 || facts.invitesNeverSent > 0) return 'todo';
  if (facts.invitesAccepted > 0 || facts.invitesPending > 0) return 'done';
  if (facts.staffWithoutAccount > 0) return 'optional';
  return facts.staff > 0 ? 'done' : 'optional';
}

function inviteDetail(facts: SetupFacts): string {
  const parts: string[] = [];
  if (facts.invitesAccepted > 0) parts.push(`${facts.invitesAccepted} accepted`);
  if (facts.invitesPending > 0) parts.push(`${facts.invitesPending} waiting`);
  if (facts.invitesNeverSent > 0) {
    parts.push(`${facts.invitesNeverSent} never emailed`);
  }
  if (facts.invitesFailed > 0) parts.push(`${facts.invitesFailed} failed to send`);
  if (facts.invitesExpired > 0) parts.push(`${facts.invitesExpired} expired`);
  if (parts.length === 0) {
    return facts.staffWithoutAccount > 0
      ? `No invitations. ${facts.staffWithoutAccount} staff cannot sign in.`
      : 'No invitations outstanding.';
  }
  return parts.join(' · ');
}

export interface SetupSummary {
  /** Required steps that are done. */
  requiredDone: number;
  requiredTotal: number;
  /** Every step, required or not. */
  done: number;
  total: number;
  /** True when every REQUIRED step is done. Optional ones never block this. */
  complete: boolean;
  /** The next thing to do — the first required step that is not done and not blocked. */
  next: SetupStep | null;
}

export function summariseSetup(steps: SetupStep[]): SetupSummary {
  const required = steps.filter((step) => step.required);
  const requiredDone = required.filter((step) => step.status === 'done').length;
  return {
    requiredDone,
    requiredTotal: required.length,
    done: steps.filter((step) => step.status === 'done').length,
    total: steps.length,
    complete: requiredDone === required.length,
    // Not merely "the first unfinished step": a blocked one cannot be acted
    // on, so pointing at it would send somebody to a screen that refuses them.
    next:
      required.find((step) => step.status === 'todo') ??
      steps.find((step) => step.status === 'todo') ??
      null,
  };
}
