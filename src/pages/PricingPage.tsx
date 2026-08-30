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
 * This is a pre-signup, unauthenticated marketing page showing plans
 * hardcoded from `supabase/migrations/0023_commercials.sql` (the source
 * of truth; see `src/lib/marketing.ts` comment). Plan CTAs route to
 * `/signup` because no `orgId` exists yet — real checkout (via Edge
 * Function) happens in Settings > Billing, after an org is created.
 */

const FAQS = [
  {
    q: 'How does billing work?',
    a: "Sign up with no card required. Once your organisation exists, its owner picks a plan from Settings and pays through Stripe's secure checkout. Nothing is charged before that.",
  },
  {
    q: 'What counts as a staff member?',
    a: 'Anyone with an active membership in your organisation who can be scheduled. Deactivated people and pending invitations do not count.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Not yet — every plan is paid from the start. Create your organisation and explore it fully before choosing a plan; nothing is charged until you do.',
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
        heading="Simple, transparent monthly pricing"
        body="Join the beta with no card, no sales call and no payment setup."
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div
          role="note"
          className="mx-auto mb-12 flex max-w-3xl gap-3 rounded-2xl border border-info/30 bg-info/5 p-4"
        >
          <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <p className="text-sm leading-relaxed text-content dark:text-content-dark">
            <span className="font-semibold">No card required to sign up.</span> Signing up
            collects no payment details. You choose and pay for a plan afterwards, from
            your organisation's own Settings once it exists.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-4">
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
                one, an empty span on the others keeps all headings,
                prices and feature lists on the same baseline. Rendering it
                only when `featured` pushed the Professional card ~40px down and left
                the cards visibly misaligned.
              */}
              <span
                aria-hidden={!featured}
                className="mb-4 h-6 self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase leading-4 tracking-wide text-primary-ink dark:text-primary-ink-dark empty:bg-transparent"
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
              className="rounded font-medium text-primary-ink dark:text-primary-ink-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
