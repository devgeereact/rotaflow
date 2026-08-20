import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ReportChipProps {
  /** A tint class pair from `@/lib/reportRows` (fill + ink, both themes). */
  tone: string;
  children: ReactNode;
  className?: string;
}

/**
 * The tinted rectangle used for Category, Frequency and Format in the reports
 * table (docs/design/Reports-Dashboard.png). Rectangular rather than a `rounded-full`
 * Badge because the reference draws these as tags, not status pills.
 */
export function ReportChip({ tone, children, className }: ReportChipProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 text-[0.72rem] font-semibold',
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}
