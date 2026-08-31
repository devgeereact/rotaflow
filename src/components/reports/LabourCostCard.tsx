import { useEffect, useState } from 'react';
import { Banknote, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { getLabourCost, type LabourCostRow } from '@/services/payRateService';
import { reportError } from '@/lib/sentry';

interface LabourCostCardProps {
  orgId: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  rangeLabel: string;
  /** From Settings → Policies. A paid break is paid time. */
  paidBreaks: boolean;
}

/** `123456` → `£1,234.56`. */
function money(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100);
}

/**
 * What the rostered period costs (CAP-086).
 *
 * Every number this product reported about a rota was a number of hours.
 * Hours are what a manager schedules; money is what they are held to.
 *
 * ## The unpriced people are named, loudly
 *
 * Somebody rostered with no rate on file contributes nothing to the total,
 * which makes the total wrong in the direction that looks fine. So the card
 * says how many, and the figure is labelled as covering only the priced
 * staff. A number that looks like an answer and is not is worse than no
 * number at all — that principle is why several rows of this product's
 * register exist.
 *
 * ## Rostered, not worked
 *
 * The cost comes from the roster. A manager approving next week has no clock
 * events to work from, and the question they are asking is what they are
 * about to commit to.
 */
export function LabourCostCard({
  orgId,
  from,
  to,
  rangeLabel,
  paidBreaks,
}: LabourCostCardProps): JSX.Element | null {
  const [rows, setRows] = useState<LabourCostRow[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    void (async () => {
      try {
        const found = await getLabourCost(orgId, from, to, paidBreaks);
        if (active) {
          setRows(found);
          setDenied(false);
        }
      } catch (err) {
        // 42501 is the database refusing a non-manager, which is correct
        // rather than broken: the card simply does not render for them.
        const code =
          err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
        if (code === '42501') {
          if (active) setDenied(true);
          return;
        }
        reportError(err, { area: 'reports:labour-cost' });
        if (active) setRows([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, from, to, paidBreaks]);

  if (denied || rows === null) return null;

  const total = rows.reduce((sum, row) => sum + row.costPence, 0);
  const minutes = rows.reduce((sum, row) => sum + row.scheduledMinutes, 0);
  const unrated = rows.reduce((most, row) => Math.max(most, row.unratedStaff), 0);

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Banknote
          size={18}
          className="text-primary-ink dark:text-primary-ink-dark"
          aria-hidden="true"
        />
        <h2 className="text-sm font-semibold text-content dark:text-content-dark">
          Rostered cost · {rangeLabel}
        </h2>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Nothing published in this period.
        </p>
      ) : (
        <>
          <p className="text-2xl font-semibold text-content dark:text-content-dark">
            {money(total)}
          </p>
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            {Math.round(minutes / 60)} rostered hours
            {paidBreaks ? ', breaks paid' : ', breaks unpaid'}
          </p>

          <ul className="mt-4 space-y-2">
            {rows.map((row) => (
              <li
                key={row.locationId ?? 'unassigned'}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="truncate text-content-muted dark:text-content-muted-dark">
                  {row.locationName ?? 'No site'}
                </span>
                <span className="font-medium text-content dark:text-content-dark">
                  {money(row.costPence)}
                </span>
              </li>
            ))}
          </ul>

          {unrated > 0 && (
            <p className="mt-4 flex items-start gap-2 text-sm text-warning-ink dark:text-warning-ink-dark">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              {unrated === 1
                ? 'One rostered person has no pay rate on file, so they are not in this figure.'
                : `${unrated} rostered people have no pay rate on file, so they are not in this figure.`}{' '}
              Set rates from the Team screen.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
