import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ScrollRegion } from '@/components/ui/ScrollRegion';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { cn } from '@/lib/utils';
import type { TeamRow, TeamTodayStatus } from '@/lib/teamRows';

const PROFILE_LINK_CLASS = cn(
  'inline-flex h-9 items-center justify-center rounded-xl px-3 text-sm font-semibold',
  'border border-surface-border bg-surface text-content hover:bg-surface-subtle',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
  /**
   * What to show when there are no rows. An `EmptyState`, built by the caller,
   * because "no staff have been added yet" and "no staff match these filters"
   * are different situations with different next actions and this component
   * cannot tell them apart.
   */
  empty: ReactNode;
  onOpenActions: (row: TeamRow) => void;
}

/**
 * The Team directory (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.team`
 * `table()` call): Person/Department/Site/Contract/Rostered/Today/Actions.
 * "Profile" is a real navigation; the reference's "Message" button has no real
 * capability behind it — RotaFlow has no direct-messaging feature — so it is
 * replaced with the real per-person management actions (edit, emergency
 * contacts, documents, deactivate, GDPR) that the directory already supported
 * before this rebuild.
 *
 * ## Two representations, one dataset
 *
 * Seven columns do not fit a 390px screen, and the honest options are to hide
 * columns behind a sideways scroll or to stop drawing a table. On a phone this
 * draws person rows instead: name and role, then site, contract and today's
 * status as labelled facts, then the two actions. Nothing is hidden and there
 * is nothing to discover by dragging.
 *
 * From `md` up it is the full table, inside a labelled `ScrollRegion` so the
 * remaining overflow (a long site name, 200% zoom) is reachable by keyboard
 * and visible as an edge fade rather than silently clipped.
 */
export function TeamRowsTable({
  rows,
  empty,
  onOpenActions,
}: TeamRowsTableProps): JSX.Element {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      {/* Phones: labelled person rows. */}
      <ul className="divide-y divide-surface-border md:hidden dark:divide-surface-border-dark">
        {rows.map((row) => (
          <li key={row.id} className="p-4">
            <div className="flex items-start gap-3">
              <StaffAvatar
                firstName={row.firstName}
                lastName={row.lastName}
                photoUrl={row.photoUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/app/team/${row.id}`}
                  className="block font-semibold text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-dark"
                >
                  {row.firstName} {row.lastName}
                </Link>
                {row.jobTitle && (
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {row.jobTitle}
                  </p>
                )}
              </div>
              <Badge tone={TODAY_TONE[row.todayStatus]} dot>
                {TODAY_LABEL[row.todayStatus]}
              </Badge>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div className="col-span-2 flex gap-2">
                <dt className="text-content-muted dark:text-content-muted-dark">Site</dt>
                <dd className="min-w-0 flex-1 text-content dark:text-content-dark">
                  {row.location}
                  {row.department ? ` · ${row.department}` : ''}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Contract
                </dt>
                <dd className="tabular-nums text-content dark:text-content-dark">
                  {row.contractHoursLabel}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Rostered
                </dt>
                <dd className="tabular-nums text-content dark:text-content-dark">
                  {row.rosteredHoursLabel}
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex items-center gap-2">
              <Link
                to={`/app/team/${row.id}`}
                className={cn(PROFILE_LINK_CLASS, 'h-11 flex-1')}
              >
                View
              </Link>
              <IconButton
                icon={MoreHorizontal}
                label={`More actions for ${row.firstName} ${row.lastName}`}
                onClick={() => onOpenActions(row)}
                className="border border-surface-border dark:border-surface-border-dark"
              />
            </div>
          </li>
        ))}
      </ul>

      {/* `md` and up: the full table. */}
      <ScrollRegion label="Team directory" className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Team directory: person, department, site, contract hours, rostered hours and
            today&apos;s status.
          </caption>
          <thead>
            <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
              <th scope="col" className="px-4 py-3">
                Person
              </th>
              <th scope="col" className="px-4 py-3">
                Department
              </th>
              <th scope="col" className="px-4 py-3">
                Site
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Contract
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Rostered
              </th>
              <th scope="col" className="px-4 py-3">
                Today
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {rows.map((row) => (
              <tr
                key={row.id}
                className="transition-colors duration-control hover:bg-surface-subtle motion-reduce:transition-none dark:hover:bg-surface-subtle-dark"
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
                        className="truncate font-medium text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-dark"
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpenActions(row)}
                      aria-label={`More actions for ${row.firstName} ${row.lastName}`}
                    >
                      More
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
