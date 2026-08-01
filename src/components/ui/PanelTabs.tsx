import { cn } from '@/lib/utils';

export interface PanelTabItem<T extends string> {
  value: T;
  label: string;
}

interface PanelTabsProps<T extends string> {
  items: PanelTabItem<T>[];
  active: T;
  onChange: (value: T) => void;
  /** Names the tablist for assistive tech — always pass something specific. */
  label: string;
  /** Space between tabs. The staff profile runs wide; detail panels run tight. */
  gapClass?: string;
  className?: string;
}

/**
 * In-page section switcher — the real ARIA tabs pattern, for panels that swap
 * **inside one screen** and have no URL of their own.
 *
 * ## PanelTabs or Tabs?
 *
 * `ui/Tabs` is this component's sibling and they are not interchangeable:
 *
 * - **`Tabs`** is a `<nav>` of `NavLink`s, one URL per tab. Use it whenever a
 *   tab is somewhere a person could sensibly link to or refresh into — the
 *   Settings and My Profile areas, and the Locations / Departments workspace.
 * - **`PanelTabs`** (this) is `role="tablist"`, driven by component state. Use
 *   it when the tabs genuinely swap content in place and minting a route for
 *   each would be noise — the sections of the staff profile, and the
 *   Overview / Staff / Shifts / Settings / History strip inside the location
 *   detail panel, which belongs to whichever site happens to be selected.
 *
 * Announcing `role="tab"` on something that navigates misleads screen-reader
 * users; using a link where nothing navigates gives up the browser's free
 * keyboard handling. Pick by behaviour, not by looks — both draw the same
 * underline.
 */
export function PanelTabs<T extends string>({
  items,
  active,
  onChange,
  label,
  gapClass = 'gap-10',
  className,
}: PanelTabsProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center border-b border-surface-border dark:border-surface-border-dark',
        gapClass,
        className,
      )}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === active}
          onClick={() => onChange(item.value)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            item.value === active
              ? 'border-primary text-primary'
              : 'border-transparent text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
