import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Mail, Phone, User } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { getProfile, updateProfile } from '@/services/profileService';
import { getMyStaffProfile, updateStaffProfile } from '@/services/staffService';
import { roleLabels, type SystemRole } from '@/lib/orgPreferences';
import { getOrganisation } from '@/services/orgService';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { SettingsSection } from '@/components/settings/SettingsSection';
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
 * produces an account whose login no longer matches its profile row. Avatar
 * upload is likewise absent. ImageKit is in the stack but nothing is wired to
 * it, and `photo_url` is a pasted link today.
 */
export function ProfilePage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { orgId, role } = useOrg();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingEmployment, setSavingEmployment] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [labels, setLabels] = useState<Record<SystemRole, string> | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [profile, staffProfile, org] = await Promise.all([
          getProfile(user.id),
          orgId ? getMyStaffProfile(orgId, user.id).catch(() => null) : null,
          orgId ? getOrganisation(orgId).catch(() => null) : null,
        ]);
        if (!active) return;
        setFullName(profile?.full_name ?? '');
        setEmail(profile?.email ?? user.email ?? '');
        setStaff(staffProfile);
        setJobTitle(staffProfile?.job_title ?? '');
        setPhone(staffProfile?.phone ?? '');
        setLabels(org ? roleLabels(org.settings) : null);
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

  const handleSaveEmployment = useCallback(async (): Promise<void> => {
    if (!staff) return;
    setSavingEmployment(true);
    try {
      const updated = await updateStaffProfile(staff.id, {
        job_title: jobTitle.trim() || null,
        phone: phone.trim() || null,
      });
      setStaff(updated);
      showSuccess('Work details updated.');
    } catch (err) {
      reportError(err, { area: 'account-profile:save-employment' });
      showError('Could not update your work details. Please try again.');
    } finally {
      setSavingEmployment(false);
    }
  }, [staff, jobTitle, phone, showError, showSuccess]);

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
            title="Work details"
            description="Your role within this organisation."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="profile-job-title">Job title</Label>
                <Input
                  id="profile-job-title"
                  value={jobTitle}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setJobTitle(e.target.value)
                  }
                />
              </div>
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
              <Button
                onClick={() => void handleSaveEmployment()}
                disabled={savingEmployment}
              >
                {savingEmployment ? 'Saving…' : 'Save work details'}
              </Button>
            </div>
          </SettingsSection>
        )}
      </div>

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
    </div>
  );
}
