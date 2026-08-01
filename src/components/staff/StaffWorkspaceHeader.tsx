import { Tabs, type TabItem } from '@/components/ui/Tabs';

/** Which half of the merged Staff workspace is on screen. */
export type StaffWorkspaceTab = 'directory' | 'invitations';

const COPY: Record<StaffWorkspaceTab, { title: string; subtitle: string }> = {
  // Verbatim from design/staff.png — this tab is a matched screen.
  directory: {
    title: 'Staff',
    subtitle: 'Manage your team, roles, departments and availability.',
  },
  invitations: {
    title: 'Invitations',
    subtitle: 'Invite people to your organisation and manage pending invitations.',
  },
};

interface StaffWorkspaceHeaderProps {
  tab: StaffWorkspaceTab;
  /** `/app/staff` in the product, `/staff-preview` in the design loop. */
  basePath: string;
  /** Hides the Invitations tab from roles that cannot mint one. */
  canInvite?: boolean;
}

/**
 * Title, subtitle and the Directory / Invitations switch.
 *
 * Staff and Team were two sidebar entries answering the same question — who
 * works here — so they merge into one workspace, the way Locations and
 * Departments already do. This strip is the seam and appears in
 * design/staff.png no more than the locations one appears in its references;
 * see design/.loop/staff-invitations-log.md.
 *
 * These are **routes**, not in-page panels, so it uses `ui/Tabs` rather than
 * `ui/PanelTabs`: an owner linking a colleague straight to the invitations
 * list, or refreshing on it, has to land back on it.
 */
export function StaffWorkspaceHeader({
  tab,
  basePath,
  canInvite = true,
}: StaffWorkspaceHeaderProps): JSX.Element {
  const items: TabItem[] = [
    { to: basePath, label: 'Directory' },
    { to: `${basePath}/invitations`, label: 'Invitations', hidden: !canInvite },
  ];

  return (
    <div className="mb-6">
      <h1 className="font-display text-3xl font-bold text-content dark:text-content-dark">
        {COPY[tab].title}
      </h1>
      <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
        {COPY[tab].subtitle}
      </p>
      <Tabs items={items} label="Staff workspace sections" className="mt-4" />
    </div>
  );
}
