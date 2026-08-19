import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Button } from '@/components/ui/Button';
import { HERO, PRIMARY_CTA } from '@/lib/marketing';

interface FinalCtaProps {
  heading?: string;
  body?: string;
}

/**
 * Closing call to action.
 *
 * "Book a Demo" routes to `/contact` rather than a scheduling widget: there is
 * no calendar integration and no sales calendar to book into, and a button
 * that opens nothing is worse than one that reaches a form somebody reads.
 */
export function FinalCta({
  heading = 'Ready to simplify your scheduling?',
  body = 'Create your organisation, add a location, and build your first rota today.',
}: FinalCtaProps): JSX.Element {
  const { user } = useSupabaseAuth();

  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <div className="rounded-2xl border border-surface-border bg-surface p-10 text-center shadow-sm md:p-16 dark:border-surface-border-dark dark:bg-surface-dark">
        <h2 className="font-display text-3xl font-bold text-content md:text-4xl dark:text-content-dark">
          {heading}
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-content-muted dark:text-content-muted-dark">
          {body}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {user ? (
            <Link to="/app/dashboard">
              <Button size="lg">
                Go to dashboard
                <ArrowRight size={18} aria-hidden="true" />
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/signup">
                <Button size="lg">
                  {PRIMARY_CTA}
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
              </Link>
              <Link to="/contact">
                <Button size="lg" variant="secondary">
                  Book a demo
                </Button>
              </Link>
            </>
          )}
        </div>

        <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-content-muted dark:text-content-muted-dark">
          {HERO.trust.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
