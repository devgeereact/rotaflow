/**
 * Every page a logged-out visitor can reach, with the words a search engine
 * and a link preview will show.
 *
 * ## Why this file exists
 *
 * Before it, `index.html` carried ONE `<title>` and ONE `<meta description>`
 * for all fourteen public pages, and `MarketingLayout` overwrote
 * `document.title` after React mounted. There was no `<link rel="canonical">`,
 * no Open Graph and no Twitter card anywhere in the repository, and
 * `sitemap.xml` did not exist — the URL answered 200 because the SPA fallback
 * served `index.html`, which is the failure mode `docs/DEPLOYMENT.md` warns
 * about twice: an HTTP 200 is not evidence that a file deployed.
 *
 * One list, three consumers, so they cannot drift:
 *
 *   1. `vite.config.ts` writes `dist/sitemap.xml` from the `sitemap: true`
 *      entries at build time.
 *   2. `MarketingLayout` and `AuthSplitLayout` set the title, description and
 *      canonical for the route being rendered.
 *   3. `navigationTargets.test.ts` asserts every path here has a real
 *      `<Route>` in `App.tsx`, the same way it guards the settings tabs — a
 *      sitemap advertising a URL that renders the 404 page is worse than no
 *      sitemap.
 *
 * ## The rule for descriptions
 *
 * They describe what the page contains. `src/lib/marketing.ts` explains at
 * length why this product does not publish traction it does not have; the
 * same applies here, where the claim is repeated by every search result.
 */

export interface PublicRoute {
  /** Must match a `<Route path>` in `App.tsx`. */
  path: string;
  /** Rendered as `<title>` with the brand appended, and as `og:title`. */
  title: string;
  /** Under 160 characters, so it is not truncated mid-sentence in a result. */
  description: string;
  /**
   * Whether the page belongs in `sitemap.xml`. False for the ones that exist
   * to be arrived at rather than found: a password-reset form has nothing to
   * offer a search result, and listing it invites crawlers to hammer an auth
   * endpoint.
   */
  sitemap: boolean;
  /** Relative weight within this site only. Ignored by most crawlers. */
  priority?: number;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: '/',
    title: 'Scheduling certainty for every shift',
    description:
      'UK-first workforce scheduling for shift-based teams. Build rotas, manage leave and swaps, track attendance, and keep working when the signal drops.',
    sitemap: true,
    priority: 1.0,
  },
  {
    path: '/features',
    title: 'Features',
    description:
      'Rota building, leave and swaps, GPS clock-in, timesheets, announcements and reporting — with an offline mode that queues work until the signal returns.',
    sitemap: true,
    priority: 0.9,
  },
  {
    path: '/solutions',
    title: 'Solutions',
    description:
      'How RotaFlow fits care, hospitality, retail, security, cleaning and logistics — six sectors that share one problem: the rota changes after it is published.',
    sitemap: true,
    priority: 0.8,
  },
  {
    path: '/pricing',
    title: 'Pricing',
    description:
      'Four plans from £29 a month, priced per organisation rather than per seat. No credit card to start, and no payment setup during the beta.',
    sitemap: true,
    priority: 0.9,
  },
  {
    path: '/resources',
    title: 'Resources',
    description:
      'Guides to setting up an organisation, inviting staff, publishing a first rota, and what is built so far — kept in step with the product rather than ahead of it.',
    sitemap: true,
    priority: 0.6,
  },
  {
    path: '/about',
    title: 'About',
    description:
      'Who builds RotaFlow, what it is for, and why a rota product is judged on the week it gets wrong rather than the week it gets right.',
    sitemap: true,
    priority: 0.5,
  },
  {
    path: '/contact',
    title: 'Contact',
    description:
      'Ask a question about RotaFlow, request a walkthrough, or report a problem. Messages reach a person, not a queue.',
    sitemap: true,
    priority: 0.5,
  },
  {
    path: '/legal/privacy',
    title: 'Privacy',
    description:
      'What personal data RotaFlow holds on staff and administrators, why, where it is stored, how long it is kept, and how to have it erased.',
    sitemap: true,
    priority: 0.3,
  },
  {
    path: '/legal/terms',
    title: 'Terms of Service',
    description: 'The terms on which RotaFlow is provided during the beta.',
    sitemap: true,
    priority: 0.3,
  },
  {
    path: '/legal/cookies',
    title: 'Cookie Notice',
    description:
      'What RotaFlow stores in your browser, why each item is there, and what happens if you clear it. There is no advertising or cross-site tracking.',
    sitemap: true,
    priority: 0.3,
  },
  {
    path: '/legal/accessibility',
    title: 'Accessibility',
    description:
      'RotaFlow is built to WCAG 2 AA and tested on every public page in CI. What that covers, what it does not yet, and how to report a barrier.',
    sitemap: true,
    priority: 0.3,
  },
  {
    path: '/legal/trust',
    title: 'Trust and sub-processors',
    description:
      'Where RotaFlow data lives, which sub-processors handle it and what each one does, how to report a vulnerability, and what happens when something breaks.',
    sitemap: true,
    priority: 0.4,
  },
  {
    path: '/login',
    title: 'Sign in',
    description: 'Sign in to your RotaFlow organisation.',
    sitemap: true,
    priority: 0.4,
  },
  {
    path: '/signup',
    title: 'Create an account',
    description:
      'Create a RotaFlow organisation and build your first rota. No credit card, and no payment setup during the beta.',
    sitemap: true,
    priority: 0.7,
  },
  {
    path: '/forgot-password',
    title: 'Reset your password',
    description:
      'Send a password reset link to the email address on your RotaFlow account.',
    sitemap: false,
  },
  {
    path: '/reset-password',
    title: 'Choose a new password',
    description: 'Set a new password for your RotaFlow account.',
    sitemap: false,
  },
] as const;

/** The metadata for a path, or undefined if it is not a public page. */
export function publicRouteFor(pathname: string): PublicRoute | undefined {
  return PUBLIC_ROUTES.find((route) => route.path === pathname);
}
