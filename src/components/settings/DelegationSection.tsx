import { useCallback, useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import {
  delegateRole,
  isLive,
  listDelegations,
  revokeDelegation,
  type Delegation,
} from '@/services/delegationService';

interface DelegationSectionProps {
  orgId: string;
  /** Everybody in the organisation, so a row can show a name rather than a uuid. */
  members: readonly { userId: string; name: string }[];
  /** Only a real owner or manager may arrange cover — a delegate may not. */
  canDelegate: boolean;
}

/**
 * Arranging cover while somebody is away (CAP-090).
 *
 * ## What this replaces
 *
 * "Deputy Manager" was a display label: `roleLabels` renames the three real
 * roles and changes nothing about what anybody may do. A manager going away
 * for a fortnight had two options, and both were bad — promote somebody
 * permanently and hope to remember to demote them, or leave every leave
 * request, swap and overtime claim unanswered until they were back.
 *
 * ## It says plainly what it does and does not hand over
 *
 * Cover confers manager, never owner. That is a real limit and the screen
 * states it, because somebody arranging cover before a holiday needs to know
 * what will still be blocked while they are away rather than discovering it
 * from a colleague's message.
 *
 * ## The list shows ended cover too
 *
 * A delegation that has expired is the answer to "who approved this while I
 * was off", which is a question that gets asked weeks later. Hiding it would
 * make the record useless exactly when it is wanted.
 */
export function DelegationSection({
  orgId,
  members,
  canDelegate,
}: DelegationSectionProps): JSX.Element {
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Delegation[] | null>(null);
  const [toUserId, setToUserId] = useState('');
  const [until, setUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await listDelegations(orgId);
        if (active) setRows(found);
      } catch (err) {
        reportError(err, { area: 'delegation:list' });
        if (active) setRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const nameOf = (userId: string): string =>
    members.find((m) => m.userId === userId)?.name ?? 'Somebody who has left';

  const handleDelegate = useCallback(async (): Promise<void> => {
    if (!toUserId || !until) return;
    setSaving(true);
    try {
      // End of the chosen day, not its midnight: cover "until Friday" that
      // stopped at 00:00 on Friday would leave the Friday uncovered, which
      // is the day somebody is most likely to need it.
      await delegateRole(orgId, toUserId, `${until}T23:59:59Z`);
      setToUserId('');
      setUntil('');
      setReloadKey((k) => k + 1);
      showSuccess('Cover arranged.');
    } catch (err) {
      reportError(err, { area: 'delegation:create' });
      showError(
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : 'That cover could not be arranged.',
      );
    } finally {
      setSaving(false);
    }
  }, [orgId, toUserId, until, showError, showSuccess]);

  const handleRevoke = useCallback(
    async (delegation: Delegation): Promise<void> => {
      try {
        await revokeDelegation(delegation.id);
        setReloadKey((k) => k + 1);
        showSuccess('Cover ended.');
      } catch (err) {
        reportError(err, { area: 'delegation:revoke' });
        showError('That cover could not be ended.');
      }
    },
    [showError, showSuccess],
  );

  return (
    <SettingsSection
      title="Cover while somebody is away"
      description="Lend managerial approvals to a colleague for a set period."
    >
      {canDelegate && (
        <div className="mb-5 grid gap-4 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
          <div>
            <Label htmlFor="delegate-to">Who is covering</Label>
            <Select
              id="delegate-to"
              value={toUserId}
              onChange={(event) => setToUserId(event.target.value)}
            >
              <option value="">Choose somebody</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="delegate-until">Until the end of</Label>
            <Input
              id="delegate-until"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
          <Button
            disabled={saving || !toUserId || !until}
            onClick={() => void handleDelegate()}
          >
            {saving ? 'Arranging…' : 'Arrange cover'}
          </Button>
        </div>
      )}

      <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
        Cover gives approvals and the rota — everything a manager can do. It does{' '}
        <strong>not</strong> give ownership: deleting the organisation, transferring it
        and changing billing stay with the owner. Cover ends on its own date; nobody has
        to remember.
      </p>

      {rows && rows.length > 0 ? (
        <ul className="divide-y divide-divider dark:divide-divider-dark">
          {rows.map((row) => {
            const live = isLive(row);
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                <UserCheck
                  size={17}
                  className="shrink-0 text-content-muted dark:text-content-muted-dark"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-content dark:text-content-dark">
                    <strong>{nameOf(row.toUserId)}</strong> covering for{' '}
                    {nameOf(row.fromUserId)}
                  </p>
                  <p className="text-xs text-content-muted dark:text-content-muted-dark">
                    until {new Date(row.endsAt).toLocaleDateString('en-GB')}
                    {row.revokedAt && ' · ended early'}
                  </p>
                </div>
                {live ? <Badge tone="success">Active</Badge> : <Badge>Ended</Badge>}
                {live && canDelegate && (
                  <Button variant="secondary" onClick={() => void handleRevoke(row)}>
                    End now
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Nobody is covering for anybody.
        </p>
      )}
    </SettingsSection>
  );
}
