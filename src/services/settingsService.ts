import { api } from '@/lib/api';
import type { AppSettings, AppSettingsUpdate } from '@/types';

/**
 * A person's own preferences (`/me/settings`). The API answers defaults when nothing has been saved, so a read
 * never comes back empty. `userId` is kept for the callers' shape; the API acts on the signed-in person only.
 */
type ApiSettings = Pick<
  AppSettings,
  'theme' | 'time_format' | 'week_start' | 'digest_frequency' | 'notifications_enabled'
>;

function toSettings(userId: string, s: ApiSettings): AppSettings {
  return {
    created_at: '',
    updated_at: '',
    id: userId,
    user_id: userId,
    ...s,
    notifications_enabled: Boolean(s.notifications_enabled),
  };
}

export async function getSettings(userId: string): Promise<AppSettings | null> {
  const r = await api.get<{ settings: ApiSettings }>('/me/settings');
  return toSettings(userId, r.settings);
}

export async function updateSettings(
  userId: string,
  patch: AppSettingsUpdate,
): Promise<AppSettings> {
  const body: Record<string, unknown> = {};
  for (const k of [
    'theme',
    'time_format',
    'week_start',
    'digest_frequency',
    'notifications_enabled',
  ] as const) {
    if (k in patch) body[k] = patch[k];
  }
  const r = await api.post<{ settings: ApiSettings }>('/me/settings', body);
  return toSettings(userId, r.settings);
}
