import type { ReactNode } from 'react';
import { Tabs, type TabItem } from '@/components/ui/Tabs';

interface WorkspaceHeaderProps {
  title: string;
  subtitle: string;
  /**
   * The sections of this workspace. Fewer than two renders no tab bar at all —
   * a single-tab switcher is a control that cannot do anything, and staff see
   * exactly that on workspaces where the other half is managerial.
   */
  tabs: TabItem[];
  /** Page-level actions, right-aligned against the title. */
  actions?: ReactNode;
}

/**
 * Title, subtitle and section switch for a screen built from two or more
 * related views that share a URL space.
 *
 * ## Why workspaces exist here
 *
 * Several pairs in this product are one job split across two sidebar entries:
 * you build a rota and then look at the published one; you open the team
 * directory and then check who is available. Keeping them as unrelated
 * top-level destinations means navigating out to the sidebar and back for what
 * is really a tab switch, and it makes the sidebar longer than it needs to be.
 *
 * ## Why routes rather than in-page state
 *
 * These are `ui/Tabs` (links), not `ui/PanelTabs` (buttons), because each half
 * has to survive a refresh and be linkable — a manager sending a colleague to
 * the published schedule cannot send them to "the other tab of the rota page".
 *
 * ## Why the halves stay separate components
 *
 * The obvious reading of "merge these screens" is one component rendering both.
 * That would produce a 2,500-line file out of the rota builder and the
 * schedule, against §31's "do not build large monolithic components" — and the
 * two genuinely do different work (one writes drafts, one reads published
 * rows). They are merged as a *workspace*: one header, one URL space, one
 * sidebar entry, two focused components underneath.
 */
export function WorkspaceHeader({
  title,
  subtitle,
  tabs,
  actions,
}: WorkspaceHeaderProps): JSX.Element {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            {title}
          </h1>
          <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
            {subtitle}
          </p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs.length > 1 && (
        <Tabs items={tabs} label={`${title} sections`} className="mt-4" />
      )}
    </div>
  );
}
