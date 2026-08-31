import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Building2, Calendar, Clock, Globe, Mail, Phone } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import {
  getOrganisation,
  listOrgMemberRoles,
  mergeOrgSettings,
  transferOwnership,
  updateOrganisation,
} from '@/services/orgService';
import { listActiveStaff } from '@/services/staffService';
import {
  deleteOrganisation,
  exportOrganisationData,
  organisationDeletionPreview,
  type OrganisationDeletionPreview,
} from '@/services/orgLifecycleService';
import { listLocations } from '@/services/locationService';
import { downloadJson } from '@/lib/csv';
import { CURRENCIES, DATE_FORMATS, orgProfileFields } from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { DeleteOrganisationModal } from '@/components/settings/DeleteOrganisationModal';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';
import {
  COUNTRIES,
  INDUSTRIES,
  ORG_TYPES,
  TIMEZONES,
  WORKING_WEEKS,
} from '@/components/onboarding/constants';

/**
 * `/app/settings/organisation`. Design/SettingsOrganisation.png.
 *
 * This replaces the flat `/app/settings` route, which held only the name and
 * the five onboarding "about" fields. The reference adds the contact block
 * (phone, website, address, registration number, primary contact) and a
 * sites/departments summary, all of which are stored data the app already has
 * and simply never surfaced again after onboarding.
 *
 * Two cards on the reference are deliberately **not** built:
 *
 * - **Industry Pack**. Templates, compliance rules and settings bundled per
 *   industry. There is no packs table, no template rows and no installer. A
 *   card reading "Care Homes · Active" would be a label over nothing.
 * - **Platform Support Access**. Granting RotaFlow staff temporary access to
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
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [fields, setFields] = useState(() => orgProfileFields(null));
  const [siteCount, setSiteCount] = useState<number | null>(null);

  // Ownership transfer (CAP-091). Candidates are active members other than
  // the current owner, named from their staff record where one exists — a
  // dropdown of raw user ids would be unusable.
  const [candidates, setCandidates] = useState<{ userId: string; label: string }[]>([]);
  const [transferTo, setTransferTo] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletePreview, setDeletePreview] = useState<OrganisationDeletionPreview | null>(
    null,
  );

  const canEdit = role === 'owner';

  // Who this organisation could be handed to. Owner-only, and non-fatal: a
  // failed load leaves the section saying there is nobody to transfer to,
  // which is true from the screen's point of view and better than an error
  // on a page whose main job is editing the organisation's name.
  useEffect(() => {
    if (!orgId || !canEdit) return;
    let active = true;
    void (async () => {
      try {
        const [roles, staff] = await Promise.all([
          listOrgMemberRoles(orgId),
          listActiveStaff(orgId).catch(() => []),
        ]);
        if (!active) return;
        const nameFor = new Map(
          staff
            .filter((sp) => sp.user_id)
            .map((sp) => [sp.user_id as string, `${sp.first_name} ${sp.last_name}`]),
        );
        setCandidates(
          [...roles.entries()]
            .filter(([, r]) => r !== 'owner')
            .map(([userId, r]) => ({
              userId,
              label: `${nameFor.get(userId) ?? 'Member'} — ${r}`,
            }))
            .sort((x, y) => x.label.localeCompare(y.label)),
        );
      } catch (err) {
        reportError(err, { area: 'settings-organisation:transfer-candidates' });
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, canEdit, reloadKey]);

  const handleTransfer = useCallback(async (): Promise<void> => {
    if (!orgId || !transferTo) return;
    setTransferring(true);
    try {
      await transferOwnership(orgId, transferTo);
      // The caller is a manager from this moment, so the whole page's
      // permissions change under them. Refreshing the org context is what
      // makes the UI agree with the database rather than showing owner-only
      // controls that will now be refused.
      void refresh();
      setTransferTo('');
      setReloadKey((k) => k + 1);
      showSuccess('Ownership transferred. You are now a manager in this organisation.');
    } catch (err) {
      reportError(err, { area: 'settings-organisation:transfer' });
      showError('Could not transfer ownership. Please try again.');
    } finally {
      setTransferring(false);
    }
  }, [orgId, transferTo, refresh, showSuccess, showError]);

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
        setFields(orgProfileFields(org.settings, org));
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
      // The five with real columns go to the columns (0023 added them for
      // this and nothing had ever written them, which is why the admin
      // console had nothing to read and invented values instead — BUG-026).
      // The rest stay in `settings`, which has no column to go to.
      await updateOrganisation(orgId, {
        name: name.trim(),
        industry: fields.industry.trim() || null,
        country: fields.country,
        timezone: fields.timezone,
        contact_email: fields.contactEmail.trim() || null,
        contact_phone: fields.phone.trim() || null,
      });
      await mergeOrgSettings(orgId, {
        org_type: fields.orgType,
        working_week: fields.workingWeek,
        website: fields.website,
        address_line: fields.addressLine,
        registration_no: fields.registrationNo,
        primary_contact: fields.primaryContact,
        date_format: fields.dateFormat,
        currency: fields.currency,
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

  const handleExport = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setExporting(true);
    try {
      const data = await exportOrganisationData(orgId);
      downloadJson(
        `${data.organisation.slug}_export_${new Date().toISOString().slice(0, 10)}`,
        data,
      );
      // An export that silently skipped a table would look complete. Say so.
      if (data.omitted.length > 0) {
        showError(
          `Exported, but ${data.omitted.length} ${data.omitted.length === 1 ? 'table' : 'tables'} could not be read and are listed in the file under "omitted".`,
        );
      } else {
        showSuccess('Export downloaded.');
      }
    } catch (err) {
      reportError(err, { area: 'settings-organisation:export' });
      showError('Could not build the export. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [orgId, showError, showSuccess]);

  const openDelete = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setDeleteOpen(true);
    try {
      // Non-fatal: the dialog is still correct without the counts, and
      // refusing to open it because a count failed would leave the owner with
      // no way to delete at all.
      setDeletePreview(await organisationDeletionPreview(orgId));
    } catch (err) {
      reportError(err, { area: 'settings-organisation:delete-preview' });
      setDeletePreview(null);
    }
  }, [orgId]);

  const handleDelete = useCallback(
    async (typedName: string): Promise<void> => {
      if (!orgId) return;
      setDeleting(true);
      try {
        await deleteOrganisation(orgId, typedName);
        setDeleteOpen(false);
        // The organisation this session was scoped to no longer exists, so
        // there is nothing here to return to. Refresh first: leaving stale
        // membership in context would render the next screen against a
        // tenant that has been deleted.
        // refresh() is fire-and-forget by design here: the screen is being
        // navigated away from either way, and blocking the exit on a context
        // reload for an organisation that no longer exists would just show a
        // spinner over a deleted tenant.
        void refresh();
        void navigate('/', { replace: true });
      } catch (err) {
        reportError(err, { area: 'settings-organisation:delete' });
        const code = (err as { code?: string } | null)?.code;
        showError(
          code === 'ORG02'
            ? 'That name does not match this organisation.'
            : code === '42501'
              ? 'Only an owner of this organisation can delete it.'
              : 'Could not delete this organisation. Nothing has been removed.',
        );
      } finally {
        setDeleting(false);
      }
    },
    [orgId, refresh, navigate, showError],
  );

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
          <div>
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
          <div>
            <Label htmlFor="org-date-format">Date format</Label>
            <Select
              id="org-date-format"
              icon={Calendar}
              value={fields.dateFormat}
              onChange={(e) => set('dateFormat', e.target.value)}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="org-currency">Currency</Label>
            <Select
              id="org-currency"
              value={fields.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
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
              className="text-sm font-semibold text-primary-ink hover:underline dark:text-primary-ink-dark"
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

      {/* CAP-091. Doing this by hand needs promote-then-demote — 0047 refuses
          the other order — which leaves two owners in between, and stays that
          way if the second step is forgotten. Both halves happen in one
          transaction here. */}
      {canEdit && (
        <SettingsSection
          title="Transfer ownership"
          description="Hand this organisation to another member. You stay on as a manager."
        >
          {candidates.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              There is nobody to transfer to yet. Invite a colleague first — ownership can
              only pass to someone who is already a member.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="transfer-owner">New owner</Label>
                <Select
                  id="transfer-owner"
                  value={transferTo}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setTransferTo(e.target.value)
                  }
                >
                  <option value="">Choose a member…</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="secondary"
                onClick={() => void handleTransfer()}
                disabled={!transferTo || transferring}
              >
                {transferring ? 'Transferring…' : 'Transfer ownership'}
              </Button>
            </div>
          )}
          <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
            An owner is the only role that can change the plan, delete the organisation,
            or transfer it again. You will not be able to undo this yourself.
          </p>
        </SettingsSection>
      )}

      {/*
        BUG-009: there was no way to delete an organisation from anywhere in
        the product — no button, no console action, no RPC — which made GDPR
        erasure impossible and left every test tenant in production for good.
        It sits at the bottom of the owner-only settings page, behind a typed
        confirmation, with the export offered in the same dialog.
      */}
      <SettingsSection
        title="Delete this organisation"
        description="Permanent, immediate, and not recoverable. Export first if you might need the data."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? 'Preparing export…' : 'Export all data'}
          </Button>
          <Button variant="danger" onClick={() => void openDelete()}>
            Delete organisation
          </Button>
        </div>
        <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
          Everyone in this organisation loses access the moment it is deleted. Audit
          records are kept, without the organisation attached, because an audit trail a
          deletion erases is not an audit trail.
        </p>
      </SettingsSection>

      <DeleteOrganisationModal
        open={deleteOpen}
        organisationName={name}
        preview={deletePreview}
        busy={deleting}
        exporting={exporting}
        onExport={() => void handleExport()}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={(typedName) => void handleDelete(typedName)}
      />

      {/* Sticky so the Save control is reachable without scrolling back up. This page is two screens tall on a laptop. */}
      <div className="sticky bottom-0 -mx-1 flex justify-end gap-3 border-t border-surface-border bg-background/90 px-1 py-4 backdrop-blur dark:border-surface-border-dark dark:bg-background-dark/90">
        <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
