/**
 * View model for `/app/announcements` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.announcements`). Pure functions, no network, no React, so the
 * real page and the design-loop preview render exactly the same tree.
 */

import { format } from 'date-fns';
import type {
  Announcement,
  AnnouncementRead,
  Department,
  Location,
  StaffProfile,
} from '@/types';

export interface AnnouncementAuthor {
  userId: string;
  name: string;
}

export interface AnnouncementCard {
  id: string;
  title: string;
  body: string;
  /** Reuses the real `urgent` column; there is no separate pin column. */
  pinned: boolean;
  audienceLabel: string;
  authorName: string;
  /** "22 May 2026, 09:00". */
  when: string;
  readCount: number;
  audienceSize: number;
  isReadByViewer: boolean;
}

export function authorIndex(staff: StaffProfile[]): Map<string, AnnouncementAuthor> {
  const index = new Map<string, AnnouncementAuthor>();
  for (const profile of staff) {
    if (!profile.user_id) continue;
    index.set(profile.user_id, {
      userId: profile.user_id,
      name: `${profile.first_name} ${profile.last_name}`.trim(),
    });
  }
  return index;
}

/** Staff attributed to a site through the departments that belong to it. */
function staffAtLocation(
  location: Location,
  departments: Department[],
  staff: StaffProfile[],
): StaffProfile[] {
  const deptIds = new Set(
    departments.filter((d) => d.location_id === location.id).map((d) => d.id),
  );
  return staff.filter((s) => s.department_id && deptIds.has(s.department_id));
}

function audienceFor(
  row: Announcement,
  locations: Location[],
  departments: Department[],
  staff: StaffProfile[],
): { label: string; size: number } {
  if (row.department_id) {
    const department = departments.find((d) => d.id === row.department_id);
    return {
      label: department?.name ?? 'A department',
      size: staff.filter((s) => s.department_id === row.department_id).length,
    };
  }
  if (row.location_id) {
    const location = locations.find((l) => l.id === row.location_id);
    return {
      label: location?.name ?? 'A site',
      size: location ? staffAtLocation(location, departments, staff).length : 0,
    };
  }
  return { label: 'All sites', size: staff.length };
}

export function toAnnouncementCard(
  row: Announcement,
  authors: Map<string, AnnouncementAuthor>,
  locations: Location[],
  departments: Department[],
  staff: StaffProfile[],
  reads: AnnouncementRead[],
  viewerStaffId: string | null,
): AnnouncementCard {
  const author = row.author_user_id ? authors.get(row.author_user_id) : undefined;
  const forThis = reads.filter((r) => r.announcement_id === row.id);
  const { label, size } = audienceFor(row, locations, departments, staff);

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.urgent,
    audienceLabel: label,
    authorName: author?.name ?? 'Unknown',
    when: format(new Date(row.published_at ?? row.created_at), 'd MMM yyyy, HH:mm'),
    readCount: forThis.length,
    audienceSize: size,
    isReadByViewer: viewerStaffId
      ? forThis.some((r) => r.staff_profile_id === viewerStaffId)
      : false,
  };
}

/** Sort pinned first, then newest. */
export function sortCards(cards: AnnouncementCard[]): AnnouncementCard[] {
  return [...cards].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.when.localeCompare(a.when);
  });
}

export interface ReachRow {
  id: string;
  label: string;
  count: number;
}

/** The "Reach" card's bar rows: all sites, then each site's own staff count. */
export function buildReach(
  locations: Location[],
  departments: Department[],
  staff: StaffProfile[],
): ReachRow[] {
  return [
    { id: 'all', label: 'All sites', count: staff.length },
    ...locations.map((location) => ({
      id: location.id,
      label: location.name,
      count: staffAtLocation(location, departments, staff).length,
    })),
  ];
}
