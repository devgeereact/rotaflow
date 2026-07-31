import type { LucideIcon } from 'lucide-react';
import { ChevronRight, CircleHelp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';

export interface HelpLink {
  id: string;
  icon: LucideIcon;
  label: string;
  onSelect?: () => void;
}

interface NeedHelpCardProps {
  links: HelpLink[];
}

/** "Need Help?" rail card — support entry points, one row per topic. */
export function NeedHelpCard({ links }: NeedHelpCardProps): JSX.Element {
  return (
    <Card className="h-full rounded-xl p-5">
      <ClockCardHeading icon={CircleHelp} title="Need Help?" />

      <ul className="mt-4">
        {links.map((link) => (
          <li key={link.id}>
            <button
              type="button"
              onClick={link.onSelect}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark"
            >
              <link.icon size={18} aria-hidden="true" className="shrink-0 text-primary" />
              <span className="flex-1 text-sm text-content dark:text-content-dark">
                {link.label}
              </span>
              <ChevronRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-content-muted dark:text-content-muted-dark"
              />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
