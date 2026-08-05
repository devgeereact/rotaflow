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
 * Every organisation's SMTP configuration, for the platform console.
 *
 * Reads the same `org_smtp_settings_safe` view as the per-org call, so the
 * password is omitted at the column level here too — a platform administrator
 * cannot read a tenant's SMTP password by widening the query, because the grant
 * that withholds it is not a row filter.
 *
 * Cross-tenant because `org_smtp_settings_write` is a `for all` policy keyed on
 * `has_org_role(org_id, ['owner'])`, and `has_org_role` ends in
 * `or public.is_platform_admin()`. A non-administrator calling this gets the
 * organisations they own, which is what they would see anyway.
 */
export async function listAllSmtpSettings(): Promise<OrgSmtpSettingsSafe[]> {
  const { data, error } = await supabase
    .from('org_smtp_settings_safe')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Save (create or replace) an org's SMTP credentials. Owner-only, enforced by
 * RLS on the base table. Deliberately does not `.select()` the result:
 * `smtp_pass` is excluded from the column-level SELECT grant entirely (RLS
 * itself does permit the owner to SELECT the row — see 0010's header — but
 * the grant is what actually keeps the password from coming back), so
 * re-fetch via `getOrgSmtpSettings` (the safe view) if the caller needs
 * confirmation.
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
 *
 * Always clears `verified_at`: any connection-affecting edit invalidates the
 * prior "known to work" claim, not just a password change — only test-smtp
 * gets to set it again.
 */
export async function updateOrgSmtpFields(
  orgId: string,
  patch: Omit<OrgSmtpSettingsUpdate, 'smtp_pass' | 'org_id' | 'verified_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('org_smtp_settings')
    .update({ ...patch, verified_at: null })
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
