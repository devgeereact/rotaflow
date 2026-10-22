import { useCallback, useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Phone, User } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { getProfile, updateProfile } from '@/services/profileService';
import { getMyStaffProfile, updateStaffProfile } from '@/services/staffService';
import { removeStaffPhoto, uploadStaffPhoto } from '@/services/staffPhotoService';
import { PHOTO_ACCEPT, photoFileProblem, photoSource } from '@/lib/staffPhoto';
import { roleLabels, type SystemRole } from '@/lib/orgPreferences';
import { getOrganisation } from '@/services/orgService';
import { listMyAuditLogs, type AuditLogEntry } from '@/services/auditService';
import { formatAuditAction } from '@/lib/auditActions';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { StaffProfile } from '@/types';

const ROLE_SCOPE: Record<SystemRole, string> = {
  owner: 'Full access, including billing and permissions.',
  manager: 'Builds rotas, approves requests, manages staff.',
  staff: 'Views their own shifts, clocks in, requests leave and swaps.',
};

/**
 * `/app/account/profile`. Design/ProfileSettings.png, "Personal Information".
 *
 * ## Two records, one screen
 *
 * A person's details are split across two tables and the split is not
 * arbitrary. `profiles` is the account, one row per login, shared across every
 * organisation they belong to, holding the name and email. `staff_profiles` is
 * their employment *inside one organisation*. Job title, department, phone,
 * and someone who works for two organisations has two of them.
 *
 * The reference shows one form, so this writes both: name to `profiles`, job
 * title and phone to the staff record for the active organisation. A user with
 * no staff record (an owner who signed up and never added themselves to the
 * roster) still gets the account half, with the employment fields hidden
 * rather than shown disabled with nothing behind them.
 *
 * Email is read-only on purpose: changing it needs Supabase's confirmation
 * round-trip on both the old and the new address, and half-building that
 * produces an account whose login no longer matches its profile row.
 *
 * The photo is an upload to the private `staff-photos` bucket (0162), shown
 * through a signed link, so erasure can remove it. A legacy pasted
 * `photo_url` still shows until it is replaced or removed.
 *
 * Job title, department, contract and hours are read-only here since
 * `0042_staff_self_edit_personal_info.sql`: a staff member may only change
 * their own `phone` and photo on `staff_profiles`, everything else on
 * that row is manager/owner-only, enforced by a trigger regardless of which
 * screen tries to write it.
 */
export function ProfilePage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { orgId, role } = useOrg();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [phone, setPhone] = useState('');
  const [labels, setLabels] = useState<Record<SystemRole, string> | null>(null);
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [profile, staffProfile, org, recent] = await Promise.all([
          getProfile(user.id),
          orgId ? getMyStaffProfile(orgId, user.id).catch(() => null) : null,
          orgId ? getOrganisation(orgId).catch(() => null) : null,
          // Non-fatal: a nicety beside the form, never a reason to fail it.
          orgId ? listMyAuditLogs(orgId, user.id, 5).catch(() => []) : [],
        ]);
        if (!active) return;
        setFullName(profile?.full_name ?? '');
        setEmail(profile?.email ?? user.email ?? '');
        setStaff(staffProfile);
        setPhone(staffProfile?.phone ?? '');
        setLabels(org ? roleLabels(org.settings) : null);
        setActivity(recent);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'account-profile:load' });
        showError('Could not load your profile.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, orgId, showError]);

  const handleSaveAccount = useCallback(async (): Promise<void> => {
    if (!user || !fullName.trim()) return;
    setSavingAccount(true);
    try {
      await updateProfile(user.id, { full_name: fullName.trim() });
      showSuccess('Profile updated.');
    } catch (err) {
      reportError(err, { area: 'account-profile:save' });
      showError('Could not update your profile. Please try again.');
    } finally {
      setSavingAccount(false);
    }
  }, [user, fullName, showError, showSuccess]);

  const handleSaveContact = useCallback(async (): Promise<void> => {
    if (!staff) return;
    setSavingContact(true);
    try {
      const updated = await updateStaffProfile(staff.id, {
        phone: phone.trim() || null,
      });
      setStaff(updated);
      showSuccess('Contact details updated.');
    } catch (err) {
      reportError(err, { area: 'account-profile:save-contact' });
      showError('Could not update your contact details. Please try again.');
    } finally {
      setSavingContact(false);
    }
  }, [staff, phone, showError, showSuccess]);

  const handlePhotoFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!staff || !file) return;
      const problem = photoFileProblem(file);
      if (problem) {
        showError(problem);
        return;
      }
      setSavingPhoto(true);
      try {
        setStaff(await uploadStaffPhoto(staff, file));
        showSuccess('Photo updated.');
      } catch (err) {
        reportError(err, { area: 'account-profile:save-photo' });
        showError('Could not update your photo. Please try again.');
      } finally {
        setSavingPhoto(false);
      }
    },
    [staff, showError, showSuccess],
  );

  const handleRemovePhoto = useCallback(async (): Promise<void> => {
    if (!staff) return;
    setSavingPhoto(true);
    try {
      setStaff(await removeStaffPhoto(staff.id));
      showSuccess('Photo removed.');
    } catch (err) {
      reportError(err, { area: 'account-profile:remove-photo' });
      showError('Could not remove your photo. Please try again.');
    } finally {
      setSavingPhoto(false);
    }
  }, [staff, showError, showSuccess]);

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <SettingsSection
          title="Personal information"
          description="Your details and how colleagues see you in RotaFlow."
        >
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Label htmlFor="profile-name">Full name</Label>
              <Input
                id="profile-name"
                icon={User}
                value={fullName}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setFullName(e.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="profile-email">Email address</Label>
              <Input id="profile-email" icon={Mail} value={email} disabled readOnly />
              <p className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark">
                Contact your administrator to change the address you sign in with.
              </p>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button
              onClick={() => void handleSaveAccount()}
              disabled={savingAccount || !fullName.trim()}
            >
              {savingAccount ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </SettingsSection>

        {staff && (
          <SettingsSection
            title="Photo"
            description="How colleagues recognise you around the app."
          >
            <div className="flex items-center gap-4">
              <StaffAvatar
                firstName={staff.first_name}
                lastName={staff.last_name}
                photoUrl={photoSource(staff)}
                size="2xl"
              />
              <div className="flex-1">
                <Label htmlFor="profile-photo-file">Choose a picture</Label>
                <input
                  id="profile-photo-file"
                  type="file"
                  accept={PHOTO_ACCEPT}
                  disabled={savingPhoto}
                  onChange={(e) => void handlePhotoFile(e)}
                  className="block w-full text-sm text-content file:mr-3 file:rounded-lg file:border file:border-surface-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-content dark:text-content-dark dark:file:border-surface-border-dark dark:file:bg-surface-dark dark:file:text-content-dark"
                />
                <p className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark">
                  JPEG, PNG or WebP, up to 2 MB. Kept privately and removed if your record
                  is erased.
                </p>
              </div>
            </div>
            {(staff.photo_path || staff.photo_url) && (
              <div className="mt-6 flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => void handleRemovePhoto()}
                  disabled={savingPhoto}
                >
                  {savingPhoto ? 'Saving…' : 'Remove photo'}
                </Button>
              </div>
            )}
          </SettingsSection>
        )}

        {staff && (
          <SettingsSection
            title="Contact details"
            description="How your manager reaches you."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="profile-phone">Phone number</Label>
                <Input
                  id="profile-phone"
                  icon={Phone}
                  type="tel"
                  value={phone}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setPhone(e.target.value)
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => void handleSaveContact()} disabled={savingContact}>
                {savingContact ? 'Saving…' : 'Save contact details'}
              </Button>
            </div>
          </SettingsSection>
        )}

        {staff && (
          <SettingsSection
            title="Employment"
            description="Set by your manager. Contact them to change any of this."
          >
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Job title
                </dt>
                <dd className="font-medium text-content dark:text-content-dark">
                  {staff.job_title ?? '-'}
                </dd>
              </div>
              <div>
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Payroll ID
                </dt>
                <dd className="font-medium text-content dark:text-content-dark">
                  {staff.payroll_id ?? '-'}
                </dd>
              </div>
            </dl>
          </SettingsSection>
        )}
      </div>

      <div className="space-y-6">
        <SettingsSection title="Role & access" description="What you can see and do.">
          {role ? (
            <div>
              <Badge
                tone={
                  role === 'owner' ? 'primary' : role === 'manager' ? 'info' : 'neutral'
                }
              >
                {labels?.[role] ?? role}
              </Badge>
              <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
                {ROLE_SCOPE[role]}
              </p>
            </div>
          ) : (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No role assigned in this organisation.
            </p>
          )}
        </SettingsSection>

        {/* The reference's "Recent account activity" card. Only the caller's
          own audited actions in this organisation, which is what the read
          policy admits (0016); the full list is the Activity tab. */}
        <SettingsSection
          title="Recent account activity"
          description="What you have done in this organisation lately."
        >
          {activity.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Nothing recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-divider text-sm dark:divide-divider-dark">
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-3 py-2.5"
                >
                  <span className="text-content dark:text-content-dark">
                    {formatAuditAction(entry.action)}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                    {formatActivityTime(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/app/account/activity"
            className="mt-3 inline-block text-sm font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
          >
            View all activity
          </Link>
        </SettingsSection>
      </div>
    </div>
  );
}

function formatActivityTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
