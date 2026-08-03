import { Link } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  CircleDashed,
  Clock3,
  Hammer,
  LifeBuoy,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { MarketingLayout, PageHero } from '@/components/marketing/MarketingLayout';
import { FinalCta } from '@/components/marketing/FinalCta';

/**
 * `/resources`.
 *
 * A resources page normally carries a blog, webinars, case studies and
 * whitepapers. RotaFlow has none of those, and stubbing them out would produce
 * exactly the "empty placeholder page" the brief rules out.
 *
 * So it carries what genuinely exists and is useful to someone evaluating the
 * product: how to get set up, what is built today, and what is not. The build
 * status section is the honest centrepiece — a prospective buyer deciding
 * whether RotaFlow covers their operation is better served by a straight answer
 * than by a feature matrix with every box ticked.
 *
 * Keep `BUILD_STATUS` in step with `docs/SCREENS.md`; it is the same
 * information, written for a buyer rather than an engineer.
 */

interface Guide {
  icon: LucideIcon;
  title: string;
  body: string;
  steps: readonly string[];
}

const GUIDES: readonly Guide[] = [
  {
    icon: Hammer,
    title: 'Set up your organisation',
    body: 'From signing up to a published first week.',
    steps: [
      'Create your organisation and pick your industry',
      'Add your sites and the departments inside them',
      'Set your working week, timezone and week start day',
      'Invite your managers, then your staff, with a role each',
    ],
  },
  {
    icon: CalendarDays,
    title: 'Build and publish your first rota',
    body: 'The core loop, start to finish.',
    steps: [
      'Create the shift types your operation runs (early, day, late, night)',
      'Open the rota builder and pick a location, department and week',
      'Drag shifts onto the grid, or auto-fill and adjust',
      'Resolve any conflicts flagged, then publish to notify the team',
    ],
  },
  {
    icon: Users,
    title: 'Get your team onboard',
    body: 'What staff need to do on day one.',
    steps: [
      'Accept the emailed invitation and set a password',
      'Install RotaFlow to the home screen from the browser',
      'Submit availability so it is known before the next rota',
      'Check the published schedule, and subscribe to it in a calendar app',
    ],
  },
  {
    icon: Clock3,
    title: 'Run attendance and timesheets',
    body: 'From clock-in to an approved timesheet.',
    steps: [
      'Staff clock in and out on their phone, GPS-verified',
      'Entries made with no signal queue and sync automatically',
      'Review the week — scheduled against worked, with variance',
      'Approve, or request a correction on anything flagged',
    ],
  },
];

interface StatusGroup {
  state: 'built' | 'partial' | 'planned';
  heading: string;
  items: readonly string[];
}

const BUILD_STATUS: readonly StatusGroup[] = [
  {
    state: 'built',
    heading: 'Built and in use today',
    items: [
      'Rota builder with drag-and-drop, conflicts and publishing',
      'Published schedules — day, week, month and agenda views',
      'Staff directory, profiles, qualifications and documents',
      'Availability, leave requests and shift swaps',
      'GPS clock-in with an offline queue',
      'Timesheets computed from real clock events',
      'Reports with CSV export',
      'Announcements, locations and departments',
      'Organisation settings, permissions, policies and audit trail',
      'Installable PWA with offline support',
    ],
  },
  {
    state: 'partial',
    heading: 'Built, still being extended',
    items: [
      'Notification delivery — in-app and email work; SMS has no provider yet',
      'Reporting — the core reports are in, scheduled reports are not',
      'Custom role labels, on top of the fixed owner/manager/staff permissions',
    ],
  },
  {
    state: 'planned',
    heading: 'Not built yet',
    items: [
      'Billing and subscriptions — no payment provider is connected',
      'Payroll and HR integrations',
      'Document and photo upload to managed storage',
      'QR-code clock-in as an alternative to GPS',
      'A public API and API tokens',
    ],
  },
];

const STATE_STYLE: Record<StatusGroup['state'], { dot: string; label: string }> = {
  built: { dot: 'bg-success', label: 'text-success' },
  partial: { dot: 'bg-warning', label: 'text-warning' },
  planned: { dot: 'bg-content-muted', label: 'text-content-muted' },
};

export function ResourcesPage(): JSX.Element {
  return (
    <MarketingLayout title="Resources">
      <PageHero
        eyebrow="Resources"
        heading="Getting started, and what is actually built"
        body="RotaFlow is in active development. These are the guides for setting it up — and a straight answer on what the product does and does not do today."
      />

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="mb-3 inline-grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <BookOpen size={20} aria-hidden="true" />
          </span>
          <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
            Setup guides
          </h2>
          <p className="mt-3 text-content-muted dark:text-content-muted-dark">
            Four short paths that cover everything a new organisation needs.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {GUIDES.map(({ icon: Icon, title, body, steps }) => (
            <Card key={title} className="h-full">
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3 className="font-display text-lg font-semibold text-content dark:text-content-dark">
                {title}
              </h3>
              <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                {body}
              </p>
              <ol className="mt-4 space-y-2.5 border-t border-surface-border pt-4 dark:border-surface-border-dark">
                {steps.map((step, i) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-content dark:text-content-dark">{step}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-surface-border bg-surface-subtle py-20 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="mb-3 inline-grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <CircleDashed size={20} aria-hidden="true" />
            </span>
            <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
              What is built today
            </h2>
            <p className="mt-3 text-content-muted dark:text-content-muted-dark">
              Published because you should be able to tell whether RotaFlow covers your
              operation before you sign up — not after.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {BUILD_STATUS.map(({ state, heading, items }) => (
              <Card key={heading} className="h-full">
                <div className="mb-4 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${STATE_STYLE[state].dot}`}
                  />
                  <h3
                    className={`font-display text-sm font-semibold uppercase tracking-wide ${STATE_STYLE[state].label}`}
                  >
                    {heading}
                  </h3>
                </div>
                <ul className="space-y-2.5">
                  {items.map((item) => (
                    <li
                      key={item}
                      className="text-sm leading-relaxed text-content dark:text-content-dark"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Smartphone size={20} aria-hidden="true" />
            </span>
            <h2 className="font-display text-lg font-semibold text-content dark:text-content-dark">
              Installing RotaFlow on a phone
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              There is no app store download. Open RotaFlow in Safari on iOS or Chrome on
              Android, then choose <em>Add to Home Screen</em> — or accept the install
              prompt the app offers. It then opens full-screen like any other app and
              keeps working without a connection.
            </p>
          </Card>

          <Card>
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <LifeBuoy size={20} aria-hidden="true" />
            </span>
            <h2 className="font-display text-lg font-semibold text-content dark:text-content-dark">
              Getting help
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              RotaFlow is small enough that questions reach the people building it. There
              is no ticket queue and no chatbot — just{' '}
              <Link
                to="/contact"
                className="rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                get in touch
              </Link>{' '}
              and you will get a real answer.
            </p>
          </Card>
        </div>
      </section>

      <FinalCta />
    </MarketingLayout>
  );
}
