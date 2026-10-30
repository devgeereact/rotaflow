import type { JSX } from 'react';
import { Badge } from '@/components/ui/Badge';

interface EligibilityChipProps {
  /** Names of the required documents that are missing, not yet approved, or out of date. */
  missing: string[];
  /** Approved but expiring within 30 days. */
  expiringSoon?: number;
  className?: string;
}

/**
 * Whether a person is cleared to work, by their documents (compliance, slice S10). It informs, it
 * does not block: rostering someone who is not cleared stays the manager's decision. The reason is
 * in the title and the screen-reader text, not only in the colour.
 */
export function EligibilityChip({
  missing,
  expiringSoon = 0,
  className,
}: EligibilityChipProps): JSX.Element | null {
  if (missing.length > 0) {
    const why = `Not cleared: ${missing.join(', ')}`;
    return (
      <span title={why} className={className}>
        <Badge tone="danger">
          Not cleared<span className="sr-only">. {why}</span>
        </Badge>
      </span>
    );
  }
  if (expiringSoon > 0) {
    const why = `${expiringSoon} required document${expiringSoon === 1 ? '' : 's'} expiring within 30 days`;
    return (
      <span title={why} className={className}>
        <Badge tone="warning">
          Expiring<span className="sr-only">. {why}</span>
        </Badge>
      </span>
    );
  }
  return null;
}
