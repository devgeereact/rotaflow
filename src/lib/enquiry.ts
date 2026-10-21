import { SECTORS } from '@/lib/marketing';

/**
 * The website enquiry: what the contact form collects, how it is checked in
 * the browser, and the statuses the console moves it through.
 *
 * The server checks everything again (`supabase/functions/public-enquiry/
 * validate.ts`), and `validate.test.ts` fails if the lists here and there
 * drift. The browser's checks are for the person typing, not a control.
 */

/** Team-size bands, in the order the form offers them. */
export const ENQUIRY_TEAM_SIZES = ['1-25', '26-100', '101-500', '500+'] as const;
export type EnquiryTeamSize = (typeof ENQUIRY_TEAM_SIZES)[number];

/** The marketing site's sectors, plus a way to say none of them fits. */
export const ENQUIRY_SECTOR_OPTIONS: readonly { value: string; label: string }[] = [
  ...SECTORS.map(({ name }) => ({ value: name, label: name })),
  { value: 'Other', label: 'Something else' },
];

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const ORGANISATION_MAX = 160;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 5000;

/**
 * Deliberately permissive: `something@something.tld`. Stricter patterns reject
 * valid addresses (apostrophes, long TLDs, subdomains) and the real check is
 * whether the reply arrives.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EnquiryFields {
  name: string;
  workEmail: string;
  organisation: string;
  teamSize: string;
  sector: string;
  message: string;
  wantsDemo: boolean;
  marketingConsent: boolean;
  /** The honeypot. A person never sees it; it is sent as typed. */
  website: string;
}

export const EMPTY_ENQUIRY: EnquiryFields = {
  name: '',
  workEmail: '',
  organisation: '',
  teamSize: '',
  sector: '',
  message: '',
  wantsDemo: false,
  marketingConsent: false,
  website: '',
};

export type EnquiryErrors = Partial<
  Record<'name' | 'workEmail' | 'organisation' | 'message', string>
>;

/** The browser's checks, worded for the person filling the form in. */
export function validateEnquiryFields(fields: EnquiryFields): EnquiryErrors {
  const errors: EnquiryErrors = {};
  const name = fields.name.trim();
  const email = fields.workEmail.trim();
  const organisation = fields.organisation.trim();
  const message = fields.message.trim();

  if (!name) errors.name = 'Enter your name.';
  else if (name.length > NAME_MAX)
    errors.name = `Keep your name under ${NAME_MAX} characters.`;

  if (!email) errors.workEmail = 'Enter your work email address.';
  else if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))
    errors.workEmail = 'Enter an email address like name@organisation.co.uk.';

  if (!organisation) errors.organisation = 'Enter your organisation.';
  else if (organisation.length > ORGANISATION_MAX)
    errors.organisation = `Keep the organisation name under ${ORGANISATION_MAX} characters.`;

  if (!message) errors.message = 'Tell us a little about what you need.';
  else if (message.length < MESSAGE_MIN)
    errors.message = 'A bit more detail helps us give you a useful answer.';
  else if (message.length > MESSAGE_MAX)
    errors.message = `Keep your message under ${MESSAGE_MAX} characters.`;

  return errors;
}

/**
 * Whether the page was opened from a "Book a demo" link, which carries
 * `?demo=1` so the demo box starts ticked.
 */
export function wantsDemoFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get('demo');
  return value === '1' || value === 'true';
}

/** Where every "Book a demo" call to action points. */
export const BOOK_DEMO_PATH = '/contact?demo=1';

// ── the console side ───────────────────────────────────────────────────

export const ENQUIRY_STATUSES = ['new', 'replied', 'demo_booked', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: 'New',
  replied: 'Replied',
  demo_booked: 'Demo booked',
  closed: 'Closed',
};

export const ENQUIRY_STATUS_TONE: Record<
  EnquiryStatus,
  'warning' | 'info' | 'success' | 'neutral'
> = {
  new: 'warning',
  replied: 'info',
  demo_booked: 'success',
  closed: 'neutral',
};

export function isEnquiryStatus(value: string): value is EnquiryStatus {
  return (ENQUIRY_STATUSES as readonly string[]).includes(value);
}

/** One enquiry as the console reads it. No address hash, no user agent. */
export interface EnquiryRecord {
  id: string;
  name: string;
  workEmail: string;
  organisation: string;
  teamSize: string | null;
  sector: string | null;
  message: string;
  wantsDemo: boolean;
  marketingConsent: boolean;
  status: EnquiryStatus;
  createdAt: string;
  updatedAt: string;
}
