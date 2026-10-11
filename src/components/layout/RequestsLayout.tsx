import { Outlet } from 'react-router-dom';
import { Tabs } from '@/components/ui/Tabs';
import { REQUEST_SECTIONS } from '@/lib/requestSections';

/**
 * Leave, Swaps and Overtime: the three screens behind the phone's "Requests"
 * tab.
 *
 * The tab bar has room for one destination, so it lands on Leave. Without
 * this switch, swaps and overtime were reachable on a phone only through the
 * drawer, behind `More`. A pathless layout route rather than a hub page: each
 * screen keeps its own URL, and the switch is drawn above whichever one is
 * open, in its loading and error states as well as its loaded one.
 *
 * Phones only. From `md` up the sidebar lists all three as separate rows, so a
 * second switch above the page would repeat the navigation beside it.
 */
export function RequestsLayout(): JSX.Element {
  return (
    <>
      <Tabs
        items={REQUEST_SECTIONS.map((section) => ({ ...section }))}
        label="Request types"
        className="mb-6 md:hidden"
      />
      <Outlet />
    </>
  );
}
