import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Building2, Calendar, Clock, Globe, Mail, Phone } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import {
  getOrganisation,
  mergeOrgSettings,
  updateOrganisation,
} from '@/services/orgService';
import { listLocations } from '@/services/locationService';
import { orgProfileFields } from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';
import {
  COUNTRIES,
  INDUSTRIES,
  ORG_TYPES,
  TIMEZONES,
  WORKING_WEEKS,
} from '@/components/onboarding/constants';

/**
 * `/app/settings/organisation` — design/SettingsOrganisation.png.
 *
 * This replaces the flat `/app/settings` route, which held only the name and
 * the five onboarding "about" fields. The reference adds the contact block
 * (phone, website, address, registration number, primary contact) and a
 * sites/departments summary, all of which are stored data the app already has
 * and simply never surfaced again after onboarding.
 *
 * Two cards on the reference are deliberately **not** built:
 *
 * - **Industry Pack** — templates, compliance rules and settings bundled per
 *   industry. There is no packs table, no template rows and no installer. A
 *   card reading "Care Homes · Active" would be a label over nothing.
 * - **Platform Support Access** — granting RotaFlow staff temporary access to
 *   a tenant. That is a support-impersonation feature: it needs an
 *   access-grant table, an expiry job, and an audit event per grant, and it
 *   hands a third party a customer's staff PII. Not something to mock up.
 *
 * Both are recorded in the audit rather than stubbed, because a settings
 * screen that shows a security control which does not exist is worse than one
 * that omits it.
 */
export function SettingsOrganisationPage(): JSX.Element {
  const { orgId, role, refresh } = useOrg();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [fields, setFields] = useState(() => orgProfileFields(null));
  const [siteCount, setSiteCount] = useState<number | null>(null);

  const canEdit = role === 'owner';

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [org, locations] = await Promise.all([
          getOrganisation(orgId),
          // Non-fatal: the summary is a nicety, the form is the screen.
          listLocations(orgId).catch(() => null),
        ]);
        if (!active) return;
        setName(org.name);
        setFields(orgProfileFields(org.settings));
        setSiteCount(locations?.length ?? null);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-organisation:load' });
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

  const set = useCallback(
    <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]): void => {
      setFields((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    if (!orgId || !name.trim()) return;
    setSaving(true);
    try {
      await updateOrganisation(orgId, { name: name.trim() });
      await mergeOrgSettings(orgId, {
        industry: fields.industry,
        org_type: fields.orgType,
        country: fields.country,
        timezone: fields.timezone,
        working_week: fields.workingWeek,
        phone: fields.phone,
        website: fields.website,
        address_line: fields.addressLine,
        registration_no: fields.registrationNo,
        contact_email: fields.contactEmail,
        primary_contact: fields.primaryContact,
      });
      await refresh();
      showSuccess('Organisation settings saved.');
    } catch (err) {
      reportError(err, { area: 'settings-organisation:save' });
      showError('Could not save organisation settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [orgId, name, fields, refresh, showError, showSuccess]);

  if (!canEdit) return <OwnerOnlyNotice section="organisation settings" />;

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
          Could not load organisation settings.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Organisation details"
        description="How your organisation appears across RotaFlow and on exports."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label htmlFor="org-name">Organisation name</Label>
            <Input
              id="org-name"
              icon={Building2}
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="org-registration">Registration number</Label>
            <Input
              id="org-registration"
              value={fields.registrationNo}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set('registrationNo', e.target.value)
              }
            />
          </div>
          <div>
            <Label htmlFor="org-phone">Phone</Label>
            <Input
              id="org-phone"
              icon={Phone}
              type="tel"
              value={fields.phone}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set('phone', e.target.value)
              }
            />
          </div>
          <div>
            <Label htmlFor="org-website">Website</Label>
            <Input
              id="org-website"
              icon={Globe}
              value={fields.website}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set('website', e.target.value)
              }
            />
          </div>
          <div>
            <Label htmlFor="org-email">Contact email</Label>
            <Input
              id="org-email"
              icon={Mail}
              type="email"
              value={fields.contactEmail}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set('contactEmail', e.target.value)
              }
            />
          </div>
          <div>
            <Label htmlFor="org-contact">Primary contact</Label>
            <Input
              id="org-contact"
              value={fields.primaryContact}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set('primaryContact', e.target.value)
              }
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="org-address">Address</Label>
            <Input
              id="org-address"
              value={fields.addressLine}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                set('addressLine', e.target.value)
              }
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Organisation preferences"
        description="Defaults applied when building rotas and reading times across the app."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label htmlFor="org-industry">Industry</Label>
            <Select
              id="org-industry"
              icon={Briefcase}
              value={fields.industry}
              onChange={(e) => set('industry', e.target.value)}
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
              value={fields.orgType}
              onChange={(e) => set('orgType', e.target.value)}
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
              value={fields.country}
              onChange={(e) => set('country', e.target.value)}
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
              value={fields.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="org-week">Default working week</Label>
            <Select
              id="org-week"
              icon={Calendar}
              value={fields.workingWeek}
              onChange={(e) => set('workingWeek', e.target.value)}
            >
              {WORKING_WEEKS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </SettingsSection>

      {siteCount !== null && (
        <SettingsSection
          title="Sites & departments"
          description={`${siteCount} ${siteCount === 1 ? 'site' : 'sites'} configured for this organisation.`}
          action={
            <Link
              to="/app/locations"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Manage
            </Link>
          }
        >
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Sites, departments and cost centres are managed in Locations.
          </p>
        </SettingsSection>
      )}

      {/* Sticky so the Save control is reachable without scrolling back up —
          this page is two screens tall on a laptop. */}
      <div className="sticky bottom-0 -mx-1 flex justify-end gap-3 border-t border-surface-border bg-background/90 px-1 py-4 backdrop-blur dark:border-surface-border-dark dark:bg-background-dark/90">
        <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
