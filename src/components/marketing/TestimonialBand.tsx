import { Quote, ShieldCheck, WifiOff, FlaskConical, Lock } from 'lucide-react';
import { TESTIMONIALS } from '@/lib/marketing';

const COMMITMENTS = [
  {
    icon: WifiOff,
    title: 'Works without a signal',
    body: 'Clock-ins, leave requests and swaps queue on the device and sync when the connection returns. Nothing is lost in a basement or a stairwell.',
  },
  {
    icon: Lock,
    title: 'Your data is isolated',
    body: 'Every organisation is separated at the database level by row-level security, not by a filter in application code that a bug could skip.',
  },
  {
    icon: ShieldCheck,
    title: 'Built for UK obligations',
    body: 'UK dates, employment terminology and working-time rest rules, with per-person GDPR export and anonymisation built in from the start.',
  },
  {
    icon: FlaskConical,
    title: 'The pay-critical maths is tested',
    body: 'Hours from clock events, the overtime split and leave entitlement carry an automated test suite, because a rounding error there is somebody’s wages.',
  },
];

/**
 * The social-proof slot.
 *
 * When `TESTIMONIALS` has entries this renders them. It is **empty on purpose**
 *. RotaFlow has no customers, and a quote attributed to a named person at a
 * named company is the most actionable false claim a pre-launch site can make.
 * See `src/lib/marketing.ts`.
 *
 * Rather than leave a gap in the page, the slot carries commitments that are
 * true and verifiable in the repository today. That is a weaker sales pitch
 * than an invented quote and a considerably stronger position to defend.
 */
export function TestimonialBand(): JSX.Element {
  if (TESTIMONIALS.length > 0) {
    return (
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map(({ quote, name, role, organisation }) => (
            <figure
              key={`${name}-${organisation}`}
              className="flex h-full flex-col rounded-2xl border border-surface-border bg-surface p-6 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark"
            >
              <Quote
                size={24}
                aria-hidden="true"
                className="mb-4 text-primary dark:text-primary-ink-dark"
              />
              <blockquote className="flex-1 leading-relaxed text-content dark:text-content-dark">
                {quote}
              </blockquote>
              <figcaption className="mt-5 border-t border-surface-border pt-4 text-sm dark:border-surface-border-dark">
                <span className="block font-semibold text-content dark:text-content-dark">
                  {name}
                </span>
                <span className="text-content-muted dark:text-content-muted-dark">
                  {role}, {organisation}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
          What we will put in writing
        </h2>
        <p className="mt-3 text-content-muted dark:text-content-muted-dark">
          RotaFlow is pre-launch, so there are no customer quotes here yet. These are the
          commitments the product is built on. Each one checkable, not a claim about how
          many people use it.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {COMMITMENTS.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex gap-4 rounded-2xl border border-surface-border bg-surface p-6 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:text-primary-ink-dark">
              <Icon size={20} aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-display font-semibold text-content dark:text-content-dark">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                {body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
