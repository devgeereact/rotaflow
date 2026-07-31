import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { STAFF_STATUS_LABELS, type StaffStatus } from '@/lib/staffDirectory';

const TONES: Record<StaffStatus, BadgeTone> = {
  active: 'success',
  on_leave: 'warning',
  unavailable: 'danger',
  inactive: 'neutral',
};

/** Status pill in the directory's Status column and details panel. */
export function StaffStatusBadge({
  status,
  className,
}: {
  status: StaffStatus;
  className?: string;
}): JSX.Element {
  return (
    <Badge tone={TONES[status]} className={className}>
      {STAFF_STATUS_LABELS[status]}
    </Badge>
  );
}
