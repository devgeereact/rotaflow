import { Card } from '@/components/ui/Card';

export interface AvailabilityRule {
  id: string;
  label: string;
  value: string;
}

interface AvailabilityRulesCardProps {
  rules: AvailabilityRule[];
  onEdit: () => void;
}

/** The scheduling constraints availability is validated against. */
export function AvailabilityRulesCard({
  rules,
  onEdit,
}: AvailabilityRulesCardProps): JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          Rules &amp; Constraints
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Edit
        </button>
      </div>

      <dl className="mt-3 space-y-2.5">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center justify-between gap-3">
            <dt className="min-w-0 text-sm text-content dark:text-content-dark">
              {rule.label}
            </dt>
            <dd className="shrink-0 text-sm text-content-muted dark:text-content-muted-dark">
              {rule.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
