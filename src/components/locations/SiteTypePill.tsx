import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { SiteTone } from '@/lib/locationsDirectory';

const TONES: Record<SiteTone, BadgeTone> = {
  primary: 'primary',
  violet: 'violet',
  info: 'info',
  success: 'success',
  rose: 'rose',
  warning: 'warning',
  teal: 'teal',
};

/**
 * Location- or department-type chip ("Care Home", "Clinical", "Support") —
 * a squarer pill than the rounded-full status badges on the same row.
 */
export function SiteTypePill({
  label,
  tone,
  className,
}: {
  label: string;
  tone: SiteTone;
  className?: string;
}): JSX.Element {
  return (
    <Badge
      tone={TONES[tone]}
      className={cn('rounded-md px-2.5 py-1 font-semibold', className)}
    >
      {label}
    </Badge>
  );
}
