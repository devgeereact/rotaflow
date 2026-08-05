import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type ConnectorStats = Tables<'integration_connector_stats'>;
export type OrgIntegration = Tables<'org_integrations'>;
export type SyncRun = Tables<'integration_sync_runs'>;

/**
 * Integration connectors and their reliability (0026).
 *
 * The per-connector figures come from the `integration_connector_stats` view,
 * which aggregates in Postgres. The alternative — pulling every sync run to a
 * browser to divide two numbers — is the same answer at a hundred times the
 * cost, and gets slower every day the product runs.
 */
export async function listConnectorStats(): Promise<ConnectorStats[]> {
  const { data, error } = await supabase
    .from('integration_connector_stats')
    .select('*')
    .order('orgs_connected', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listOrgIntegrations(orgId: string): Promise<OrgIntegration[]> {
  const { data, error } = await supabase
    .from('org_integrations')
    .select('*')
    .eq('org_id', orgId)
    .order('connector_key');
  if (error) throw error;
  return data ?? [];
}

/** The most recent failures, for the "what is broken right now" panel. */
export async function listRecentFailures(limit = 25): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('integration_sync_runs')
    .select('*')
    .eq('outcome', 'failed')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function connectIntegration(
  orgId: string,
  connectorKey: string,
  credentialsRef?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('connect_integration', {
    p_org: orgId,
    p_connector: connectorKey,
    p_ref: credentialsRef ?? null,
  });
  if (error) throw error;
  return data;
}

export async function setOrgIntegrationStatus(
  orgId: string,
  connectorKey: string,
  status: 'connected' | 'paused' | 'error' | 'disconnected',
): Promise<void> {
  const { error } = await supabase.rpc('set_org_integration_status', {
    p_org: orgId,
    p_connector: connectorKey,
    p_status: status,
  });
  if (error) throw error;
}
