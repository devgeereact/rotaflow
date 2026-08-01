import { Mail, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { IconTile } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';
import type { InviteRow } from '@/lib/staffInvites';
import type { MembershipRole } from '@/types';

interface InvitesTableProps {
  rows: InviteRow[];
  /** Omitted for a role that may read the list but not withdraw from it. */
  onRevoke?: (row: InviteRow) => void;
  /** Id currently being withdrawn — its button is disabled meanwhile. */
  busyId?: string | null;
}

/** Elevated roles get the accent an ordinary staff invite does not need. */
const ROLE_TONES: Record<MembershipRole, BadgeTone> = {
  owner: 'violet',
  manager: 'primary',
  staff: 'neutral',
};

/** Column widths as a share of the table, matching the directory's density. */
const COLUMNS: { key: string; label: string; width: string }[] = [
  { key: 'invitee', label: 'Invitee', width: 'w-[30%]' },
  { key: 'role', label: 'Role', width: 'w-[13%]' },
  { key: 'invited', label: 'Invited', width: 'w-[15%]' },
  { key: 'expires', label: 'Expires', width: 'w-[16%]' },
  { key: 'status', label: 'Status', width: 'w-[16%]' },
];

const CELL = 'px-3 py-3.5 align-middle';

/**
 * Pending invitations, drawn in the same idiom as the staff directory table
 * (design/staff.png) so the two tabs read as one screen.
 *
 * There is no per-row link to copy: only a sha256 hash of the token is stored,
 * so the URL exists exactly once, at creation. `InviteLinkCard` is where it
 * gets copied; a lost link is reissued by revoking and inviting again.
 */
export function InvitesTable({ rows, onRevoke, busyId }: InvitesTableProps): JSX.Element {
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        {COLUMNS.map((column) => (
          <col key={column.key} className={column.width} />
        ))}
        <col className="w-[10%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
          {COLUMNS.map((column, index) => (
            <th
              key={column.key}
              scope="col"
              className={cn('px-3 py-3', index === 0 && 'pl-2.5')}
            >
              <span className="whitespace-nowrap text-sm font-semibold text-content dark:text-content-dark">
                {column.label}
              </span>
            </th>
          ))}
          <th scope="col" className="px-3 py-3">
            <span className="whitespace-nowrap text-sm font-semibold text-content dark:text-content-dark">
              Actions
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className="border-b border-divider transition-colors last:border-0 hover:bg-surface-subtle dark:border-divider-dark dark:hover:bg-surface-subtle-dark"
          >
            <td className={cn(CELL, 'pl-2.5')}>
              <div className="flex items-center gap-3">
                <IconTile icon={Mail} tone="primary" size="base" />
                <p className="min-w-0 truncate text-sm font-semibold text-content dark:text-content-dark">
                  {row.email}
                </p>
              </div>
            </td>

            <td className={CELL}>
              <Badge tone={ROLE_TONES[row.role]} className="px-2.5 py-1">
                {row.roleLabel}
              </Badge>
            </td>

            <td
              className={cn(
                CELL,
                'whitespace-nowrap text-sm text-content dark:text-content-dark',
              )}
            >
              {row.invitedOn}
            </td>

            <td className={CELL}>
              <span
                className={cn(
                  'whitespace-nowrap text-sm',
                  row.expiringSoon
                    ? 'font-semibold text-warning'
                    : 'text-content dark:text-content-dark',
                )}
              >
                {row.expiresLabel}
              </span>
            </td>

            <td className={CELL}>
              {/* Never colour alone (docs/DESIGN.md §5): the two states carry
                  different words, so neither needs an icon — which also keeps
                  this column identical in weight to the directory's. */}
              <Badge tone={row.expiringSoon ? 'warning' : 'info'} className="px-2.5 py-1">
                {row.expiringSoon ? 'Expiring' : 'Pending'}
              </Badge>
            </td>

            <td className={CELL}>
              {onRevoke && (
                <button
                  type="button"
                  disabled={busyId === row.id}
                  aria-label={`Revoke the invitation for ${row.email}`}
                  onClick={() => onRevoke(row)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-surface-border bg-surface px-2.5 text-sm font-medium text-content-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark"
                >
                  <X size={14} aria-hidden="true" />
                  Revoke
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
