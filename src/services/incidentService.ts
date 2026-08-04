import { supabase } from '@/lib/supabase';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/incidents';

/**
 * Platform incidents.
 *
 * Reads are plain queries; `platform_incidents_select` in 0021 admits every
 * platform role, deliberately including support and finance — an incident
 * nobody can see is an incident that gets opened twice.
 *
 * Writes go through RPCs that raise. The title and impact minimums, the
 * resolution note and the resolved/resolved_at pairing are enforced in the
 * database, so a refused write cannot look like a successful one.
 */

interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  service: string;
  impact: string;
  started_at: string;
  resolved_at: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
  incident_events:
    | {
        id: string;
        author_name: string | null;
        body: string;
        created_at: string;
      }[]
    | null;
}

const SELECT = `
  id, title, severity, status, service, impact, started_at, resolved_at,
  profiles:owner_user_id ( full_name, email ),
  incident_events ( id, author_name, body, created_at )
`;

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity as IncidentSeverity,
    status: row.status as IncidentStatus,
    service: row.service,
    impact: row.impact,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    ownerName: row.profiles?.full_name ?? row.profiles?.email ?? null,
    // Chronological: a timeline read newest-first is a timeline nobody can
    // follow. The list itself is sorted worst-first; the narrative is not.
    events: (row.incident_events ?? [])
      .map((e) => ({
        id: e.id,
        authorName: e.author_name,
        body: e.body,
        createdAt: e.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export async function listIncidents(limit = 100): Promise<Incident[]> {
  const { data, error } = await supabase
    .from('platform_incidents')
    .select(SELECT)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as IncidentRow[]).map(toIncident);
}

/**
 * Just the open ones, for Platform Health.
 *
 * Filtered in the query so it uses 0021's partial index and returns nothing
 * at all in the normal case where nothing is broken.
 */
export async function listOpenIncidents(): Promise<Incident[]> {
  const { data, error } = await supabase
    .from('platform_incidents')
    .select(SELECT)
    .neq('status', 'resolved')
    .order('started_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as IncidentRow[]).map(toIncident);
}

export async function openIncident(input: {
  title: string;
  severity: IncidentSeverity;
  service: string;
  impact: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('open_incident', {
    p_title: input.title,
    p_severity: input.severity,
    p_service: input.service,
    p_impact: input.impact,
  });
  if (error) throw error;
  return data;
}

export async function addIncidentEvent(
  incidentId: string,
  body: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_incident_event', {
    p_incident: incidentId,
    p_body: body,
  });
  if (error) throw error;
  return data;
}

/** Resolving requires a note — the database refuses without one. */
export async function setIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_incident_status', {
    p_incident: incidentId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw error;
}
