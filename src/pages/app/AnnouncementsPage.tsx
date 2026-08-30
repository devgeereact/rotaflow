import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncementReads,
  listAnnouncements,
  markAnnouncementRead,
  remindAnnouncementUnread,
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
      // Notifying the audience is the database's job now
      // (`announcements_enqueue_published`, 0087). It used to be dispatched
      // from here, after the insert had already committed and the toast was
      // already on screen — so closing the tab on that toast posted an
      // announcement nobody was told about. The audience was also resolved
      // from this page's loaded staff list, which made an announcement's
      // reach depend on a client-side cache.
    },
    [orgId, user, showError, showSuccess],
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
    async (card: AnnouncementCard): Promise<void> => {
      setBusyId(card.id);
      try {
        // Server-side for two reasons: the outbox row is committed before this
        // returns, so the reminder cannot be lost with the tab; and the unread
        // set is computed from the announcement's own audience rather than
        // from `staff`/`reads` as this page happens to hold them.
        const reached = await remindAnnouncementUnread(card.id);
        if (reached === 0) {
          showError('Everyone in this audience has already read it.');
          return;
        }
        showSuccess(`Reminder sent to ${reached} unread.`);
      } catch (err) {
        reportError(err, { area: 'announcements:remind' });
        showError('Could not send that reminder.');
      } finally {
        setBusyId(null);
      }
    },
    [showError, showSuccess],
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
        onRemindUnread={(card) => void handleRemindUnread(card)}
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
