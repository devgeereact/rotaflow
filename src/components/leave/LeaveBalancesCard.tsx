import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { LEAVE_TYPE_BAR, LEAVE_TYPE_ICON, LEAVE_TYPE_TILE } from '@/lib/leaveStatus';
import type { LeaveBalance } from '@/lib/leaveRows';

interface LeaveBalancesCardProps {
  balances: LeaveBalance[];
  onViewAll: () => void;
}

/**
 * 0-100% in 5% steps, written out so Tailwind's content scan sees every class
 * (a templated `w-[${n}%]` is purged at build time, and an inline style is
 * forbidden by docs/RULES.md §4). 5% is finer than the 250px bar can resolve.
 */
const METER_WIDTH: Record<number, string> = {
  0: 'w-0',
  5: 'w-[5%]',
  10: 'w-[10%]',
  15: 'w-[15%]',
  20: 'w-[20%]',
  25: 'w-[25%]',
  30: 'w-[30%]',
  35: 'w-[35%]',
  40: 'w-[40%]',
  45: 'w-[45%]',
  50: 'w-[50%]',
  55: 'w-[55%]',
  60: 'w-[60%]',
  65: 'w-[65%]',
  70: 'w-[70%]',
  75: 'w-[75%]',
  80: 'w-[80%]',
  85: 'w-[85%]',
  90: 'w-[90%]',
  95: 'w-[95%]',
  100: 'w-full',
};

/**
 * Remaining days per leave type, each with a meter against its allowance
 * (design/Leave.png).
 *
 * The meter is decoration over numbers that are always spelled out, a type
 * with no allowance to measure against (statutory sick leave has no
 * entitlement pot) still reads correctly, it just has nothing to fill.
 */
export function LeaveBalancesCard({
  balances,
  onViewAll,
}: LeaveBalancesCardProps): JSX.Element {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[0.95rem] font-bold text-content dark:text-content-dark">
          Leave Balances
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded text-[0.8rem] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          View all
        </button>
      </div>

      <ul className="space-y-1.5">
        {balances.map((balance) => {
          const Icon = LEAVE_TYPE_ICON[balance.type];
          const percent = Math.round(Math.min(1, Math.max(0, balance.fraction)) * 100);
          return (
            <li key={balance.type} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
                  LEAVE_TYPE_TILE[balance.type],
                )}
              >
                <Icon size={18} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[0.82rem] font-semibold leading-5 text-content dark:text-content-dark">
                    {balance.label}
                  </p>
                  <p className="shrink-0 text-[0.72rem] leading-4 text-content-muted dark:text-content-muted-dark">
                    Allowance{' '}
                    <span className="font-semibold text-content dark:text-content-dark">
                      {balance.allowanceDays} days
                    </span>
                  </p>
                </div>

                <p className="text-[0.78rem] leading-4 text-content-muted dark:text-content-muted-dark">
                  Balance{' '}
                  <span className="font-semibold text-content dark:text-content-dark">
                    {balance.balanceDays} days
                  </span>
                </p>

                <div
                  role="img"
                  aria-label={`${balance.balanceDays} of ${balance.allowanceDays} days remaining`}
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-divider dark:bg-surface-subtle-dark"
                >
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-300',
                      LEAVE_TYPE_BAR[balance.type],
                      METER_WIDTH[Math.round(percent / 5) * 5],
                    )}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
