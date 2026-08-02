import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Send, Trash2 } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from '@/services/announcementService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listOrgMemberRoles, listOrgMemberUserIds } from '@/services/orgService';
import { listStaff } from '@/services/staffService';
import { reportError } from '@/lib/sentry';
import {
  authorIndex,
  matchesSearch,
  toAnnouncementPreview,
  toAnnouncementRow,
  type AnnouncementAuthor,
} from '@/lib/announcementsMapping';
import { tabAccepts, type AnnouncementTab } from '@/lib/announcements';
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView';
import { AnnouncementComposerModal } from '@/components/announcements/AnnouncementComposerModal';
import type { AnnouncementFilterSelect } from '@/components/announcements/AnnouncementFilterBar';
import type { AnnouncementQuickAction } from '@/components/announcements/AnnouncementPreviewPanel';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Announcement, Department, Location } from '@/types';

const TABS = [
  { value: 'all', label: 'All Announcements' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'archived', label: 'Archived' },
] as const;

/**
 * `/app/announcements` — the communications workspace in
 * design/Announcements-Dashboard.png.
 *
 * The schema is narrower than the screen (see `src/lib/announcementsMapping.ts`):
 * status is derived from `published_at`, and there is no archive, attachment or
 * read-receipt store. The Archived tab is therefore always empty and the preview
 * panel omits its Delivery and Attachments blocks — the design is honoured
 * without inventing data the database cannot back.
 */
export function AnnouncementsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();
  const { user } = useSupabaseAuth();
  const { send } = useInngestDispatch();
  const { showError, showSuccess } = useToast();

  const [rows, setRows] = useState<Announcement[]>([]);
  const [authors, setAuthors] = useState<Map<string, AnnouncementAuthor>>(new Map());
  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [activeTab, setActiveTab] = useState<AnnouncementTab>('all');
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [audience, setAudience] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<Announcement | null>(null);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['announcements'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [announcements, staff, roles, locs, deps] = await Promise.all([
          listAnnouncements(orgId),
          listStaff(orgId, { includeInactive: true }),
          listOrgMemberRoles(orgId),
          listLocations(orgId),
          listDepartments(orgId),
        ]);
        if (!active) return;
        setRows(announcements);
        setAuthors(authorIndex(staff, roles));
        setLocations(locs);
        setDepartments(deps);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'announcements:load' });
        setLoadFailed(true);
        showError('Could not load announcements.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey, showError]);

  // One `now` per mapping pass, so every status in a list is decided against
  // the same instant rather than drifting row by row.
  const mapped = useMemo(() => {
    const now = new Date();
    return rows.map((row) =>
      toAnnouncementRow(row, authors, locations, departments, now),
    );
  }, [rows, authors, locations, departments]);

  const filtered = useMemo(
    () =>
      mapped.filter((row) => {
        if (!tabAccepts(activeTab, row.status)) return false;
        if (status && row.status !== status) return false;
        if (!matchesSearch(row, search)) return false;
        if (locationId) {
          const name = locations.find((l) => l.id === locationId)?.name;
          if (name && row.audienceScope !== name) return false;
        }
        if (departmentId) {
          const name = departments.find((d) => d.id === departmentId)?.name;
          if (name && !row.audience.startsWith(name)) return false;
        }
        if (audience && row.audience !== audience) return false;
        return true;
      }),
    [
      mapped,
      activeTab,
      status,
      search,
      locationId,
      departmentId,
      audience,
      locations,
      departments,
    ],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const preview = useMemo(
    () =>
      selectedRow
        ? toAnnouncementPreview(selectedRow, authors, locations, departments, new Date())
        : null,
    [selectedRow, authors, locations, departments],
  );

  const handleCreate = useCallback(
    async (input: { title: string; body: string; urgent: boolean }): Promise<void> => {
      if (!orgId || !user) return;
      // Surfaced here, not just in the modal: a silent failure would leave the
      // composer open with no explanation. Rethrown so the modal stays open.
      let created;
      try {
        created = await createAnnouncement({
          org_id: orgId,
          author_user_id: user.id,
          title: input.title,
          body: input.body,
          urgent: input.urgent,
          scope: 'org',
        });
      } catch (err) {
        showError('Could not post that announcement. Please try again.');
        throw err;
      }
      setRows((prev) => [created, ...prev]);
      setSelectedId(created.id);
      showSuccess('Announcement posted.');

      // Fire-and-forget: a failed dispatch does not undo the post, which is
      // already visible in the table. See send-notification's header for why
      // this goes through Inngest rather than a direct client insert.
      const recipients = await listOrgMemberUserIds(orgId, user.id);
      if (recipients.length > 0) {
        void send('announcement/published', {
          orgId,
          userIds: recipients,
          type: 'announcement',
          title: created.title,
          body: created.body,
        });
      }
    },
    [orgId, user, send, showError, showSuccess],
  );

  const handleResend = useCallback(async (): Promise<void> => {
    if (!orgId || !user || !selectedRow) return;
    try {
      const recipients = await listOrgMemberUserIds(orgId, user.id);
      if (recipients.length === 0) {
        showError('No one else in this organisation to notify.');
        return;
      }
      await send('announcement/published', {
        orgId,
        userIds: recipients,
        type: 'announcement',
        title: selectedRow.title,
        body: selectedRow.body,
      });
      showSuccess('Announcement re-sent to the team.');
    } catch (err) {
      reportError(err, { area: 'announcements:resend' });
      showError('Could not resend that announcement.');
    }
  }, [orgId, user, selectedRow, send, showError, showSuccess]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!selectedRow) return;
    try {
      await deleteAnnouncement(selectedRow.id);
      setRows((prev) => prev.filter((row) => row.id !== selectedRow.id));
      setSelectedId(null);
      showSuccess('Announcement removed.');
    } catch (err) {
      reportError(err, { area: 'announcements:delete' });
      showError('Could not remove that announcement.');
    }
  }, [selectedRow, showError, showSuccess]);

  const openComposer = useCallback((seed: Announcement | null): void => {
    setComposerSeed(seed);
    setComposerOpen(true);
  }, []);

  const selects: AnnouncementFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: locationId,
      onChange: setLocationId,
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    },
    {
      id: 'departments',
      allLabel: 'All Departments',
      value: departmentId,
      onChange: setDepartmentId,
      widthClass: 'w-44',
      options: departments.map((d) => ({ value: d.id, label: d.name })),
    },
    {
      id: 'audiences',
      allLabel: 'All Audiences',
      value: audience,
      onChange: setAudience,
      options: [...new Set(mapped.map((row) => row.audience))].map((name) => ({
        value: name,
        label: name,
      })),
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

  // Only the follow-ups the schema can actually back. The reference's "Archive
  // Announcement" is deliberately renamed: `announcements` has no archived
  // state, so the only thing that row could do is delete — and it says so.
  const quickActions: AnnouncementQuickAction[] = canManageStaff
    ? [
        {
          id: 'resend',
          icon: Send,
          label: 'Resend Announcement',
          onSelect: () => void handleResend(),
        },
        {
          id: 'duplicate',
          icon: Copy,
          label: 'Duplicate Announcement',
          onSelect: () => openComposer(selectedRow),
        },
        {
          id: 'delete',
          icon: Trash2,
          label: 'Delete Announcement',
          onSelect: () => void handleDelete(),
        },
      ]
    : [];

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load announcements.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  const emptyMessage = loading
    ? 'Loading announcements…'
    : activeTab === 'archived'
      ? 'Nothing archived — RotaFlow does not archive announcements yet.'
      : 'No announcements match these filters.';

  return (
    <>
      <AnnouncementsView
        tabs={[...TABS]}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setPage(1);
        }}
        onNewAnnouncement={canManageStaff ? () => openComposer(null) : undefined}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        selects={selects}
        onFilters={() => showSuccess('More filters are coming in a later release.')}
        rows={visible}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onEdit={(id) => openComposer(rows.find((row) => row.id === id) ?? null)}
        onMenu={setSelectedId}
        emptyMessage={emptyMessage}
        page={safePage}
        pageCount={pageCount}
        rangeFrom={filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
        rangeTo={(safePage - 1) * pageSize + visible.length}
        total={filtered.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        preview={preview}
        quickActions={quickActions}
        onDownload={() => undefined}
        onViewGuide={() =>
          showSuccess('The announcement guide is coming in a later release.')
        }
      />

      {canManageStaff && (
        <AnnouncementComposerModal
          open={composerOpen}
          seed={composerSeed}
          orgId={orgId}
          onClose={() => setComposerOpen(false)}
          onSubmit={handleCreate}
        />
      )}
    </>
  );
}
