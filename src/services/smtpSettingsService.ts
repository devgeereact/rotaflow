import { api, orgPath } from '@/lib/api';
import type {
  OrgSmtpSettingsInsert,
  OrgSmtpSettingsSafe,
  OrgSmtpSettingsUpdate,
} from '@/types';

/**
 * Fetch an org's SMTP configuration for display. Host/username/from-address,
 * never the password. Backed by `org_smtp_settings_safe`
 * (0010_org_smtp_settings.sql), which omits `smtp_pass` at the column level.
 */
export async function getOrgSmtpSettings(
  orgId: string,
): Promise<OrgSmtpSettingsSafe | null> {
  // The password is never returned; the API says only that one is stored.
  const r = await api.get<{
    smtp: {
      smtp_host: string;
      smtp_port: number | string;
      smtp_user: string;
      from_email: string;
      from_name: string | null;
      verified_at: string | null;
    } | null;
  }>(orgPath(orgId, '/smtp'));
  if (!r.smtp) return null;
  return {
    org_id: orgId,
    created_at: null,
    updated_at: null,
    smtp_host: r.smtp.smtp_host,
    smtp_port: Number(r.smtp.smtp_port),
    smtp_user: r.smtp.smtp_user,
    from_email: r.smtp.from_email,
    from_name: r.smtp.from_name,
    verified_at: r.smtp.verified_at,
  };
}

/**
 * Every organisation's SMTP configuration, for the platform console.
 *
 * Reads the same `org_smtp_settings_safe` view as the per-org call, so the
 * password is omitted at the column level here too, a platform administrator
 * cannot read a tenant's SMTP password by widening the query, because the grant
 * that withholds it is not a row filter.
 *
 * Cross-tenant because `org_smtp_settings_write` is a `for all` policy keyed on
 * `has_org_role(org_id, ['owner'])`, and `has_org_role` ends in
 * `or public.is_platform_admin()`. A non-administrator calling this gets the
 * organisations they own, which is what they would see anyway.
 */
export async function listAllSmtpSettings(): Promise<OrgSmtpSettingsSafe[]> {
  // The platform-wide list of organisations' mail accounts has no API route: each organisation's account is its
  // owner's. The integrations console that read it is on the cut list (docs/MERGE-TARGET.md section 5).
  return Promise.resolve([]);
}

/**
 * Save (create or replace) an org's SMTP credentials. Owner-only, enforced by
 * RLS on the base table. Deliberately does not `.select()` the result:
 * `smtp_pass` is excluded from the column-level SELECT grant entirely (RLS
 * itself does permit the owner to SELECT the row. See 0010's header, but
 * the grant is what actually keeps the password from coming back), so
 * re-fetch via `getOrgSmtpSettings` (the safe view) if the caller needs
 * confirmation.
 */
export async function saveOrgSmtpSettings(input: OrgSmtpSettingsInsert): Promise<void> {
  // Encrypted at rest by the API; changing the host, port, user or password clears `verified_at`.
  await api.post(orgPath(input.org_id, '/smtp'), {
    smtp_host: input.smtp_host,
    smtp_port: input.smtp_port,
    smtp_user: input.smtp_user,
    smtp_pass: input.smtp_pass,
    from_email: input.from_email,
    from_name: input.from_name ?? null,
  });
}

/**
 * Update everything except the password, for the common case of editing
 * host/username/from-address without re-entering a credential the client can
 * never see again (it's never read back. See `getOrgSmtpSettings`).
 *
 * Always clears `verified_at`: any connection-affecting edit invalidates the
 * prior "known to work" claim, not just a password change, only test-smtp
 * gets to set it again.
 */
export async function updateOrgSmtpFields(
  orgId: string,
  patch: Omit<OrgSmtpSettingsUpdate, 'smtp_pass' | 'org_id' | 'verified_at'>,
): Promise<void> {
  // Sending no password keeps the one already stored.
  await api.post(orgPath(orgId, '/smtp'), {
    smtp_host: patch.smtp_host,
    smtp_port: patch.smtp_port,
    smtp_user: patch.smtp_user,
    from_email: patch.from_email,
    from_name: patch.from_name ?? null,
  });
}

/** Remove an org's SMTP configuration. Falls back to the global sender. */
export async function deleteOrgSmtpSettings(orgId: string): Promise<void> {
  await api.post(orgPath(orgId, '/smtp/delete'));
}

export interface TestSmtpResult {
  ok: boolean;
  sentTo?: string;
  error?: string;
}

/**
 * Send a real test email through the org's saved SMTP settings
 * (supabase/functions/test-smtp). A send failure is reported as
 * `{ ok: false, error }`, not a thrown error. That's a legitimate outcome
 * the caller should show inline, not treat as unexpected.
 */
export async function testOrgSmtpSettings(orgId: string): Promise<TestSmtpResult> {
  const r = await api.post<{ ok: boolean; error?: string; sent_to?: string }>(
    orgPath(orgId, '/smtp/test'),
  );
  return r.ok
    ? { ok: true, sentTo: r.sent_to }
    : { ok: false, error: r.error ?? 'The test email was not sent.' };
}
