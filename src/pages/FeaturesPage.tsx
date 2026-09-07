import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { BenefitGrid } from '@/components/marketing/BenefitGrid';
import { FinalCta } from '@/components/marketing/FinalCta';
import { PRIMARY_CTA } from '@/lib/marketing';

/**
 * `/features`. The product tour.
 *
 * Structured as the day-to-day loop a scheduling manager actually runs, because
 * that is how the product is evaluated: build the rota, publish it, staff
 * respond, hours come back, the numbers are reported. Every step below is a
 * screen that exists. Cross-checked against `docs/SCREENS.md` §2.
 */

const WORKFLOW = [
  {
    step: 'Build',
    title: 'Draft the week on a staff-by-day grid',
    body: 'Drag shifts onto the grid or auto-fill from last week. RotaFlow flags double-bookings, rest-period breaches, unavailability and missing qualifications while you build, with running labour hours and estimated cost as you go.',
    points: [
      'Weekly and daily views, per location and department',
      'Copy the previous week, or clear and start again',
      'Reusable shift types with their own colours',
      'Open shifts left unassigned and visible as gaps',
    ],
  },
  {
    step: 'Publish',
    title: 'Release it when it is ready, not before',
    body: 'A rota stays a draft while you move it around. Publishing shows exactly what is about to change — the date range, how many shifts, how many still open, and any unresolved conflicts — and then notifies the team.',
    points: [
      'Draft and published are genuinely separate states',
      'Staff only ever see what has been published',
      'Unpublish to pull a week back for changes',
      'Publishing history kept per week',
    ],
  },
  {
    step: 'Respond',
    title: 'Staff handle their own availability, leave and swaps',
    body: 'People submit availability before the rota is built, request leave against a live balance, and arrange swaps between themselves. All from a phone. Managers approve in one queue, and the rota updates itself.',
    points: [
      'Recurring and one-off availability',
      'Leave requests with entitlement and balance',
      'Shift swaps checked for coverage and rest',
      'Announcements to a site, a department or everyone',
    ],
  },
  {
    step: 'Track',
    title: 'Attendance that survives a dead zone',
    body: 'Clock in and out with GPS verification. With no signal the entry is written to the device and queued; when the connection returns it syncs on its own. Anything the server rejects is shown to the person rather than silently dropped.',
    points: [
      'GPS verification against the site',
      'Offline queue with a visible pending count',
      'Break start and end recorded',
      'Rejected entries surfaced, never discarded',
    ],
  },
  {
    step: 'Pay',
    title: 'Timesheets built from what actually happened',
    body: 'Hours come from real clock events, not from the rota. Scheduled against worked, breaks deducted, overtime split out, and any ambiguous day flagged for a human rather than guessed at.',
    points: [
      'Scheduled vs worked vs variance per person',
      'Unpaid breaks deducted automatically',
      'Missing clock-outs flagged, not invented',
      'Approve, reject or request a correction',
    ],
  },
  {
    step: 'Report',
    title: 'See the whole operation',
    body: 'Coverage, staffing levels, labour hours and cost, attendance, absence, leave, swaps and overtime. Filtered by date range, site and department, and exportable for payroll or a board pack.',
    points: [
      'Filter by period, location and department',
      'CSV export from any report',
      'Compliance and qualification expiry alerts',
      'Per-location performance comparison',
    ],
  },
];

const PLATFORM = [
  {
    title: 'Installs like an app',
    body: 'RotaFlow installs to a phone or tablet home screen straight from the browser, so there is no app store listing to maintain and no review to wait for.',
  },
  {
    title: 'Works offline',
    body: 'The whole interface is cached. Clock-ins, leave requests and swaps queue on the device and sync when a connection returns.',
  },
  {
    title: 'Multi-tenant by design',
    body: 'Each organisation is isolated at the database level by row-level security, so one tenant cannot read another even if application code has a bug.',
  },
  {
    title: 'Role-aware throughout',
    body: 'Owners, managers and staff see different navigation and different data. Permissions are enforced on the server, not just hidden in the interface.',
  },
  {
    title: 'Live updating',
    body: 'Approve a leave request and every open screen showing it updates, no refresh, no stale queue on somebody else’s monitor.',
  },
  {
    title: 'Accessible and keyboard-driven',
    body: 'Semantic markup, visible focus states, labelled forms, colour-independent status indicators and reduced-motion support throughout.',
  },
];

export function FeaturesPage(): JSX.Element {
  return (
    <MarketingLayout title="Features">
      <PageHero
        eyebrow="Features"
        heading="Everything scheduling touches, in one place"
        body="RotaFlow covers the full loop. Building the rota, publishing it, collecting what staff need, tracking attendance, producing the timesheet and reporting on all of it."
      >
        <Link to="/signup">
          <Button size="lg">
            {PRIMARY_CTA}
            <ArrowRight size={18} aria-hidden="true" />
          </Button>
        </Link>
      </PageHero>

      <BenefitGrid
        heading="The eight things RotaFlow does"
        body="Each maps to a screen that is built and working today."
      />

      <section className="border-y border-surface-border bg-surface-subtle py-20 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
              How a week runs in RotaFlow
            </h2>
            <p className="mt-3 text-content-muted dark:text-content-muted-dark">
              The same loop every scheduling manager already runs, with the manual parts
              removed.
            </p>
          </div>

          <ol className="space-y-6">
            {WORKFLOW.map(({ step, title, body, points }, i) => (
              <li key={step}>
                <Card className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <div className="mb-3 flex items-center gap-3">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-fg">
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-primary-ink dark:text-primary-ink-dark">
                        {step}
                      </span>
                    </div>
                    <h3 className="font-display text-xl font-semibold text-content dark:text-content-dark">
                      {title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                      {body}
                    </p>
                  </div>

                  <ul className="space-y-2.5 md:border-l md:border-surface-border md:pl-6 md:dark:border-surface-border-dark">
                    {points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-sm">
                        <Check
                          size={16}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-success"
                        />
                        <span className="text-content dark:text-content-dark">
                          {point}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
            And how it is built
          </h2>
          <p className="mt-3 text-content-muted dark:text-content-muted-dark">
            The parts that do not show up in a feature list but decide whether the product
            survives a real shift.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM.map(({ title, body }) => (
            <Card key={title} className="h-full">
              <h3 className="mb-1.5 font-display text-base font-semibold text-content dark:text-content-dark">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                {body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <FinalCta />
    </MarketingLayout>
  );
}
