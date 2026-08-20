import { Building2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { SiteStatusBadge } from '@/components/locations/SiteStatusBadge';
import { buildLocationTiles } from '@/lib/locationsDirectoryMapping';
import type { LocationRow } from '@/lib/locationsDirectory';

export interface LocationsViewProps {
  rows: LocationRow[];
  loading: boolean;
  canManage: boolean;
  onAddLocation: () => void;
  onEditLocation: (id: string) => void;
  onOpenDepartments: (id: string) => void;
  onOpenMinimumCover: (id: string) => void;
}

/**
 * `/app/locations` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.locations`):
 * a pagehead, four count tiles, and a card grid — one card per site. No
 * table, no filter bar, no side detail panel; the reference's own
 * "Departments" and "Minimum cover" buttons are placeholders (`toast(...)`),
 * this app has real screens behind both, opened as dialogs from the card.
 */
export function LocationsView({
  rows,
  loading,
  canManage,
  onAddLocation,
  onEditLocation,
  onOpenDepartments,
  onOpenMinimumCover,
}: LocationsViewProps): JSX.Element {
  const navigate = useNavigate();
  const tiles = buildLocationTiles(rows);

  return (
    <div>
      <WorkspaceHeader
        title="Locations"
        subtitle="Sites and the departments inside them. A department is what the rota groups by and what a staffing minimum is set against."
        actions={
          canManage && (
            <Button onClick={onAddLocation}>
              <Plus size={16} aria-hidden="true" className="mr-1.5" />
              Add location
            </Button>
          )
        }
      />

      <TileGrid className="mb-5">
        <StatTile label="Locations" value={tiles.locations} />
        <StatTile label="Departments" value={tiles.departments} />
        <StatTile label="Staff assigned" value={tiles.staffAssigned} />
        <StatTile
          label="In setup"
          value={tiles.inSetup}
          hint={tiles.inSetup > 0 ? 'Not yet rosterable' : undefined}
        />
      </TileGrid>

      {loading ? (
        <Card>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            No locations yet.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-content dark:text-content-dark">
                    {row.name}
                  </h3>
                  <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                    {[row.type, row.address].filter(Boolean).join(' · ') ||
                      'No details set'}
                  </p>
                </div>
                <SiteStatusBadge status={row.status} className="shrink-0" />
              </div>

              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Staff
                  </dt>
                  <dd className="text-content dark:text-content-dark">{row.staff}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Departments
                  </dt>
                  <dd className="flex flex-wrap justify-end gap-1">
                    {row.departmentNames.length === 0 ? (
                      <span className="text-content dark:text-content-dark">None</span>
                    ) : (
                      row.departmentNames.map((name) => (
                        <Badge key={name} tone="neutral">
                          {name}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Minimum cover
                  </dt>
                  <dd className="text-content dark:text-content-dark">
                    {row.minimumCoverSummary ?? 'Not set'}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenDepartments(row.id)}
                >
                  Departments
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenMinimumCover(row.id)}
                >
                  Minimum cover
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void navigate('/app/rota')}
                >
                  Rota
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onEditLocation(row.id)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
