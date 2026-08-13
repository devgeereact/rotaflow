import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

interface StepCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Action row, rendered below a divider. */
  footer: ReactNode;
}

/** The right-hand form card shared by every onboarding step. */
export function StepCard({
  icon: Icon,
  title,
  subtitle,
  children,
  footer,
}: StepCardProps): JSX.Element {
  return (
    <Card className="animate-fade-up motion-reduce:animate-none p-6 shadow md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand-wash text-brand dark:bg-brand-deep/20 dark:text-brand-light">
          <Icon size={26} aria-hidden="true" />
        </span>
        <div className="min-w-0 pt-1">
          <h2 className="font-display text-2xl font-bold text-ink dark:text-content-dark">
            {title}
          </h2>
          <p className="text-content-muted dark:text-content-muted-dark">{subtitle}</p>
        </div>
      </div>

      <div className="border-t border-surface-border pt-6 dark:border-surface-border-dark">
        {children}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-6 dark:border-surface-border-dark">
        {footer}
      </div>
    </Card>
  );
}
