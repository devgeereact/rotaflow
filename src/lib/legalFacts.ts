/**
 * The facts the legal pages are built from (CAP-060).
 *
 * ## Why these are data and not prose in a component
 *
 * The four legal routes rendered a placeholder saying the real text was
 * coming. That is honest on day one and misleading by month three — a live
 * public site with a Privacy page that says "this is a placeholder" is worse
 * than one with a short, accurate statement, because a prospective customer
 * reads it as "nobody has thought about this".
 *
 * Three of the four can be written as fact rather than as policy: what the
 * browser stores, where data goes, and how the product behaves for assistive
 * technology are things the code decides, and the code can be read. Terms of
 * Service cannot — it is a contract, it needs UK counsel, and that page still
 * says so.
 *
 * Keeping the facts here rather than in JSX means each one cites where it can
 * be checked, and a page that drifts from the system is a diff in one file
 * rather than a paragraph nobody re-reads.
 *
 * **This is not legal advice, and none of these pages claim to be.** They
 * describe what the software does. Where a statement is a commitment rather
 * than a description, it is marked as awaiting counsel instead of invented.
 */

export interface StoredItem {
  key: string;
  purpose: string;
  /** How long it survives, in words a reader can act on. */
  lifetime: string;
  /** Where in the code this is set, so the claim can be checked. */
  source: string;
}

/**
 * Everything RotaFlow puts in a browser.
 *
 * There are **no cookies**, no analytics, no advertising and no third-party
 * scripts. Everything below is `localStorage` on this device, which is why
 * the page can say plainly that there is nothing to consent to: none of it
 * is used to track anybody, and all of it is cleared by signing out or by
 * clearing site data.
 *
 * Verified by reading every `localStorage` key in `src/` — if that list
 * changes, this one has to change with it.
 */
export const STORED_ITEMS: readonly StoredItem[] = [
  {
    key: 'Supabase session',
    purpose:
      'Keeps you signed in between visits. Without it you would sign in again on every page load.',
    lifetime: 'Until you sign out, or the session expires.',
    source: 'src/lib/supabase.ts',
  },
  {
    key: 'rotaflow:activeOrgId',
    purpose:
      'Which organisation you were last looking at, so the app opens where you left it when you belong to more than one.',
    lifetime: 'Until you sign out.',
    source: 'src/lib/session.ts',
  },
  {
    key: 'pwa-theme',
    purpose: 'Whether you chose light or dark.',
    lifetime: 'Until you clear site data.',
    source: 'src/context/ThemeContext.tsx',
  },
  {
    key: 'rotaflow.sidebar.collapsed',
    purpose: 'Whether you collapsed the sidebar.',
    lifetime: 'Until you clear site data.',
    source: 'src/components/layout/Sidebar.tsx',
  },
  {
    key: 'rotaflow:report-favourites, rotaflow:report-runs',
    purpose:
      'Which reports you starred and which you ran recently, so the Reports screen is useful on your second visit.',
    lifetime: 'Until you clear site data. Never leaves the device.',
    source: 'src/lib/reportPrefs.ts',
  },
  {
    key: 'Offline queue (IndexedDB)',
    purpose:
      'Clock-ins, leave requests and swaps made without a signal, held on the device until they can be sent.',
    lifetime: 'Until the entry syncs, or you discard it.',
    source: 'src/services/syncQueue.ts',
  },
];

export interface DataFact {
  question: string;
  answer: string;
}

/**
 * The privacy statements that are descriptions rather than commitments.
 *
 * Each is checkable: the residency answers come from `docs/DATA_LIFECYCLE.md`
 * §"Where the data is", which was corrected when BUG-056 closed, and the
 * retention answers from the `retention_policies` table the nightly job
 * actually reads.
 */
export const PRIVACY_FACTS: readonly DataFact[] = [
  {
    question: 'Who is the data about?',
    answer:
      'People who work for an organisation using RotaFlow: their name, contact details, job title, the shifts they are rostered, the times they clock in and out including a location fix, leave and any documents their employer uploads.',
  },
  {
    question: 'Who decides how it is used?',
    answer:
      'The employer. RotaFlow is the processor and they are the controller — which means a question about why your data is held, or a request to correct it, goes to them first. We act on their instructions.',
  },
  {
    question: 'Where is it held?',
    answer:
      'The database is in the EU (Supabase, eu-west-1). Two things leave that region and both are named on the Trust page: billing identity goes to Stripe (US) when an organisation subscribes, and — only when a manager uses the AI assistant — first names, job titles, skills and contracted hours go to OpenRouter (US) for that request. Nothing else does.',
  },
  {
    question: 'Is any of it sold, or used for advertising?',
    answer:
      'No. There is no advertising, no analytics, no tracking, and no third-party script on this site.',
  },
  {
    question: 'How long is it kept?',
    answer:
      'Each kind of record has a retention period, enforced by a nightly job rather than by anybody remembering — clock events, audit entries, notifications and support cases each have their own. An organisation can see the schedule in its own settings.',
  },
  {
    question: 'Can it be exported or deleted?',
    answer:
      'Yes. An organisation can export everything it holds as one file, and can delete the organisation entirely. An individual can be anonymised in place, which keeps the rota history the business needs while removing the person from it.',
  },
];

/**
 * What has been done for accessibility, and what has not.
 *
 * The honest half matters more than the tidy half: a statement that claims
 * WCAG AA without saying what was tested is a claim nobody can check, and
 * the sort of thing a procurement review is right to distrust.
 */
export const ACCESSIBILITY_FACTS: readonly DataFact[] = [
  {
    question: 'What is tested automatically',
    answer:
      'Every public page and 26 signed-in screens are scanned for WCAG colour-contrast failures on every push, in both light and dark mode. The build fails if any appear. That gate found and fixed 367 real failures.',
  },
  {
    question: 'What that does not cover',
    answer:
      'An automated scan finds a minority of accessibility problems. Keyboard-only journeys, screen-reader announcements and focus order are checked by hand as screens are built, and have not been through a formal audit by a specialist. We would rather say that than imply a certification we do not hold.',
  },
  {
    question: 'What is deliberately built in',
    answer:
      'Colour is never the only signal — a status always has a word beside it. Controls are reachable by keyboard, dialogs trap focus and close on Escape, and every icon-only button carries a name for a screen reader.',
  },
  {
    question: 'If something is in your way',
    answer:
      'Tell us and we will fix it and say when. An access barrier in a rota is not a cosmetic issue: it is somebody unable to see when they are working.',
  },
];

/** Reviewed by a person on this date, and shown so a reader can judge staleness. */
export const LEGAL_FACTS_REVIEWED = '31 August 2026';
