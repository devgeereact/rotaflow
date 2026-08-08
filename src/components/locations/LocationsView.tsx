import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { TablePagination } from '@/components/ui/TablePagination';
import { LocationDetailsPanel } from '@/components/locations/LocationDetailsPanel';
import { LocationsTable } from '@/components/locations/LocationsTable';
import { LocationsTipBanner } from '@/components/locations/LocationsTipBanner';
import {
  SiteFilterBar,
  type SiteFilterSelect,
} from '@/components/locations/SiteFilterBar';
import { SiteStatCard } from '@/components/locations/SiteStatCard';
import type { SiteSort } from '@/components/locations/SiteTableHeader';
import type { LocationDetails, LocationRow, SiteStat } from '@/lib/locationsDirectory';

interface LocationsViewProps {
  stats: SiteStat[];
  rows: LocationRow[];
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  selects: SiteFilterSelect[];
  sort: SiteSort | null;
  onSortChange: (sort: SiteSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCloseDetails: () => void;
  onEdit: (id: string) => void;
  onOpenActions: (id: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  details: LocationDetails | null;
  onMoreFilters: () => void;
  onAddLocation?: () => void;
  onEditInfo: () => void;
  onFollowMetric: (id: string) => void;
  onViewActivity: () => void;
  onOpenGuide: () => void;
  /** Settings tab content for the selected site. Omitted in design previews, which have no live org to save against. */
  renderSettings?: (location: LocationDetails) => ReactNode;
}

/**
 * The Locations tab of the workspace (design/Locations-Management.png):
 * summary tiles, filters, the sites table, the selected site's panel and the
 * advisory strip. Presentational. The caller owns filtering, sorting and
 * paging so this renders identically from Supabase data and from the
 * design-loop fixtures.
 */
export function LocationsView({
  stats,
  rows,
  total,
  search,
  onSearchChange,
  selects,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  onCloseDetails,
  onEdit,
  onOpenActions,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  details,
  onMoreFilters,
  onAddLocation,
  onEditInfo,
  onFollowMetric,
  onViewActivity,
  onOpenGuide,
  renderSettings,
}: LocationsViewProps): JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {stats.map((stat) => (
            <SiteStatCard key={stat.id} stat={stat} />
          ))}
        </div>

        <div className="mt-6">
          <SiteFilterBar
            search={search}
            searchPlaceholder="Search locations..."
            onSearchChange={onSearchChange}
            selects={selects}
            onMoreFilters={onMoreFilters}
          />
        </div>

        <Card className="mt-5 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <LocationsTable
              rows={rows}
              sort={sort}
              onSortChange={onSortChange}
              selectedId={selectedId}
              onSelect={onSelect}
              onEdit={onEdit}
              onOpenActions={onOpenActions}
            />
          </div>
          <div className="border-t border-surface-border dark:border-surface-border-dark">
            <TablePagination
              page={page}
              pageCount={Math.max(1, Math.ceil(total / pageSize))}
              pageSize={pageSize}
              total={total}
              shown={rows.length}
              noun="locations"
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        </Card>

        <div className="mt-4">
          <LocationsTipBanner onOpenGuide={onOpenGuide} />
        </div>
      </div>

      <aside className="space-y-4">
        {onAddLocation && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onAddLocation}
              className="flex h-9 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus size={16} aria-hidden="true" />
              Add Location
            </button>
          </div>
        )}
        {details && (
          <LocationDetailsPanel
            location={details}
            onClose={onCloseDetails}
            onEditInfo={onEditInfo}
            onFollowMetric={onFollowMetric}
            onViewActivity={onViewActivity}
            renderSettings={renderSettings}
          />
        )}
      </aside>
    </div>
  );
}
