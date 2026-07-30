import { supabase } from '@/lib/supabase';
import type {
  OrgSmtpSettingsInsert,
  OrgSmtpSettingsSafe,
  OrgSmtpSettingsUpdate,
} from '@/types';

/**
 * Fetch an org's SMTP configuration for display — host/username/from-address,
 * never the password. Backed by `org_smtp_settings_safe`
 * (0010_org_smtp_settings.sql), which omits `smtp_pass` at the column level.
 */
export async function getOrgSmtpSettings(
  orgId: string,
): Promise<OrgSmtpSettingsSafe | null> {
  const { data, error } = await supabase
    .from('org_smtp_settings_safe')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Save (create or replace) an org's SMTP credentials. Owner-only, enforced by
 * RLS on the base table. Deliberately does not `.select()` the result: there
 * is no select policy on `org_smtp_settings` at all, so the row can be
 * written but never read back through this client — re-fetch via
 * `getOrgSmtpSettings` (the safe view) if the caller needs confirmation.
 */
export async function saveOrgSmtpSettings(input: OrgSmtpSettingsInsert): Promise<void> {
  const { error } = await supabase
    .from('org_smtp_settings')
    .upsert(input, { onConflict: 'org_id' });
  if (error) throw error;
}

/**
 * Update everything except the password — for the common case of editing
 * host/username/from-address without re-entering a credential the client can
 * never see again (it's never read back — see `getOrgSmtpSettings`).
 */
export async function updateOrgSmtpFields(
  orgId: string,
  patch: Omit<OrgSmtpSettingsUpdate, 'smtp_pass' | 'org_id'>,
): Promise<void> {
  const { error } = await supabase
    .from('org_smtp_settings')
    .update(patch)
    .eq('org_id', orgId);
  if (error) throw error;
}

/** Remove an org's SMTP configuration — falls back to the global sender. */
export async function deleteOrgSmtpSettings(orgId: string): Promise<void> {
  const { error } = await supabase.from('org_smtp_settings').delete().eq('org_id', orgId);
  if (error) throw error;
}

export interface TestSmtpResult {
  ok: boolean;
  sentTo?: string;
  error?: string;
}

/**
 * Send a real test email through the org's saved SMTP settings
 * (supabase/functions/test-smtp). A send failure is reported as
 * `{ ok: false, error }`, not a thrown error — that's a legitimate outcome
 * the caller should show inline, not treat as unexpected.
 */
export async function testOrgSmtpSettings(orgId: string): Promise<TestSmtpResult> {
  const result = await supabase.functions.invoke<TestSmtpResult>('test-smtp', {
    body: { orgId },
  });
  if (result.error) throw result.error;
  if (!result.data) throw new Error('test-smtp returned no data');
  return result.data;
}
