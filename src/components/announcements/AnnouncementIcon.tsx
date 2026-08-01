import {
  AlertTriangle,
  BadgePoundSterling,
  Bell,
  CalendarDays,
  Gift,
  Info,
  Megaphone,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';
import type { AnnouncementCategory } from '@/lib/announcements';

interface AnnouncementIconProps {
  category: AnnouncementCategory;
  /** `base` is the 40px table tile, `xl` the 56px preview-panel tile. */
  size?: 'base' | 'xl';
  className?: string;
}

/**
 * The tinted glyph beside every announcement title
 * (design/Announcements-Dashboard.png). Decorative — the title next to it
 * carries the meaning, so no label is announced.
 */
const CATEGORIES: Record<AnnouncementCategory, { icon: LucideIcon; tone: IconTileTone }> =
  {
    general: { icon: Megaphone, tone: 'indigo' },
    training: { icon: Bell, tone: 'warning' },
    event: { icon: Gift, tone: 'danger' },
    policy: { icon: ShieldCheck, tone: 'primary' },
    system: { icon: AlertTriangle, tone: 'warning' },
    rota: { icon: CalendarDays, tone: 'indigo' },
    health: { icon: Info, tone: 'primary' },
    pay: { icon: BadgePoundSterling, tone: 'success' },
  };

export function AnnouncementIcon({
  category,
  size = 'base',
  className,
}: AnnouncementIconProps): JSX.Element {
  const { icon, tone } = CATEGORIES[category];
  return <IconTile icon={icon} tone={tone} size={size} className={className} />;
}
