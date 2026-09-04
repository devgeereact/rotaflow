import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { FinalCta } from '@/components/marketing/FinalCta';

/**
 * `/about`.
 *
 * No invented founding date, headcount, funding round or office. RotaFlow is a
 * small, pre-launch UK product and the page says so, a prospective buyer in
 * care or hospitality is choosing who holds their staff records, and finding
 * out later that the "50-person team" was one person is a worse outcome than
 * being told up front.
 */

const PRINCIPLES = [
  {
    title: 'A wrong number is worse than no number',
    body: 'Timesheets drive pay. Where clock events are ambiguous — a missing clock-out, an unclosed break — RotaFlow shows the reading the evidence supports and flags it for a human, rather than quietly guessing and presenting the guess as a fact.',
  },
  {
    title: 'It has to work with no signal',
    body: 'Care homes have dead zones, warehouses have thick walls, and a carer should not have to walk outside to clock in. Attendance is written to the device first and synced after, and anything the server rejects is shown to the person, never silently dropped.',
  },
  {
    title: 'Tenants are separated by the database',
    body: 'Every organisation’s data is isolated by row-level security in Postgres, not by a filter in application code. It is the boundary that holds even when application code has a bug, which it eventually will.',
  },
  {
    title: 'Say what is not built',
    body: 'The features list only carries what works today, the pricing page says billing is not live, and this site publishes a build-status page. Overstating a pre-launch product buys one signup and loses the customer.',
  },
];

const FACTS = [
  { label: 'Stage', value: 'Pre-launch beta' },
  { label: 'Based in', value: 'United Kingdom' },
  { label: 'Data held in', value: 'EU region, managed Postgres' },
  { label: 'Built for', value: 'UK employment practice and GDPR' },
];

export function AboutPage(): JSX.Element {
  return (
    <MarketingLayout title="About">
      <PageHero
        eyebrow="About"
        heading="Scheduling software for people who run shifts"
        body="RotaFlow is a small, independent UK product built around one belief: the software that decides when someone works, and what they get paid, should be held to a higher standard than most of it is."
      />

      <section className="mx-auto max-w-3xl px-6 py-20">
        <div className="space-y-5 text-lg leading-relaxed text-content-muted dark:text-content-muted-dark">
          <p>
            Most shift rotas still live in a spreadsheet. One person owns the file, the
            version on the wall is already out of date, leave gets approved in a WhatsApp
            thread and nobody is certain who is actually on tonight. At month end,
            somebody re-keys paper timesheets into payroll and hopes.
          </p>
          <p>
            None of that is a technology problem. It is a problem of information living in
            five places at once. RotaFlow puts it in one: build the rota, publish it, let
            staff request and swap against it, record attendance where it actually
            happens, and produce the timesheet from that record rather than from what the
            rota said should have happened.
          </p>
          <p>
            It is built as a{' '}
            <strong className="font-semibold text-content dark:text-content-dark">
              progressive web app
            </strong>{' '}
            for a specific reason. The people who use it most are not at a desk. They are
            on a ward, on a shop floor, or in a stairwell with no signal. RotaFlow
            installs to a phone without an app store, and keeps working when the
            connection does not.
          </p>
        </div>
      </section>

      <section className="border-y border-surface-border bg-surface-subtle py-20 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-12 text-center font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
            How we build it
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {PRINCIPLES.map(({ title, body }) => (
              <Card key={title} className="h-full">
                <h3 className="font-display text-lg font-semibold text-content dark:text-content-dark">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                  {body}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="mb-10 text-center font-display text-2xl font-bold text-content md:text-3xl dark:text-content-dark">
          Where things stand
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map(({ label, value }) => (
            <div
              key={label}
              className="rounded-2xl border border-surface-border bg-surface p-5 text-center shadow-sm dark:border-surface-border-dark dark:bg-surface-dark"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
                {label}
              </dt>
              <dd className="mt-1.5 font-display font-semibold text-content dark:text-content-dark">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mx-auto mt-10 max-w-2xl text-center leading-relaxed text-content-muted dark:text-content-muted-dark">
          RotaFlow has not launched publicly, so it has no customer count to quote and no
          testimonials to show. What it has is a working product you can sign up for
          today, and a{' '}
          <Link
            to="/resources"
            className="rounded font-medium text-primary-ink dark:text-primary-ink-dark underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            published list of what is and is not built
          </Link>
          .
        </p>

        <div className="mt-9 flex justify-center">
          <Link to="/contact">
            <Button size="lg" variant="secondary">
              Talk to us
              <ArrowRight size={18} aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </section>

      <FinalCta />
    </MarketingLayout>
  );
}
