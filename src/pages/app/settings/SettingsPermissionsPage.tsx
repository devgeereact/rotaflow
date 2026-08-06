import { useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getOrganisation, listOrgMemberRoles } from '@/services/orgService';
import { listStaff } from '@/services/staffService';
import { DEFAULT_ROLE_LABELS, roleLabels, type SystemRole } from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
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
export function SettingsPermissionsPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { showError } = useToast();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [labels, setLabels] = useState<Record<SystemRole, string>>(DEFAULT_ROLE_LABELS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

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
  }, [orgId, showError]);

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
            {members.map((member) => (
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
              </li>
            ))}
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
              Changing an existing member&rsquo;s role
            </p>
            <p className="mt-1">
              Roles are set when an invitation is accepted. Changing one afterwards needs
              a role-change audit event so the change is attributable. That event does not
              exist yet, so the control is not offered here rather than performing an
              unrecorded privilege change.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
