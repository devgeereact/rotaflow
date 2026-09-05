import { Download, FileUp, Info, Plus, SearchX, Users } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { TeamRowsTable } from '@/components/staff/TeamRowsTable';
import type { TeamRow, TeamTiles } from '@/lib/teamRows';
import type { Department, Location } from '@/types';

export interface TeamDirectoryViewProps {
  orgName: string;
  tiles: TeamTiles;
  search: string;
  onSearchChange: (value: string) => void;
  departmentId: string;
  onDepartmentChange: (value: string) => void;
  locationId: string;
  onLocationChange: (value: string) => void;
  departments: Department[];
  locations: Location[];
  rows: TeamRow[];
  totalRowCount: number;
  onOpenActions: (row: TeamRow) => void;
  onExport: () => void;
  onAddStaff?: () => void;
  /** Manager-only, like adding one person. Absent means the button is not shown. */
  onImportStaff?: () => void;
}

/**
 * `/app/team` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.team`).
 * "Invite a team member" in the reference links out to Settings → Permissions
 * — organisation administration, not day-to-day workforce management, per
 * its own callout — but "Add Staff" opens a real, faster inline form here
 * instead of sending the manager away, a strictly better real capability the
 * reference has no equivalent for.
 *
 * ## Layout order, and why the metrics shrank
 *
 * The reason anybody opens Team is the list of people. Six full-width metric
 * tiles put that list roughly 850px down a 390px screen, below a permanent
 * information card as well
 * (`docs/design-review/team-mobile.png`). The tiles are now `compact` and
 * two-up on phones, and the permanent callout became one line of help attached
 * to the actions it is about, so the search field is inside the first screen
 * and the first person is just under it.
 */
export function TeamDirectoryView({
  orgName,
  tiles,
  search,
  onSearchChange,
  departmentId,
  onDepartmentChange,
  locationId,
  onLocationChange,
  departments,
  locations,
  rows,
  totalRowCount,
  onOpenActions,
  onExport,
  onAddStaff,
  onImportStaff,
}: TeamDirectoryViewProps): JSX.Element {
  const filtered = Boolean(search || departmentId || locationId);
  const appliedCount = [search, departmentId, locationId].filter(Boolean).length;

  const clearFilters = (): void => {
    onSearchChange('');
    onDepartmentChange('');
    onLocationChange('');
  };

  return (
    <div>
      <WorkspaceHeader
        title="Team"
        subtitle={`Everyone in ${orgName}, what they are contracted for, and what they are actually rostered.`}
        primaryAction={
          onAddStaff && (
            <Button onClick={onAddStaff}>
              <Plus size={16} aria-hidden="true" className="mr-1.5" />
              Add Staff
            </Button>
          )
        }
        actions={
          <>
            <Button variant="secondary" onClick={onExport}>
              <Download size={16} aria-hidden="true" className="mr-1.5" />
              Export
            </Button>
            {onImportStaff && (
              <Button variant="secondary" onClick={onImportStaff}>
                <FileUp size={16} aria-hidden="true" className="mr-1.5" />
                Import
              </Button>
            )}
          </>
        }
      />

      {/* Two-up and compact on phones; the existing six-across from `xl`. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile compact label="Team members" value={tiles.teamMembers} />
        <StatTile compact label="On shift today" value={tiles.onShiftToday} />
        <StatTile compact label="Absent" value={tiles.absentToday} />
        <StatTile compact label="On leave today" value={tiles.onLeaveToday} />
        <StatTile
          compact
          label="Documents expiring"
          value={tiles.documentsExpiring}
          hint={
            tiles.documentsExpiring > 0 && (
              <span className="text-danger-ink dark:text-danger-ink-dark">
                within 30 days
              </span>
            )
          }
        />
        <StatTile compact label="Invites outstanding" value={tiles.invitesOutstanding} />
      </div>

      {/* One line, attached to the actions it explains, rather than the
          full-width permanent information card this was. Adding a staff record
          and inviting a person to sign in are different operations and people
          do confuse them — but that is a sentence, not a panel above the
          content. */}
      <p className="mb-4 flex items-start gap-2 text-sm text-content-muted dark:text-content-muted-dark">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          Add Staff creates a staff record. Giving someone a sign-in lives in{' '}
          <a
            href="/app/settings"
            className="font-semibold text-primary-ink underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
          >
            Settings → Permissions
          </a>
          .
        </span>
      </p>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4 dark:border-surface-border-dark">
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name, role or site…"
            aria-label="Search team"
            className="w-auto flex-1 sm:max-w-xs"
          />
          <Select
            value={departmentId}
            onChange={(e) => onDepartmentChange(e.target.value)}
            aria-label="Department"
            className="w-auto py-2"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            value={locationId}
            onChange={(e) => onLocationChange(e.target.value)}
            aria-label="Site"
            className="w-auto py-2"
          >
            <option value="">All sites</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters ({appliedCount})
            </Button>
          )}
          {/* Announced, because the count is the only feedback that a filter
              did anything when the list is longer than the viewport. */}
          <p
            aria-live="polite"
            className="ml-auto text-xs tabular-nums text-content-muted dark:text-content-muted-dark"
          >
            Showing {rows.length} of {totalRowCount}
          </p>
        </div>

        {/* Two empty states, not one sentence. "Nobody matches these
            filters" was shown to a brand-new organisation that had never
            added anybody and had no filter applied, which reads as a broken
            search rather than as the first-run state it is. */}
        <TeamRowsTable
          rows={rows}
          empty={
            totalRowCount === 0 ? (
              <EmptyState
                icon={Users}
                title="No staff yet"
                description="Add the people who work here and they will appear in this directory, ready to be rostered."
                action={
                  onAddStaff && (
                    <Button onClick={onAddStaff}>
                      <Plus size={16} aria-hidden="true" className="mr-1.5" />
                      Add Staff
                    </Button>
                  )
                }
              />
            ) : (
              <EmptyState
                icon={SearchX}
                title="No staff match these filters"
                description={`${totalRowCount} people are in this directory. Widen the search or clear the filters to see them.`}
                action={
                  filtered && (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )
                }
              />
            )
          }
          onOpenActions={onOpenActions}
        />
      </Card>
    </div>
  );
}
