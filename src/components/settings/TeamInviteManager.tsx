import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createInvite,
  listPendingInvites,
  revokeInvite,
  sendInviteEmail,
} from '@/services/inviteService';
import { reportError } from '@/lib/sentry';
import { isValidEmail } from '@/lib/email';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import type { Invite, MembershipRole } from '@/types';

const ROLE_OPTIONS: { value: MembershipRole; label: string; hint: string }[] = [
  { value: 'staff', label: 'Staff', hint: 'View their rota, clock in, request leave' },
  {
    value: 'manager',
    label: 'Manager',
    hint: 'Build rotas, approve requests, manage staff',
  },
  {
    value: 'owner',
    label: 'Owner',
    hint: 'Everything, including org settings and billing',
  },
];

function formatExpiry(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'expired';
  return days === 1 ? 'expires tomorrow' : `expires in ${days} days`;
}

/**
 * Invitation management: create an invite, email its one-time link, copy that
 * link as a fallback, revoke a pending one.
 *
 * This was `/app/team`, a top-level sidebar item. The designed sidebar has no
 * Team entry, and what this screen actually does. Decide who may join the
 * organisation and at what role, is organisation administration, which is
 * exactly what Settings → Permissions is for. So it moved in whole rather than
 * being rebuilt, and `/app/team` now redirects here so existing links and
 * bookmarks keep working.
 */
export function TeamInviteManager(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const { canManageStaff, canManageOrg } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['invites'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('staff');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Held after a successful invite so the manager can copy the link. The raw
  // token only exists in this response and is unrecoverable afterwards.
  const [lastLink, setLastLink] = useState<{ email: string; url: string } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const rows = await listPendingInvites(orgId);
        if (!active) return;
        setInvites(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'team:list-invites' });
        setLoadFailed(true);
        showError('Could not load pending invitations.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey, showError]);

  const handleInvite = useCallback(async (): Promise<void> => {
    if (!orgId || !email.trim()) return;
    if (!isValidEmail(email)) {
      setFormError('That does not look like a valid email address.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createInvite(orgId, email.trim(), role);
      const invitedEmail = email.trim();
      setLastLink({ email: invitedEmail, url: created.acceptUrl });
      setEmail('');
      setRole('staff');
      setModalOpen(false);
      setReloadKey((k) => k + 1);

      // The invite already exists and the link is on screen, so emailing is a
      // best effort on top — never a reason to fail the invitation. The link
      // stays visible either way, because the manager is the fallback when no
      // mailbox is configured or the send is refused.
      const delivery = await sendInviteEmail(orgId, created);
      if (delivery.sent) {
        showSuccess(`Invitation emailed to ${invitedEmail}.`);
      } else {
        showSuccess('Invitation created.');
        showError(
          delivery.reason ??
            'The invite could not be emailed. Copy the link below and send it to them.',
        );
      }
    } catch (err) {
      reportError(err, { area: 'team:create-invite' });
      // The database raises specific messages (already a member, bad address,
      // insufficient role) that are more useful than a generic failure.
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Could not create that invitation.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }, [orgId, email, role, showError, showSuccess]);

  const handleRevoke = useCallback(
    async (invite: Invite): Promise<void> => {
      try {
        await revokeInvite(invite.id);
        setInvites((prev) => prev.filter((i) => i.id !== invite.id));
        showSuccess(`Invitation for ${invite.email} revoked.`);
      } catch (err) {
        reportError(err, { area: 'team:revoke-invite' });
        showError('Could not revoke that invitation.');
      }
    },
    [showError, showSuccess],
  );

  const copyLink = useCallback(
    async (url: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(url);
        showSuccess('Invitation link copied.');
      } catch (err) {
        reportError(err, { area: 'team:copy-link' });
        showError('Could not copy. Select the link and copy it manually.');
      }
    },
    [showError, showSuccess],
  );

  if (!canManageStaff) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Only owners and managers can manage the team.
        </p>
      </Card>
    );
  }

  const roleOptions = canManageOrg
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((o) => o.value !== 'owner');

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Invite people to {orgName ?? 'your organisation'} and manage pending
          invitations.
        </p>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus size={14} aria-hidden="true" className="mr-1.5" />
          Invite someone
        </Button>
      </div>

      {lastLink && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <h2 className="mb-1 font-medium text-content dark:text-content-dark">
            Invitation link for {lastLink.email}
          </h2>
          <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
            RotaFlow emails this link automatically; the copy here is your fallback if the
            email does not arrive. It is shown once — only a hash of the token is stored,
            so it cannot be retrieved again. Revoke and reissue if it is lost.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-surface-border bg-background px-3 py-2 font-mono text-xs text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark">
              {lastLink.url}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyLink(lastLink.url)}
            >
              <Copy size={14} aria-hidden="true" className="mr-1.5" />
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLastLink(null)}>
              Done
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-4 font-medium text-content dark:text-content-dark">
          Pending invitations
        </h2>

        {loading ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : loadFailed ? (
          <div>
            <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
              Could not load invitations. This is a connection problem, not an empty list.
            </p>
            <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
          </div>
        ) : invites.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            No pending invitations.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                    {invite.email}
                  </p>
                  <p className="text-xs text-content-muted dark:text-content-muted-dark">
                    {invite.role} · {formatExpiry(invite.expires_at)}
                  </p>
                </div>
                <span className="text-xs text-content-muted dark:text-content-muted-dark">
                  Link shown once at creation
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRevoke(invite)}
                  aria-label={`Revoke invitation for ${invite.email}`}
                >
                  <X size={14} aria-hidden="true" className="mr-1.5" />
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Invite someone">
        <div className="space-y-4">
          <div>
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
            />
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              They must accept using this exact address. The invitation cannot be redeemed
              from any other account.
            </p>
          </div>

          <div>
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as MembershipRole)}
            >
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              {roleOptions.find((o) => o.value === role)?.hint}
            </p>
          </div>

          {formError && (
            <p className="text-sm text-danger-ink dark:text-danger-ink-dark" role="alert">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleInvite()}
              disabled={submitting || !email.trim()}
            >
              {submitting ? 'Creating…' : 'Create invitation'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
