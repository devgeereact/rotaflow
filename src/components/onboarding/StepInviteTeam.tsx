import { useCallback, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Copy,
  Info,
  MapPin,
  Plus,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { StepCard } from '@/components/onboarding/StepCard';
import type { MembershipRole } from '@/types';

export interface StagedInvite {
  email: string;
  role: MembershipRole;
  /**
   * Department/location are staged locally for the reviewer's own planning
   * only — `createInvite` (src/services/inviteService.ts) takes just
   * org/email/role, and the `invites` table has no columns for either yet.
   * Shown in the review table below to match design/Team-onboarding.png, but
   * not persisted; a future migration would be needed to actually save them.
   */
  department?: string;
  location?: string;
  /** Set once the invitation exists in the database. */
  url?: string;
  error?: string;
}

interface StepInviteTeamProps {
  staged: StagedInvite[];
  onStage: (invites: StagedInvite[]) => void;
  onSend: () => void;
  onSkip: () => void;
  onCopy: (url: string) => void;
  submitting: boolean;
  sent: boolean;
  /** Locations captured in step 2, offered here as real (not invented) options. */
  locationNames: string[];
}

const ROLE_BADGE: Record<MembershipRole, string> = {
  owner: 'bg-brand-wash text-brand dark:bg-brand-deep/20 dark:text-brand-light',
  manager: 'bg-shift-violet/15 text-shift-violet',
  staff:
    'bg-surface-border/60 text-content-muted dark:bg-surface-border-dark/60 dark:text-content-muted-dark',
};

const AVATAR_TINTS = [
  'bg-brand-wash text-brand',
  'bg-shift-violet/15 text-shift-violet',
  'bg-shift-amber/20 text-shift-amber',
  'bg-shift-teal/15 text-shift-teal',
  'bg-shift-rose/15 text-shift-rose',
];

function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second || first).toUpperCase();
}

export function StepInviteTeam({
  staged,
  onStage,
  onSend,
  onSkip,
  onCopy,
  submitting,
  sent,
  locationNames,
}: StepInviteTeamProps): JSX.Element {
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<MembershipRole>('staff');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');

  const addEmails = useCallback((): void => {
    const parsed = emails
      .split(/[,\s;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length === 0) return;

    const existing = new Set(staged.map((s) => s.email));
    const additions = parsed
      .filter((e) => !existing.has(e))
      .map((email) => ({
        email,
        role,
        department: department || undefined,
        location: location || undefined,
      }));

    onStage([...staged, ...additions]);
    setEmails('');
  }, [emails, role, department, location, staged, onStage]);

  const remove = useCallback(
    (email: string): void => onStage(staged.filter((s) => s.email !== email)),
    [staged, onStage],
  );

  return (
    <StepCard
      icon={Users}
      title="Invite your team"
      subtitle="Add team members to your organisation. You can always invite more later."
      footer={
        <>
          <Button variant="secondary" onClick={onSkip} disabled={submitting}>
            {sent ? 'Continue' : 'Skip for now'}
          </Button>
          {!sent && (
            <Button
              className="bg-brand hover:bg-brand/90 dark:bg-brand"
              onClick={onSend}
              disabled={submitting || staged.length === 0}
            >
              {submitting
                ? 'Creating…'
                : `Create ${staged.length || ''} invitation${staged.length === 1 ? '' : 's'}`.trim()}
              {!submitting && (
                <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
              )}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        {!sent && (
          <>
            <div>
              <Label htmlFor="invite-emails">Email addresses</Label>
              <textarea
                id="invite-emails"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    addEmails();
                  }
                }}
                rows={2}
                placeholder="Enter email addresses"
                className="w-full resize-y rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
              />
              <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                Add one or more email addresses, separated by commas, then press Enter.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  id="invite-role"
                  icon={User}
                  value={role}
                  onChange={(e) => setRole(e.target.value as MembershipRole)}
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="invite-department">Department (optional)</Label>
                <Select
                  id="invite-department"
                  icon={Building2}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="">Select department</option>
                  <option value="Care">Care</option>
                  <option value="Nursing">Nursing</option>
                  <option value="Support">Support</option>
                  <option value="Admin">Admin</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="invite-location">Location (optional)</Label>
                <Select
                  id="invite-location"
                  icon={MapPin}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={locationNames.length === 0}
                >
                  <option value="">Select location</option>
                  {locationNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={addEmails}
              disabled={!emails.trim()}
            >
              <Plus size={14} aria-hidden="true" className="mr-1" />
              Add another
            </Button>

            <div className="flex gap-3 rounded-xl border border-brand/20 bg-brand-wash p-4 dark:bg-brand-deep/10">
              <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
              <div className="text-sm text-content-muted dark:text-content-muted-dark">
                <p className="font-medium text-ink dark:text-content-dark">About roles</p>
                <p className="text-brand dark:text-brand-light">
                  You can change roles and permissions later from Settings &gt; Team.
                </p>
              </div>
            </div>
          </>
        )}

        {staged.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink dark:text-content-dark">
                {sent ? 'Invitations created' : 'Invited team members'} ({staged.length})
              </h3>
              {!sent && (
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  {staged.length} invitation{staged.length === 1 ? '' : 's'} will be
                  created
                </p>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-surface-border dark:border-surface-border-dark">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-subtle text-xs uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:bg-surface-subtle-dark dark:text-content-muted-dark">
                    <th className="px-4 py-2.5 font-medium">Email address</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Department</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
                  {staged.map((invite, i) => (
                    <tr key={invite.email}>
                      <td className="flex items-center gap-2.5 px-4 py-3">
                        <span
                          className={cn(
                            'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                            AVATAR_TINTS[i % AVATAR_TINTS.length],
                          )}
                        >
                          {initials(invite.email)}
                        </span>
                        <span className="truncate text-content dark:text-content-dark">
                          {invite.email}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                            ROLE_BADGE[invite.role],
                          )}
                        >
                          {invite.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                        {invite.department ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                        {invite.location ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {invite.error ? (
                          <span className="text-xs text-danger">{invite.error}</span>
                        ) : invite.url ? (
                          <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                            Created
                          </span>
                        ) : (
                          <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {invite.url ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onCopy(invite.url!)}
                            aria-label={`Copy invitation link for ${invite.email}`}
                          >
                            <Copy size={13} aria-hidden="true" />
                          </Button>
                        ) : (
                          !sent && (
                            <button
                              type="button"
                              onClick={() => remove(invite.email)}
                              aria-label={`Remove ${invite.email}`}
                              className="rounded p-1 text-content-muted transition-colors hover:text-danger dark:text-content-muted-dark"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </StepCard>
  );
}
