import { api, isApiCode } from '@/lib/api';
import type { Tables } from '@/types/database.types';

export type Incident = Tables<'incidents'>;
export type IncidentUpdate = Tables<'incident_updates'>;

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

/**
 * Platform incidents (0021).
 *
 * Reads are plain queries, `incidents_select` admits platform staff and
 * nobody else. Every write is an RPC, because the migration revoked insert,
 * update and delete: the reference number, the mandatory resolution note and
 * the audit row are all things a client must not be able to skip.
 */

/** Most recent first. `limit` bounds the register; the screen says what it loaded. */
export async function listIncidents(limit = 100): Promise<Incident[]> {
  const r = await api.get<{ incidents: Incident[] }>('/platform/incidents');
  return r.incidents.slice(0, limit);
}

async function detail(
  id: string,
): Promise<{ incident: Incident; updates: IncidentUpdate[] } | null> {
  try {
    return await api.get<{ incident: Incident; updates: IncidentUpdate[] }>(
      `/platform/incidents/${encodeURIComponent(id)}`,
    );
  } catch (error) {
    if (isApiCode(error, 'not_found')) return null;
    throw error;
  }
}

export async function getIncident(id: string): Promise<Incident | null> {
  return (await detail(id))?.incident ?? null;
}

/** The timeline, oldest first. It is read as a narrative. */
export async function listIncidentUpdates(incidentId: string): Promise<IncidentUpdate[]> {
  return ((await detail(incidentId))?.updates ?? []).map((u) => ({
    ...u,
    incident_id: incidentId,
  }));
}

export async function declareIncident(input: {
  title: string;
  impact: string;
  severity: IncidentSeverity;
  service: string;
  startedAt?: string;
}): Promise<string> {
  const r = await api.post<{ id: string }>('/platform/incidents', {
    title: input.title,
    impact: input.impact,
    severity: input.severity,
    service: input.service,
    started_at: input.startedAt ?? null,
  });
  return r.id;
}

export async function addIncidentUpdate(
  incidentId: string,
  status: Exclude<IncidentStatus, 'resolved'>,
  body: string,
): Promise<void> {
  await api.post(`/platform/incidents/${encodeURIComponent(incidentId)}/updates`, {
    status,
    body,
  });
}

/**
 * Close one. The resolution note is required by the function and by a CHECK,
 * a resolved incident nobody described is a hole in the mean-time-to-resolve.
 */
export async function resolveIncident(
  incidentId: string,
  resolution: string,
): Promise<void> {
  await api.post(`/platform/incidents/${encodeURIComponent(incidentId)}/resolve`, {
    resolution,
  });
}
