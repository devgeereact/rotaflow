import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface TabItem {
  /** Route this tab navigates to, e.g. `/app/settings/billing`. */
  to: string;
  label: string;
  /** Hidden from the bar entirely. Use for tabs a role cannot reach. */
  hidden?: boolean;
}

interface TabsProps {
  items: TabItem[];
  /** Accessible name for the tab bar, e.g. "Settings sections". */
  label: string;
  className?: string;
}

/**
 * The horizontal section switcher used by the Settings and My Profile areas
 * (docs/design/SettingsOrganisation.png, docs/design/ProfileSettings.png).
 *
 * ## Why this is a `<nav>` of links and NOT `role="tablist"`
 *
 * It looks like a tab bar, and the designs call these tabs, but every one of
 * them is a distinct URL, `/app/settings/organisation`, `/app/settings/billing`
 * and so on. That has to stay true: a manager needs to send a colleague a link
 * to the Billing screen, and a page this deep must survive a refresh.
 *
 * The ARIA tabs pattern is for switching panels **within one page**. Announcing
 * `role="tab"` on something that performs a navigation tells a screen-reader
 * user that content will swap in place, then the whole page changes under them
 *, and it costs the affordances links actually have (open in a new tab, copy
 * link address, back button). W3C's own guidance is to use links when the tabs
 * are navigation. So: a labelled `<nav>`, real `<a>`s, `aria-current="page"` on
 * the active one. Browsers give keyboard support for free, which is also why
 * there is no roving-tabindex logic here to get wrong.
 *
 * ## Overflow
 *
 * Settings has eight tabs and My Profile six. They do not fit on a phone, so
 * the strip scrolls horizontally rather than wrapping to a second row, a
 * wrapped tab bar reflows the page content under it every time the active item
 * changes line.
 */
export function Tabs({ items, label, className }: TabsProps): JSX.Element {
  const visible = items.filter((item) => !item.hidden);

  return (
    <nav
      aria-label={label}
      className={cn(
        'border-b border-surface-border dark:border-surface-border-dark',
        className,
      )}
    >
      <ul className="-mb-px flex items-center gap-8 overflow-x-auto">
        {visible.map((item) => (
          <li key={item.to} className="shrink-0">
            <NavLink
              to={item.to}
              // `end` so a parent route does not stay highlighted while a child
              // is active, /app/settings must not look selected on
              // /app/settings/billing.
              end
              className={({ isActive }) =>
                cn(
                  'inline-block border-b-2 px-1 pb-3 pt-1 text-sm transition-colors',
                  // Focus ring on the link itself, not the underline, so it is
                  // visible against both the active and inactive states.
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  isActive
                    ? 'border-primary font-semibold text-primary dark:text-primary-ink-dark'
                    : 'border-transparent font-medium text-content-muted hover:border-surface-border hover:text-content dark:text-content-muted-dark dark:hover:border-surface-border-dark dark:hover:text-content-dark',
                )
              }
              // NavLink sets aria-current="page" on the active link itself.
              // Do not pass aria-current here. Supplying it explicitly
              // overrides that and silently removes the only programmatic
              // signal of which section is open.
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
