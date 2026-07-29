import { useCallback, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Info, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { StepCard } from '@/components/onboarding/StepCard';
import type { MembershipRole } from '@/types';

export interface StagedInvite {
  email: string;
  role: MembershipRole;
  /** Set once the invitation exists in the database. */
  url?: string;
  error?: string;
}

interface StepInviteTeamProps {
  staged: StagedInvite[];
  onStage: (invites: StagedInvite[]) => void;
  onSend: () => void;
  onSkip: () => void;
  onBack: () => void;
  onCopy: (url: string) => void;
  submitting: boolean;
  sent: boolean;
}

const ROLE_BADGE: Record<MembershipRole, string> = {
  owner: 'bg-primary/10 text-primary',
  manager: 'bg-secondary/10 text-secondary dark:text-secondary-dark',
  staff:
    'bg-surface-border/60 text-content-muted dark:bg-surface-border-dark/60 dark:text-content-muted-dark',
};

export function StepInviteTeam({
  staged,
  onStage,
  onSend,
  onSkip,
  onBack,
  onCopy,
  submitting,
  sent,
}: StepInviteTeamProps): JSX.Element {
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<MembershipRole>('staff');

  const addEmails = useCallback((): void => {
    const parsed = emails
      .split(/[,\s;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length === 0) return;

    const existing = new Set(staged.map((s) => s.email));
    const additions = parsed
      .filter((e) => !existing.has(e))
      .map((email) => ({ email, role }));

    onStage([...staged, ...additions]);
    setEmails('');
  }, [emails, role, staged, onStage]);

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
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={16} aria-hidden="true" className="mr-1.5" />
            Back
          </Button>
          <Button variant="ghost" onClick={onSkip} disabled={submitting}>
            {sent ? 'Continue' : 'Skip for now'}
          </Button>
          {!sent && (
            <Button onClick={onSend} disabled={submitting || staged.length === 0}>
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
              <Input
                id="invite-emails"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addEmails();
                  }
                }}
                placeholder="colleague@example.com, another@example.com"
              />
              <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                Separate multiple addresses with commas, then press Enter or Add.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_auto] sm:items-end">
              <div>
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as MembershipRole)}
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </Select>
              </div>
              <Button variant="secondary" onClick={addEmails} disabled={!emails.trim()}>
                Add to list
              </Button>
            </div>
          </>
        )}

        <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            RotaFlow does not send the emails yet — automated delivery arrives with the
            notifications work. Each invitation produces a private link, shown once, for
            you to send however you like.
          </p>
        </div>

        {staged.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-medium text-content dark:text-content-dark">
              {sent ? 'Invitations created' : 'To invite'} ({staged.length})
            </h3>
            <ul className="divide-y divide-surface-border rounded-xl border border-surface-border dark:divide-surface-border-dark dark:border-surface-border-dark">
              {staged.map((invite) => (
                <li key={invite.email} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-content dark:text-content-dark">
                    {invite.email}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                      ROLE_BADGE[invite.role],
                    )}
                  >
                    {invite.role}
                  </span>

                  {invite.error ? (
                    <span className="text-xs text-danger">{invite.error}</span>
                  ) : invite.url ? (
                    <Button size="sm" variant="ghost" onClick={() => onCopy(invite.url!)}>
                      <Copy size={13} aria-hidden="true" className="mr-1.5" />
                      Copy link
                    </Button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => remove(invite.email)}
                      aria-label={`Remove ${invite.email}`}
                      className="rounded p-1 text-content-muted transition-colors hover:text-danger dark:text-content-muted-dark"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </StepCard>
  );
}
