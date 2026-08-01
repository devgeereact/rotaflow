import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { createInvite, listPendingInvites, revokeInvite } from '@/services/inviteService';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InviteFormModal } from '@/components/staff/InviteFormModal';
import {
  StaffInvitationsView,
  type InviteLink,
} from '@/components/staff/StaffInvitationsView';
import { StaffWorkspaceHeader } from '@/components/staff/StaffWorkspaceHeader';
import type { StaffFilterSelect } from '@/components/staff/StaffFilterBar';
import {
  buildInviteStats,
  INVITE_ROLE_LABELS,
  matchesInvite,
  toInviteRow,
} from '@/lib/staffInvites';
import { reportError } from '@/lib/sentry';
import type { InviteRow } from '@/lib/staffInvites';
import type { Invite, MembershipRole } from '@/types';

/**
 * The Invitations tab of the Staff workspace — previously the standalone Team
 * screen, which asked the same question the directory does ("who works here")
 * from a second sidebar entry.
 *
 * Everything is scoped to the active org; RLS is the real gate, `usePermissions`
 * only decides which affordances appear. See `src/services/inviteService.ts`
 * for why minting and redemption go through SECURITY DEFINER functions.
 */
export function StaffInvitationsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff, canManageOrg } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Held after a successful invite so the manager can copy the link — the raw
  // token only exists in that response and is unrecoverable afterwards.
  const [link, setLink] = useState<InviteLink | null>(null);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['invites'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((key) => key + 1),
  });

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
        reportError(err, { area: 'staff-invitations:list' });
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

  const allRows = useMemo(() => {
    // One clock for the whole list, so two rows never straddle midnight and
    // disagree about how many days are left.
    const now = new Date();
    return invites.map((invite) => toInviteRow(invite, now));
  }, [invites]);

  const filtered = useMemo(
    () =>
      allRows.filter((row) => matchesInvite(row, search) && (!role || row.role === role)),
    [allRows, search, role],
  );

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const selects: StaffFilterSelect[] = [
    {
      id: 'roles',
      allLabel: 'All Roles',
      value: role,
      onChange: (value) => {
        setRole(value);
        setPage(1);
      },
      options: (['staff', 'manager', 'owner'] as MembershipRole[]).map((value) => ({
        value,
        label: INVITE_ROLE_LABELS[value],
      })),
    },
  ];

  const handleInvite = useCallback(
    async (email: string, inviteRole: MembershipRole): Promise<void> => {
      if (!orgId) return;
      const created = await createInvite(orgId, email, inviteRole);
      setLink({ email, url: created.acceptUrl });
      setModalOpen(false);
      setReloadKey((key) => key + 1);
      showSuccess('Invitation created. Copy the link and send it to them.');
    },
    [orgId, showSuccess],
  );

  const handleRevoke = useCallback(
    async (row: InviteRow): Promise<void> => {
      setRevokingId(row.id);
      try {
        await revokeInvite(row.id);
        setInvites((prev) => prev.filter((invite) => invite.id !== row.id));
        showSuccess(`Invitation for ${row.email} revoked.`);
      } catch (err) {
        reportError(err, { area: 'staff-invitations:revoke' });
        showError('Could not revoke that invitation.');
      } finally {
        setRevokingId(null);
      }
    },
    [showError, showSuccess],
  );

  const copyLink = useCallback(async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      showSuccess('Invitation link copied.');
    } catch (err) {
      reportError(err, { area: 'staff-invitations:copy-link' });
      showError('Could not copy — select the link and copy it manually.');
    }
  }, [link, showError, showSuccess]);

  // Cosmetic only; `create_invite` and the `invites` policies are what actually
  // stop a staff account minting one.
  if (!canManageStaff) {
    return (
      <div>
        <StaffWorkspaceHeader tab="invitations" basePath="/app/staff" canInvite={false} />
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            Only owners and managers can invite people to this organisation.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <StaffWorkspaceHeader tab="invitations" basePath="/app/staff" />

      {loadFailed ? (
        <Card>
          <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
            Could not load invitations — this is a connection problem, not an empty list.
          </p>
          <Button size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </Card>
      ) : (
        <StaffInvitationsView
          stats={buildInviteStats(allRows)}
          rows={pageRows}
          total={filtered.length}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          selects={selects}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          link={link}
          onCopyLink={() => void copyLink()}
          onDismissLink={() => setLink(null)}
          onInvite={() => setModalOpen(true)}
          onRevoke={(row) => void handleRevoke(row)}
          revokingId={revokingId}
          loading={loading}
          empty={!loading && allRows.length === 0}
        />
      )}

      <InviteFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleInvite}
        canInviteOwner={canManageOrg}
      />
    </div>
  );
}
