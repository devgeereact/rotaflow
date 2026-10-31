import { activeOrgPath, api, isApiCode, orgPath, seg } from '@/lib/api';
import type { MePayload } from '@/context/AuthContext';
import type { Announcement, AnnouncementInsert, AnnouncementRead } from '@/types';

/** Every announcement in the org, newest first. RLS (org-shared) scopes this to members. */
type ApiAnnouncement = Omit<Announcement, 'org_id' | 'updated_at'> & {
  reads_count?: number;
  read_by_me?: boolean | number;
};

async function fetchAnnouncements(orgId: string): Promise<ApiAnnouncement[]> {
  const r = await api.get<{ announcements: ApiAnnouncement[] }>(
    orgPath(orgId, '/announcements'),
  );
  return r.announcements;
}

function toAnnouncement(orgId: string, a: ApiAnnouncement): Announcement {
  const row: ApiAnnouncement = { ...a };
  delete row.reads_count;
  delete row.read_by_me;
  return { ...row, org_id: orgId, updated_at: a.created_at, urgent: Boolean(a.urgent) };
}

export async function listAnnouncements(orgId: string): Promise<Announcement[]> {
  return (await fetchAnnouncements(orgId))
    .map((a) => toAnnouncement(orgId, a))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Publishes immediately, `published_at` is set here, not left null for a later
 * "publish" step.
 *
 * Notifying the audience is NOT done here. `announcements_enqueue_published`
 * (0087) writes the notification in the same transaction as the insert, so it
 * cannot be lost by a tab that closes on the success toast — which is what
 * happened while this page dispatched it itself (GAP-026).
 */
export async function createAnnouncement(
  input: AnnouncementInsert,
): Promise<Announcement> {
  // Posting publishes at once (the API notifies the audience on publish).
  const r = await api.post<{ id: string }>(orgPath(input.org_id, '/announcements'), {
    scope: input.scope ?? 'org',
    location_id: input.location_id ?? null,
    department_id: input.department_id ?? null,
    title: input.title,
    body: input.body,
    urgent: input.urgent ?? false,
    publish: true,
  });
  const found = (await listAnnouncements(input.org_id)).find((a) => a.id === r.id);
  if (!found) throw new Error('Announcement not found');
  return found;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await api.post(activeOrgPath(`/announcements/${seg(id)}/delete`));
}

/**
 * Every read receipt in the org, for the read-progress bar (0046). `everyone: false` (a person who is not an owner or
 * manager) reads only their own receipts and never asks for everyone's, which the API refuses them; left out, the
 * service asks and falls back on the refusal.
 */
export async function listAnnouncementReads(
  orgId: string,
  options: { everyone?: boolean } = {},
): Promise<AnnouncementRead[]> {
  const list = await fetchAnnouncements(orgId);
  const out: AnnouncementRead[] = [];
  if (options.everyone !== false) {
    try {
      // An owner or manager reads every receipt, one announcement at a time.
      for (const a of list) {
        const r = await api.get<{
          reads: { staff_profile_id: string; read_at: string }[];
        }>(orgPath(orgId, `/announcements/${seg(a.id)}/reads`));
        for (const read of r.reads) {
          out.push({
            id: `${a.id}:${read.staff_profile_id}`,
            org_id: orgId,
            announcement_id: a.id,
            ...read,
          });
        }
      }
      return out;
    } catch (error) {
      if (!isApiCode(error, 'forbidden')) throw error;
    }
  }
  // Anyone else sees only their own receipts, which the list already carries.
  const me = await api.get<MePayload>('/me');
  const staff = await api.get<{ staff: { id: string; user_id: string | null }[] }>(
    orgPath(orgId, '/staff'),
  );
  const mine = staff.staff.find((s) => s.user_id === me.user.id);
  if (!mine) return [];
  return list
    .filter((a) => Boolean(a.read_by_me))
    .map((a) => ({
      id: `${a.id}:${mine.id}`,
      org_id: orgId,
      announcement_id: a.id,
      staff_profile_id: mine.id,
      read_at: a.created_at,
    }));
}

/** A no-op if already read: `announcement_reads` is unique per (announcement, staff). */
export async function markAnnouncementRead(
  orgId: string,
  announcementId: string,
  _staffProfileId: string,
): Promise<void> {
  // Idempotent on the API: reading twice records one receipt.
  await api.post(orgPath(orgId, `/announcements/${seg(announcementId)}/read`));
}

/**
 * Re-notify everyone in an announcement's audience who has not read it.
 *
 * The one dispatch no trigger can carry: pressing "Remind unread" changes no
 * row, so there is no transition to hang it on. It goes through an RPC instead
 * — which still commits the outbox row before returning, so the reminder
 * survives the tab closing immediately afterwards.
 *
 * The audience and the read set are both computed server-side. The page used
 * to derive them from whatever staff list it had loaded, so who got reminded
 * depended on a client-side cache.
 *
 * Returns how many people it will actually reach.
 */
export async function remindAnnouncementUnread(announcementId: string): Promise<number> {
  const r = await api.post<{ reminded: number }>(
    activeOrgPath(`/announcements/${seg(announcementId)}/remind`),
  );
  return r.reminded;
}
