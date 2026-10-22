import type { TimeFormat } from '@/lib/format';
import type { WeekStartsOn } from '@/lib/schedulePeriod';

/**
 * The three personal preferences on My account, Preferences (0163), read
 * from `app_settings`. The columns are `text` with a check constraint, so a
 * value arrives as a string; anything unexpected reads as today's default
 * rather than breaking a screen.
 */

export type WeekStart = 'monday' | 'sunday';
export type DigestFrequency = 'immediate' | 'daily' | 'weekly';

export interface PersonalPreferences {
  timeFormat: TimeFormat;
  weekStart: WeekStart;
  /** Stored and shown only: no digest job exists yet (docs/NOTIFICATIONS-SPEC.md). */
  digestFrequency: DigestFrequency;
}

export const DEFAULT_PREFERENCES: PersonalPreferences = {
  timeFormat: '24h',
  weekStart: 'monday',
  digestFrequency: 'immediate',
};

export function toPersonalPreferences(
  row: {
    time_format?: string | null;
    week_start?: string | null;
    digest_frequency?: string | null;
  } | null,
): PersonalPreferences {
  if (!row) return DEFAULT_PREFERENCES;
  return {
    timeFormat: row.time_format === '12h' ? '12h' : '24h',
    weekStart: row.week_start === 'sunday' ? 'sunday' : 'monday',
    digestFrequency:
      row.digest_frequency === 'daily' || row.digest_frequency === 'weekly'
        ? row.digest_frequency
        : 'immediate',
  };
}

/** For `startOfWeek`: Sunday is 0, Monday is 1. */
export function weekStartsOn(weekStart: WeekStart): WeekStartsOn {
  return weekStart === 'sunday' ? 0 : 1;
}
