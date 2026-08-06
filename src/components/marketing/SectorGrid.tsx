import { Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { SECTORS } from '@/lib/marketing';

interface SectorGridProps {
  /** `compact` drops the bullet lists. Used on the landing page, where the full detail belongs on /solutions. */
  variant?: 'compact' | 'full';
}

/**
 * The six industries RotaFlow is built for.
 *
 * These are target sectors, described by the scheduling problems they actually
 * have, not a claim that organisations in them are already customers. No
 * logos and no named accounts, for the same reason `TESTIMONIALS` is empty.
 */
export function SectorGrid({ variant = 'full' }: SectorGridProps): JSX.Element {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
          Built for shift-based teams
        </h2>
        <p className="mt-3 text-content-muted dark:text-content-muted-dark">
          The same scheduling engine, shaped around how each sector actually runs.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SECTORS.map(({ icon: Icon, name, body, points }) => (
          <Card key={name} className="flex h-full flex-col">
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon size={20} aria-hidden="true" />
            </span>
            <h3 className="mb-1.5 font-display text-lg font-semibold text-content dark:text-content-dark">
              {name}
            </h3>
            <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              {body}
            </p>

            {variant === 'full' && (
              <ul className="mt-4 space-y-2 border-t border-surface-border pt-4 dark:border-surface-border-dark">
                {points.map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm">
                    <Check
                      size={16}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                    />
                    <span className="text-content dark:text-content-dark">{point}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
