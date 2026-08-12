import { useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import {
  getOrganisation,
  listOrgMemberRoles,
  removeMember,
  updateMemberRole,
} from '@/services/orgService';
import { listStaff } from '@/services/staffService';
import { DEFAULT_ROLE_LABELS, roleLabels, type SystemRole } from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { TeamInviteManager } from '@/components/settings/TeamInviteManager';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';

interface MemberRow {
  userId: string;
  name: string;
  role: SystemRole;
}

const ROLE_TONE: Record<SystemRole, 'primary' | 'info' | 'neutral'> = {
  owner: 'primary',
  manager: 'info',
  staff: 'neutral',
};

/**
 * `/app/settings/permissions`, who is in the organisation, at what role, and
 * who has been invited.
 *
 * Owner-only (see `settingsTabsForRole`): this tab is where someone can hand
 * another account the ability to spend money and change access, so it is not
 * shared with managers. The database agrees independently, `create_invite`
 * refuses an owner-role invite from a manager, which is the boundary that
 * actually matters; this gate is presentation.
 */
const ROLE_OPTIONS: SystemRole[] = ['owner', 'manager', 'staff'];

export function SettingsPermissionsPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [labels, setLabels] = useState<Record<SystemRole, string>>(DEFAULT_ROLE_LABELS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [roleChangeFor, setRoleChangeFor] = useState<MemberRow | null>(null);
  const [nextRole, setNextRole] = useState<SystemRole>('staff');
  const [removeFor, setRemoveFor] = useState<MemberRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [memberRoles, staff, org] = await Promise.all([
          listOrgMemberRoles(orgId),
          listStaff(orgId),
          getOrganisation(orgId),
        ]);
        if (!active) return;

        setLabels(roleLabels(org.settings));

        // Staff profiles carry the human name; memberships carry the role.
        // A membership with no staff profile is normal, an owner who signed
        // up and has not added themselves to the roster yet, so it still
        // appears, named by its role rather than dropped from the list.
        const nameByUser = new Map<string, string>();
        for (const person of staff) {
          if (person.user_id) {
            nameByUser.set(person.user_id, `${person.first_name} ${person.last_name}`);
          }
        }

        const rows: MemberRow[] = [];
        for (const [userId, memberRole] of memberRoles) {
          rows.push({
            userId,
            name: nameByUser.get(userId) ?? 'Account with no staff record',
            role: memberRole as SystemRole,
          });
        }
        // Owners first, then managers, then staff. The order someone scans in
        // when auditing who has access.
        const rank: Record<string, number> = { owner: 0, manager: 1, staff: 2 };
        rows.sort(
          (a, b) =>
            (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name),
        );
        setMembers(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-permissions:load' });
        setLoadFailed(true);
        showError('Could not load organisation members.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey, showError]);

  const handleChangeRole = async (): Promise<void> => {
    if (!orgId || !roleChangeFor) return;
    setSaving(true);
    try {
      await updateMemberRole(orgId, roleChangeFor.userId, nextRole);
      showSuccess(`${roleChangeFor.name}'s role changed to ${labels[nextRole]}.`);
      setRoleChangeFor(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      reportError(err, { area: 'settings-permissions:change-role' });
      showError(
        'Could not change that role. An organisation must keep at least one owner.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (!orgId || !removeFor) return;
    setSaving(true);
    try {
      await removeMember(orgId, removeFor.userId);
      showSuccess(`${removeFor.name} removed from the organisation.`);
      setRemoveFor(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      reportError(err, { area: 'settings-permissions:remove' });
      showError(
        'Could not remove that member. An organisation must keep at least one owner.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (role !== 'owner') return <OwnerOnlyNotice section="permissions" />;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="People and access"
        description="Everyone with a RotaFlow login for this organisation, and what they can reach."
      >
        {loading ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : loadFailed ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Could not load members. This is a connection problem, not an empty
            organisation.
          </p>
        ) : members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members yet"
            description="Invite someone below to give them access to this organisation."
          />
        ) : (
          <ul className="divide-y divide-divider dark:divide-divider-dark">
            {members.map((member) => {
              const isOwner = member.role === 'owner';
              return (
                <li key={member.userId} className="flex items-center gap-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {member.name
                      .split(' ')
                      .slice(0, 2)
                      .map((part) => part[0] ?? '')
                      .join('')
                      .toUpperCase() || '?'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-content dark:text-content-dark">
                    {member.name}
                  </span>
                  <Badge tone={ROLE_TONE[member.role] ?? 'neutral'}>
                    {labels[member.role] ?? member.role}
                  </Badge>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isOwner}
                      title={isOwner ? 'An organisation must keep one owner' : undefined}
                      onClick={() => {
                        setNextRole(member.role);
                        setRoleChangeFor(member);
                      }}
                    >
                      Change role
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isOwner || member.userId === user?.id}
                      title={
                        isOwner
                          ? 'An organisation must keep one owner'
                          : member.userId === user?.id
                            ? 'You cannot remove yourself'
                            : undefined
                      }
                      onClick={() => setRemoveFor(member)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Invitations">
        <TeamInviteManager />
      </SettingsSection>

      <Card className="bg-info/5">
        <div className="flex gap-3">
          <ShieldCheck
            size={18}
            className="mt-0.5 shrink-0 text-info"
            aria-hidden="true"
          />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              Every change here is recorded
            </p>
            <p className="mt-1">
              A role change or a removal writes a row to this organisation&rsquo;s audit
              log automatically. An organisation cannot be left without an owner — the
              last one can neither be demoted nor removed.
            </p>
          </div>
        </div>
      </Card>

      <Modal
        open={roleChangeFor !== null}
        onClose={() => setRoleChangeFor(null)}
        title={`Change role, ${roleChangeFor?.name ?? ''}`}
      >
        <div className="space-y-4">
          <div>
            <Select
              value={nextRole}
              onChange={(e) => setNextRole(e.target.value as SystemRole)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {labels[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleChangeFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving || nextRole === roleChangeFor?.role}
              onClick={() => void handleChangeRole()}
            >
              {saving ? 'Saving…' : 'Change role'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={removeFor !== null}
        onClose={() => setRemoveFor(null)}
        title={`Remove ${removeFor?.name ?? ''}?`}
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Their past shifts and timesheets are kept. They lose access immediately.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoveFor(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={saving}
              onClick={() => void handleRemove()}
            >
              {saving ? 'Removing…' : 'Remove from organisation'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
