import { cn } from '@/lib/utils';
import { AnnouncementTableRow } from '@/components/announcements/AnnouncementTableRow';
import type { AnnouncementRow } from '@/lib/announcements';

interface AnnouncementTableProps {
  rows: AnnouncementRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onMenu: (id: string) => void;
  emptyMessage: string;
}

const HEAD =
  'py-3 pr-4 text-left text-xs font-semibold text-content dark:text-content-dark';

/**
 * The announcements roster (design/Announcements-Dashboard.png). Column widths
 * are fixed so the Announcement column absorbs the remainder. The reference's
 * proportions hold at every viewport the table is scrolled into.
 */
export function AnnouncementTable({
  rows,
  selectedId,
  onSelect,
  onEdit,
  onMenu,
  emptyMessage,
}: AnnouncementTableProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse">
      <thead>
        <tr className="border-b border-divider dark:border-divider-dark">
          <th scope="col" className="w-12">
            <span className="sr-only">Pinned</span>
          </th>
          <th scope="col" className={HEAD}>
            Announcement
          </th>
          <th scope="col" className={cn(HEAD, 'w-44')}>
            Audience
          </th>
          <th scope="col" className={cn(HEAD, 'w-32')}>
            Status
          </th>
          <th scope="col" className={cn(HEAD, 'w-40')}>
            Scheduled / Sent
          </th>
          <th scope="col" className={cn(HEAD, 'w-44')}>
            Created By
          </th>
          <th scope="col" className={cn(HEAD, 'w-36 pr-4 text-center')}>
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <AnnouncementTableRow
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            onSelect={onSelect}
            onEdit={onEdit}
            onMenu={onMenu}
          />
        ))}
      </tbody>
    </table>
  );
}
