import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: ReactNode;
  hint: ReactNode;
}

/** One of the five top-row stat cards on the manager dashboard (design/Workforce-Dashboard.png). */
export function StatCard({
  icon: Icon,
  tint,
  label,
  value,
  hint,
}: StatCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tint)}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
          {label}
        </p>
      </div>
      <p className="mb-1 text-2xl font-bold text-content dark:text-content-dark">
        {value}
      </p>
      <div className="text-xs text-content-muted dark:text-content-muted-dark">
        {hint}
      </div>
    </Card>
  );
}
