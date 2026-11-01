import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ProductPreview } from '@/components/marketing/ProductPreview';
import { BenefitGrid } from '@/components/marketing/BenefitGrid';
import { SectorGrid } from '@/components/marketing/SectorGrid';
import { StatsBand } from '@/components/marketing/StatsBand';
import { WhyChooseBand } from '@/components/marketing/WhyChooseBand';
import { TestimonialBand } from '@/components/marketing/TestimonialBand';
import { FinalCta } from '@/components/marketing/FinalCta';
import { HERO, PRIMARY_CTA, TAGLINE } from '@/lib/marketing';
import { BOOK_DEMO_PATH, JOIN_BETA_PATH } from '@/lib/enquiry';

/**
 * `/`. The public marketing homepage.
 *
 * Copy is deliberately conservative: RotaFlow is a real, pre-launch product and
 * this is the first thing a prospective organisation sees. No fabricated stats,
 * testimonials or customer logos. None exist yet, and inventing them is both
 * worse than a page that undersells slightly and a CAP Code breach on a live
 * site. `src/lib/marketing.ts` holds every word of copy and states the rule.
 */
export function HomePage(): JSX.Element {
  const { user } = useAuth();

  return (
    <MarketingLayout title={TAGLINE}>
      <section className="overflow-hidden pb-16 pt-16 md:pb-20 md:pt-24">
        {/*
          The hero copy enters on the CSS `fade-up` keyframe, one line after
          another, never through GSAP. A JS animation library starts an element
          at `opacity: 0` and only reveals it once its animation runs, so
          anything that stops that, a slow parse on a phone, blocked JS, a
          crawler that does not execute it, or a headless render, leaves the
          single most important block of copy on the site invisible. That is
          exactly what happened here with framer-motion, and it was caught by
          screenshotting the page rather than by any gate.

          The keyframe uses `both` fill mode, so the browser paints the final
          state with no JS at all, and `motion-reduce` drops it entirely for
          anyone who has asked for less movement. GSAP and Lenis
          (`components/marketing/motion`) arrive after first paint and only
          touch what is still below the fold. docs/DESIGN-SYSTEM.md §4.

          From `xl` the copy and the product shot sit side by side, copy on the
          left, as `docs/design/marketting.png` lays them out. Below `xl` the
          right-hand column would squeeze the rota grid's seven day columns, so
          the shot stacks under centred copy (2026-10-22 design-match pass).
        */}
        <div className="mx-auto max-w-6xl px-6 xl:grid xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] xl:items-center xl:gap-10">
          <div className="mx-auto max-w-3xl text-center xl:mx-0 xl:max-w-none xl:text-left">
            <p className="mb-5 inline-block animate-fade-up rounded-full motion-reduce:animate-none border border-surface-border bg-surface px-3.5 py-1.5 text-sm text-content-muted dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark">
              {HERO.eyebrow}
            </p>
            <h1 className="animate-fade-up font-display text-4xl [animation-delay:80ms] motion-reduce:animate-none font-medium leading-[1.1] tracking-tight text-content sm:text-5xl sm:leading-none md:text-6xl dark:text-content-dark">
              {HERO.headline}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl animate-fade-up xl:mx-0 text-lg [animation-delay:160ms] motion-reduce:animate-none leading-relaxed text-content-muted dark:text-content-muted-dark">
              {HERO.body}
            </p>

            <div className="mt-9 flex animate-fade-up flex-col items-center [animation-delay:240ms] motion-reduce:animate-none justify-center gap-3 sm:flex-row xl:justify-start">
              {user ? (
                <Link to="/app/dashboard">
                  <Button size="lg">
                    Go to dashboard
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to={JOIN_BETA_PATH}>
                    <Button size="lg">
                      {PRIMARY_CTA}
                      <ArrowRight size={18} aria-hidden="true" />
                    </Button>
                  </Link>
                  <Link to={BOOK_DEMO_PATH}>
                    <Button size="lg" variant="secondary">
                      Book a demo
                    </Button>
                  </Link>
                </>
              )}
            </div>

            <ul className="mt-6 flex animate-fade-up flex-wrap items-center [animation-delay:320ms] motion-reduce:animate-none justify-center gap-x-6 gap-y-2 xl:justify-start text-sm text-content-muted dark:text-content-muted-dark">
              {HERO.trust.map((point) => (
                <li key={point} className="flex items-center gap-1.5 whitespace-nowrap">
                  <Check
                    size={16}
                    aria-hidden="true"
                    className="text-success-ink dark:text-success-ink-dark"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 xl:mt-0">
            <ProductPreview />
          </div>
        </div>
      </section>

      <StatsBand />
      <BenefitGrid />
      <SectorGrid variant="compact" />
      <WhyChooseBand />
      <TestimonialBand />
      <FinalCta />
    </MarketingLayout>
  );
}
