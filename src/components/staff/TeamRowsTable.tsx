import { Link } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { cn } from '@/lib/utils';
import type { TeamRow, TeamTodayStatus } from '@/lib/teamRows';

const PROFILE_LINK_CLASS = cn(
  'inline-flex h-9 items-center justify-center rounded-xl px-3 text-sm font-semibold',
  'border border-surface-border bg-surface text-content hover:bg-surface-subtle',
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark',
);

const TODAY_LABEL: Record<TeamTodayStatus, string> = {
  on_shift: 'On shift',
  absent: 'Absent',
  off: 'Off',
};

const TODAY_TONE: Record<TeamTodayStatus, BadgeTone> = {
  on_shift: 'success',
  absent: 'danger',
  off: 'neutral',
};

interface TeamRowsTableProps {
  rows: TeamRow[];
  emptyMessage: string;
  onOpenActions: (row: TeamRow) => void;
}

/**
 * The Team directory table (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.team` `table()` call): Person/Department/Site/Contract/
 * Rostered/Today/Actions. "Profile" is a real navigation; the reference's
 * "Message" button has no real capability behind it — RotaFlow has no
 * direct-messaging feature — so it is replaced with the real per-person
 * management actions (edit, emergency contacts, documents, deactivate,
 * GDPR) that the directory already supported before this rebuild.
 */
export function TeamRowsTable({
  rows,
  emptyMessage,
  onOpenActions,
}: TeamRowsTableProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
            <th className="px-4 py-3">Person</th>
            <th className="px-4 py-3">Department</th>
            <th className="px-4 py-3">Site</th>
            <th className="px-4 py-3 text-right">Contract</th>
            <th className="px-4 py-3 text-right">Rostered</th>
            <th className="px-4 py-3">Today</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
          {rows.map((row) => (
            <tr
              key={row.id}
              className="hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <StaffAvatar
                    firstName={row.firstName}
                    lastName={row.lastName}
                    photoUrl={row.photoUrl}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <Link
                      to={`/app/team/${row.id}`}
                      className="truncate font-medium text-content hover:underline dark:text-content-dark"
                    >
                      {row.firstName} {row.lastName}
                    </Link>
                    {row.jobTitle && (
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {row.jobTitle}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-content dark:text-content-dark">
                {row.department}
              </td>
              <td className="px-4 py-3 text-content dark:text-content-dark">
                {row.location}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-content dark:text-content-dark">
                {row.contractHoursLabel}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-content dark:text-content-dark">
                {row.rosteredHoursLabel}
              </td>
              <td className="px-4 py-3">
                <Badge tone={TODAY_TONE[row.todayStatus]} dot>
                  {TODAY_LABEL[row.todayStatus]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Link to={`/app/team/${row.id}`} className={PROFILE_LINK_CLASS}>
                    Profile
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => onOpenActions(row)}>
                    More
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
