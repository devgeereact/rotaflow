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

import type { ConsentCategory } from '@/lib/consent';

export interface StoredItem {
  key: string;
  purpose: string;
  /** How long it survives, in words a reader can act on. */
  lifetime: string;
  /**
   * Which consent category owns it (`src/lib/consent.ts`).
   *
   * The cookie table and the consent panel are both built from this list, so
   * they cannot disagree about what is essential — a notice that says one
   * thing while the toggle does another is the failure worth designing out.
   */
  category: ConsentCategory;
  /** Where in the code this is set, so the claim can be checked. */
  source: string;
}

/**
 * Everything RotaFlow puts in a browser.
 *
 * There are **no cookies**, no analytics and no advertising. Everything below
 * is `localStorage`, `sessionStorage`, IndexedDB or Cache Storage on this
 * device.
 *
 * Cache Storage was added to this list on 5 September 2026 and is the reason
 * the sentence above names four stores rather than three. The four buckets the
 * service worker writes were undeclared, while the page built from this list
 * said it showed everything kept on the device. Two of them, `supabase-api`
 * and `imagekit-media`, hold more personal data than anything else here: rows
 * of an organisation's rota and staff, and staff photographs. They were missed
 * because the service worker is generated from `vite.config.ts`, so a sweep of
 * storage writes in `src/` cannot see it. When you check this list, read
 * `vite.config.ts` too.
 *
 * Two entries were missing from this list until 4 September 2026 — the
 * onboarding draft, which holds an organisation name and a site postal
 * address, and the install-prompt snooze. Both were being written and neither
 * was declared. The rule the header sets is that this list is verified by
 * reading every storage write in `src/`; that rule was right and it had simply
 * not been re-run.
 */
export const STORED_ITEMS: readonly StoredItem[] = [
  {
    key: 'Supabase session',
    purpose:
      'Keeps you signed in between visits. Without it you would sign in again on every page load.',
    lifetime: 'Until you sign out, or the session expires.',
    category: 'necessary',
    source: 'src/lib/supabase.ts',
  },
  {
    key: 'rotaflow:activeOrgId',
    purpose:
      'Which organisation you were last looking at, so the app opens where you left it when you belong to more than one.',
    lifetime: 'Until you sign out.',
    category: 'necessary',
    source: 'src/lib/session.ts',
  },
  {
    key: 'rotaflow:consent',
    purpose:
      'Your answer to the storage question on this page, and the date you gave it. Without it you would be asked again on every visit.',
    lifetime: 'Until you clear site data, or change your answer.',
    category: 'necessary',
    source: 'src/lib/consent.ts',
  },
  {
    key: 'rotaflow:onboarding-draft (session only)',
    purpose:
      'The organisation name and site address you typed on the first onboarding step, so a refresh does not lose them. Cleared the moment onboarding finishes.',
    lifetime: 'Until onboarding completes, or you close the tab.',
    category: 'necessary',
    source: 'src/pages/OnboardingPage.tsx',
  },
  {
    key: 'Offline queue (IndexedDB)',
    purpose:
      'Clock-ins, leave requests and swaps made without a signal, held on the device until they can be sent.',
    lifetime: 'Until the entry syncs, or you discard it.',
    category: 'necessary',
    source: 'src/services/syncQueue.ts',
  },
  {
    key: 'pwa-theme',
    purpose: 'Whether you chose light or dark.',
    lifetime: 'Until you clear site data.',
    category: 'preferences',
    source: 'src/context/ThemeContext.tsx',
  },
  {
    key: 'rotaflow.sidebar.collapsed',
    purpose: 'Whether you collapsed the sidebar.',
    lifetime: 'Until you clear site data.',
    category: 'preferences',
    source: 'src/components/layout/Sidebar.tsx',
  },
  {
    key: 'rotaflow:report-favourites, rotaflow:report-runs',
    purpose:
      'Which reports you starred and which you ran recently, so the Reports screen is useful on your second visit.',
    lifetime: 'Until you clear site data. Never leaves the device.',
    category: 'preferences',
    source: 'src/lib/reportPrefs.ts',
  },
  {
    key: 'rotaflow:installPromptSnoozedUntil',
    purpose:
      'That you dismissed the "install this app" banner, so it stops asking for thirty days.',
    lifetime: 'Thirty days from the dismissal.',
    category: 'preferences',
    source: 'src/lib/installPrompt.ts',
  },
  // The three Cache Storage buckets below were missing from this list until
  // 5 September 2026. The rule in the header is that the list is verified by
  // reading every storage write in `src/`, and these are written by the
  // service worker, which is generated from `vite.config.ts` and so sits
  // outside that sweep. They are also the two entries holding the most
  // personal data of anything on the device, which is the wrong pair to have
  // left undeclared under a heading that says "everything".
  {
    key: 'Cache Storage: rotaflow-precache',
    purpose:
      'The app itself: its code, styles and icons, so it opens with no signal. This is what makes RotaFlow usable on a ward or a site with no reception.',
    lifetime: 'Replaced when a new version is installed.',
    category: 'necessary',
    source: 'vite.config.ts (workbox globPatterns)',
  },
  {
    key: 'Cache Storage: supabase-api',
    purpose:
      'The most recent answers to up to 50 data requests, so a screen you have already opened can still show something when the network drops. It can therefore hold rota and staff information for your organisation.',
    lifetime: 'Five minutes, and signing out on this device clears it.',
    category: 'necessary',
    source: 'vite.config.ts (runtimeCaching), cleared by src/lib/session.ts',
  },
  {
    key: 'Cache Storage: imagekit-media',
    purpose:
      'Images the app has displayed, which includes staff profile photographs, so they do not download again on every visit.',
    lifetime: 'Thirty days, and signing out on this device clears it.',
    category: 'necessary',
    source: 'vite.config.ts (runtimeCaching), cleared by src/lib/session.ts',
  },
  {
    key: 'Cache Storage: rotaflow-fonts',
    purpose:
      'The four typeface files the interface uses. Self-hosted since 3 September 2026, so no request goes to a font service.',
    lifetime: 'One year.',
    category: 'necessary',
    source: 'vite.config.ts (runtimeCaching)',
  },
];

/**
 * The one thing that is not device storage but is still a choice.
 *
 * Crash reporting sends an error to Sentry rather than keeping anything here,
 * so it has no row in the table above — but it is a transfer to a processor,
 * and the consent panel offers it alongside the rest.
 */
export const DIAGNOSTICS_DISCLOSURE = {
  purpose:
    'When something goes wrong, send the error to Sentry so it can be fixed without waiting for somebody to report it.',
  detail:
    'A stack trace, the page path, and the steps that led to it. Console output is dropped and web addresses have their query strings removed before anything is sent. There is no session recording and no performance tracking — both were removed on 4 September 2026. Sentry processes in the EU.',
  source: 'src/lib/sentry.ts',
} as const;

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
      'The database is in the EU (Supabase, eu-west-1). Two things leave that region and both are named on the Trust page: billing identity goes to Stripe (US) when an organisation subscribes, and, only when a manager uses the AI assistant, the week being drafted goes to OpenRouter (US) for that one request. That is staff first and last names, job titles, skills, weekly hours and contract type, together with the organisation name, its site names, the shifts already on the rota and the dates of approved leave. Leave type is deliberately never sent, so an absence cannot be read as sickness. Nothing else leaves the region.',
  },
  {
    question: 'Is any of it sold, or used for advertising?',
    answer:
      'No. There is no advertising, no analytics, no advertising pixel and no tag manager, and nothing here profiles you or follows you to another site. One thing does leave the browser and is worth naming rather than glossing: if the app crashes, an error report goes to Sentry, and only if you agreed to that. You can change that answer at any time from the Cookie Notice.',
  },
  {
    question: 'How long is it kept?',
    answer:
      'Each kind of record has a retention period, enforced by a nightly job rather than by anybody remembering — clock events, audit entries, notifications and support cases each have their own. An organisation can see the schedule in its own settings.',
  },
  {
    question: 'Can it be exported or deleted?',
    answer:
      'Yes, though not by you on your own. An organisation can export everything it holds as one file and can delete the organisation entirely, and an individual can be anonymised in place, which keeps the rota history the business needs while removing the person from it. There is no self-service button for an individual: ask your employer, or write to us and we will handle it as a formal request.',
  },
  {
    question: 'Who is responsible for this notice?',
    answer:
      'Gideon Akinlotan, a sole trader based in the United Kingdom, trading as RotaFlow. The full notice below has the contact route and the complaint route, and says plainly which parts still need a lawyer before they can be relied on.',
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
export const LEGAL_FACTS_REVIEWED = '4 September 2026';
