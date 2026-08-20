import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { SITE_STATUS_LABELS, type SiteStatus } from '@/lib/locationsDirectory';
import { cn } from '@/lib/utils';

const TONES: Record<SiteStatus, BadgeTone> = {
  setup: 'neutral',
  active: 'success',
  maintenance: 'warning',
  inactive: 'neutral',
};

/** Operating-state pill on a location card. */
export function SiteStatusBadge({
  status,
  className,
}: {
  status: SiteStatus;
  className?: string;
}): JSX.Element {
  return (
    <Badge
      tone={TONES[status]}
      className={cn('rounded-md px-2.5 py-1 font-semibold', className)}
    >
      {SITE_STATUS_LABELS[status]}
    </Badge>
  );
}
