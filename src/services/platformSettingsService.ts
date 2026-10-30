import { api, ApiError } from '@/lib/api';
import type { PlatformSettings, PlatformSettingsUpdate } from '@/types';

/**
 * Platform settings (any signed-in person reads; owner and admin write). The API keeps the settings the product
 * still uses: name, support address, URL, default time zone, registration and maintenance mode. The rest of the
 * old row (branding, session and upload limits, email provider) read nothing and is answered with defaults.
 */

interface ApiSettings {
  platform_name: string;
  support_email: string;
  platform_url: string;
  default_timezone: string;
  registration_enabled: boolean | number;
  maintenance_mode: boolean | number;
  maintenance_message: string | null;
  updated_at: string;
}

function toSettings(s: ApiSettings): PlatformSettings {
  return {
    id: true,
    platform_name: s.platform_name,
    support_email: s.support_email,
    platform_url: s.platform_url,
    default_timezone: s.default_timezone,
    registration_enabled: Boolean(Number(s.registration_enabled)),
    maintenance_mode: Boolean(Number(s.maintenance_mode)),
    maintenance_message: s.maintenance_message,
    updated_at: s.updated_at,
    created_at: s.updated_at,
    updated_by: null,
    admin_session_minutes: 60,
    api_rate_limit_per_min: 60,
    email_provider: 'smtp',
    email_sender_address: s.support_email,
    email_sender_name: s.platform_name,
    favicon_url: null,
    logo_url: null,
    max_concurrent_sessions: 0,
    max_upload_mb: 2,
    permitted_file_types: [],
    primary_colour: '',
    public_api_enabled: false,
    reauth_for_critical: false,
    require_mfa: false,
    signin_alerts: false,
    support_branding: false,
    webhook_max_attempts: 0,
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const r = await api.get<{ settings: ApiSettings | false | null }>('/platform/settings');
  return r.settings ? toSettings(r.settings) : null;
}

const WRITABLE = [
  'platform_name',
  'support_email',
  'platform_url',
  'default_timezone',
  'registration_enabled',
  'maintenance_mode',
  'maintenance_message',
] as const;

export async function updatePlatformSettings(
  patch: PlatformSettingsUpdate,
  _updatedBy: string,
): Promise<PlatformSettings> {
  const body: Record<string, unknown> = {};
  for (const k of WRITABLE) if (k in patch) body[k] = patch[k];
  const r = await api.post<{ settings: ApiSettings }>('/platform/settings', body);
  return toSettings(r.settings);
}

const MFA_IN_CLERK =
  'Two-step verification for platform staff is set in the Clerk dashboard (turn on multi-factor for those accounts), not here.';

export async function setPlatformMfaRequired(_required: boolean): Promise<boolean> {
  return Promise.reject(new ApiError(405, 'not_available', MFA_IN_CLERK));
}

export async function getMyMfaStatus(): Promise<{
  hasVerifiedFactor: boolean;
  factorCount: number;
  sessionIsAal2: boolean;
}> {
  return Promise.reject(new ApiError(405, 'not_available', MFA_IN_CLERK));
}
