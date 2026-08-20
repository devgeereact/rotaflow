import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface SwapRule {
  id: string;
  icon: LucideIcon;
  label: string;
  /** Pre-formatted, e.g. "24 hours" or "Yes". */
  value: string;
}

interface SwapRulesCardProps {
  rules: SwapRule[];
  onEdit?: () => void;
}

/**
 * The policy a swap request is checked against (docs/design/Swap-Request.png).
 *
 * Every row is passed in. This card never assumes a default threshold,
 * because a wrong one tells staff a swap is allowed when it is not.
 */
export function SwapRulesCard({ rules, onEdit }: SwapRulesCardProps): JSX.Element {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[0.9rem] font-semibold text-content dark:text-content-dark">
          Swap Rules
        </h2>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded text-[0.78rem] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Edit
          </button>
        )}
      </div>

      <ul className="space-y-2.5">
        {rules.map(({ id, icon: Icon, label, value }) => (
          <li key={id} className="flex items-center gap-3">
            <Icon
              size={16}
              aria-hidden="true"
              className="shrink-0 text-content-muted dark:text-content-muted-dark"
            />
            <span className="min-w-0 flex-1 truncate text-[0.73rem] text-content dark:text-content-dark">
              {label}
            </span>
            <span className="shrink-0 text-[0.73rem] font-semibold text-content dark:text-content-dark">
              {value}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
