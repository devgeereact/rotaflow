import type { JSX } from 'react';
import { AlertTriangle, Check, XCircle } from 'lucide-react';
import { WHY_ROTAFLOW } from '@/lib/marketing';

/**
 * "Why teams choose RotaFlow."
 *
 * Each entry is an outcome the built product produces, phrased as what the
 * software does rather than as a measured result. There is no "cut scheduling
 * time by 70%" here: that is a research claim, and RotaFlow has run no study
 * and has no customers to have measured.
 */
export function WhyChooseBand(): JSX.Element {
  return (
    <section className="border-y border-surface-border bg-surface-subtle py-20 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div data-reveal>
          <h2 className="font-display text-3xl font-medium text-content md:text-4xl dark:text-content-dark">
            Why teams choose RotaFlow
          </h2>
          <p className="mt-4 max-w-md leading-relaxed text-content-muted dark:text-content-muted-dark">
            Scheduling goes wrong in a handful of predictable ways. RotaFlow is built
            around catching each of them before it reaches a member of staff.
          </p>

          {/* A real example of what "caught while you build" looks like, so this
              column is not three lines beside a five-item list (design gap F04).
              The figures are an illustration, and labelled as one. */}
          <figure className="mt-8 max-w-md rounded-card border border-surface-border bg-surface p-4 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark">
            <figcaption className="mb-3 text-xs font-medium uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
              Example: while you build
            </figcaption>
            <ul className="space-y-2">
              <li className="flex gap-3 rounded-lg border border-warning/40 bg-warning-wash p-3 dark:bg-warning-wash-dark">
                <AlertTriangle
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-warning-ink dark:text-warning-ink-dark"
                />
                <span className="text-sm">
                  <span className="block font-medium text-content dark:text-content-dark">
                    Short rest: 9 h 30 min
                  </span>
                  <span className="block text-ink-muted dark:text-content-muted-dark">
                    The late ends 22:00 and Thursday&rsquo;s early starts 07:30.
                  </span>
                </span>
              </li>
              <li className="flex gap-3 rounded-lg border border-danger/40 bg-danger-wash p-3 dark:bg-danger-wash-dark">
                <XCircle
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-danger-ink dark:text-danger-ink-dark"
                />
                <span className="text-sm">
                  <span className="block font-medium text-content dark:text-content-dark">
                    Double-booked
                  </span>
                  <span className="block text-ink-muted dark:text-content-muted-dark">
                    The same person is on two sites on Friday morning.
                  </span>
                </span>
              </li>
            </ul>
          </figure>
        </div>

        <ul className="space-y-6">
          {WHY_ROTAFLOW.map(({ title, body }) => (
            <li key={title} data-reveal className="flex gap-4">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success/10 text-success-ink dark:text-success-ink-dark">
                <Check size={16} aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display font-medium text-content dark:text-content-dark">
                  {title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
