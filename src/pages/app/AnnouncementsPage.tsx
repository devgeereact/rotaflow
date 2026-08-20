import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncementReads,
  listAnnouncements,
  markAnnouncementRead,
} from '@/services/announcementService';
import { listDepartments, listLocations } from '@/services/locationService';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { reportError } from '@/lib/sentry';
import {
  authorIndex,
  buildReach,
  sortCards,
  toAnnouncementCard,
  type AnnouncementCard,
} from '@/lib/announcementsMapping';
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView';
import {
  AnnouncementComposerModal,
  type AnnouncementDraft,
} from '@/components/announcements/AnnouncementComposerModal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type {
  Announcement,
  AnnouncementInsert,
  AnnouncementRead,
  Department,
  Location,
  StaffProfile,
} from '@/types';

function toInsert(
  orgId: string,
  userId: string,
  draft: AnnouncementDraft,
): AnnouncementInsert {
  const [kind, id] = draft.audience.split(':');
  return {
    org_id: orgId,
    author_user_id: userId,
    title: draft.title,
    body: draft.body,
    urgent: draft.urgent,
    scope: kind === 'location' || kind === 'department' ? kind : 'org',
    location_id: kind === 'location' ? id : null,
    department_id: kind === 'department' ? id : null,
  };
}

/**
 * `/app/announcements` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.announcements`). Read receipts are real (`announcement_reads`,
 * 0046) rather than the `null` "cannot count another member's reads"
 * placeholder the previous build carried — that limitation was about
 * `notifications`, which is personal; announcement reads are org-shared.
 */
export function AnnouncementsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();
  const { user } = useSupabaseAuth();
  const { send } = useInngestDispatch();
  const { showError, showSuccess } = useToast();

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [rows, setRows] = useState<Announcement[]>([]);
  const [reads, setReads] = useState<AnnouncementRead[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useRealtimeRefresh({
    tables: ['announcements'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [mine, announcements, readRows, staffRows, locationRows, departmentRows] =
          await Promise.all([
            getMyStaffProfile(orgId, user.id),
            listAnnouncements(orgId),
            listAnnouncementReads(orgId),
            listActiveStaff(orgId),
            listLocations(orgId),
            listDepartments(orgId),
          ]);
        if (!active) return;
        setMyProfile(mine);
        setRows(announcements);
        setReads(readRows);
        setStaff(staffRows);
        setLocations(locationRows);
        setDepartments(departmentRows);
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
  }, [orgId, user, reloadKey, showError]);

  const authors = useMemo(() => authorIndex(staff), [staff]);

  const cards = useMemo(
    () =>
      sortCards(
        rows.map((row) =>
          toAnnouncementCard(
            row,
            authors,
            locations,
            departments,
            staff,
            reads,
            myProfile?.id ?? null,
          ),
        ),
      ),
    [rows, authors, locations, departments, staff, reads, myProfile],
  );

  const reach = useMemo(
    () => buildReach(locations, departments, staff),
    [locations, departments, staff],
  );

  const handleCreate = useCallback(
    async (draft: AnnouncementDraft): Promise<void> => {
      if (!orgId || !user) return;
      let created;
      try {
        created = await createAnnouncement(toInsert(orgId, user.id, draft));
      } catch (err) {
        showError('Could not post that announcement. Please try again.');
        throw err;
      }
      setRows((prev) => [created, ...prev]);
      showSuccess('Announcement posted.');

      const recipients = staff
        .filter((s) => {
          if (created.department_id) return s.department_id === created.department_id;
          if (created.location_id) {
            const deptIds = new Set(
              departments
                .filter((d) => d.location_id === created.location_id)
                .map((d) => d.id),
            );
            return s.department_id && deptIds.has(s.department_id);
          }
          return true;
        })
        .map((s) => s.user_id)
        .filter((id): id is string => Boolean(id));

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
    [orgId, user, staff, departments, send, showError, showSuccess],
  );

  const handleMarkRead = useCallback(
    async (card: AnnouncementCard): Promise<void> => {
      if (!orgId || !myProfile) return;
      setBusyId(card.id);
      try {
        await markAnnouncementRead(orgId, card.id, myProfile.id);
        setReads((prev) => [
          ...prev,
          {
            id: `local-${card.id}`,
            org_id: orgId,
            announcement_id: card.id,
            staff_profile_id: myProfile.id,
            read_at: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        reportError(err, { area: 'announcements:mark-read' });
        showError('Could not mark that as read.');
      } finally {
        setBusyId(null);
      }
    },
    [orgId, myProfile, showError],
  );

  const handleRemindUnread = useCallback(
    (card: AnnouncementCard): void => {
      if (!orgId) return;
      const row = rows.find((r) => r.id === card.id);
      if (!row) return;
      setBusyId(card.id);
      try {
        const readerIds = new Set(
          reads
            .filter((r) => r.announcement_id === card.id)
            .map((r) => r.staff_profile_id),
        );
        const targeted = staff.filter((s) => {
          if (row.department_id) return s.department_id === row.department_id;
          if (row.location_id) {
            const deptIds = new Set(
              departments
                .filter((d) => d.location_id === row.location_id)
                .map((d) => d.id),
            );
            return s.department_id && deptIds.has(s.department_id);
          }
          return true;
        });
        const recipients = targeted
          .filter((s) => !readerIds.has(s.id))
          .map((s) => s.user_id)
          .filter((id): id is string => Boolean(id));

        if (recipients.length === 0) {
          showError('Everyone in this audience has already read it.');
          return;
        }
        void send('announcement/published', {
          orgId,
          userIds: recipients,
          type: 'announcement',
          title: row.title,
          body: row.body,
        });
        showSuccess(`Reminder sent to ${recipients.length} unread.`);
      } finally {
        setBusyId(null);
      }
    },
    [orgId, rows, reads, staff, departments, send, showError, showSuccess],
  );

  const handleTakeDown = useCallback(
    async (card: AnnouncementCard): Promise<void> => {
      setBusyId(card.id);
      try {
        await deleteAnnouncement(card.id);
        setRows((prev) => prev.filter((row) => row.id !== card.id));
        showSuccess('Announcement taken down.');
      } catch (err) {
        reportError(err, { area: 'announcements:delete' });
        showError('Could not take that announcement down.');
      } finally {
        setBusyId(null);
      }
    },
    [showError, showSuccess],
  );

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

  return (
    <>
      <AnnouncementsView
        cards={cards}
        reach={reach}
        loading={loading}
        canManage={canManageStaff}
        canPost={canManageStaff}
        busyId={busyId}
        onNewAnnouncement={() => setComposerOpen(true)}
        onRemindUnread={handleRemindUnread}
        onTakeDown={(card) => void handleTakeDown(card)}
        onMarkRead={(card) => void handleMarkRead(card)}
      />

      <AnnouncementComposerModal
        open={composerOpen}
        locations={locations}
        departments={departments}
        orgId={canManageStaff ? orgId : null}
        onClose={() => setComposerOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
}
