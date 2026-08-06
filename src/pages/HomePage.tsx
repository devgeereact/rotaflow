import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Button } from '@/components/ui/Button';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ProductPreview } from '@/components/marketing/ProductPreview';
import { BenefitGrid } from '@/components/marketing/BenefitGrid';
import { SectorGrid } from '@/components/marketing/SectorGrid';
import { StatsBand } from '@/components/marketing/StatsBand';
import { WhyChooseBand } from '@/components/marketing/WhyChooseBand';
import { TestimonialBand } from '@/components/marketing/TestimonialBand';
import { FinalCta } from '@/components/marketing/FinalCta';
import { HERO, TAGLINE } from '@/lib/marketing';

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
  const { user } = useSupabaseAuth();

  return (
    <MarketingLayout title={TAGLINE}>
      <section className="overflow-hidden pb-28 pt-16 md:pt-24">
        {/*
          Entrance animation is the CSS `fade-up` keyframe, not framer-motion.
          framer starts the element at `opacity: 0` and only reveals it once its
          animation runs, so anything that stops that, a slow parse on a phone,
          blocked JS, a crawler that does not execute it, or a headless render. Leaves the single most important block of copy on the site invisible.
          That is exactly what happened here, and it was caught by screenshotting
          the page rather than by any gate.

          The Tailwind keyframe uses `both` fill mode, so the browser paints the
          final state with no JS at all, and `motion-reduce` drops it entirely
          for anyone who has asked for less movement.
        */}
        <div className="mx-auto max-w-3xl animate-fade-up px-6 text-center motion-reduce:animate-none">
          <p className="mb-5 inline-block rounded-full border border-surface-border bg-surface px-3.5 py-1.5 text-sm text-content-muted dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark">
            {TAGLINE}
          </p>
          <h1 className="font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-content sm:text-5xl md:text-6xl dark:text-content-dark">
            {HERO.headline.map((line, i) => (
              <span key={line} className="block">
                {i === HERO.headline.length - 1 ? (
                  <span className="text-primary">{line}</span>
                ) : (
                  line
                )}
              </span>
            ))}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-content-muted dark:text-content-muted-dark">
            {HERO.body}
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {user ? (
              <Link to="/app/dashboard">
                <Button size="lg">
                  Go to dashboard
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/signup">
                  <Button size="lg">
                    Start free trial
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button size="lg" variant="secondary">
                    Book a demo
                  </Button>
                </Link>
              </>
            )}
          </div>

          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-content-muted dark:text-content-muted-dark">
            {HERO.trust.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>

        <div className="mt-16">
          <ProductPreview />
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
