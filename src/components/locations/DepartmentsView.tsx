import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { TablePagination } from '@/components/ui/TablePagination';
import { DepartmentOverviewPanel } from '@/components/locations/DepartmentOverviewPanel';
import {
  DepartmentQuickActions,
  type DepartmentAction,
} from '@/components/locations/DepartmentQuickActions';
import { DepartmentsTable } from '@/components/locations/DepartmentsTable';
import {
  SiteFilterBar,
  type SiteFilterSelect,
} from '@/components/locations/SiteFilterBar';
import { SiteStatCard } from '@/components/locations/SiteStatCard';
import type { SiteSort } from '@/components/locations/SiteTableHeader';
import type {
  DepartmentDetails,
  DepartmentRow,
  SiteStat,
} from '@/lib/locationsDirectory';

interface DepartmentsViewProps {
  stats: SiteStat[];
  rows: DepartmentRow[];
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  selects: SiteFilterSelect[];
  sort: SiteSort | null;
  onSortChange: (sort: SiteSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onOpenActions: (id: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  details: DepartmentDetails | null;
  onMoreFilters: () => void;
  onAddDepartment?: () => void;
  onFollowMetric: (id: string) => void;
  onViewActivity: () => void;
  onQuickAction: (action: DepartmentAction) => void;
}

/**
 * The Departments tab of the workspace (design/Location-department.png):
 * summary tiles, filters, the departments table, the selected department's
 * overview panel and the six shortcut cards.
 */
export function DepartmentsView({
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
  onEdit,
  onOpenActions,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  details,
  onMoreFilters,
  onAddDepartment,
  onFollowMetric,
  onViewActivity,
  onQuickAction,
}: DepartmentsViewProps): JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <SiteStatCard key={stat.id} stat={stat} />
          ))}
        </div>

        <div className="mt-6">
          <SiteFilterBar
            search={search}
            searchPlaceholder="Search departments..."
            onSearchChange={onSearchChange}
            selects={selects}
            onMoreFilters={onMoreFilters}
          />
        </div>

        <Card className="mt-5 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <DepartmentsTable
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
              noun="departments"
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        </Card>
      </div>

      <aside className="space-y-4">
        {onAddDepartment && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onAddDepartment}
              className="flex h-9 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus size={16} aria-hidden="true" />
              Add Department
            </button>
          </div>
        )}
        {details && (
          <DepartmentOverviewPanel
            department={details}
            onFollowMetric={onFollowMetric}
            onViewActivity={onViewActivity}
          />
        )}
      </aside>

      {/* Spans both columns. The reference runs the shortcuts full width. */}
      <div className="xl:col-span-2">
        <DepartmentQuickActions onSelect={onQuickAction} />
      </div>
    </div>
  );
}
