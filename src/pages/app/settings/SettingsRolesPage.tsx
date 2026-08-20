import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Info } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getOrganisation, mergeOrgSettings } from '@/services/orgService';
import { listOrgMemberRoles } from '@/services/orgService';
import {
  DEFAULT_ROLE_LABELS,
  SYSTEM_ROLES,
  roleLabels,
  type SystemRole,
} from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SettingsSection } from '@/components/settings/SettingsSection';

const ROLE_SCOPE: Record<SystemRole, string> = {
  owner: 'Full access, including billing and permissions.',
  manager: 'Builds rotas, approves requests, manages staff.',
  staff: 'Views their own shifts, clocks in, requests leave and swaps.',
};

/**
 * `/app/settings/roles`. The "Role Display Labels" card from
 * docs/design/SettingsOrganisation.png, given its own section.
 *
 * ## The gap between the design and the schema, and how it is resolved
 *
 * The reference lists seven roles. Manager, Deputy Manager, Team Leader,
 * Senior Carer, Carer, HR, Trainer, which reads as custom roles. The schema
 * cannot represent that: `memberships.role` is a three-value CHECK
 * (`owner | manager | staff`) and every RLS policy in `0002_rotaflow.sql` is
 * written against those three literals. Adding real custom roles is a
 * migration plus a rewrite of the entire authorisation boundary.
 *
 * But look at what the card itself says it does: *"Customise how roles are
 * shown across the platform"*, with a **System Role → Display Label** mapping.
 * That is relabelling, not new permissions, and it fits the existing schema
 * exactly, a care home genuinely does call its manager a "Deputy Manager".
 *
 * So that is what this ships, and the screen says plainly that a label does
 * not change what someone can do. The alternative, a UI that lets an owner
 * create "HR Advisor" and quietly grants them `staff` permissions, is how you
 * end up with a customer believing access is restricted when it is not.
 */
export function SettingsRolesPage(): JSX.Element {
  const { orgId, role, refresh } = useOrg();
  const { showError, showSuccess } = useToast();

  const [labels, setLabels] = useState<Record<SystemRole, string>>(DEFAULT_ROLE_LABELS);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // `organisations_update` (0002_rotaflow.sql) is owner-only — a manager
  // could see this form enabled and have every save silently rejected by RLS.
  const canEdit = role === 'owner';

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [org, memberRoles] = await Promise.all([
          getOrganisation(orgId),
          listOrgMemberRoles(orgId).catch(() => new Map<string, string>()),
        ]);
        if (!active) return;
        setLabels(roleLabels(org.settings));

        const tally: Record<string, number> = {};
        for (const value of memberRoles.values()) {
          tally[value] = (tally[value] ?? 0) + 1;
        }
        setCounts(tally);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-roles:load' });
        showError('Could not load role settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, showError]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setSaving(true);
    try {
      // Blank falls back to the system name rather than storing "", an empty
      // label would render a nameless role everywhere it appears.
      await mergeOrgSettings(orgId, {
        role_labels: {
          owner: labels.owner.trim() || DEFAULT_ROLE_LABELS.owner,
          manager: labels.manager.trim() || DEFAULT_ROLE_LABELS.manager,
          staff: labels.staff.trim() || DEFAULT_ROLE_LABELS.staff,
        },
      });
      await refresh();
      showSuccess('Role labels saved.');
    } catch (err) {
      reportError(err, { area: 'settings-roles:save' });
      showError('Could not save role labels. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [orgId, labels, refresh, showError, showSuccess]);

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
    <div className="space-y-6">
      <SettingsSection
        title="Role display labels"
        description="Customise how each role is named across RotaFlow. Labels change wording only, not what someone can do."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left dark:border-surface-border-dark">
                <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                  System role
                </th>
                <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                  Display label
                </th>
                <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                  People
                </th>
                <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                  Access
                </th>
              </tr>
            </thead>
            <tbody>
              {SYSTEM_ROLES.map((systemRole) => (
                <tr
                  key={systemRole}
                  className="border-b border-divider last:border-0 dark:border-divider-dark"
                >
                  <td className="py-3 pr-4 align-middle font-medium capitalize text-content dark:text-content-dark">
                    {systemRole}
                  </td>
                  <td className="py-3 pr-4 align-middle">
                    <Input
                      aria-label={`Display label for ${systemRole}`}
                      value={labels[systemRole]}
                      disabled={!canEdit}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setLabels((prev) => ({ ...prev, [systemRole]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="py-3 pr-4 align-middle tabular-nums text-content-muted dark:text-content-muted-dark">
                    {counts[systemRole] ?? 0}
                  </td>
                  <td className="py-3 align-middle text-content-muted dark:text-content-muted-dark">
                    {ROLE_SCOPE[systemRole]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="mt-6 flex justify-end">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save labels'}
            </Button>
          </div>
        )}
      </SettingsSection>

      <Card className="bg-info/5">
        <div className="flex gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              Custom roles are not available yet
            </p>
            <p className="mt-1">
              RotaFlow has three permission levels. Owner, manager and staff, and every
              access rule in the database is written against them. Renaming a role here
              changes how it reads, not what it can reach. Roles with their own permission
              sets need a schema change and are tracked as a separate piece of work.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
