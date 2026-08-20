import type { TabItem } from '@/components/ui/Tabs';
import type { MembershipRole } from '@/types';

/**
 * Section tabs for the merged workspace below.
 *
 * Kept beside `settingsTabs.ts` and out of the components for the same reason:
 * `navigationTargets.test.ts` parses these against App.tsx's real route table,
 * so a tab pointing at a route that does not exist is a test failure rather
 * than a 404 a user finds.
 *
 * Rota Builder and Schedule used to be the other merged workspace here. The
 * organisation workspace reference (`docs/ORGANISATION_WORKSPACE.html`) treats
 * them as two separate journeys with their own sidebar rows and no shared tab
 * bar, so the cross-link was removed along with `RotaBuilderPage`'s use of it,
 * rather than left exported with nothing rendering it. `sidebarNav.ts` §"Order
 * and labels" has the fuller reasoning.
 */

function isManager(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'manager';
}

/**
 * **Team**. The directory and the availability matrix answer "who works here"
 * and "when can they work", which is one question asked twice.
 *
 * Staff again get a single tab: `/app/team` is managerial, but availability is
 * a person's own submission, so they keep the availability half on its own.
 */
export function teamWorkspaceTabs(role: MembershipRole | null): TabItem[] {
  const availability: TabItem = { to: '/app/availability', label: 'Availability' };
  if (!isManager(role)) return [availability];
  return [{ to: '/app/team', label: 'Directory' }, availability];
}
