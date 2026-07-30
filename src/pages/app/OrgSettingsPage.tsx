import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Briefcase, Building2, Calendar, Clock, Globe, Settings } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import {
  getOrganisation,
  mergeOrgSettings,
  updateOrganisation,
} from '@/services/orgService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import {
  COUNTRIES,
  INDUSTRIES,
  ORG_TYPES,
  TIMEZONES,
  WORKING_WEEKS,
} from '@/components/onboarding/constants';
import type { Organisation } from '@/types';

/** `organisations.settings` is a free-form jsonb — read with fallbacks, never assume shape. */
function settingsString(settings: Organisation['settings'], key: string): string {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return '';
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

/**
 * `/app/settings` — owner-only post-onboarding edit of the organisation's
 * name and the same "about your organisation" details captured during
 * onboarding (industry, type, country, timezone, working week). Reuses the
 * onboarding `StepAbout` option lists and `mergeOrgSettings` so a value
 * edited here reads back identically to how onboarding wrote it.
 */
export function OrgSettingsPage(): JSX.Element {
  const { orgId, refresh } = useOrg();
  const { canManageOrg } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [orgType, setOrgType] = useState('');
  const [country, setCountry] = useState('United Kingdom');
  const [timezone, setTimezone] = useState('Europe/London');
  const [workingWeek, setWorkingWeek] = useState('mon-sun');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const org = await getOrganisation(orgId);
        if (!active) return;
        setName(org.name);
        setIndustry(settingsString(org.settings, 'industry'));
        setOrgType(settingsString(org.settings, 'org_type'));
        setCountry(settingsString(org.settings, 'country') || 'United Kingdom');
        setTimezone(settingsString(org.settings, 'timezone') || 'Europe/London');
        setWorkingWeek(settingsString(org.settings, 'working_week') || 'mon-sun');
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'org-settings:load' });
        setLoadFailed(true);
        showError('Could not load organisation settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey, showError]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!orgId || !name.trim()) return;
    setSaving(true);
    try {
      await updateOrganisation(orgId, { name: name.trim() });
      await mergeOrgSettings(orgId, {
        industry,
        org_type: orgType,
        country,
        timezone,
        working_week: workingWeek,
      });
      await refresh();
      showSuccess('Organisation settings saved.');
    } catch (err) {
      reportError(err, { area: 'org-settings:save' });
      showError('Could not save organisation settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    orgId,
    name,
    industry,
    orgType,
    country,
    timezone,
    workingWeek,
    refresh,
    showError,
    showSuccess,
  ]);

  if (!canManageOrg) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Only the organisation owner can manage organisation settings.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load organisation settings.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 flex items-center gap-2 font-display text-2xl text-content dark:text-content-dark">
        <Settings size={22} aria-hidden="true" />
        Organisation settings
      </h1>

      <Card>
        <div className="space-y-6">
          <div>
            <Label htmlFor="org-name">Organisation name</Label>
            <Input
              id="org-name"
              icon={Building2}
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <Label htmlFor="org-industry">Industry</Label>
              <Select
                id="org-industry"
                icon={Briefcase}
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                <option value="">Select your industry</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="org-type">Organisation type</Label>
              <Select
                id="org-type"
                icon={Building2}
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
              >
                <option value="">Select a type</option>
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="org-country">Country / Region</Label>
              <Select
                id="org-country"
                icon={Globe}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="org-timezone">Time zone</Label>
              <Select
                id="org-timezone"
                icon={Clock}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="org-week">Default working week</Label>
            <Select
              id="org-week"
              icon={Calendar}
              value={workingWeek}
              onChange={(e) => setWorkingWeek(e.target.value)}
            >
              {WORKING_WEEKS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="pt-2">
            <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
