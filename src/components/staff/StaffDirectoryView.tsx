import { CalendarX2, CircleCheck, Clock, Star, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffDetailsPanel } from '@/components/staff/StaffDetailsPanel';
import {
  StaffFilterBar,
  type StaffFilterSelect,
} from '@/components/staff/StaffFilterBar';
import { StaffStatCard } from '@/components/staff/StaffStatCard';
import { TablePagination } from '@/components/ui/TablePagination';
import { StaffTable, type StaffSort } from '@/components/staff/StaffTable';
import type {
  StaffDetails,
  StaffDirectoryRow,
  StaffDirectoryStats,
} from '@/lib/staffDirectory';

interface StaffDirectoryViewProps {
  stats: StaffDirectoryStats;
  rows: StaffDirectoryRow[];
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  selects: StaffFilterSelect[];
  sort: StaffSort | null;
  onSortChange: (sort: StaffSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenActions: (id: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  details: StaffDetails | null;
  onMoreFilters: () => void;
  onAddStaff?: () => void;
  onEditDetails: () => void;
  onViewSkills: () => void;
  onViewCalendar: () => void;
  onViewDocuments: () => void;
}

/**
 * The Staff Directory screen (design/staff.png): summary tiles, filters, the
 * roster table and the selected person's summary panel. Presentational. The
 * caller owns filtering, sorting and paging so this renders identically from
 * Supabase data and from the design-loop fixtures.
 */
export function StaffDirectoryView({
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
  onOpenActions,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  details,
  onMoreFilters,
  onAddStaff,
  onEditDetails,
  onViewSkills,
  onViewCalendar,
  onViewDocuments,
}: StaffDirectoryViewProps): JSX.Element {
  const percent = (value: number): string =>
    stats.totalStaff === 0
      ? '0% of team'
      : `${Math.floor((value / stats.totalStaff) * 100)}% of team`;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
      <div className="min-w-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StaffStatCard
            icon={Users}
            tone="primary"
            label="Total Staff"
            value={String(stats.totalStaff)}
            hint="Active staff"
          />
          <StaffStatCard
            icon={CircleCheck}
            tone="success"
            label="On Shift Today"
            value={String(stats.onShiftToday)}
            hint={percent(stats.onShiftToday)}
          />
          <StaffStatCard
            icon={CalendarX2}
            tone="violet"
            label="On Leave Today"
            value={String(stats.onLeaveToday)}
            hint={percent(stats.onLeaveToday)}
          />
          <StaffStatCard
            icon={Clock}
            tone="warning"
            label="Unavailable Today"
            value={String(stats.unavailableToday)}
            hint={percent(stats.unavailableToday)}
          />
          <StaffStatCard
            icon={Star}
            tone="info"
            label="Vacancies"
            value={String(stats.vacancies)}
            hint="Open shifts"
          />
        </div>

        <div className="mt-8">
          <StaffFilterBar
            search={search}
            onSearchChange={onSearchChange}
            selects={selects}
            onMoreFilters={onMoreFilters}
            onAddStaff={onAddStaff}
          />
        </div>

        <Card className="mt-7 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <StaffTable
              rows={rows}
              sort={sort}
              onSortChange={onSortChange}
              selectedId={selectedId}
              onSelect={onSelect}
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
              noun="staff"
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        </Card>
      </div>

      {details && (
        <aside>
          <StaffDetailsPanel
            staff={details}
            onEdit={onEditDetails}
            onViewSkills={onViewSkills}
            onViewCalendar={onViewCalendar}
            onViewDocuments={onViewDocuments}
          />
        </aside>
      )}
    </div>
  );
}
