import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type Incident = Tables<'incidents'>;
export type IncidentUpdate = Tables<'incident_updates'>;

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

/**
 * Platform incidents (0021).
 *
 * Reads are plain queries — `incidents_select` admits platform staff and
 * nobody else. Every write is an RPC, because the migration revoked insert,
 * update and delete: the reference number, the mandatory resolution note and
 * the audit row are all things a client must not be able to skip.
 */

/** Most recent first. `limit` bounds the register; the screen says what it loaded. */
export async function listIncidents(limit = 100): Promise<Incident[]> {
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getIncident(id: string): Promise<Incident | null> {
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The timeline, oldest first — it is read as a narrative. */
export async function listIncidentUpdates(incidentId: string): Promise<IncidentUpdate[]> {
  const { data, error } = await supabase
    .from('incident_updates')
    .select('*')
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function declareIncident(input: {
  title: string;
  impact: string;
  severity: IncidentSeverity;
  service: string;
  startedAt?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('declare_incident', {
    p_title: input.title,
    p_impact: input.impact,
    p_severity: input.severity,
    p_service: input.service,
    p_started_at: input.startedAt ?? null,
  });
  if (error) throw error;
  return data;
}

export async function addIncidentUpdate(
  incidentId: string,
  status: Exclude<IncidentStatus, 'resolved'>,
  body: string,
): Promise<void> {
  const { error } = await supabase.rpc('add_incident_update', {
    p_incident: incidentId,
    p_status: status,
    p_body: body,
  });
  if (error) throw error;
}

/**
 * Close one. The resolution note is required by the function and by a CHECK —
 * a resolved incident nobody described is a hole in the mean-time-to-resolve.
 */
export async function resolveIncident(
  incidentId: string,
  resolution: string,
): Promise<void> {
  const { error } = await supabase.rpc('resolve_incident', {
    p_incident: incidentId,
    p_resolution: resolution,
  });
  if (error) throw error;
}
