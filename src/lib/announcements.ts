/**
 * View models for the Announcements screen (design/Announcements-Dashboard.png).
 *
 * These are presentation shapes, not database rows. An `announcements` row
 * carries `scope`/`published_at`/`urgent`; the screen shows a delivery status,
 * an audience label folded together from scope + location/department, and an
 * author's name and role that live in `profiles`/`memberships`. Services map
 * Supabase rows into these (see `src/lib/announcementsMapping.ts`); the design
 * fixtures build the same shapes by hand (`src/lib/announcementsDemo.ts`).
 */

/** Delivery state shown in the Status column and on the preview panel. */
export type AnnouncementStatus = 'sent' | 'scheduled' | 'draft' | 'archived';

/** The tab bar above the table. `all` is the default. */
export type AnnouncementTab = 'all' | 'scheduled' | 'drafts' | 'sent' | 'archived';

/**
 * Drives the tinted icon tile beside each title. Purely presentational — the
 * schema has no category column, so live rows derive this from the announcement
 * (see `categoriseAnnouncement`) rather than storing it.
 */
export type AnnouncementCategory =
  'general' | 'training' | 'event' | 'policy' | 'system' | 'rota' | 'health' | 'pay';

export interface AnnouncementRow {
  id: string;
  title: string;
  /** First line of the body, truncated by the cell — not by this string. */
  excerpt: string;
  category: AnnouncementCategory;
  /** Renders the pin gutter marker on the left of the row. */
  pinned: boolean;
  /** Who it went to, e.g. "All Staff" / "Care Staff". */
  audience: string;
  /** Where it went, e.g. "All Locations" / "Sunnyvale Care Home". */
  audienceScope: string;
  status: AnnouncementStatus;
  /** Formatted send/schedule stamp, or `null` for a never-scheduled draft. */
  when: string | null;
  /** Caption under the stamp: "Sent" / "Scheduled" / "Not scheduled". */
  whenLabel: string;
  authorName: string;
  authorRole: string;
  authorPhotoUrl: string | null;
}

export interface AnnouncementAttachment {
  id: string;
  name: string;
  /** Type and size, pre-formatted: "PDF · 245 KB". */
  meta: string;
}

/** Delivered / read counts for the preview panel's Delivery block. */
export interface AnnouncementDelivery {
  delivered: number;
  read: number;
  unread: number;
}

export interface AnnouncementPreview {
  id: string;
  title: string;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
  /** "Sent on 22 May 2025, 09:00" — already tense-matched to `status`. */
  sentLabel: string;
  authorLabel: string;
  body: string;
  audience: string;
  audienceScope: string;
  /**
   * `null` where per-recipient delivery is not readable. `notifications` is
   * RLS-scoped to `user_id = auth.uid()`, so a manager cannot count another
   * member's reads from the client — the panel hides the block rather than
   * showing a number that is really "how many of these I read myself".
   */
  delivery: AnnouncementDelivery | null;
  attachments: AnnouncementAttachment[];
}

/** Read share as a whole percent, for the engagement meter. 0 when nothing was delivered. */
export function engagementPercent(delivery: AnnouncementDelivery): number {
  if (delivery.delivered <= 0) return 0;
  return Math.round((delivery.read / delivery.delivered) * 100);
}

/** Which statuses a tab admits. `all` admits everything. */
export function tabAccepts(tab: AnnouncementTab, status: AnnouncementStatus): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'scheduled':
      return status === 'scheduled';
    case 'drafts':
      return status === 'draft';
    case 'sent':
      return status === 'sent';
    case 'archived':
      return status === 'archived';
  }
}
