import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IconTileTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'violet'
  | 'info'
  | 'rose'
  | 'teal'
  | 'danger'
  | 'indigo';

interface IconTileProps {
  icon: LucideIcon;
  tone?: IconTileTone;
  size?: 'sm' | 'base' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * A rounded, tinted square holding one outline icon. The summary-tile and
 * activity-row motif in docs/design/staff.png and docs/design/Staff-Profile.png.
 * Purely decorative: the label beside it carries the meaning.
 */
const TONES: Record<IconTileTone, string> = {
  primary: 'bg-primary/10 text-primary-ink dark:text-primary-ink-dark',
  success: 'bg-success/10 text-success-ink dark:text-success-ink-dark',
  warning: 'bg-warning/15 text-warning-ink dark:text-warning-ink-dark',
  violet: 'bg-shift-violet/15 text-shift-violet',
  info: 'bg-info/10 text-info',
  // Department-type tints on docs/design/Location-department.png. Same `bg-X/15
  // text-X` idiom as `violet`, over the shift palette's rose and teal.
  rose: 'bg-shift-rose/15 text-shift-rose',
  teal: 'bg-shift-teal/15 text-shift-teal',
  danger: 'bg-danger/10 text-danger',
  // Blue-violet, not the pink `shift-violet`. The announcement megaphone and
  // rota tiles in docs/design/Announcements-Dashboard.png sit in the indigo family.
  indigo:
    'bg-shift-tint-violet text-shift-tint-violet-fg dark:bg-shift-deep-violet dark:text-shift-violet',
};

const SIZES: Record<NonNullable<IconTileProps['size']>, { box: string; icon: number }> = {
  sm: { box: 'h-8 w-8 rounded-lg', icon: 16 },
  // 40px. The summary-tile and department-row square on both locations
  // references, a step down from the 44px staff tile.
  base: { box: 'h-10 w-10 rounded-lg', icon: 20 },
  md: { box: 'h-11 w-11 rounded-xl', icon: 20 },
  lg: { box: 'h-12 w-12 rounded-xl', icon: 24 },
  // 56px. The announcement preview rail's tile, the largest on any screen.
  xl: { box: 'h-14 w-14 rounded-xl', icon: 26 },
};

export function IconTile({
  icon: Icon,
  tone = 'primary',
  size = 'md',
  className,
}: IconTileProps): JSX.Element {
  const spec = SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center', spec.box, TONES[tone], className)}
    >
      <Icon size={spec.icon} strokeWidth={2} />
    </span>
  );
}
