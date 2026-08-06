import type { AnnouncementPreview, AnnouncementRow } from '@/lib/announcements';

/**
 * Design-loop fixtures reproducing design/Announcements-Dashboard.png exactly.
 *
 * These exist so the screen can be screenshotted without a Supabase session or
 * a seeded organisation, `AnnouncementsPreviewPage` renders the same
 * components the live page does. Nothing here is used in production.
 */
export const DEMO_ANNOUNCEMENTS: AnnouncementRow[] = [
  {
    id: 'bank-holiday',
    title: 'Bank Holiday Coverage-26 May',
    excerpt: 'Please note that we require all available staff to check their shifts…',
    category: 'general',
    pinned: true,
    audience: 'All Staff',
    audienceScope: 'All Locations',
    status: 'sent',
    when: '22 May 2025, 09:00',
    whenLabel: 'Sent',
    authorName: 'James Davis',
    authorRole: 'Manager',
    authorPhotoUrl: null,
  },
  {
    id: 'mandatory-training',
    title: 'Mandatory Training. Update',
    excerpt: 'Please complete your mandatory training by 30 May to stay compliant…',
    category: 'training',
    pinned: false,
    audience: 'Care Staff',
    audienceScope: 'All Locations',
    status: 'scheduled',
    when: '28 May 2025, 10:00',
    whenLabel: 'Scheduled',
    authorName: 'James Davis',
    authorRole: 'Manager',
    authorPhotoUrl: null,
  },
  {
    id: 'staff-appreciation',
    title: 'Staff Appreciation Day',
    excerpt: 'Join us for refreshments and recognition of everyone’s hard work…',
    category: 'event',
    pinned: false,
    audience: 'All Staff',
    audienceScope: 'Sunnyvale Care Home',
    status: 'sent',
    when: '20 May 2025, 14:30',
    whenLabel: 'Sent',
    authorName: 'Sarah Johnson',
    authorRole: 'Deputy Manager',
    authorPhotoUrl: null,
  },
  {
    id: 'lone-working',
    title: 'Policy Update. Lone Working',
    excerpt: 'Please review the updated lone working policy before your next shift…',
    category: 'policy',
    pinned: false,
    audience: 'Care Staff',
    audienceScope: 'All Locations',
    status: 'sent',
    when: '18 May 2025, 11:15',
    whenLabel: 'Sent',
    authorName: 'James Davis',
    authorRole: 'Manager',
    authorPhotoUrl: null,
  },
  {
    id: 'system-maintenance',
    title: 'System Maintenance',
    excerpt: 'RotaFlow will be unavailable during this period for scheduled work…',
    category: 'system',
    pinned: false,
    audience: 'All Staff',
    audienceScope: 'All Locations',
    status: 'draft',
    when: null,
    whenLabel: 'Not scheduled',
    authorName: 'James Davis',
    authorRole: 'Manager',
    authorPhotoUrl: null,
  },
  {
    id: 'new-rota',
    title: 'New Rota Published',
    excerpt: 'The rota for 26 May-8 June is now available to view in the app…',
    category: 'rota',
    pinned: false,
    audience: 'All Staff',
    audienceScope: 'All Locations',
    status: 'sent',
    when: '16 May 2025, 16:45',
    whenLabel: 'Sent',
    authorName: 'Megan Lee',
    authorRole: 'Scheduler',
    authorPhotoUrl: null,
  },
  {
    id: 'flu-clinics',
    title: 'Flu Vaccination Clinics',
    excerpt: 'Book your appointment for the upcoming flu vaccination clinics…',
    category: 'health',
    pinned: false,
    audience: 'All Staff',
    audienceScope: 'All Locations',
    status: 'scheduled',
    when: '30 May 2025, 09:00',
    whenLabel: 'Scheduled',
    authorName: 'Megan Lee',
    authorRole: 'Scheduler',
    authorPhotoUrl: null,
  },
  {
    id: 'overtime-policy',
    title: 'Overtime Policy Reminder',
    excerpt: 'Please ensure overtime is approved in advance by your line manager…',
    category: 'pay',
    pinned: false,
    audience: 'Care Staff',
    audienceScope: 'All Locations',
    status: 'sent',
    when: '10 May 2025, 10:00',
    whenLabel: 'Sent',
    authorName: 'James Davis',
    authorRole: 'Manager',
    authorPhotoUrl: null,
  },
];

export const DEMO_ANNOUNCEMENT_PREVIEW: AnnouncementPreview = {
  id: 'bank-holiday',
  title: 'Bank Holiday Coverage-26 May',
  category: 'general',
  status: 'sent',
  sentLabel: 'Sent on 22 May 2025, 09:00',
  authorLabel: 'By James Davis',
  body:
    'Please note that we require all available staff to check their shifts for the ' +
    'Bank Holiday on Monday 26 May. Additional hours are available and will be ' +
    'allocated to those who are able to support.\n\n' +
    'Thank you for your continued dedication.',
  audience: 'All Staff',
  audienceScope: 'All Locations',
  delivery: { delivered: 42, read: 38, unread: 4 },
  attachments: [
    {
      id: 'bank-holiday-guidelines',
      name: 'Bank_Holiday_Guidelines.pdf',
      meta: 'PDF · 245 KB',
    },
  ],
};

/** Total announcements in the fixture org. The reference's "of 23". */
export const DEMO_ANNOUNCEMENT_TOTAL = 23;
