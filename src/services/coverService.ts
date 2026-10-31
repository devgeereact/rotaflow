import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import type { CoverReason } from '@/lib/coverRules';
import type { SchedulingWarning } from '@/lib/schedulingRules';

/**
 * Cover (R2 slice S12): absence reports, cover requests, applications and the manager's cover
 * board. Every screen that uses this stays behind the `cover_tools` feature flag
 * (useFeatureAccess), and the server refuses these routes (403 feature_off) while the flag is off.
 * With it on, the instant open-shift claim also checks eligibility on the server, and a shift with
 * an open cover request is applied for here instead (409 `cover_request_open`).
 */
export const COVER_FEATURE = 'cover_tools';

export interface CoverShift {
  id: string;
  rota_id: string | null;
  location_id: string | null;
  location_name: string | null;
  shift_type: string | null;
  staff_profile_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  status: string;
  timezone: string | null;
  notes: string | null;
}

export interface CoverApplication {
  id: string;
  shift_id: string;
  staff_profile_id: string;
  cover_request_id: string | null;
  status: 'pending' | 'withdrawn' | 'approved' | 'rejected';
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoverRequest {
  id: string;
  shift_id: string;
  status: 'open' | 'filled' | 'cancelled';
  note: string | null;
  respond_by: string | null;
  absence_id: string | null;
  absent_staff_profile_id: string | null;
  filled_staff_profile_id: string | null;
  offered_count: number;
  close_reason: string | null;
  created_at: string;
}

export interface CoverAbsence {
  id: string;
  shift_id: string;
  staff_profile_id: string;
  reason: string;
  status: 'open' | 'covered' | 'dismissed' | 'withdrawn';
  created_at: string;
}

export interface Assessed {
  eligible: boolean;
  reasons: CoverReason[];
  warnings: SchedulingWarning[];
}

export type BoardApplication = CoverApplication &
  Assessed & { name: string | null; shift: CoverShift };

export interface CoverOverview {
  counts: {
    open_requests: number;
    unfilled_72h: number;
    pending_applications: number;
    open_absences: number;
  };
  requests: (CoverRequest & {
    absent_name: string | null;
    shift: CoverShift;
    applicants: BoardApplication[];
  })[];
  applications: BoardApplication[];
  absences: (CoverAbsence & { name: string | null; shift: CoverShift })[];
  unfilled: (CoverShift & { cover_request_id: string | null; applicants: number })[];
  history: {
    action: string;
    entity_type: string;
    entity_id: string | null;
    at: string;
  }[];
}

export type Candidate = Assessed & {
  staff_profile_id: string;
  name: string;
  application: { id: string; status: string } | null;
  hours_that_week: number;
};

/** An open shift as the cover module sees it. The eligibility fields are present for a person with a staff record. */
export type CoverOpenShift = CoverShift &
  Partial<Assessed> & {
    cover_request: { id: string; note: string | null; respond_by: string | null } | null;
    application?: { id: string; status: string } | null;
  };

export interface CoverMine {
  upcoming: (CoverShift & { absence_id: string | null })[];
  absences: (CoverAbsence & { shift: CoverShift | null })[];
  applications: (CoverApplication & { shift: CoverShift | null })[];
}

const p = (path: string): string => activeOrgPath(`/cover${path}`);

export async function getCoverOverview(orgId: string): Promise<CoverOverview> {
  return api.get<CoverOverview>(orgPath(orgId, '/cover/overview'));
}

export async function getCoverOpen(orgId: string): Promise<CoverOpenShift[]> {
  return (await api.get<{ shifts: CoverOpenShift[] }>(orgPath(orgId, '/cover/open')))
    .shifts;
}

export async function getCoverMine(orgId: string): Promise<CoverMine> {
  return api.get<CoverMine>(orgPath(orgId, '/cover/mine'));
}

export async function getCandidates(
  shiftId: string,
): Promise<{ shift: CoverShift; candidates: Candidate[] }> {
  return api.get<{ shift: CoverShift; candidates: Candidate[] }>(
    p(`/shifts/${seg(shiftId)}/candidates`),
  );
}

export async function applyForCover(
  shiftId: string,
  note?: string,
): Promise<CoverApplication> {
  return (
    await api.post<{ application: CoverApplication }>(
      p(`/shifts/${seg(shiftId)}/apply`),
      note ? { note } : {},
    )
  ).application;
}

export async function assignCover(
  shiftId: string,
  staffProfileId: string,
): Promise<void> {
  await api.post(p(`/shifts/${seg(shiftId)}/assign`), {
    staff_profile_id: staffProfileId,
  });
}

export async function createCoverRequest(body: {
  shift_id: string;
  absence_id?: string;
  note?: string;
  respond_by?: string;
}): Promise<{ request: CoverRequest; offered: number }> {
  return api.post<{ request: CoverRequest; offered: number }>(p('/requests'), body);
}

export async function cancelCoverRequest(requestId: string): Promise<void> {
  await api.post(p(`/requests/${seg(requestId)}/cancel`));
}

export async function decideApplication(
  applicationId: string,
  action: 'approve' | 'reject' | 'withdraw',
): Promise<void> {
  await api.post(p(`/applications/${seg(applicationId)}/${action}`));
}

export async function reportAbsence(
  shiftId: string,
  reason: string,
): Promise<CoverAbsence> {
  return (
    await api.post<{ absence: CoverAbsence }>(p('/absences'), {
      shift_id: shiftId,
      reason,
    })
  ).absence;
}

export async function closeAbsence(
  absenceId: string,
  action: 'withdraw' | 'dismiss',
): Promise<void> {
  await api.post(p(`/absences/${seg(absenceId)}/${action}`));
}
