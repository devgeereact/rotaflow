import { Card } from '@/components/ui/Card';
import { PRODUCT_BENEFITS } from '@/lib/marketing';

interface BenefitGridProps {
  heading?: string;
  body?: string;
}

/**
 * The eight product benefits. Content lives in `src/lib/marketing.ts`, which
 * carries the rule: nothing goes in the list that is not built and working
 * today, checked against `docs/SCREENS.md`.
 */
export function BenefitGrid({
  heading = 'One platform for the whole operation',
  body = 'Everything below is built and working in RotaFlow today, not a roadmap.',
}: BenefitGridProps): JSX.Element {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
          {heading}
        </h2>
        <p className="mt-3 text-content-muted dark:text-content-muted-dark">{body}</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCT_BENEFITS.map(({ icon: Icon, title, body: text }) => (
          <Card key={title} className="h-full">
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary dark:text-primary-ink-dark">
              <Icon size={20} aria-hidden="true" />
            </span>
            <h3 className="mb-1.5 font-display text-base font-semibold text-content dark:text-content-dark">
              {title}
            </h3>
            <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              {text}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
