import { Archive, CheckCircle2, CircleDot, Clock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnnouncementStatus } from '@/lib/announcements';

interface AnnouncementStatusPillProps {
  status: AnnouncementStatus;
  className?: string;
}

/**
 * Status chip in the table's Status column and at the head of the preview
 * panel (design/Announcements-Dashboard.png). Icon + label, never colour alone
 * (docs/DESIGN.md §5).
 */
const STATUSES: Record<
  AnnouncementStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  sent: {
    label: 'Sent',
    icon: CheckCircle2,
    className: 'bg-success/10 text-success',
  },
  scheduled: {
    label: 'Scheduled',
    icon: Clock,
    className: 'bg-primary/10 text-primary',
  },
  draft: {
    label: 'Draft',
    icon: CircleDot,
    className:
      'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
  },
  archived: {
    label: 'Archived',
    icon: Archive,
    className:
      'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
  },
};

export function AnnouncementStatusPill({
  status,
  className,
}: AnnouncementStatusPillProps): JSX.Element {
  const { label, icon: Icon, className: tone } = STATUSES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold',
        tone,
        className,
      )}
    >
      <Icon size={16} aria-hidden="true" strokeWidth={2.25} />
      {label}
    </span>
  );
}
