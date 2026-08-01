import { BarChart3, CalendarDays, CircleCheck, MapPin, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { IconTile } from '@/components/ui/IconTile';
import type { SiteStat, SiteStatIcon } from '@/lib/locationsDirectory';

const ICONS: Record<SiteStatIcon, LucideIcon> = {
  pin: MapPin,
  check: CircleCheck,
  staff: Users,
  calendar: CalendarDays,
  coverage: BarChart3,
};

/**
 * One tile in the summary row above either table
 * (design/Locations-Management.png, design/Location-department.png).
 *
 * Unlike the staff tile the icon sits to the *right of the value*, vertically
 * centred on it, which leaves the label the card's full width — it has to hold
 * "Upcoming Shifts (7 days)" on one line.
 */
export function SiteStatCard({ stat }: { stat: SiteStat }): JSX.Element {
  return (
    <Card className="p-4">
      <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
        {stat.label}
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-3xl font-bold leading-9 text-content dark:text-content-dark">
          {stat.value}
        </p>
        <IconTile icon={ICONS[stat.icon]} tone={stat.tone} size="base" />
      </div>
      <p className="mt-2 truncate text-sm text-content-muted dark:text-content-muted-dark">
        {stat.hint}
      </p>
    </Card>
  );
}
