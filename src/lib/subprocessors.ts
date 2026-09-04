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
 * is legal advice — `/legal/terms` carries the same warning about its own
 * commercial clauses. What a DPA needs in order to be signed, though, is
 * exactly this: an accurate, dated list of who the sub-processors are. So this
 * is the part that can honestly be built now.
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
      'What appears in an error: the stack trace, the path of the page it happened on, and the steps that led there. Console output is dropped and web addresses have their query strings removed before anything is sent, because a Supabase request carries its filter values — an email address, a staff id — in the query. The browser is never told who you are: `Sentry.setUser` is not called anywhere.',
    region: 'European Union — the EU ingest region, fixed when the account was created.',
    outsideUkEu: false,
    evidence: 'src/lib/sentry.ts, VITE_SENTRY_DSN',
    optOut:
      'Yes. Nothing is sent unless you turn on crash reporting, which is off until you do, and you can turn it off again from the Cookie Notice. Until 4 September 2026 this row was wrong in both directions: it claimed a user id that was never sent, and it did not mention the session replay and performance tracing that were.',
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
    region:
      'Global edge network. A request is normally served by the nearest location, which for a UK or EU visitor is in the UK or the EU, but the network is worldwide and the routing is not ours to control.',
    // Stays false, with the reasoning written down because the row used to
    // look self-contradictory: `false` beside a region reading "global edge
    // network".
    //
    // This flag means "personal data leaves the UK/EU to reach it". A proxied
    // request is served by the location nearest the visitor, so for the UK and
    // EU visitors this product has, it does not. What is true is that
    // Cloudflare is a US company operating a worldwide network, which raises a
    // transfer question this repository is not qualified to answer — so the
    // region field says so plainly, /legal/trust repeats it, and the Privacy
    // Notice lists it as needing a solicitor. Flagging it `true` instead would
    // put it in the "outside the UK and EU" list beside Stripe and OpenRouter,
    // where the page says both are in the United States and neither receives
    // anything unless you use the feature it powers. Cloudflare is neither.
    // A wrong grouping reads as more precise than an honest sentence, and is
    // worth less.
    outsideUkEu: false,
    evidence:
      'Cloudflare zone configuration; every request reaches the origin through it.',
    optOut: null,
  },
];

/**
 * Removed on 31 August 2026: **Inngest**. It was listed as dispatching
 * notifications, citing `src/services/notificationDispatchService.ts` as its
 * evidence — a file deleted when `0087` moved dispatch into Postgres triggers
 * and a `pg_cron` drain. So a published procurement document named a processor
 * that receives nothing, and proved it with a path that does not exist. That
 * is the failure mode the header rule above exists to prevent, and it survived
 * two weeks because nothing re-reads these paths.
 *
 * Errs in the customer's favour either way — over-declaring a processor is the
 * safe direction — but a list a reviewer can falsify in one `ls` is worth less
 * than one they cannot.
 */

/** The date the list above was last checked against the code, not last edited. */
export const SUB_PROCESSORS_REVIEWED = '4 September 2026';
