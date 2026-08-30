/**
 * Who processes customer data, what they get, and where they are
 * (docs/SAAS.md GAP-014).
 *
 * ## Why this is a data file and not prose on a page
 *
 * A sub-processor list is the one legal-adjacent document that is entirely a
 * statement of *fact* about the system, so it can be derived from the system
 * and kept beside it. Every row below cites the file that proves it. When a
 * processor is added or dropped, this list is the thing that changes, and a
 * reviewer can check each claim without taking anyone's word for it.
 *
 * It is deliberately NOT a DPA. A DPA is a binding contract and drafting one
 * is legal advice — `LegalNotice` already says the published policies need UK
 * counsel and must not be drafted in this repo. What a DPA needs in order to
 * be signed, though, is exactly this: an accurate, dated list of who the
 * sub-processors are. So this is the part that can honestly be built now.
 *
 * ## The rule for editing it
 *
 * Every claim here must be checkable from the repository or from a
 * configuration value someone can read. If a row cannot cite evidence, it does
 * not go in the table — a plausible-sounding entry on a procurement document
 * is worse than an absent one, because a customer will rely on it.
 */

export interface SubProcessor {
  name: string;
  /** What it does for RotaFlow, in the customer's terms. */
  purpose: string;
  /** Personal data it receives. "None" is a real and important answer. */
  personalData: string;
  /** Where it processes. Named region where we know it, honest where we do not. */
  region: string;
  /** True when personal data leaves the UK/EU to reach it. */
  outsideUkEu: boolean;
  /** The file or setting that proves the row. */
  evidence: string;
  /** Can a customer avoid it, and how? Null when it is unavoidable. */
  optOut: string | null;
}

/**
 * Ordered so the two that take personal data outside the UK/EU come first.
 * That is the question a procurement reviewer opens this page to answer, and
 * burying it below the routine infrastructure rows would be a choice about
 * what they notice.
 */
export const SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    name: 'OpenRouter, and the model provider it routes to',
    purpose:
      'The optional AI rota assistant. Drafts shift suggestions and announcement text from a manager’s prompt.',
    personalData:
      'Staff first and last names, job titles, skills, weekly hours and contract type, plus the shifts, locations and leave DATES for the week being drafted. Leave type is deliberately not sent, so an absence cannot be read as sickness.',
    region: 'United States. The default model is openai/gpt-4o-mini.',
    outsideUkEu: true,
    evidence: 'supabase/functions/ai-rota-assistant/index.ts',
    optOut:
      'Yes, and it is the default. The assistant’s two deterministic tabs make no network call at all — they read rows the organisation already has. An organisation that never opens “Ask AI” never sends anything to OpenRouter, and the feature is included only with the Business and Enterprise plans.',
  },
  {
    name: 'Stripe',
    purpose: 'Subscription checkout, the billing portal, and payment processing.',
    personalData:
      'Billing identity for whoever pays: the email address and card details they enter on Stripe’s own checkout page, plus the organisation id and plan code we attach. Staff records are never sent.',
    region: 'United States, with global processing.',
    outsideUkEu: true,
    evidence: 'supabase/functions/create-checkout-session/index.ts',
    optOut:
      'Not while subscribing. Nothing reaches Stripe for an organisation that has not started checkout.',
  },
  {
    name: 'Supabase',
    purpose:
      'The database, authentication, file storage and the server functions. This is where the product’s data lives.',
    personalData:
      'Everything the product holds: staff records, rotas, clock-in events including GPS, leave, documents and the audit log.',
    region: 'European Union — eu-west-1, Ireland.',
    outsideUkEu: false,
    evidence: 'Supabase project region, eu-west-1',
    optOut: null,
  },
  {
    name: 'Sentry',
    purpose: 'Error monitoring, so a crash is noticed without a customer reporting it.',
    personalData:
      'Whatever appears in an error: the signed-in user’s id, the page they were on, and the technical detail of the failure.',
    region: 'European Union — the EU ingest region, fixed when the account was created.',
    outsideUkEu: false,
    evidence: 'src/lib/sentry.ts, VITE_SENTRY_DSN',
    optOut: null,
  },
  {
    name: 'ImageKit',
    purpose: 'Hosting and delivery of uploaded images, such as staff photos.',
    personalData: 'Uploaded images, which for a staff photo is a photograph of a person.',
    region: 'United Kingdom.',
    outsideUkEu: false,
    evidence: 'VITE_IMAGEKIT_URL_ENDPOINT',
    optOut: 'Yes. Nothing is sent unless someone uploads an image.',
  },
  {
    name: 'Inngest',
    purpose: 'Dispatching background and scheduled work, such as notifications.',
    personalData:
      'The recipient user ids and the notification’s own title and body. No staff record is sent.',
    region: 'Determined by the Inngest account; not independently verified here.',
    outsideUkEu: false,
    evidence: 'src/services/notificationDispatchService.ts',
    optOut: null,
  },
  {
    name: 'Namecheap / cPanel hosting',
    purpose:
      'Serving the application itself — a static bundle — and the outbound mail for password resets and invitations.',
    personalData:
      'Email addresses and the content of the messages we send to them. The application files themselves contain no customer data.',
    region: 'United Kingdom — premium17.web-hosting.com.',
    outsideUkEu: false,
    evidence: 'docs/DEPLOYMENT.md',
    optOut: null,
  },
  {
    name: 'Cloudflare',
    purpose: 'DNS, TLS and the proxy in front of the site.',
    personalData:
      'Connection metadata for anyone visiting: IP address, request headers, and the pages requested.',
    region: 'Global edge network.',
    outsideUkEu: false,
    evidence:
      'Cloudflare zone configuration; every request reaches the origin through it.',
    optOut: null,
  },
];

/** The date the list above was last checked against the code, not last edited. */
export const SUB_PROCESSORS_REVIEWED = '30 August 2026';
