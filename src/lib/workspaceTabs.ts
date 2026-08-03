import type { TabItem } from '@/components/ui/Tabs';
import type { MembershipRole } from '@/types';

/**
 * Section tabs for the two merged workspaces.
 *
 * Kept beside `settingsTabs.ts` and out of the components for the same reason:
 * `navigationTargets.test.ts` parses these against App.tsx's real route table,
 * so a tab pointing at a route that does not exist is a test failure rather
 * than a 404 a user finds.
 */

function isManager(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'manager';
}

/**
 * **Rota** — building a week and reading the published result are two halves of
 * one job, and they were two sidebar entries with no way across.
 *
 * Staff get a single tab. They cannot open the builder (`RequireRole` refuses
 * `/app/rota`), so showing them a switch whose other side 403s would be a
 * control that only ever produces a permission screen. `WorkspaceHeader`
 * renders no tab bar at all for one item.
 */
export function rotaWorkspaceTabs(role: MembershipRole | null): TabItem[] {
  const published: TabItem = { to: '/app/schedule', label: 'Published schedule' };
  if (!isManager(role)) return [published];
  return [{ to: '/app/rota', label: 'Build rota' }, published];
}

/**
 * **Team** — the directory and the availability matrix answer "who works here"
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
