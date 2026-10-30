import { activeOrgPath, api, isApiCode, orgPath, seg } from '@/lib/api';
import type { OvertimeRequest, OvertimeRequestInsert } from '@/types';

/**
 * `overtime_requests` reader/writer.
 *
 * The table has existed since migration 0001 and carried no service at all,
 * the 2026-08-04 audit (now `docs/SAAS.md`) P2-7, and NEW_STRUCTURE §34's `/app/overtime` had nothing behind it.
 * Staff could not offer overtime and managers could not allocate it, so the
 * hours a rota actually costs beyond contract were invisible outside the
 * timesheet totals.
 *
 * Shaped deliberately like `leaveService`: the two are the same workflow,
 * a person asks, a manager decides, the decision is stamped with who and when.
 * Matching them means the pages, the status vocabulary and the RLS story stay
 * recognisable rather than each request type inventing its own.
 */

/** One person's own requests. The staff view. */
export async function listMyOvertimeRequests(
  staffProfileId: string,
): Promise<OvertimeRequest[]> {
  const r = await api.get<{ overtime: OvertimeRequest[] }>(activeOrgPath('/overtime'), {
    staff_profile_id: staffProfileId,
  });
  return r.overtime.map(toOvertime).sort((a, b) => b.date.localeCompare(a.date));
}

function toOvertime(r: OvertimeRequest): OvertimeRequest {
  return { ...r, hours: Number(r.hours) };
}

/** Every request across the org. The manager approval queue. */
export async function listOrgOvertimeRequests(orgId: string): Promise<OvertimeRequest[]> {
  const r = await api.get<{ overtime: OvertimeRequest[] }>(orgPath(orgId, '/overtime'));
  return r.overtime
    .map(toOvertime)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createOvertimeRequest(
  input: OvertimeRequestInsert,
): Promise<OvertimeRequest> {
  const r = await api.post<{ overtime: OvertimeRequest }>(
    orgPath(input.org_id, '/overtime'),
    {
      staff_profile_id: input.staff_profile_id,
      date: input.date,
      hours: input.hours,
      note: input.note ?? null,
    },
  );
  return toOvertime(r.overtime);
}

/**
 * Manager approve/reject. Returns `null` when the claim was already decided
 * or withdrawn by the time this landed (BUG-061).
 *
 * RLS (`has_org_role`) is the real enforcement. This only records the
 * decision. `reviewed_by` takes the reviewer's **user id**, matching
 * `reviewLeaveRequest`, because the column FKs `profiles`.
 *
 * The `status = 'pending'` predicate makes the decision atomic: Postgres
 * re-evaluates the WHERE clause under the row lock, so two managers racing
 * produce one update and one no-op instead of the second silently overwriting
 * the first's `reviewed_by`. It also loses to a withdrawal, which is the
 * behaviour a staff member expects from a button labelled Withdraw. Overtime
 * carries this further than leave or swaps do — an approval is what sends the
 * hours to payroll.
 */
export async function reviewOvertimeRequest(
  id: string,
  status: 'approved' | 'rejected',
  _reviewedBy: string,
): Promise<OvertimeRequest | null> {
  // The reviewer is the signed-in person; a request already decided is the "no longer pending" null.
  try {
    const r = await api.post<{ overtime: OvertimeRequest }>(
      activeOrgPath(`/overtime/${seg(id)}/review`),
      { status },
    );
    return toOvertime(r.overtime);
  } catch (error) {
    if (isApiCode(error, 'already_decided')) return null;
    throw error;
  }
}

/**
 * Staff withdrawing their own still-pending claim. Returns false when it was
 * no longer pending — the same guard from the other side, so a withdrawal that
 * arrives after a manager's decision cannot silently un-approve hours that
 * have already gone to payroll. Until now the doc comment above was the only
 * thing that said "still-pending"; nothing enforced it.
 */
export async function cancelOvertimeRequest(id: string): Promise<boolean> {
  try {
    await api.post(activeOrgPath(`/overtime/${seg(id)}/cancel`));
    return true;
  } catch (error) {
    if (isApiCode(error, 'cannot_cancel')) return false;
    throw error;
  }
}

export interface OvertimeEvidence {
  /** Paid minutes the person was rostered for that day, net of breaks. */
  scheduledMinutes: number;
  /** Minutes between paired clock in/out events on that day. */
  workedMinutes: number;
  /** `in` events with no `out` after them — the forgotten clock-out. */
  unpairedEvents: number;
}

/**
 * What the clock recorded against what was scheduled, for one person on one
 * day (CAP-087, `0097`).
 *
 * `overtime_requests.hours` is a number somebody types, and until now nothing
 * compared it to anything — while the row goes to payroll.
 *
 * This deliberately does NOT replace the typed number. Clock data is least
 * complete exactly when overtime happens: the carer who stays late to cover an
 * incident is the one most likely to forget to clock out. A derived figure
 * would be the authoritative-looking wrong answer. What an approver gets is
 * something to judge against, including the freedom to approve a claim the
 * clock does not support — which is a real and legitimate case.
 *
 * Returns null if the evidence cannot be read. The claim is still reviewable;
 * an approval screen that breaks because a supporting query failed would be a
 * worse outcome than one without the extra context.
 */
export async function getOvertimeEvidence(
  orgId: string,
  staffProfileId: string,
  date: string,
): Promise<OvertimeEvidence | null> {
  try {
    const r = await api.get<{
      scheduled_minutes: number;
      worked_minutes: number;
      unpaired_events: number;
    }>(orgPath(orgId, '/overtime/evidence'), { staff_profile_id: staffProfileId, date });
    return {
      scheduledMinutes: r.scheduled_minutes,
      workedMinutes: r.worked_minutes,
      unpairedEvents: r.unpaired_events,
    };
  } catch {
    return null;
  }
}
