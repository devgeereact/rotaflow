import { CAPABILITIES, TRACTION } from '@/lib/marketing';

/**
 * The "platform statistics" band.
 *
 * A landing page normally fills this slot with traction — active users,
 * organisations, shifts scheduled, uptime. RotaFlow has not launched, so every
 * one of those numbers would be invented, and this band is the most prominent
 * place on the page to publish a false factual claim. See `src/lib/marketing.ts`
 * for the full reasoning.
 *
 * So it renders `TRACTION` when real figures exist and `CAPABILITIES` — product
 * facts checkable against the repository — until they do. The switch is
 * automatic: fill `TRACTION` and this band changes with no edit here.
 */
export function StatsBand(): JSX.Element {
  const showingTraction = TRACTION.length > 0;
  const stats = showingTraction ? TRACTION : CAPABILITIES;

  return (
    <section className="border-y border-surface-border bg-surface py-16 dark:border-surface-border-dark dark:bg-surface-dark">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-10 text-center font-display text-2xl font-bold text-content md:text-3xl dark:text-content-dark">
          {showingTraction ? 'RotaFlow by the numbers' : 'What RotaFlow gives you'}
        </h2>

        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(({ value, label, detail }) => (
            <div key={label} className="text-center">
              <dt className="sr-only">{label}</dt>
              <dd>
                <p className="font-display text-3xl font-extrabold tracking-tight text-primary md:text-4xl">
                  {value}
                </p>
                <p className="mt-2 font-semibold text-content dark:text-content-dark">
                  {label}
                </p>
                <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                  {detail}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
