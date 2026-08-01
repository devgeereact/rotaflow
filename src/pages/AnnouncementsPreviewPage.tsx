import { useState } from 'react';
import { Archive, Copy, Send } from 'lucide-react';
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView';
import type { AnnouncementFilterSelect } from '@/components/announcements/AnnouncementFilterBar';
import type { AnnouncementTab } from '@/lib/announcements';
import {
  DEMO_ANNOUNCEMENTS,
  DEMO_ANNOUNCEMENT_PREVIEW,
  DEMO_ANNOUNCEMENT_TOTAL,
} from '@/lib/announcementsDemo';

/**
 * Design-loop preview only — `/app/announcements` needs a real Supabase session
 * and a seeded organisation. This renders the same components against the
 * fixtures in `src/lib/announcementsDemo.ts`, reproducing
 * design/Announcements-Dashboard.png. Not wired to any service call; see
 * design/.loop/announcements-log.md.
 */
export function AnnouncementsPreviewPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<AnnouncementTab>('all');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [audience, setAudience] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>('bank-holiday');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const selects: AnnouncementFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: location,
      onChange: setLocation,
      options: [
        { value: 'sunnyvale', label: 'Sunnyvale Care Home' },
        { value: 'riverside', label: 'Riverside House' },
      ],
    },
    {
      id: 'departments',
      allLabel: 'All Departments',
      value: department,
      onChange: setDepartment,
      widthClass: 'w-44',
      options: [
        { value: 'care', label: 'Care' },
        { value: 'nursing', label: 'Nursing' },
      ],
    },
    {
      id: 'audiences',
      allLabel: 'All Audiences',
      value: audience,
      onChange: setAudience,
      options: [
        { value: 'all-staff', label: 'All Staff' },
        { value: 'care-staff', label: 'Care Staff' },
      ],
    },
    {
      id: 'statuses',
      allLabel: 'All Statuses',
      value: status,
      onChange: setStatus,
      options: [
        { value: 'sent', label: 'Sent' },
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'draft', label: 'Draft' },
      ],
    },
  ];

  const noop = (): void => {};

  return (
    <div className="min-h-screen bg-background px-7 py-7 dark:bg-background-dark">
      <AnnouncementsView
        tabs={[
          { value: 'all', label: 'All Announcements' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'drafts', label: 'Drafts' },
          { value: 'sent', label: 'Sent' },
          { value: 'archived', label: 'Archived' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewAnnouncement={noop}
        search={search}
        onSearchChange={setSearch}
        selects={selects}
        onFilters={noop}
        rows={DEMO_ANNOUNCEMENTS}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onEdit={noop}
        onMenu={noop}
        emptyMessage="No announcements match these filters."
        page={page}
        pageCount={6}
        rangeFrom={1}
        rangeTo={DEMO_ANNOUNCEMENTS.length}
        total={DEMO_ANNOUNCEMENT_TOTAL}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        preview={DEMO_ANNOUNCEMENT_PREVIEW}
        quickActions={[
          { id: 'resend', icon: Send, label: 'Resend Announcement', onSelect: noop },
          {
            id: 'duplicate',
            icon: Copy,
            label: 'Duplicate Announcement',
            onSelect: noop,
          },
          { id: 'archive', icon: Archive, label: 'Archive Announcement', onSelect: noop },
        ]}
        onDownload={noop}
        onViewGuide={noop}
      />
    </div>
  );
}
