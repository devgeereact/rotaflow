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
import { isValidEmail } from '@/lib/email';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { StepCard } from '@/components/onboarding/StepCard';
import type { MembershipRole } from '@/types';

export interface StagedInvite {
  email: string;
  role: MembershipRole;
  /**
   * Where this person will work. Held as ids because they are sent to
   * `create_invite`, which validates both against the inviting organisation
   * and applies them to the staff record on acceptance (0126).
   *
   * Until RF-11 these were NAMES, staged in component state, shown back in
   * the review table below, and then dropped: `createInvite` took only
   * org/email/role and `invites` had no column for either. A manager
   * assigned twenty people to sites during onboarding and every one of them
   * joined unassigned. The code comment that used to sit here said so, which
   * nobody administering an organisation ever reads.
   */
  departmentId?: string;
  locationId?: string;
  /** The chosen names, for the review table. Display only. */
  department?: string;
  location?: string;
  /** Set once the invitation exists in the database. */
  url?: string;
  error?: string;
  /**
   * Why the join link could not be emailed, when the invitation itself was
   * created. Distinct from `error`, which means no invitation exists at all.
   *
   * RF-10: these two used to be the same thing, which is to say neither was
   * recorded. `handleCreateInvites` awaited `sendInviteEmail` and threw its
   * result away, so a mail server returning 503 produced the same green
   * "Invitations sent" as a successful send. The invite worked — it is durable
   * and the link is shown — but the owner walked away believing their staff
   * had been written to, and nobody had.
   */
  deliveryError?: string;
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
  locations: readonly { id: string; name: string }[];
  /**
   * The organisation's real departments.
   *
   * Empty during onboarding, because nothing creates a department before this
   * step — and the control is hidden when it is empty. It used to offer a
   * hardcoded Care/Nursing/Support/Admin, which belonged to no organisation
   * and was stored nowhere: a list invented by the interface, presented as
   * though it were the customer's own.
   */
  departments: readonly { id: string; name: string }[];
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
  locations,
  departments,
}: StepInviteTeamProps): JSX.Element {
  const [emails, setEmails] = useState('');
  const [invalidCount, setInvalidCount] = useState(0);
  const [role, setRole] = useState<MembershipRole>('staff');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');

  const addEmails = useCallback((): void => {
    const parsed = emails
      .split(/[,\s;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length === 0) return;

    // Anything malformed is held back rather than staged. It would only be
    // rejected later by create_invite's regex, after the wizard had moved on,
    // where the failure is invisible.
    const [valid, invalid] = parsed.reduce<[string[], string[]]>(
      ([ok, bad], candidate) =>
        isValidEmail(candidate) ? [[...ok, candidate], bad] : [ok, [...bad, candidate]],
      [[], []],
    );

    const existing = new Set(staged.map((s) => s.email));
    const additions = valid
      .filter((e) => !existing.has(e))
      .map((email) => ({
        email,
        role,
        departmentId: department || undefined,
        locationId: location || undefined,
        department: departments.find((d) => d.id === department)?.name,
        location: locations.find((l) => l.id === location)?.name,
      }));

    onStage([...staged, ...additions]);
    setEmails(invalid.join(' '));
    setInvalidCount(invalid.length);
  }, [emails, role, department, location, departments, locations, staged, onStage]);

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
                onChange={(e) => {
                  setEmails(e.target.value);
                  setInvalidCount(0);
                }}
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
              {invalidCount > 0 && (
                <p
                  className="mt-1 text-xs text-danger-ink dark:text-danger-ink-dark"
                  role="alert"
                >
                  {invalidCount === 1
                    ? "That address doesn't look valid. It's been left above so you can correct it."
                    : `${invalidCount} addresses don't look valid. They've been left above so you can correct them.`}
                </p>
              )}
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
              {/* Hidden when the organisation has no departments, which is
                  every organisation at this point in onboarding. An empty
                  dropdown is honest where the old hardcoded Care/Nursing/
                  Support/Admin was not: those belonged to no organisation and
                  were saved nowhere. */}
              {departments.length > 0 && (
                <div>
                  <Label htmlFor="invite-department">Department (optional)</Label>
                  <Select
                    id="invite-department"
                    icon={Building2}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="invite-location">Location (optional)</Label>
                <Select
                  id="invite-location"
                  icon={MapPin}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={locations.length === 0}
                >
                  <option value="">Select location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
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
                        {invite.department ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                        {invite.location ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        {invite.error ? (
                          <span className="text-xs text-danger-ink dark:text-danger-ink-dark">
                            {invite.error}
                          </span>
                        ) : invite.url && invite.deliveryError ? (
                          // The invitation is real and the link below works.
                          // Only the email did not go, and saying so is the
                          // whole point — the owner has to pass the link on
                          // themselves, and cannot know that from "Created".
                          <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning-ink dark:text-warning-ink-dark">
                            Not emailed
                          </span>
                        ) : invite.url ? (
                          <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success-ink dark:text-success-ink-dark">
                            Emailed
                          </span>
                        ) : (
                          <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning-ink dark:text-warning-ink-dark">
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
