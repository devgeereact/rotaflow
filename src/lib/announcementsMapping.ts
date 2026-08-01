/**
 * Maps Supabase rows onto the Announcements view models. Pure functions — no
 * network, no React — so `/app/announcements` and the design-loop preview
 * render exactly the same component tree.
 *
 * The schema is narrower than the screen: `announcements` has no status,
 * category, pin, attachment or read-receipt column (see `docs/SCHEMA.md`).
 * Everything below is derived from what the row actually carries, and the
 * things that cannot be derived are reported as absent rather than guessed —
 * `delivery` is `null`, `attachments` is empty, `pinned` is `false`.
 */

import { format } from 'date-fns';
import type { Announcement, Department, Location, StaffProfile } from '@/types';
import type {
  AnnouncementCategory,
  AnnouncementPreview,
  AnnouncementRow,
  AnnouncementStatus,
} from '@/lib/announcements';

/** Author name + role, resolved from `staff_profiles` and `memberships`. */
export interface AnnouncementAuthor {
  userId: string;
  name: string;
  role: string;
  photoUrl: string | null;
}

/**
 * `published_at` is the only delivery signal the row carries: unset is a draft,
 * in the future is scheduled, in the past has gone out. There is no archived
 * state in the schema, so `'archived'` is never produced here.
 */
export function statusOf(row: Announcement, now: Date): AnnouncementStatus {
  if (!row.published_at) return 'draft';
  return new Date(row.published_at) > now ? 'scheduled' : 'sent';
}

const CATEGORY_KEYWORDS: [AnnouncementCategory, RegExp][] = [
  ['training', /\btrain(ing)?\b|\bcourse\b|\bcompliance\b/i],
  ['rota', /\brota\b|\bschedule\b|\bshift pattern\b/i],
  ['policy', /\bpolicy\b|\bprocedure\b|\bguideline\b/i],
  ['pay', /\bpay\b|\bpayroll\b|\bovertime\b|\bsalary\b|\bexpense\b/i],
  ['health', /\bvaccin|\bhealth\b|\bclinic\b|\bwellbeing\b/i],
  ['event', /\bparty\b|\bevent\b|\bcelebrat|\bappreciation\b|\bsocial\b/i],
  ['system', /\bmaintenance\b|\boutage\b|\bdowntime\b|\bsystem\b/i],
];

/**
 * Picks the tinted glyph beside a title. Presentational only — nothing depends
 * on getting it right, and `general` (the megaphone) is a safe default, so
 * keyword matching is honest here in a way it would not be for, say, routing.
 */
export function categorise(row: Announcement): AnnouncementCategory {
  if (row.urgent) return 'system';
  const haystack = `${row.title} ${row.body}`;
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) return category;
  }
  return 'general';
}

/** "22 May 2025, 09:00" — the reference's stamp format. */
function stamp(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy, HH:mm');
}

function whenLabelFor(status: AnnouncementStatus): string {
  switch (status) {
    case 'sent':
      return 'Sent';
    case 'scheduled':
      return 'Scheduled';
    case 'draft':
      return 'Not scheduled';
    case 'archived':
      return 'Archived';
  }
}

/** Who it went to, folded out of `scope` + the targeted location/department. */
function audienceFor(
  row: Announcement,
  locations: Location[],
  departments: Department[],
): { audience: string; audienceScope: string } {
  const location = locations.find((l) => l.id === row.location_id);
  const department = departments.find((d) => d.id === row.department_id);

  if (row.scope === 'department' && department) {
    return {
      audience: `${department.name} Staff`,
      audienceScope: location?.name ?? 'All Locations',
    };
  }
  if (row.scope === 'location' && location) {
    return { audience: 'All Staff', audienceScope: location.name };
  }
  return { audience: 'All Staff', audienceScope: 'All Locations' };
}

const UNKNOWN_AUTHOR: Omit<AnnouncementAuthor, 'userId'> = {
  name: 'Unknown',
  role: 'Member',
  photoUrl: null,
};

export function toAnnouncementRow(
  row: Announcement,
  authors: Map<string, AnnouncementAuthor>,
  locations: Location[],
  departments: Department[],
  now: Date,
): AnnouncementRow {
  const status = statusOf(row, now);
  const author =
    (row.author_user_id && authors.get(row.author_user_id)) || UNKNOWN_AUTHOR;
  const firstLine = row.body.split('\n').find((line) => line.trim().length > 0) ?? '';

  return {
    id: row.id,
    title: row.title,
    excerpt: firstLine,
    category: categorise(row),
    // No pin column in `announcements` — nothing can be pinned yet.
    pinned: false,
    ...audienceFor(row, locations, departments),
    status,
    when: row.published_at ? stamp(row.published_at) : null,
    whenLabel: whenLabelFor(status),
    authorName: author.name,
    authorRole: author.role,
    authorPhotoUrl: author.photoUrl,
  };
}

export function toAnnouncementPreview(
  row: Announcement,
  authors: Map<string, AnnouncementAuthor>,
  locations: Location[],
  departments: Department[],
  now: Date,
): AnnouncementPreview {
  const status = statusOf(row, now);
  const author =
    (row.author_user_id && authors.get(row.author_user_id)) || UNKNOWN_AUTHOR;
  const verb = status === 'scheduled' ? 'Scheduled for' : 'Sent on';

  return {
    id: row.id,
    title: row.title,
    category: categorise(row),
    status,
    sentLabel: row.published_at
      ? `${verb} ${stamp(row.published_at)}`
      : `Drafted ${stamp(row.created_at)}`,
    authorLabel: `By ${author.name}`,
    body: row.body,
    ...audienceFor(row, locations, departments),
    // `notifications` is RLS-scoped to `user_id = auth.uid()`, so a manager
    // cannot count another member's reads from the client. The panel hides the
    // block rather than showing a number that is really "how many I read".
    delivery: null,
    // No attachments table yet.
    attachments: [],
  };
}

/** Title/body/audience/author match, case-insensitively. */
export function matchesSearch(row: AnnouncementRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [row.title, row.excerpt, row.audience, row.audienceScope, row.authorName].some(
    (field) => field.toLowerCase().includes(needle),
  );
}

/** Builds the author lookup the mappers need from an org's staff profiles. */
export function authorIndex(
  profiles: StaffProfile[],
  roles: Map<string, string>,
): Map<string, AnnouncementAuthor> {
  const index = new Map<string, AnnouncementAuthor>();
  for (const profile of profiles) {
    if (!profile.user_id) continue;
    index.set(profile.user_id, {
      userId: profile.user_id,
      name: `${profile.first_name} ${profile.last_name}`.trim(),
      role: profile.job_title ?? roles.get(profile.user_id) ?? 'Member',
      photoUrl: profile.photo_url,
    });
  }
  return index;
}
