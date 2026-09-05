import type { ReactNode } from 'react';
import { PublicNav } from '@/components/marketing/PublicNav';
import { PublicFooter } from '@/components/marketing/PublicFooter';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import { SkipLink } from '@/components/layout/SkipLink';

interface MarketingLayoutProps {
  /**
   * The page's own title. Every marketing route is separately linkable and
   * shareable. The description, canonical URL and social tags come from
   * `src/lib/publicRoutes.ts` keyed on the path, so they cannot be forgotten
   * per page the way a prop can.
   */
  title: string;
  /** Ask crawlers not to index this page. The 404 is the only caller. */
  noindex?: boolean;
  children: ReactNode;
}

/**
 * Nav + content + footer for every public marketing route.
 *
 * The metadata lives here rather than in each page because seven routes
 * sharing one `<title>` is exactly the sort of thing that survives review: it
 * is invisible on screen and only shows up in a browser tab, a bookmark or a
 * shared link. Since 2026-09-02 that is `usePageMetadata`, which also writes
 * the description, the canonical URL and the Open Graph and Twitter tags —
 * none of which existed anywhere in this repository before then.
 */
export function MarketingLayout({
  title,
  noindex,
  children,
}: MarketingLayoutProps): JSX.Element {
  usePageMetadata({ title, noindex });

  return (
    <div className="flex min-h-screen flex-col bg-background dark:bg-background-dark">
      <SkipLink />
      <PublicNav />
      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

interface PageHeroProps {
  eyebrow: string;
  heading: string;
  body: string;
  children?: ReactNode;
}

/** Standard heading block for the inner marketing pages. */
export function PageHero({
  eyebrow,
  heading,
  body,
  children,
}: PageHeroProps): JSX.Element {
  return (
    <section className="border-b border-surface-border bg-surface dark:border-surface-border-dark dark:bg-surface-dark">
      <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary-ink dark:text-primary-ink-dark">
          {eyebrow}
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-content md:text-5xl dark:text-content-dark">
          {heading}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-content-muted dark:text-content-muted-dark">
          {body}
        </p>
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}
