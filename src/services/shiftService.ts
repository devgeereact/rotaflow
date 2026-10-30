import { activeOrgPath, api, currentOrgId, orgPath, seg } from '@/lib/api';
import { dropSupersededShifts } from '@/lib/rotaRollup';
import type { Shift, ShiftInsert, ShiftUpdate } from '@/types';

/**
 * Shifts through the API (`/orgs/{o}/shifts`). A shift on a published rota cannot be changed (409, publish lock),
 * a read-only organisation cannot build (402), and staff never see shifts on a draft rota: the API filters them.
 */

type ApiShift = Shift & {
  rota?: { status?: string | null; supersedes_rota_id?: string | null } | null;
};

const FIELDS = [
  'rota_id',
  'location_id',
  'department_id',
  'staff_profile_id',
  'shift_type_id',
  'starts_at',
  'ends_at',
  'break_minutes',
  'status',
  'colour',
  'notes',
] as const;

function body(row: Partial<Shift>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in row) out[k] = row[k as keyof Shift];
  return out;
}

function strip(row: ApiShift): Shift {
  const out: ApiShift = { ...row };
  delete out.rota;
  return out;
}

/** The API answers at most 50 rota ids per read. */
const ROTA_CHUNK = 50;

async function fetchForRotas(orgId: string, rotaIds: string[]): Promise<ApiShift[]> {
  const rows: ApiShift[] = [];
  for (let i = 0; i < rotaIds.length; i += ROTA_CHUNK) {
    const r = await api.get<{ shifts: ApiShift[] }>(orgPath(orgId, '/shifts'), {
      rota_ids: rotaIds.slice(i, i + ROTA_CHUNK).join(','),
    });
    rows.push(...r.shifts);
  }
  return rows;
}

/** Create many shifts in one transaction (at most 500): all land or none do. */
export async function createShifts(shifts: ShiftInsert[]): Promise<Shift[]> {
  if (shifts.length === 0) return [];
  const orgId = shifts[0]?.org_id ?? '';
  const created: string[] = [];
  for (let i = 0; i < shifts.length; i += 500) {
    const r = await api.post<{ ids: string[] }>(orgPath(orgId, '/shifts/batch'), {
      shifts: shifts.slice(i, i + 500).map((s) => body(s as Partial<Shift>)),
    });
    created.push(...r.ids);
  }
  const rotaIds = [
    ...new Set(shifts.map((s) => s.rota_id).filter((id): id is string => !!id)),
  ];
  const wanted = new Set(created);
  const rows = (await fetchForRotas(orgId, rotaIds))
    .filter((s) => wanted.has(s.id))
    .map(strip);
  if (rows.length === created.length) return rows;
  // A shift with no rota is not reachable by rota id; read the period instead.
  const starts = shifts.map((s) => s.starts_at).sort();
  const ends = shifts.map((s) => s.ends_at).sort();
  const loose = await api.get<{ shifts: ApiShift[] }>(orgPath(orgId, '/shifts'), {
    from: starts[0],
    to: ends[ends.length - 1],
    overlapping: '1',
  });
  return loose.shifts.filter((s) => wanted.has(s.id)).map(strip);
}

export async function listShiftsForRotas(rotaIds: string[]): Promise<Shift[]> {
  if (rotaIds.length === 0) return [];
  const rows = await fetchForRotas(currentOrgId(), rotaIds);
  return rows
    .map(strip)
    .sort(
      (a, b) =>
        (a.rota_id ?? '').localeCompare(b.rota_id ?? '') ||
        a.starts_at.localeCompare(b.starts_at) ||
        a.id.localeCompare(b.id),
    );
}

export interface PeriodShiftQuery {
  orgId: string;
  fromIso: string;
  toIso: string;
  locationId?: string | null;
  staffProfileId?: string | null;
  /** Default true: only shifts on a published rota. False includes drafts, one version of each week. */
  publishedOnly?: boolean;
}

async function readPeriod(
  query: PeriodShiftQuery,
  overlapping: boolean,
): Promise<Shift[]> {
  const r = await api.get<{ shifts: ApiShift[] }>(orgPath(query.orgId, '/shifts'), {
    from: query.fromIso,
    to: query.toIso,
    overlapping: overlapping ? '1' : undefined,
    location_id: query.locationId ?? undefined,
    staff_profile_id: query.staffProfileId ?? undefined,
  });
  const rows = [...r.shifts].sort(
    (a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id),
  );
  const published = query.publishedOnly !== false;
  const versioned = published ? rows : dropSupersededShifts(rows);
  return versioned
    .filter((row) => !published || row.rota?.status === 'published')
    .map(strip);
}

/** Shifts that START in [fromIso, toIso). */
export async function listShiftsForPeriod(query: PeriodShiftQuery): Promise<Shift[]> {
  return readPeriod(query, false);
}

export type OverlappingShiftQuery = PeriodShiftQuery;

/** Shifts that overlap [fromIso, toIso) at all, including one that started before it. */
export async function listShiftsOverlapping(
  query: OverlappingShiftQuery,
): Promise<Shift[]> {
  return readPeriod(query, true);
}

export async function createShift(shift: ShiftInsert): Promise<Shift> {
  const r = await api.post<{ shift: ApiShift }>(
    orgPath(shift.org_id, '/shifts'),
    body(shift),
  );
  return strip(r.shift);
}

export async function updateShift(id: string, patch: ShiftUpdate): Promise<Shift> {
  const path = patch.org_id ? orgPath(patch.org_id, '/shifts') : activeOrgPath('/shifts');
  const r = await api.post<{ shift: ApiShift }>(`${path}/${seg(id)}`, body(patch));
  return strip(r.shift);
}

export async function deleteShift(id: string): Promise<void> {
  await api.post(activeOrgPath(`/shifts/${seg(id)}/delete`));
}
