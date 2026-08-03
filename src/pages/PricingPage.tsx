import { Link } from 'react-router-dom';
import { Check, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { PLANS } from '@/lib/marketing';
import { cn } from '@/lib/utils';

/**
 * `/pricing`.
 *
 * **No payment provider is integrated.** `subscriptions` is an empty seam —
 * `docs/SCREENS.md` §3 records that nothing reads or writes it, and the billing
 * Edge Functions it references were never built. So nothing on this page can
 * charge anyone, and the page says so in the banner rather than implying a card
 * will be taken at the end of a trial.
 *
 * Every plan CTA routes to `/signup` or `/contact` — real destinations. A
 * "Subscribe" button that opens a checkout which does not exist would be the
 * single worst dead button on the site.
 */

const FAQS = [
  {
    q: 'How does billing work during the beta?',
    a: 'It does not. RotaFlow has no payment provider connected, so no card is collected at signup and nothing can be charged. Prices below are what the plans will cost when billing goes live; you will be told before that happens.',
  },
  {
    q: 'What counts as a staff member?',
    a: 'Anyone with an active membership in your organisation who can be scheduled. Deactivated people and pending invitations do not count.',
  },
  {
    q: 'What happens at the end of the trial?',
    a: 'Nothing is deleted and nothing is charged. Your organisation stays as it is; when billing goes live you choose a plan or continue on Starter.',
  },
  {
    q: 'Can we move between plans?',
    a: 'Yes, in either direction. Staff and location limits apply from the moment the plan changes; no data is removed if you move down.',
  },
  {
    q: 'Where is our data held?',
    a: 'In a managed Postgres database in the EU, isolated per organisation by row-level security. You can export any staff member’s full record, or anonymise it, at any time.',
  },
  {
    q: 'Do you offer a discount for charities?',
    a: 'Get in touch. RotaFlow is built for care and community organisations and we would rather have you on it than not.',
  },
];

export function PricingPage(): JSX.Element {
  return (
    <MarketingLayout title="Pricing">
      <PageHero
        eyebrow="Pricing"
        heading="Simple pricing, per person, per month"
        body="Start free while RotaFlow is in beta. No card, no sales call, and nothing to cancel."
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div
          role="note"
          className="mx-auto mb-12 flex max-w-3xl gap-3 rounded-2xl border border-info/30 bg-info/5 p-4"
        >
          <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <p className="text-sm leading-relaxed text-content dark:text-content-dark">
            <span className="font-semibold">Billing is not live yet.</span> RotaFlow is in
            beta and has no payment provider connected, so signing up collects no card
            details and nothing can be charged. The prices below are what the plans will
            cost when billing launches.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          {PLANS.map(({ name, price, cadence, summary, features, cta, featured }) => (
            <Card
              key={name}
              className={cn(
                'flex h-full flex-col',
                featured && 'border-primary shadow ring-1 ring-primary',
              )}
            >
              {/*
                The badge row is rendered on every card, not just the featured
                one — an empty span on the other two keeps all three headings,
                prices and feature lists on the same baseline. Rendering it
                only when `featured` pushed the Team card ~40px down and left
                the three cards visibly misaligned.
              */}
              <span
                aria-hidden={!featured}
                className="mb-4 h-6 self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase leading-4 tracking-wide text-primary empty:bg-transparent"
              >
                {featured ? 'Most popular' : ''}
              </span>

              <h2 className="font-display text-xl font-bold text-content dark:text-content-dark">
                {name}
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                {summary}
              </p>

              <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-4xl font-extrabold tracking-tight text-content dark:text-content-dark">
                  {price}
                </span>
                <span className="text-sm text-content-muted dark:text-content-muted-dark">
                  {cadence}
                </span>
              </p>

              <ul className="mt-6 flex-1 space-y-2.5 border-t border-surface-border pt-6 dark:border-surface-border-dark">
                {features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-sm">
                    <Check
                      size={16}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                    />
                    <span className="text-content dark:text-content-dark">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to={name === 'Enterprise' ? '/contact' : '/signup'}
                className="mt-7 block"
              >
                <Button variant={featured ? 'primary' : 'secondary'} className="w-full">
                  {cta}
                </Button>
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-surface-border bg-surface-subtle py-20 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="mb-10 text-center font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
            Questions
          </h2>

          <dl className="space-y-4">
            {FAQS.map(({ q, a }) => (
              <div
                key={q}
                className="rounded-2xl border border-surface-border bg-surface p-6 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark"
              >
                <dt className="font-display font-semibold text-content dark:text-content-dark">
                  {q}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                  {a}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
            Still deciding?{' '}
            <Link
              to="/contact"
              className="rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Ask us anything
            </Link>
            .
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
