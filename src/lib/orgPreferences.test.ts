import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICIES,
  mergeSettings,
  orgProfileSettingsPatch,
  orgProfileFields,
  policiesToSettings,
  RETIRED_POLICY_KEYS,
  RETIRED_PROFILE_KEYS,
  schedulingPolicies,
} from './orgPreferences';

/**
 * Retiring a control must not delete what an organisation saved through it.
 *
 * Clock rounding, publish lead days and auto-declining clashing leave left
 * Settings → Policies, and working week, date format and currency left
 * Settings → Organisation, because nothing read them. Their stored values
 * stay in `settings`: a save writes only the keys it is given, and the merge
 * keeps everything else, including keys this release has never heard of.
 */
describe('retired settings keys', () => {
  const stored = {
    rounding_minutes: 5,
    publish_lead_days: 21,
    auto_decline_clashing_leave: true,
    working_week: 'sun-sat',
    date_format: 'MM/DD/YYYY',
    currency: 'EUR',
    some_future_key: { nested: 1 },
    min_rest_hours: 12,
    website: 'https://old.example',
  };

  it('a Policies save keeps every retired and unknown key untouched', () => {
    const policies = { ...schedulingPolicies(stored), minRestHours: 10 };
    const merged = mergeSettings(stored, policiesToSettings(policies));

    for (const key of [...RETIRED_POLICY_KEYS, ...RETIRED_PROFILE_KEYS]) {
      expect(merged[key]).toEqual(stored[key]);
    }
    expect(merged.some_future_key).toEqual({ nested: 1 });
    expect(merged.min_rest_hours).toBe(10);
  });

  it('an Organisation save keeps them too, and writes none of them', () => {
    const fields = orgProfileFields(stored);
    const patch = orgProfileSettingsPatch({ ...fields, website: 'https://new.example' });

    for (const key of [...RETIRED_POLICY_KEYS, ...RETIRED_PROFILE_KEYS]) {
      expect(patch).not.toHaveProperty(key);
    }
    const merged = mergeSettings(stored, patch);
    for (const key of [...RETIRED_POLICY_KEYS, ...RETIRED_PROFILE_KEYS]) {
      expect(merged[key]).toEqual(stored[key]);
    }
    expect(merged.website).toBe('https://new.example');
  });

  it('a Policies save writes none of the retired policy keys', () => {
    const patch = policiesToSettings(DEFAULT_POLICIES);
    for (const key of RETIRED_POLICY_KEYS) {
      expect(patch).not.toHaveProperty(key);
    }
  });

  it('merging into settings that were never written starts from empty', () => {
    expect(mergeSettings(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('schedulingPolicies working-time defaults', () => {
  it('uses 11 hours rest, 48 weekly hours and 6 days in a row when unset', () => {
    const policies = schedulingPolicies({});
    expect(policies.minRestHours).toBe(11);
    expect(policies.maxWeeklyHours).toBe(48);
    expect(policies.maxConsecutiveDays).toBe(6);
  });
});
