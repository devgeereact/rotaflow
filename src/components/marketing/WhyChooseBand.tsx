import { Check } from 'lucide-react';
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
        <div>
          <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
            Why teams choose RotaFlow
          </h2>
          <p className="mt-4 max-w-md leading-relaxed text-content-muted dark:text-content-muted-dark">
            Scheduling goes wrong in a handful of predictable ways. RotaFlow is built
            around catching each of them before it reaches a member of staff.
          </p>
        </div>

        <ul className="space-y-6">
          {WHY_ROTAFLOW.map(({ title, body }) => (
            <li key={title} className="flex gap-4">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success/10 text-success">
                <Check size={16} aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display font-semibold text-content dark:text-content-dark">
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
