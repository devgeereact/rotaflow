import { activeOrgPath, api, isApiCode, orgPath, seg } from '@/lib/api';
import { normaliseJobTitleName } from '@/lib/jobTitlePalette';
import type { JobTitle, JobTitleInsert, JobTitleUpdate } from '@/types';

/**
 * The organisation's job-title catalogue (`0127`).
 *
 * Every uniqueness rule this module reports is enforced by the database, not
 * by these functions: `job_titles_org_name_key` on the normalised name and
 * `job_titles_org_active_colour_key` on the colour of an active title. The
 * checks here exist to give a person a sentence they can act on, and the
 * error translation below exists because two managers pressing Save at the
 * same moment is exactly when a pre-flight check is worth nothing.
 */

/** Postgres' unique-violation SQLSTATE. */

export class JobTitleConflictError extends Error {
  constructor(
    message: string,
    /** Which rule was broken, so the form can point at the right field. */
    readonly field: 'name' | 'colour',
  ) {
    super(message);
    this.name = 'JobTitleConflictError';
  }
}

/**
 * Turn a constraint violation into something a manager can act on.
 *
 * Matched on the constraint NAME rather than on the message text: the message
 * is localised by the server's locale and has changed between Postgres
 * versions, and a substring match on it would silently stop working while
 * still compiling.
 */
function translateConflict(error: unknown): never {
  if (isApiCode(error, 'colour_in_use')) {
    throw new JobTitleConflictError(
      'Another active job title already uses that colour. Pick a free one, or archive the title that has it.',
      'colour',
    );
  }
  if (isApiCode(error, 'title_exists')) {
    throw new JobTitleConflictError(
      'A job title with that name already exists. Names are compared without regard to capitals or extra spaces.',
      'name',
    );
  }
  throw error;
}

/**
 * Every title in the organisation, archived ones included, ordered by name.
 *
 * Archived titles are returned deliberately: a directory has to keep
 * rendering "Senior Carer" against the people who hold it and against the
 * shifts that were worked under it. Callers filling in a picker filter to
 * `active` themselves — see `activeJobTitles`.
 */
export async function listJobTitles(orgId: string): Promise<JobTitle[]> {
  const r = await api.get<{ job_titles: Omit<JobTitle, 'org_id'>[] }>(
    orgPath(orgId, '/job-titles'),
  );
  return r.job_titles
    .map((t) => ({ ...t, org_id: orgId, active: Boolean(t.active) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function activeJobTitles(titles: JobTitle[]): JobTitle[] {
  return titles.filter((title) => title.active);
}

/** Palette ids already taken by an active title, for the colour picker. */
export function usedColourIds(titles: JobTitle[]): string[] {
  return titles
    .filter((title) => title.active && title.colour !== null)
    .map((title) => title.colour as string);
}

export async function createJobTitle(input: JobTitleInsert): Promise<JobTitle> {
  let id: string;
  try {
    id = (
      await api.post<{ id: string }>(orgPath(input.org_id, '/job-titles'), {
        name: input.name.trim(),
        colour: input.colour ?? null,
        active: input.active ?? true,
      })
    ).id;
  } catch (error) {
    translateConflict(error);
  }
  const found = (await listJobTitles(input.org_id)).find((t) => t.id === id);
  if (!found) throw new Error('Job title not found');
  return found;
}

export async function updateJobTitle(
  id: string,
  patch: JobTitleUpdate,
): Promise<JobTitle> {
  const path = patch.org_id
    ? orgPath(patch.org_id, '/job-titles')
    : activeOrgPath('/job-titles');
  const r = await api.get<{ job_titles: JobTitle[] }>(path);
  const current = r.job_titles.find((t) => t.id === id);
  if (!current) throw new Error('Job title not found');
  const merged = {
    ...current,
    ...patch,
    active: patch.active ?? Boolean(current.active),
  };
  try {
    await api.post(`${path}/${seg(id)}`, {
      name: merged.name.trim(),
      colour: merged.colour ?? null,
      active: merged.active,
    });
  } catch (error) {
    translateConflict(error);
  }
  return { ...merged, name: merged.name.trim() };
}

/**
 * Archive or restore.
 *
 * Archiving releases the colour back to the palette — the partial unique index
 * covers active rows only — so the title keeps its swatch for history while a
 * new occupation may claim it. Restoring can therefore fail with a colour
 * conflict, which is correct and is reported as such rather than silently
 * clearing the colour.
 */
export async function setJobTitleActive(id: string, active: boolean): Promise<JobTitle> {
  return updateJobTitle(id, { active });
}

/**
 * Whether a name is free, asked before the form is submitted.
 *
 * Advisory only. The unique index is what actually decides, and
 * `createJobTitle` still translates its violation: between this check and the
 * insert another manager can take the name.
 */
export async function isJobTitleNameFree(
  orgId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const normalised = normaliseJobTitleName(name);
  if (normalised === '') return false;
  return !(await listJobTitles(orgId)).some(
    (t) => t.id !== excludeId && normaliseJobTitleName(t.name) === normalised,
  );
}

/**
 * Whether managers, and not only the owner, may edit the catalogue.
 *
 * Asks the database the same question its RLS policy asks, rather than
 * re-deriving it from `organisations.settings` in the browser: the setting is
 * only advisory here, and a screen that computed its own answer could offer a
 * button the policy then refuses.
 */
export async function canManageJobTitles(orgId: string): Promise<boolean> {
  // The API's rule (Staff::titleManager): the owner always; managers when the owner has said so.
  const r = await api.get<{
    org: { settings: { job_titles_managed_by?: string } | null };
    membership: { effective_role: string };
  }>(orgPath(orgId));
  const role = r.membership.effective_role;
  return (
    role === 'owner' ||
    (role === 'manager' && r.org.settings?.job_titles_managed_by === 'managers')
  );
}
