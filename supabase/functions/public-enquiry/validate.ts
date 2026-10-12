// public-enquiry/validate.ts. RotaFlow
//
// The decision half of `public-enquiry`, with no Deno globals, so vitest can
// run it (the pattern `create-checkout-session/guard.ts` set). The handler in
// `index.ts` does the I/O: CORS, Turnstile, the IP hash and the database call.
//
// ## Why the server validates what the browser already validated
//
// The form is public and the endpoint is unauthenticated. Anything the page
// checks is a courtesy to the person typing; a script posts whatever it likes.
// So every field is checked again here, against the same limits the table's
// own CHECK constraints hold (0155), and the table is the last line.
//
// ## What a rejection says
//
// Only which field, never the value. The response must not echo input: an
// endpoint that reflects what it was sent is one step from being useful to
// somebody building a phishing page on our domain.

/** The team-size bands the form offers. Mirrored by `0155`'s CHECK. */
export const TEAM_SIZES = ['1-25', '26-100', '101-500', '500+'] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

/**
 * The sectors the form offers: the marketing site's sector names plus
 * "Other". Duplicated rather than imported because this module runs under
 * Deno with relative imports only; `validate.test.ts` fails if the two lists
 * drift.
 */
export const ENQUIRY_SECTORS = [
  'Healthcare and care homes',
  'Hospitality',
  'Retail',
  'Education',
  'Security',
  'Facilities management',
  'Other',
] as const;

export const LIMITS = {
  name: 120,
  workEmail: 254,
  organisation: 160,
  messageMin: 10,
  message: 5000,
  userAgent: 400,
  /** Cloudflare documents a maximum token length of 2048 characters. */
  turnstileToken: 2048,
} as const;

/**
 * Deliberately permissive, matching the page and the table:
 * `something@something.tld`. Stricter patterns reject real addresses
 * (apostrophes, long TLDs, subdomains); the real check is whether a reply
 * arrives.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Enquiry {
  name: string;
  workEmail: string;
  organisation: string;
  teamSize: TeamSize | null;
  sector: string | null;
  message: string;
  wantsDemo: boolean;
  marketingConsent: boolean;
}

export type ValidationResult =
  | { kind: 'ok'; enquiry: Enquiry; turnstileToken: string | null }
  /**
   * The honeypot was filled. The handler answers exactly as it does for a
   * real enquiry, so a bot learns nothing, and stores nothing.
   */
  | { kind: 'spam' }
  | { kind: 'invalid'; fields: string[] };

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/** Control characters other than tab and newline have no place in a message. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Validates a parsed JSON body.
 *
 * `website` is the honeypot: a field a person never sees (hidden from view
 * and from assistive technology) and a form-filling bot usually completes.
 */
export function validateEnquiry(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'invalid', fields: ['body'] };
  }
  const b = body as Record<string, unknown>;

  // Checked first and on its own: a filled honeypot is spam whatever else
  // the body holds, and must not be reported as a validation failure, which
  // would tell the bot which field gave it away.
  if (b.website !== undefined && b.website !== null && b.website !== '') {
    return { kind: 'spam' };
  }

  const fields: string[] = [];

  const name = text(b.name);
  if (!name || name.length > LIMITS.name || CONTROL.test(name)) fields.push('name');

  const workEmail = text(b.workEmail);
  if (
    !workEmail ||
    workEmail.length > LIMITS.workEmail ||
    !EMAIL_PATTERN.test(workEmail)
  ) {
    fields.push('workEmail');
  }

  const organisation = text(b.organisation);
  if (
    !organisation ||
    organisation.length > LIMITS.organisation ||
    CONTROL.test(organisation)
  ) {
    fields.push('organisation');
  }

  let teamSize: TeamSize | null = null;
  if (b.teamSize !== undefined && b.teamSize !== null && b.teamSize !== '') {
    if ((TEAM_SIZES as readonly unknown[]).includes(b.teamSize)) {
      teamSize = b.teamSize as TeamSize;
    } else {
      fields.push('teamSize');
    }
  }

  let sector: string | null = null;
  if (b.sector !== undefined && b.sector !== null && b.sector !== '') {
    if ((ENQUIRY_SECTORS as readonly unknown[]).includes(b.sector)) {
      sector = b.sector as string;
    } else {
      fields.push('sector');
    }
  }

  const message = text(b.message);
  if (
    !message ||
    message.length < LIMITS.messageMin ||
    message.length > LIMITS.message ||
    CONTROL.test(message)
  ) {
    fields.push('message');
  }

  if (b.wantsDemo !== undefined && typeof b.wantsDemo !== 'boolean') {
    fields.push('wantsDemo');
  }
  if (b.marketingConsent !== undefined && typeof b.marketingConsent !== 'boolean') {
    fields.push('marketingConsent');
  }

  let turnstileToken: string | null = null;
  if (b.turnstileToken !== undefined && b.turnstileToken !== null) {
    if (
      typeof b.turnstileToken === 'string' &&
      b.turnstileToken.length > 0 &&
      b.turnstileToken.length <= LIMITS.turnstileToken
    ) {
      turnstileToken = b.turnstileToken;
    } else {
      fields.push('turnstileToken');
    }
  }

  if (fields.length > 0) return { kind: 'invalid', fields };

  return {
    kind: 'ok',
    enquiry: {
      name: name!,
      workEmail: workEmail!,
      organisation: organisation!,
      teamSize,
      sector,
      message: message!,
      wantsDemo: b.wantsDemo === true,
      // Only an explicit `true` is consent. A missing field, a string
      // "true" or anything else is not, and was refused above anyway.
      marketingConsent: b.marketingConsent === true,
    },
    turnstileToken,
  };
}

/**
 * The client address to rate-limit on.
 *
 * Supabase's hosted functions sit behind Cloudflare, which sets
 * `cf-connecting-ip` itself and overwrites any value a client sends, so it is
 * preferred. `x-forwarded-for` is the fallback, first entry only. With
 * neither, every such request shares one subject, which fails towards
 * stricter rather than towards unlimited.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'unknown';
}

/** Keeps a header value within the column limit, or drops it. */
export function boundedUserAgent(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, LIMITS.userAgent);
}

/**
 * The short notice sent to the platform inbox. It carries no free text the
 * visitor typed: not the name, not the address, not the message. Those are
 * read in the console, behind sign-in and RLS. An email is a second copy of
 * personal data that the retention job cannot reach, and a sender-controlled
 * string in our own inbox is a phishing vector, so the notice says only that
 * something arrived and where to read it.
 */
export function notificationText(
  enquiry: Pick<Enquiry, 'teamSize' | 'sector' | 'wantsDemo'>,
  consoleUrl: string,
): { subject: string; text: string } {
  const subject = enquiry.wantsDemo
    ? 'New website enquiry: demo requested'
    : 'New website enquiry';
  const lines = [
    'A new enquiry has arrived through the contact form on the website.',
    '',
    `Demo requested: ${enquiry.wantsDemo ? 'yes' : 'no'}`,
    `Team size: ${enquiry.teamSize ?? 'not given'}`,
    `Sector: ${enquiry.sector ?? 'not given'}`,
    '',
    `Read and reply from the console: ${consoleUrl}`,
    '',
    'The message itself is not included in this email on purpose.',
  ];
  return { subject, text: lines.join('\n') };
}
