import { useRef, type ReactNode, type JSX } from 'react';
import { PublicNav } from '@/components/marketing/PublicNav';
import { PublicFooter } from '@/components/marketing/PublicFooter';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import { SkipLink } from '@/components/layout/SkipLink';
import { useMarketingMotion } from '@/components/marketing/motion/useMarketingMotion';

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
 *
 * Scroll motion starts here too, and only here: the app shell never mounts
 * this layout, so GSAP and Lenis cannot reach an authenticated screen.
 */
export function MarketingLayout({
  title,
  noindex,
  children,
}: MarketingLayoutProps): JSX.Element {
  usePageMetadata({ title, noindex });
  const rootRef = useRef<HTMLDivElement>(null);
  useMarketingMotion(rootRef);

  return (
    <div
      ref={rootRef}
      className="flex min-h-screen flex-col bg-background dark:bg-background-dark"
    >
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

/**
 * Standard heading block for the inner marketing pages.
 *
 * The three lines enter one after another on the CSS `fade-up` keyframe, the
 * same visible-without-JavaScript entrance as the home hero.
 */
export function PageHero({
  eyebrow,
  heading,
  body,
  children,
}: PageHeroProps): JSX.Element {
  return (
    <section className="border-b border-surface-border bg-surface dark:border-surface-border-dark dark:bg-surface-dark">
      <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
        <p className="mb-3 animate-fade-up text-sm font-medium uppercase tracking-wide text-primary-ink motion-reduce:animate-none dark:text-primary-ink-dark">
          {eyebrow}
        </p>
        <h1 className="animate-fade-up font-display text-3xl font-medium tracking-tight text-content [animation-delay:80ms] motion-reduce:animate-none md:text-5xl dark:text-content-dark">
          {heading}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl animate-fade-up text-lg leading-relaxed text-content-muted [animation-delay:160ms] motion-reduce:animate-none dark:text-content-muted-dark">
          {body}
        </p>
        {children && (
          <div className="mt-8 animate-fade-up [animation-delay:240ms] motion-reduce:animate-none">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
