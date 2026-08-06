import { cn } from '@/lib/utils';
import type { SwapTab } from '@/lib/swapRows';

/**
 * `solid` is the attention state the reference gives the pending count only,
 * a filled warning chip, so a manager sees the size of their queue without
 * opening the tab. Every other count is a soft tint.
 */
export type SwapTabEmphasis = 'solid' | 'soft';

export interface SwapTabDef {
  value: SwapTab;
  label: string;
  count: number;
  tone: 'primary' | 'warning' | 'success' | 'danger' | 'neutral';
  emphasis: SwapTabEmphasis;
}

interface SwapTabsProps {
  tabs: SwapTabDef[];
  active: SwapTab;
  onChange: (tab: SwapTab) => void;
}

const SOFT: Record<SwapTabDef['tone'], string> = {
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  neutral:
    'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

const SOLID: Record<SwapTabDef['tone'], string> = {
  primary: 'bg-primary text-primary-fg',
  warning: 'bg-warning text-primary-fg',
  success: 'bg-success text-primary-fg',
  danger: 'bg-danger text-primary-fg',
  neutral: 'bg-secondary text-primary-fg',
};

/**
 * Status tabs above the swap table (design/Swap-Request.png).
 *
 * The active underline sits clear of the rule beneath the row, in the
 * reference they are two separate lines about 9px apart, not one border the
 * active tab overlaps.
 */
export function SwapTabs({ tabs, active, onChange }: SwapTabsProps): JSX.Element {
  return (
    <div>
      <div role="tablist" aria-label="Swap status" className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const isActive = tab.value === active;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.value)}
              className={cn(
                'flex items-center gap-2 rounded-t-lg border-b-2 px-2.5 pb-3.5 pt-3 text-[0.8rem] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                isActive
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent font-semibold text-content hover:text-primary dark:text-content-dark',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full px-1.5 text-[0.66rem] font-semibold tabular-nums',
                  tab.emphasis === 'solid' ? SOLID[tab.tone] : SOFT[tab.tone],
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className="mt-2.5 h-px bg-surface-border dark:bg-surface-border-dark"
      />
    </div>
  );
}
