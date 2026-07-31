import { MoreVertical } from 'lucide-react';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { AvailabilityMeter } from '@/components/staff/AvailabilityMeter';
import { SkillChipList } from '@/components/staff/SkillChipList';
import { StaffStatusBadge } from '@/components/staff/StaffStatusBadge';
import { cn } from '@/lib/utils';
import type { RoleCodeTone, StaffDirectoryRow } from '@/lib/staffDirectory';

interface StaffTableRowProps {
  row: StaffDirectoryRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpenActions: (id: string) => void;
}

const ROLE_CODE_TONES: Record<RoleCodeTone, string> = {
  violet: 'bg-shift-violet/15 text-shift-violet',
  neutral:
    'border border-surface-border bg-surface text-content-muted dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark',
};

const CELL = 'px-3 py-3.5 align-middle';

/** One person in the staff directory table (design/staff.png). */
export function StaffTableRow({
  row,
  selected,
  onSelect,
  onOpenActions,
}: StaffTableRowProps): JSX.Element {
  const fullName = `${row.firstName} ${row.lastName}`;

  return (
    <tr
      onClick={() => onSelect(row.id)}
      className={cn(
        'cursor-pointer border-b border-divider transition-colors last:border-0 dark:border-divider-dark',
        selected
          ? 'bg-primary/[0.04] dark:bg-primary/10'
          : 'hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
      )}
    >
      <td className={cn(CELL, 'pl-2.5')}>
        <div className="flex items-center gap-3">
          <StaffAvatar
            firstName={row.firstName}
            lastName={row.lastName}
            photoUrl={row.photoUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
              {fullName}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {row.payrollId}
            </p>
          </div>
        </div>
      </td>

      <td className={CELL}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-sm font-medium text-content dark:text-content-dark">
            {row.role}
          </span>
          {row.roleCode && (
            <span
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold',
                ROLE_CODE_TONES[row.roleCodeTone],
              )}
            >
              {row.roleCode}
            </span>
          )}
        </div>
      </td>

      <td
        className={cn(
          CELL,
          'whitespace-nowrap text-sm text-content dark:text-content-dark',
        )}
      >
        {row.department}
      </td>

      <td
        className={cn(
          CELL,
          'whitespace-nowrap text-sm text-content dark:text-content-dark',
        )}
      >
        {row.location}
      </td>

      <td className={cn(CELL, 'overflow-hidden')}>
        <SkillChipList skills={row.skills} maxChars={30} className="flex-nowrap" />
      </td>

      <td className={CELL}>
        <AvailabilityMeter days={row.availability} percent={row.availabilityPercent} />
      </td>

      <td className={CELL}>
        <StaffStatusBadge status={row.status} className="px-2.5 py-1" />
      </td>

      <td className={CELL}>
        <button
          type="button"
          aria-label={`Actions for ${fullName}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenActions(row.id);
          }}
          className="grid h-8 w-8 place-items-center rounded-lg border border-surface-border bg-surface text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
        >
          <MoreVertical size={16} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}
