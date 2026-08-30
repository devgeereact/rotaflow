import { Download, Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
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
  emptyMessage: string;
  onOpenActions: (row: TeamRow) => void;
  onExport: () => void;
  onAddStaff?: () => void;
}

/**
 * `/app/team` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.team`).
 * "Invite a team member" in the reference links out to Settings → Permissions
 * — organisation administration, not day-to-day workforce management, per
 * its own callout — but "Add Staff" opens a real, faster inline form here
 * instead of sending the manager away, a strictly better real capability the
 * reference has no equivalent for.
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
  emptyMessage,
  onOpenActions,
  onExport,
  onAddStaff,
}: TeamDirectoryViewProps): JSX.Element {
  return (
    <div>
      <WorkspaceHeader
        title="Team"
        subtitle={`Everyone in ${orgName}, what they are contracted for, and what they are actually rostered.`}
        actions={
          <>
            <Button variant="secondary" onClick={onExport}>
              <Download size={14} aria-hidden="true" className="mr-1.5" />
              Export
            </Button>
            {onAddStaff && (
              <Button onClick={onAddStaff}>
                <Plus size={16} aria-hidden="true" className="mr-1.5" />
                Add Staff
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Team members" value={tiles.teamMembers} />
        <StatTile label="On shift today" value={tiles.onShiftToday} />
        <StatTile label="Absent" value={tiles.absentToday} />
        <StatTile label="On leave today" value={tiles.onLeaveToday} />
        <StatTile
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
        <StatTile label="Invites outstanding" value={tiles.invitesOutstanding} />
      </div>

      <Callout className="mb-4">
        Inviting and removing people lives in{' '}
        <a href="/app/settings" className="font-semibold underline">
          Settings → Permissions
        </a>
        . It is organisation administration, not day-to-day workforce management.
      </Callout>

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
          <span className="ml-auto font-mono text-xs text-content-muted dark:text-content-muted-dark">
            {rows.length} of {totalRowCount}
          </span>
        </div>

        <TeamRowsTable
          rows={rows}
          emptyMessage={emptyMessage}
          onOpenActions={onOpenActions}
        />
      </Card>
    </div>
  );
}
