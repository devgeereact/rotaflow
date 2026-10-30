import { ApiError } from '@/lib/api';
import type { Tables } from '@/types/database.types';

/**
 * Third-party integrations. On the cut list (docs/MERGE-TARGET.md section 5): every connector was `planned`, and
 * nothing ever wrote a sync run. The reads answer empty and the writes are refused, so the screens show their
 * empty states rather than an error.
 */

export type ConnectorStats = Tables<'integration_connector_stats'>;
export type OrgIntegration = Tables<'org_integrations'>;
export type SyncRun = Tables<'integration_sync_runs'>;

const NOT_IN_THIS_RELEASE = 'Integrations are not available in this release.';

export async function listConnectorStats(): Promise<ConnectorStats[]> {
  return Promise.resolve([]);
}

export async function listOrgIntegrations(_orgId: string): Promise<OrgIntegration[]> {
  return Promise.resolve([]);
}

export async function listRecentFailures(_limit = 25): Promise<SyncRun[]> {
  return Promise.resolve([]);
}

export async function connectIntegration(
  _orgId: string,
  _connectorKey: string,
  _credentialsRef?: string,
): Promise<string> {
  return Promise.reject(new ApiError(405, 'not_available', NOT_IN_THIS_RELEASE));
}

export async function setOrgIntegrationStatus(
  _orgId: string,
  _connectorKey: string,
  _status: 'connected' | 'paused' | 'error' | 'disconnected',
): Promise<void> {
  return Promise.reject(new ApiError(405, 'not_available', NOT_IN_THIS_RELEASE));
}
