import { cn } from '@/lib/utils';
import { LEAVE_TYPE_CHIP, LEAVE_TYPE_ICON, LEAVE_TYPE_LABEL } from '@/lib/leaveStatus';
import type { LeaveTypeKey } from '@/lib/leaveRows';

interface LeaveTypeChipProps {
  type: LeaveTypeKey;
  className?: string;
}

/**
 * Leave type as a tinted chip with its glyph (docs/design/Leave.png). Always
 * spelled out beside the icon. Type is never carried by colour alone
 * (docs/DESIGN.md §5).
 */
export function LeaveTypeChip({ type, className }: LeaveTypeChipProps): JSX.Element {
  const Icon = LEAVE_TYPE_ICON[type];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[0.8rem] font-semibold',
        LEAVE_TYPE_CHIP[type],
        className,
      )}
    >
      <Icon size={15} aria-hidden="true" />
      {LEAVE_TYPE_LABEL[type]}
    </span>
  );
}
