import { useState } from 'react';
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView';
import type { AnnouncementCard, ReachRow } from '@/lib/announcementsMapping';
import { PreviewCanvas } from '@/components/ui/PreviewCanvas';

const CARDS: AnnouncementCard[] = [
  {
    id: 'a1',
    title: 'Bank holiday rota is up',
    body: 'The rota for the August bank holiday weekend is published. Check your shifts and raise a swap early if you need one — the board fills up fast this time of year.',
    pinned: true,
    audienceLabel: 'All sites',
    authorName: 'Marcus Bell',
    when: '2 Aug 2026, 09:00',
    readCount: 41,
    audienceSize: 52,
    isReadByViewer: false,
  },
  {
    id: 'a2',
    title: 'Moving and handling refresher, Thursday',
    body: 'Mandatory refresher for anyone whose certificate expires this quarter. 10:00 in the training room at Sunnyvale House.',
    pinned: false,
    audienceLabel: 'Nursing',
    authorName: 'Amara Osei',
    when: '30 Jul 2026, 14:20',
    readCount: 12,
    audienceSize: 24,
    isReadByViewer: true,
  },
];

const REACH: ReachRow[] = [
  { id: 'all', label: 'All sites', count: 52 },
  { id: 'sunnyvale', label: 'Sunnyvale House', count: 24 },
  { id: 'riverside', label: 'Riverside House', count: 20 },
  { id: 'oakview', label: 'Oakview Care Home', count: 8 },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/announcements` needs a
 * live Supabase session and a seeded organisation. Renders the real
 * `AnnouncementsView` against fixed mock data shaped to match
 * `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.announcements`. `?role=staff`
 * switches branch.
 */
export function AnnouncementsPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const canManage = role !== 'staff';
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <PreviewCanvas standaloneClassName="min-h-screen bg-background px-7 py-7 dark:bg-background-dark">
      <AnnouncementsView
        cards={CARDS}
        reach={REACH}
        loading={false}
        canManage={canManage}
        canPost={canManage}
        busyId={busyId}
        onNewAnnouncement={() => {}}
        onRemindUnread={() => {}}
        onTakeDown={() => {}}
        onMarkRead={(card) => setBusyId(card.id)}
      />
    </PreviewCanvas>
  );
}
