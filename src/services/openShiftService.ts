import { api, currentOrgId, orgPath, seg } from '@/lib/api';

/**
 * Open shifts: future, unassigned shifts on a published rota, soonest first. Claiming is first come, first served,
 * and the API refuses one that has started, is not on a published rota, was just taken (409 `shift_taken`) or
 * overlaps the person's own work (409 `already_working`), and (since the S12 owner decision, whatever the
 * `cover_tools` flag says) refuses a person who is not eligible (409 `not_eligible`, the reasons in one sentence,
 * which the page shows as is).
 *
 * Each row also carries the reader's own eligibility (owner decision, 31 Oct 2026): the same reasons the claim
 * would refuse with, so the card can say why before anyone presses Take it. Only the reader's; null for a member
 * with no staff record.
 */
export interface OpenShiftReason {
  code: string;
  message: string;
}

export interface OpenShiftEligibility {
  eligible: boolean;
  reasons: OpenShiftReason[];
}

export interface OpenShift {
  shiftId: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes: string | null;
  shiftType: string | null;
  locationName: string | null;
  clashesWithMine: boolean;
  /** The reader's own eligibility for this shift; null without a staff record (or from an older API). */
  myEligibility: OpenShiftEligibility | null;
}

function eligibilityOf(v: unknown): OpenShiftEligibility | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as { eligible?: unknown; reasons?: unknown };
  if (typeof e.eligible !== 'boolean' || !Array.isArray(e.reasons)) return null;
  const reasons = (e.reasons as unknown[]).filter(
    (r): r is OpenShiftReason =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as OpenShiftReason).code === 'string' &&
      typeof (r as OpenShiftReason).message === 'string',
  );
  return { eligible: e.eligible, reasons };
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
      my_eligibility?: unknown;
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
    myEligibility: eligibilityOf(row.my_eligibility),
  }));
}

export async function claimOpenShift(shiftId: string): Promise<void> {
  await api.post(orgPath(currentOrgId(), `/open-shifts/${seg(shiftId)}/claim`));
}
