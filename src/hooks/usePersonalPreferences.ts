import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getSettings } from '@/services/settingsService';
import { setTimeFormat } from '@/lib/format';
import { reportError } from '@/lib/sentry';
import {
  DEFAULT_PREFERENCES,
  toPersonalPreferences,
  type PersonalPreferences,
} from '@/lib/personalPreferences';

// One read per signed-in person per page load: AppShell and My rota both ask.
let cached: { userId: string; prefs: Promise<PersonalPreferences> } | null = null;

/** Called by Preferences after a save, so the next reader sees the new values. */
export function rememberPersonalPreferences(
  userId: string,
  prefs: PersonalPreferences,
): void {
  cached = { userId, prefs: Promise.resolve(prefs) };
  setTimeFormat(prefs.timeFormat);
}

/**
 * The signed-in person's own preferences (0163). Starts on the defaults,
 * which are today's behaviour, so a slow or failed read changes nothing on
 * screen. Also points `src/lib/format.ts` at the person's clock format.
 */
export function usePersonalPreferences(): PersonalPreferences {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<PersonalPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    if (!user) return;
    let active = true;
    if (cached?.userId !== user.id) {
      cached = {
        userId: user.id,
        prefs: getSettings(user.id).then(toPersonalPreferences),
      };
    }
    cached.prefs
      .then((next) => {
        if (!active) return;
        setTimeFormat(next.timeFormat);
        setPrefs(next);
      })
      .catch((err: unknown) => {
        cached = null;
        reportError(err, { area: 'personal-preferences:load' });
      });
    return () => {
      active = false;
    };
  }, [user]);

  return prefs;
}
