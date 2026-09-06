import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/pagination';
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
const UNIQUE_VIOLATION = '23505';

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
  const details = error as { code?: string; message?: string } | null;
  if (details?.code === UNIQUE_VIOLATION) {
    const message = details.message ?? '';
    if (message.includes('job_titles_org_active_colour_key')) {
      throw new JobTitleConflictError(
        'Another active job title already uses that colour. Pick a free one, or archive the title that has it.',
        'colour',
      );
    }
    if (message.includes('job_titles_org_name_key')) {
      throw new JobTitleConflictError(
        'A job title with that name already exists. Names are compared without regard to capitals or extra spaces.',
        'name',
      );
    }
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
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('job_titles')
      .select('*')
      .eq('org_id', orgId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });
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
  const { data, error } = await supabase
    .from('job_titles')
    .insert({ ...input, name: input.name.trim() })
    .select('*')
    .single();
  if (error) translateConflict(error);
  return data;
}

export async function updateJobTitle(
  id: string,
  patch: JobTitleUpdate,
): Promise<JobTitle> {
  const { data, error } = await supabase
    .from('job_titles')
    .update(patch.name === undefined ? patch : { ...patch, name: patch.name.trim() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) translateConflict(error);
  return data;
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

  let request = supabase
    .from('job_titles')
    .select('id')
    .eq('org_id', orgId)
    .eq('name_normalised', normalised);
  if (excludeId) request = request.neq('id', excludeId);

  const { data, error } = await request.limit(1);
  if (error) throw error;
  return (data ?? []).length === 0;
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
  const { data, error } = await supabase.rpc('can_manage_job_titles', { p_org: orgId });
  if (error) throw error;
  return data === true;
}
