import { supabase } from '@/lib/supabase';
import type { Organisation } from '@/types';

/**
 * Exporting and deleting a whole organisation.
 *
 * Kept apart from `orgService`, which is the everyday CRUD an owner does
 * dozens of times. These two are the end of the tenant's life: one is the
 * only copy of their data they will ever get, the other is irreversible and
 * unbacked. Grouping them makes the ordering — export, then confirm, then
 * delete — visible in one file rather than implied across a settings page.
 */

/** What a deletion is about to destroy, for the confirmation dialog. */
export interface OrganisationDeletionPreview {
  staffProfiles: number;
  locations: number;
  rotas: number;
  shifts: number;
  clockEvents: number;
  leaveRequests: number;
  documents: number;
  members: number;
}

export async function organisationDeletionPreview(
  orgId: string,
): Promise<OrganisationDeletionPreview | null> {
  const { data, error } = await supabase.rpc('organisation_deletion_preview', {
    p_org: orgId,
  });
  if (error) throw error;

  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    staffProfiles: row.staff_profiles,
    locations: row.locations,
    rotas: row.rotas,
    shifts: row.shifts,
    clockEvents: row.clock_events,
    leaveRequests: row.leave_requests,
    documents: row.documents,
    members: row.members,
  };
}

/**
 * Delete an organisation and everything scoped to it.
 *
 * `confirmName` must equal the organisation's name exactly; the database
 * checks it, not this call. Five triggers used to make this impossible
 * (BUG-009) — see `0063_delete_organisation.sql` for which, and why the fix
 * is an exemption the guards understand rather than turning them off.
 *
 * Irreversible, and this project has no point-in-time recovery. Do not call
 * it without offering `exportOrganisationData` first.
 */
export async function deleteOrganisation(
  orgId: string,
  confirmName: string,
): Promise<void> {
  const { error } = await supabase.rpc('delete_organisation', {
    p_org: orgId,
    p_confirm_name: confirmName,
  });
  if (error) throw error;
}

/**
 * Every table in the export, in the order a human would read them.
 *
 * Listed as data rather than written out as 20 awaited calls so the set is
 * reviewable: the risk in an export is a table quietly missing from it, and
 * that is much easier to spot in a list than in a paragraph of code.
 */
const EXPORTED_TABLES = [
  'locations',
  'departments',
  'staff_profiles',
  'shift_types',
  'shift_templates',
  'rotas',
  'shifts',
  'availability',
  'leave_requests',
  'overtime_requests',
  'shift_swaps',
  'clock_events',
  'timesheets',
  'emergency_contacts',
  'documents',
  'announcements',
  'invites',
  'memberships',
  'audit_logs',
  'subscriptions',
] as const;

type ExportedTable = (typeof EXPORTED_TABLES)[number];

export interface OrganisationExport {
  exportedAt: string;
  organisation: Organisation;
  tables: Record<ExportedTable, unknown[]>;
  /** Tables the reader's own permissions kept out of the file. */
  omitted: { table: string; reason: string }[];
  notes: string[];
}

/**
 * Everything RotaFlow holds for one organisation, as one JSON file.
 *
 * Read through the caller's own session, so RLS decides what comes back: an
 * owner gets their whole tenant, and nobody gets anybody else's. A table the
 * reader cannot see is recorded in `omitted` with the reason rather than
 * silently absent — an export that quietly skips a table is worse than one
 * that refuses, because it looks complete.
 */
export async function exportOrganisationData(orgId: string): Promise<OrganisationExport> {
  const { data: organisation, error: orgError } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', orgId)
    .single();
  if (orgError) throw orgError;

  const tables = {} as Record<ExportedTable, unknown[]>;
  const omitted: { table: string; reason: string }[] = [];

  for (const table of EXPORTED_TABLES) {
    const { data, error } = await supabase.from(table).select('*').eq('org_id', orgId);
    if (error) {
      tables[table] = [];
      omitted.push({ table, reason: error.message });
      continue;
    }
    tables[table] = data ?? [];
  }

  return {
    exportedAt: new Date().toISOString(),
    organisation,
    tables,
    omitted,
    notes: [
      'Every row scoped to this organisation, read with your own permissions. A table you cannot read is listed under "omitted" with the reason, rather than left out silently.',
      'Files themselves are not included. `documents` records the URL of each uploaded file, held by ImageKit; download anything you need to keep before deleting the organisation.',
      "Staff accounts are not included. A person's RotaFlow login can belong to more than one organisation, so it is not this organisation's to export. Their employment record with you is in `staff_profiles` and the tables around it.",
      "Audit rows survive the organisation being deleted, by design: an audit trail a tenant deletion erases is not an audit trail. They are kept with the organisation's name and no longer linked to it.",
    ],
  };
}
