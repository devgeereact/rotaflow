import { Card } from '@/components/ui/Card';

const REASONS: { term: string; description: string }[] = [
  {
    term: 'Rest rule',
    description: 'Under 11 hours between the end of one shift and the start of the next',
  },
  {
    term: 'Weekly limit',
    description: 'Taking the shift would push the taker past 48 hours',
  },
  {
    term: 'Minimum cover',
    description: "The giver's site drops below its staffing minimum",
  },
  {
    term: 'Qualification',
    description: 'The shift needs a senior carer and the taker is not one',
  },
  { term: 'Availability', description: 'The taker is marked unavailable on that day' },
];

/**
 * `SCREENS.swaps`'s "Why a swap gets refused" card. The reference frames
 * these as automatically checked at offer time; the real system does not
 * enforce any of them yet (no policy store exists — see the "How shift
 * swaps work" copy this reuses), so this reads as guidance for a reviewer
 * rather than a guarantee.
 */
export function SwapRefusalReasonsCard(): JSX.Element {
  return (
    <Card className="p-0">
      <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
        <h2 className="font-semibold text-content dark:text-content-dark">
          What a reviewer should check
        </h2>
      </div>
      <dl className="divide-y divide-surface-border p-4 dark:divide-surface-border-dark">
        {REASONS.map((reason) => (
          <div key={reason.term} className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0">
            <dt className="text-sm font-semibold text-content dark:text-content-dark">
              {reason.term}
            </dt>
            <dd className="text-sm text-content-muted dark:text-content-muted-dark">
              {reason.description}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-surface-border p-4 text-xs text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
        These are not automated yet, so approval is a human judgement. Read the shift
        details before approving.
      </p>
    </Card>
  );
}
