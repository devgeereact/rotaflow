import { ArrowLeft, ArrowRight, Check, Crown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { StepCard } from '@/components/onboarding/StepCard';
import { PLANS, type PlanOption } from '@/components/onboarding/constants';

interface StepChoosePlanProps {
  plan: PlanOption['value'];
  onSelect: (plan: PlanOption['value']) => void;
  onBack: () => void;
  onContinue: () => void;
  submitting: boolean;
  error: string | null;
}

export function StepChoosePlan({
  plan,
  onSelect,
  onBack,
  onContinue,
  submitting,
  error,
}: StepChoosePlanProps): JSX.Element {
  return (
    <StepCard
      icon={Crown}
      title="Choose your plan"
      subtitle="Simple, transparent pricing. No hidden fees."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={16} aria-hidden="true" className="mr-1.5" />
            Back
          </Button>
          <Button onClick={onContinue} disabled={submitting || plan === null}>
            {submitting ? 'Saving…' : 'Continue'}
            {!submitting && (
              <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((option) => {
            const selected = plan !== null && option.value === plan;
            const enquiryOnly = option.value === null;
            const highlighted = option.popular || selected;

            return (
              <div
                key={option.name}
                className={cn(
                  'relative flex flex-col rounded-2xl border bg-surface p-5 transition-colors dark:bg-surface-dark',
                  highlighted
                    ? 'border-2 border-primary'
                    : 'border border-surface-border dark:border-surface-border-dark',
                )}
              >
                {option.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-white">
                    Most popular
                  </span>
                )}

                <h3 className="font-display text-lg font-bold text-content dark:text-content-dark">
                  {option.name}
                </h3>
                <p className="mb-4 min-h-[2.5rem] text-sm text-content-muted dark:text-content-muted-dark">
                  {option.tagline}
                </p>

                {option.monthly === null ? (
                  <p className="font-display text-3xl font-bold text-content dark:text-content-dark">
                    Custom
                  </p>
                ) : (
                  <p className="font-display text-3xl font-bold text-content dark:text-content-dark">
                    £{option.monthly}
                  </p>
                )}
                <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                  {option.monthly === null ? 'Custom pricing' : 'per month'}
                </p>
                <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
                  {option.staffLimit}
                </p>

                <ul className="mb-5 flex-1 space-y-2.5 border-t border-surface-border pt-4 dark:border-surface-border-dark">
                  {option.features.map((f) => (
                    <li
                      key={f}
                      className="flex gap-1.5 text-xs leading-tight text-content dark:text-content-dark"
                    >
                      <Check
                        size={15}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-primary dark:text-primary-ink-dark"
                      />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  variant={selected ? 'primary' : 'secondary'}
                  className={cn(
                    'w-full',
                    !selected &&
                      'border-primary text-primary dark:text-primary-ink-dark hover:bg-primary/5',
                  )}
                  title={
                    enquiryOnly
                      ? 'Enterprise is arranged directly. Get in touch with the team'
                      : undefined
                  }
                  onClick={() => {
                    if (!enquiryOnly) onSelect(option.value);
                  }}
                >
                  {enquiryOnly ? 'Contact us' : selected ? 'Selected' : 'Select plan'}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-primary/5 p-4">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-white">
            <Info size={14} aria-hidden="true" />
          </span>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            <strong className="text-content dark:text-content-dark">
              All plans include:
            </strong>{' '}
            Unlimited shifts &bull; Installable web app &bull; Real-time sync &bull;
            Tenant-isolated access
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </StepCard>
  );
}
