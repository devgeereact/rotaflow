import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';

interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Right-aligned control in the card header, usually Edit or Save. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A titled card. Every Settings and Profile section is one of these
 * (design/SettingsOrganisation.png shows six on the Organisation tab alone),
 * so the heading size, spacing and header row live here rather than being
 * retyped fourteen times with slightly different values.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: SettingsSectionProps): JSX.Element {
  return (
    <Card className={className}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

/**
 * Label/value row for read-only detail lists. The "Organisation Name /
 * Sunnyvale Care Group" pairs on the Organisation tab.
 */
export function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-content dark:text-content-dark">
        {value || <span className="text-content-muted">-</span>}
      </dd>
    </div>
  );
}
