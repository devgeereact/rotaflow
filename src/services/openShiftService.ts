import { api, currentOrgId, orgPath, seg } from '@/lib/api';

/**
 * Open shifts: future, unassigned shifts on a published rota, soonest first. Claiming is first come, first served,
 * and the API refuses one that has started, is not on a published rota, was just taken (409 `shift_taken`) or
 * overlaps the person's own work (409 `already_working`), and (since the S12 owner decision, whatever the
 * `cover_tools` flag says) refuses a person who is not eligible (409 `not_eligible`, the reasons in one sentence,
 * which the page shows as is).
 */
export interface OpenShift {
  shiftId: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes: string | null;
  shiftType: string | null;
  locationName: string | null;
  clashesWithMine: boolean;
}

export async function listOpenShifts(orgId: string): Promise<OpenShift[]> {
  const r = await api.get<{
    open_shifts: {
      shift_id: string;
      starts_at: string;
      ends_at: string;
      break_minutes: number | string;
      notes: string | null;
      shift_type: string | null;
      location_name: string | null;
      clashes_with_mine: boolean;
    }[];
  }>(orgPath(orgId, '/open-shifts'));
  return r.open_shifts.map((row) => ({
    shiftId: row.shift_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    breakMinutes: Number(row.break_minutes),
    notes: row.notes,
    shiftType: row.shift_type,
    locationName: row.location_name,
    clashesWithMine: Boolean(row.clashes_with_mine),
  }));
}

export async function claimOpenShift(shiftId: string): Promise<void> {
  await api.post(orgPath(currentOrgId(), `/open-shifts/${seg(shiftId)}/claim`));
}
