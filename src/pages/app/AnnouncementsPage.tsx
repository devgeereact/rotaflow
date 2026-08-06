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
import { downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import type { Announcement, Department, Location } from '@/types';

/** Mirrors the `AnnouncementCategory` union in lib/announcements.ts. */
const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'training', label: 'Training' },
  { value: 'event', label: 'Event' },
  { value: 'policy', label: 'Policy' },
  { value: 'system', label: 'System' },
  { value: 'rota', label: 'Rota' },
  { value: 'health', label: 'Health & safety' },
  { value: 'pay', label: 'Pay' },
] as const;

const TABS = [
  { value: 'all', label: 'All Announcements' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'archived', label: 'Archived' },
] as const;

/**
 * `/app/announcements`. The communications workspace in
 * design/Announcements-Dashboard.png.
 *
 * The schema is narrower than the screen (see `src/lib/announcementsMapping.ts`):
 * status is derived from `published_at`, and there is no archive, attachment or
 * read-receipt store. The Archived tab is therefore always empty and the preview
 * panel omits its Delivery and Attachments blocks. The design is honoured
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);

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
        if (category && row.category !== category) return false;
        if (pinnedOnly && !row.pinned) return false;
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
      category,
      pinnedOnly,
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
  // state, so the only thing that row could do is delete, and it says so.
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

  /** CSV of the filtered feed, §47 requires exports to honour the filters. */
  const handleExport = (): void => {
    if (filtered.length === 0) {
      showError('There are no announcements matching these filters to export.');
      return;
    }
    downloadCsv(
      `rotaflow-announcements-${new Date().toISOString().slice(0, 10)}`,
      filtered,
      [
        { label: 'Title', value: (r) => r.title },
        { label: 'Summary', value: (r) => r.excerpt },
        { label: 'Category', value: (r) => r.category },
        { label: 'Audience', value: (r) => r.audience },
        { label: 'Locations', value: (r) => r.audienceScope },
        { label: 'Status', value: (r) => r.status },
        { label: 'Pinned', value: (r) => (r.pinned ? 'yes' : 'no') },
        { label: 'When', value: (r) => r.when ?? '' },
        { label: 'Author', value: (r) => r.authorName },
      ],
    );
    showSuccess(`Exported ${filtered.length} announcements.`);
  };

  const emptyMessage = loading
    ? 'Loading announcements…'
    : activeTab === 'archived'
      ? 'Nothing archived. RotaFlow does not archive announcements yet.'
      : 'No announcements match these filters.';

  return (
    <>
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="More filters"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="ann-category">Category</Label>
            <Select
              id="ann-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {/* Derived, not stored, `announcements` has no category column. */}
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Categories are worked out from each announcement&rsquo;s wording, not stored
              against it.
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={pinnedOnly}
              onChange={(e) => {
                setPinnedOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Only show pinned announcements
          </label>
          <p className="text-sm text-content dark:text-content-dark">
            Showing <strong>{filtered.length}</strong> of {mapped.length} announcements.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setCategory('');
                setPinnedOnly(false);
                setPage(1);
              }}
            >
              Clear
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Writing a good announcement"
      >
        <div className="space-y-4 text-sm text-content dark:text-content-dark">
          <div>
            <h3 className="mb-1 font-semibold">Who receives it</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Audience narrows by location and department. Choosing both sends only to
              people who match both, a department at one site, not that department
              everywhere.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Delivery</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Publishing writes an in-app notification for every recipient immediately.
              Email and push go out through the notification service where the recipient
              has opted in and a channel is configured.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Read tracking</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Read counts come from recipients opening the notification. Somebody who
              reads an announcement over a colleague&rsquo;s shoulder will not be counted,
              so treat these as a floor rather than an exact figure.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Pinning</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Pinned announcements stay at the top of everyone&rsquo;s feed. Reserve it
              for things that stay true for a while. Pinning everything is the same as
              pinning nothing.
            </p>
          </div>
        </div>
      </Modal>

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
        onFilters={() => setFiltersOpen(true)}
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
        onDownload={handleExport}
        onViewGuide={() => setGuideOpen(true)}
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
