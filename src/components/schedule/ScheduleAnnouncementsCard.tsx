import { Link } from 'react-router-dom';
import { GraduationCap, Megaphone } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface ScheduleAnnouncement {
  id: string;
  title: string;
  body: string;
  /** Pre-formatted, e.g. "2 hours ago". */
  timeLabel: string;
  /** Drives the icon tile. Announcements have no type column, so the caller decides. */
  tone: 'general' | 'training';
}

interface ScheduleAnnouncementsCardProps {
  announcements: ScheduleAnnouncement[];
  viewAllTo: string;
}

const TONES = {
  general: { icon: Megaphone, tile: 'bg-primary/10 text-primary' },
  training: { icon: GraduationCap, tile: 'bg-success/10 text-success' },
} as const;

/** Latest announcements alongside the rota (design/live-schedule.png). */
export function ScheduleAnnouncementsCard({
  announcements,
  viewAllTo,
}: ScheduleAnnouncementsCardProps): JSX.Element {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          Announcements
        </h2>
        <Link to={viewAllTo} className="text-xs font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {announcements.length === 0 ? (
        <p className="border-t border-divider px-4 py-4 text-sm text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
          No announcements yet.
        </p>
      ) : (
        <ul className="border-t border-divider dark:border-divider-dark">
          {announcements.map((item) => {
            const { icon: Icon, tile } = TONES[item.tone];
            return (
              <li key={item.id} className="flex items-start gap-2.5 px-4 py-3">
                <span
                  aria-hidden="true"
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tile}`}
                >
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-[0.8rem] font-semibold text-content dark:text-content-dark">
                    {item.title}
                  </p>
                  <p className="text-xs leading-5 text-content-muted dark:text-content-muted-dark">
                    {item.body}
                  </p>
                  <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
                    {item.timeLabel}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
