import { Clock3, MailPlus, Send, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconTile } from '@/components/ui/IconTile';
import { TablePagination } from '@/components/ui/TablePagination';
import { InviteLinkCard } from '@/components/staff/InviteLinkCard';
import { InvitesTable } from '@/components/staff/InvitesTable';
import {
  StaffFilterBar,
  type StaffFilterSelect,
} from '@/components/staff/StaffFilterBar';
import { StaffStatCard } from '@/components/staff/StaffStatCard';
import type { InviteRow, InviteStats } from '@/lib/staffInvites';

export interface InviteLink {
  email: string;
  url: string;
}

interface StaffInvitationsViewProps {
  stats: InviteStats;
  rows: InviteRow[];
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  selects: StaffFilterSelect[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** The token from the last successful invite, held until dismissed. */
  link: InviteLink | null;
  onCopyLink: () => void;
  onDismissLink: () => void;
  onInvite?: () => void;
  onRevoke?: (row: InviteRow) => void;
  revokingId?: string | null;
  loading?: boolean;
  /** True when the org has no pending invites at all, filters aside. */
  empty: boolean;
}

/**
 * The Invitations half of the Staff workspace — summary tiles, filter bar,
 * the pending table and the once-only link callout.
 *
 * No mockup exists for this tab: docs/LOOP.md's "Screens with NO design
 * reference" rule applies, so the layout is inferred from design/staff.png
 * (tiles → filter bar → bordered table → pagination) using the tokens in
 * design/designsystem.png. Presentational — the caller owns the data, so this
 * renders identically from Supabase and from the design-loop fixtures.
 */
export function StaffInvitationsView({
  stats,
  rows,
  total,
  search,
  onSearchChange,
  selects,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  link,
  onCopyLink,
  onDismissLink,
  onInvite,
  onRevoke,
  revokingId,
  loading = false,
  empty,
}: StaffInvitationsViewProps): JSX.Element {
  return (
    <div className="min-w-0">
      {link && (
        <InviteLinkCard
          email={link.email}
          url={link.url}
          onCopy={onCopyLink}
          onDismiss={onDismissLink}
        />
      )}

      {/* Five across, matching the directory's summary row (design/staff.png)
          so the two tabs keep one rhythm. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StaffStatCard
          icon={MailPlus}
          tone="primary"
          label="Pending Invites"
          value={String(stats.pending)}
          hint="Awaiting acceptance"
        />
        <StaffStatCard
          icon={Clock3}
          tone="warning"
          label="Expiring Soon"
          value={String(stats.expiringSoon)}
          hint="Within 2 days"
        />
        <StaffStatCard
          icon={ShieldCheck}
          tone="violet"
          label="Managers"
          value={String(stats.elevated)}
          hint="Elevated access"
        />
        <StaffStatCard
          icon={Users}
          tone="info"
          label="Staff"
          value={String(stats.staff)}
          hint="Standard access"
        />
        <StaffStatCard
          icon={Send}
          tone="success"
          label="Sent This Week"
          value={String(stats.sentThisWeek)}
          hint="Last 7 days"
        />
      </div>

      <div className="mt-8">
        <StaffFilterBar
          search={search}
          onSearchChange={onSearchChange}
          selects={selects}
          onAdd={onInvite}
          addLabel="Invite Someone"
          searchPlaceholder="Search invitations..."
          searchLabel="Search invitations"
        />
      </div>

      <Card className="mt-7 overflow-hidden p-0">
        {loading ? (
          <p className="px-6 py-10 text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : empty ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <IconTile icon={MailPlus} tone="primary" size="xl" />
            <p className="text-base font-semibold text-content dark:text-content-dark">
              No pending invitations
            </p>
            <p className="max-w-sm text-sm text-content-muted dark:text-content-muted-dark">
              Everyone you have invited has either joined or their invitation has lapsed.
              Invite someone to add them to this organisation.
            </p>
            {onInvite && (
              <Button size="sm" className="mt-1" onClick={onInvite}>
                Invite Someone
              </Button>
            )}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-content-muted dark:text-content-muted-dark">
            No invitations match that search.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <InvitesTable rows={rows} onRevoke={onRevoke} busyId={revokingId} />
            </div>
            <div className="border-t border-surface-border dark:border-surface-border-dark">
              <TablePagination
                page={page}
                pageCount={Math.max(1, Math.ceil(total / pageSize))}
                pageSize={pageSize}
                total={total}
                shown={rows.length}
                noun="invitations"
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
