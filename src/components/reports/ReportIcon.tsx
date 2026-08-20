import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReportIconProps {
  icon: LucideIcon;
  /** A tint class pair from `@/lib/reportRows` (fill + ink, both themes). */
  tone: string;
  className?: string;
}

/**
 * The small tinted square holding a report's icon, in the table's first column
 * and in the Recent Reports rail (docs/design/Reports-Dashboard.png). Decorative,
 * the report name beside it carries the meaning.
 */
export function ReportIcon({
  icon: Icon,
  tone,
  className,
}: ReportIconProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
        tone,
        className,
      )}
    >
      <Icon size={16} strokeWidth={2} />
    </span>
  );
}
