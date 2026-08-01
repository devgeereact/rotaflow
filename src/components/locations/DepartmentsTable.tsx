import { CoverageMeter } from '@/components/locations/CoverageMeter';
import { DEPARTMENT_ICONS } from '@/components/locations/departmentIcons';
import { SiteRowActions } from '@/components/locations/SiteRowActions';
import { SiteStatusBadge } from '@/components/locations/SiteStatusBadge';
import {
  SiteTableHeader,
  type SiteColumn,
  type SiteSort,
} from '@/components/locations/SiteTableHeader';
import { SiteTypePill } from '@/components/locations/SiteTypePill';
import { IconTile } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';
import type { DepartmentRow } from '@/lib/locationsDirectory';

interface DepartmentsTableProps {
  rows: DepartmentRow[];
  sort: SiteSort | null;
  onSortChange: (sort: SiteSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onOpenActions: (id: string) => void;
}

/** Column widths as a share of the table, measured off design/Location-department.png. */
const COLUMNS: SiteColumn[] = [
  { key: 'department', label: 'Department', width: 'w-[24%]', sortable: true },
  { key: 'location', label: 'Location', width: 'w-[16%]' },
  { key: 'type', label: 'Type', width: 'w-[9%]' },
  { key: 'staff', label: 'Staff', width: 'w-[8%]', align: 'center' },
  { key: 'shifts', label: 'Upcoming Shifts', width: 'w-[11%]', align: 'center' },
  { key: 'coverage', label: 'Avg. Coverage', width: 'w-[11%]' },
  { key: 'status', label: 'Status', width: 'w-[9%]' },
  { key: 'actions', label: 'Actions', width: 'w-[12%]', align: 'center' },
];

const CELL = 'px-3 py-3 align-middle';
const NUMBER = 'text-center text-sm font-semibold text-content dark:text-content-dark';

/** The departments table on design/Location-department.png. */
export function DepartmentsTable({
  rows,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  onEdit,
  onOpenActions,
}: DepartmentsTableProps): JSX.Element {
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <SiteTableHeader columns={COLUMNS} sort={sort} onSortChange={onSortChange} />
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            onClick={() => onSelect(row.id)}
            className={cn(
              'cursor-pointer border-b border-divider transition-colors last:border-0 dark:border-divider-dark',
              row.id === selectedId
                ? 'bg-primary/[0.04] dark:bg-primary/10'
                : 'hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
            )}
          >
            <td className={cn(CELL, 'pl-4')}>
              <div className="flex items-center gap-3">
                <IconTile
                  icon={DEPARTMENT_ICONS[row.icon]}
                  tone={row.iconTone}
                  size="base"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
                    {row.name}
                  </p>
                  {row.description && (
                    <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                      {row.description}
                    </p>
                  )}
                </div>
              </div>
            </td>

            <td
              className={cn(CELL, 'truncate text-sm text-content dark:text-content-dark')}
            >
              {row.location}
            </td>

            <td className={CELL}>
              {row.type ? (
                <SiteTypePill label={row.type} tone={row.typeTone} />
              ) : (
                <span className="text-sm text-content-muted dark:text-content-muted-dark">
                  —
                </span>
              )}
            </td>

            <td className={cn(CELL, NUMBER)}>{row.staff}</td>
            <td className={cn(CELL, NUMBER)}>{row.upcomingShifts}</td>

            <td className={CELL}>
              <CoverageMeter percent={row.coveragePercent} />
            </td>

            <td className={CELL}>
              <SiteStatusBadge status={row.status} />
            </td>

            <td className={CELL}>
              <SiteRowActions
                name={row.name}
                onView={() => onSelect(row.id)}
                onEdit={() => onEdit(row.id)}
                onOpenActions={() => onOpenActions(row.id)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
