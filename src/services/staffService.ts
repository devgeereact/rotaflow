import { supabase } from '@/lib/supabase';
import type { StaffProfile, StaffProfileInsert, StaffProfileUpdate } from '@/types';

/**
 * Reads go through `staff_profiles_visible`, writes go to `staff_profiles`.
 *
 * `0150` closed GAP-117: any member of an organisation could ask PostgREST for
 * a colleague's `payroll_id`, `email`, `phone`, `start_date` and
 * `holiday_allowance`, because `staff_profiles_select` admits every member and
 * column privileges are granted per ROLE — a manager and a cleaner are both
 * `authenticated`, so the grant could not tell them apart.
 *
 * Those five columns are now revoked from `authenticated` on the base table.
 * The view returns them only to an owner or manager of that organisation, or
 * on the reader's own record, and nulls them otherwise. So `select('*')`
 * against `staff_profiles` would now FAIL rather than leak, which is the point:
 * the mistake is loud instead of quiet.
 *
 * Writes are unaffected — the column UPDATE grants are unchanged — but a
 * `RETURNING *` needs read privilege on what it returns, so the three write
 * paths below insert or update, then read the row back through the view.
 */
const READ_VIEW = 'staff_profiles_visible' as const;

/** Ids per read-back request. 100 UUIDs is ~3.8 KB of query string. */
const READ_BACK_CHUNK = 100;

/** Active staff for an org, used to give the rota assistant real people to schedule. */
export async function listActiveStaff(orgId: string): Promise<StaffProfile[]> {
  const { data, error } = await supabase
    .from(READ_VIEW)
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('first_name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export interface ListStaffOptions {
  includeInactive?: boolean;
}

/** All staff for an org (active by default; pass includeInactive for the full roster). */
export async function listStaff(
  orgId: string,
  opts: ListStaffOptions = {},
): Promise<StaffProfile[]> {
  let query = supabase.from(READ_VIEW).select('*').eq('org_id', orgId);
  if (!opts.includeInactive) query = query.eq('active', true);

  const { data, error } = await query.order('first_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * The signed-in user's own staff profile in this org, if they have one.
 *
 * Returns null for a manager or owner who was never added to the staff
 * directory, a real case, since membership and staff record are separate
 * things. Callers must handle it rather than assuming everyone is staff.
 */
export async function getMyStaffProfile(
  orgId: string,
  userId: string,
): Promise<StaffProfile | null> {
  const { data, error } = await supabase
    .from(READ_VIEW)
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getStaffProfile(id: string): Promise<StaffProfile | null> {
  const { data, error } = await supabase
    .from(READ_VIEW)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createStaffProfile(
  input: StaffProfileInsert,
): Promise<StaffProfile> {
  // `RETURNING *` would ask for the five columns `0150` revoked, so the write
  // returns its id and the row is read back through the view. One extra round
  // trip, and the alternative is a service that only works for readers who do
  // not need the fix.
  const { data, error } = await supabase
    .from('staff_profiles')
    .insert(input)
    .select('id')
    .single();

  if (error) throw error;
  const created = await getStaffProfile(data.id);
  if (!created) throw new Error('Staff record was created but could not be read back.');
  return created;
}

export async function updateStaffProfile(
  id: string,
  patch: StaffProfileUpdate,
): Promise<StaffProfile> {
  // Same reason as `createStaffProfile`: read the row back through the view
  // rather than returning columns this role may no longer select. `id` is
  // still granted, so the write can return it — and it has to, because an
  // update that matches nothing is not an error in PostgREST. Without this the
  // only symptom of a wrong id was the read-back finding no row, reported as
  // "could not be read back", which reads like a permissions fault.
  const { data: matched, error } = await supabase
    .from('staff_profiles')
    .update(patch)
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!matched || matched.length === 0) {
    throw new Error('No staff record with that id in an organisation you can write to.');
  }

  const updated = await getStaffProfile(id);
  if (!updated) throw new Error('Staff record was updated but could not be read back.');
  return updated;
}

/** Soft-delete: staff_profiles.active gates rota/AI-assistant visibility. */
export async function deactivateStaffProfile(id: string): Promise<StaffProfile> {
  return updateStaffProfile(id, { active: false });
}

export async function reactivateStaffProfile(id: string): Promise<StaffProfile> {
  return updateStaffProfile(id, { active: true });
}

/**
 * Create several staff records in one round trip (CAP-084).
 *
 * One `insert` with an array rather than a loop of single inserts: sixty
 * round trips on a hotel wifi is a minute of a progress bar, and a loop that
 * fails on row 41 leaves the customer with a half-imported team and no way to
 * tell which half.
 *
 * It is NOT one transaction — PostgREST does not offer one — so the seat
 * limit (`0070`) can still refuse the batch partway. That is why the caller
 * reports how many landed rather than "done", and why the preview screen
 * shows the seat count before anything is sent.
 */
export async function createStaffProfiles(
  rows: readonly StaffProfileInsert[],
): Promise<StaffProfile[]> {
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from('staff_profiles')
    .insert(rows as StaffProfileInsert[])
    .select('id');

  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  // Read back through the view, for the reason given on `createStaffProfile`.
  //
  // In chunks, because the read-back is a GET and every id goes in the query
  // string: sixty is about 2.3 KB and fine, but this path exists to import a
  // whole team at once and a few hundred would reach the proxy's URL limit,
  // where the symptom is a 414 on an import that already wrote every row.
  const created: StaffProfile[] = [];
  for (let i = 0; i < ids.length; i += READ_BACK_CHUNK) {
    const { data: chunk, error: readError } = await supabase
      .from(READ_VIEW)
      .select('*')
      .in('id', ids.slice(i, i + READ_BACK_CHUNK));

    if (readError) throw readError;
    created.push(...(chunk ?? []));
  }

  return created.sort((a, b) => a.first_name.localeCompare(b.first_name));
}

/**
 * Where a person works, as a set (CAP-089, `0105`).
 *
 * A site used to be inherited from the department, so somebody had exactly
 * one by construction. That is why the team filter could not answer "who can
 * cover at Ward B tonight" for anybody whose department lives at Ward A.
 *
 * Absence means "nothing recorded", not "works nowhere" — every read falls
 * back to the department's site, so an organisation that never opens the
 * control sees what it saw before.
 */
export async function listStaffLocations(orgId: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('staff_locations')
    .select('staff_profile_id, location_id')
    .eq('org_id', orgId);

  if (error) throw error;

  const byStaff = new Map<string, string[]>();
  for (const row of data ?? []) {
    const existing = byStaff.get(row.staff_profile_id) ?? [];
    existing.push(row.location_id);
    byStaff.set(row.staff_profile_id, existing);
  }
  return byStaff;
}

/**
 * Replace one person's sites.
 *
 * Delete-then-insert rather than a diff: the table is two foreign keys, the
 * sets are tiny, and a diff would be more code to get subtly wrong for no
 * measurable gain. Not a transaction — PostgREST has none — so the delete is
 * ordered first: a failed insert leaves somebody with no sites recorded,
 * which reads as "nothing recorded" and falls back to their department,
 * rather than leaving a half-applied set nobody can tell is wrong.
 */
export async function setStaffLocations(
  orgId: string,
  staffProfileId: string,
  locationIds: readonly string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('staff_locations')
    .delete()
    .eq('org_id', orgId)
    .eq('staff_profile_id', staffProfileId);
  if (deleteError) throw deleteError;

  if (locationIds.length === 0) return;

  const { error } = await supabase.from('staff_locations').insert(
    locationIds.map((locationId) => ({
      org_id: orgId,
      staff_profile_id: staffProfileId,
      location_id: locationId,
    })),
  );
  if (error) throw error;
}
