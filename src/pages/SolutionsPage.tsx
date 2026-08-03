import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { SectorGrid } from '@/components/marketing/SectorGrid';
import { FinalCta } from '@/components/marketing/FinalCta';

/**
 * `/solutions` — the same product, framed by sector.
 *
 * `SECTORS` in `src/lib/marketing.ts` carries the detail. What this page adds
 * is the honest framing: these are sectors RotaFlow is *designed for*, not
 * sectors it has customers in. No logos, no named accounts, no case studies —
 * none exist, and the sector page is where a pre-launch product is most tempted
 * to imply otherwise.
 */

const SHARED_PROBLEMS = [
  {
    problem: 'The rota lives in a spreadsheet',
    consequence:
      'One person owns the file, changes are made in three places, and the version on the wall is already out of date.',
    answer:
      'One rota, one source of truth, published to everyone at once and updated live.',
  },
  {
    problem: 'Nobody knows who is actually on shift',
    consequence:
      'Cover gaps are found when someone does not turn up, not when the rota is built.',
    answer:
      'Coverage per day and per department while you build, with open shifts shown as gaps.',
  },
  {
    problem: 'Leave and swaps happen over WhatsApp',
    consequence:
      'Approvals are lost in a thread, balances are guessed at, and the rota is never updated to match.',
    answer:
      'Requests, approvals and balances in one queue, and the rota updates when a swap is approved.',
  },
  {
    problem: 'Timesheets are re-keyed from paper',
    consequence:
      'Hours are transcribed by hand at month end, and an error is somebody’s pay.',
    answer:
      'Hours computed from real clock events, breaks deducted, ambiguity flagged for a human.',
  },
];

export function SolutionsPage(): JSX.Element {
  return (
    <MarketingLayout title="Solutions">
      <PageHero
        eyebrow="Solutions"
        heading="Built for the sectors that run on shifts"
        body="Healthcare, hospitality, retail, education, security and facilities management all schedule differently — but they break in the same four places. RotaFlow is built around those."
      >
        <Link to="/signup">
          <Button size="lg">
            Start free trial
            <ArrowRight size={18} aria-hidden="true" />
          </Button>
        </Link>
      </PageHero>

      <SectorGrid />

      <section className="border-y border-surface-border bg-surface-subtle py-20 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
              What every sector has in common
            </h2>
            <p className="mt-3 text-content-muted dark:text-content-muted-dark">
              Whatever the industry, shift scheduling fails in a small number of
              predictable ways.
            </p>
          </div>

          <div className="space-y-4">
            {SHARED_PROBLEMS.map(({ problem, consequence, answer }) => (
              <Card key={problem} className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-danger">
                    The problem
                  </p>
                  <p className="mt-1.5 font-display font-semibold text-content dark:text-content-dark">
                    {problem}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                    What it costs
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                    {consequence}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-success">
                    In RotaFlow
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                    {answer}
                  </p>
                </div>
              </Card>
            ))}
          </div>

          <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-content-muted dark:text-content-muted-dark">
            Working in a sector that is not listed? If your team works shifts, RotaFlow
            almost certainly fits —{' '}
            <Link
              to="/contact"
              className="rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              tell us how you schedule
            </Link>
            .
          </p>
        </div>
      </section>

      <FinalCta
        heading="See it against your own rota"
        body="Create an organisation, add your sites, and build a real week — it takes about ten minutes."
      />
    </MarketingLayout>
  );
}
