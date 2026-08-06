import { Eye, MoreVertical, Pencil, Pin, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnnouncementIcon } from '@/components/announcements/AnnouncementIcon';
import { AnnouncementStatusPill } from '@/components/announcements/AnnouncementStatusPill';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { AnnouncementRow } from '@/lib/announcements';

interface AnnouncementTableRowProps {
  row: AnnouncementRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onMenu: (id: string) => void;
}

const ACTION =
  'grid h-10 w-10 place-items-center rounded-lg border border-surface-border text-content-muted ' +
  'transition-colors hover:bg-surface-subtle hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark';

const PRIMARY_LINE = 'truncate text-xs font-semibold text-content dark:text-content-dark';
const SECOND_LINE =
  'mt-0.5 truncate text-xs text-content-muted dark:text-content-muted-dark';

/** One announcement in the table (design/Announcements-Dashboard.png). */
export function AnnouncementTableRow({
  row,
  selected,
  onSelect,
  onEdit,
  onMenu,
}: AnnouncementTableRowProps): JSX.Element {
  const [firstName = '', lastName = ''] = row.authorName.split(' ');

  return (
    <tr
      className={cn(
        'border-b border-divider last:border-b-0 dark:border-divider-dark',
        selected
          ? 'bg-primary/5 dark:bg-primary/10'
          : 'hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
      )}
    >
      <td className="w-12 pl-4">
        {row.pinned && (
          <Pin
            size={17}
            aria-label="Pinned"
            className="fill-content text-content dark:fill-content-dark dark:text-content-dark"
          />
        )}
      </td>

      <td className="py-4 pr-4">
        <div className="flex items-center gap-4">
          <AnnouncementIcon category={row.category} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              className={cn(
                PRIMARY_LINE,
                'block max-w-full hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              )}
            >
              {row.title}
            </button>
            <p className={cn(SECOND_LINE, 'max-w-full')}>{row.excerpt}</p>
          </div>
        </div>
      </td>

      <td className="w-44 pr-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <Users size={18} />
          </span>
          <div className="min-w-0">
            <p className={PRIMARY_LINE}>{row.audience}</p>
            <p className={SECOND_LINE}>{row.audienceScope}</p>
          </div>
        </div>
      </td>

      <td className="w-32 pr-4">
        <AnnouncementStatusPill status={row.status} />
      </td>

      <td className="w-40 pr-4">
        <p className={PRIMARY_LINE}>{row.when ?? ', '}</p>
        <p className={SECOND_LINE}>{row.whenLabel}</p>
      </td>

      <td className="w-44 pr-4">
        <div className="flex items-center gap-2.5">
          <StaffAvatar
            firstName={firstName}
            lastName={lastName}
            photoUrl={row.authorPhotoUrl}
            size="md"
            className="h-9 w-9"
          />
          <div className="min-w-0">
            <p className={PRIMARY_LINE}>{row.authorName}</p>
            <p className={SECOND_LINE}>{row.authorRole}</p>
          </div>
        </div>
      </td>

      <td className="w-36 pr-4">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            aria-label={`Preview ${row.title}`}
            className={ACTION}
          >
            <Eye size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(row.id)}
            aria-label={`Edit ${row.title}`}
            className={ACTION}
          >
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMenu(row.id)}
            aria-label={`More actions for ${row.title}`}
            className={ACTION}
          >
            <MoreVertical size={18} aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}
