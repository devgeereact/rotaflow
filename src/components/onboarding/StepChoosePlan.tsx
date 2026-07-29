import { ArrowLeft, ArrowRight, Check, Crown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { StepCard } from '@/components/onboarding/StepCard';
import {
  PLANS,
  type BillingPeriod,
  type PlanOption,
} from '@/components/onboarding/constants';

interface StepChoosePlanProps {
  plan: PlanOption['value'];
  period: BillingPeriod;
  onSelect: (plan: PlanOption['value']) => void;
  onPeriod: (period: BillingPeriod) => void;
  onBack: () => void;
  onContinue: () => void;
  submitting: boolean;
  error: string | null;
}

/** Yearly is billed as ten months — the "save 2 months" offer in the design. */
function priceFor(monthly: number, period: BillingPeriod): number {
  return period === 'yearly' ? Math.round((monthly * 10) / 12) : monthly;
}

export function StepChoosePlan({
  plan,
  period,
  onSelect,
  onPeriod,
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
        <div
          role="group"
          aria-label="Billing period"
          className="mx-auto flex w-full max-w-md rounded-xl border border-surface-border p-1 dark:border-surface-border-dark"
        >
          {(['monthly', 'yearly'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriod(p)}
              aria-pressed={period === p}
              className={cn(
                'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                period === p
                  ? 'bg-primary text-white'
                  : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
              )}
            >
              <span className="block capitalize">{p}</span>
              <span className="block text-xs font-normal opacity-80">
                {p === 'monthly' ? 'Pay monthly' : 'Save 2 months'}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((option) => {
            const selected = plan !== null && option.value === plan;
            const enquiryOnly = option.value === null;

            return (
              <div
                key={option.name}
                className={cn(
                  'relative flex flex-col rounded-2xl border p-5 transition-colors',
                  selected
                    ? 'border-primary ring-1 ring-primary'
                    : 'border-surface-border dark:border-surface-border-dark',
                )}
              >
                {option.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white">
                    Most popular
                  </span>
                )}

                <h3 className="font-display text-lg font-semibold text-content dark:text-content-dark">
                  {option.name}
                </h3>
                <p className="mb-4 min-h-[2.5rem] text-xs text-content-muted dark:text-content-muted-dark">
                  {option.tagline}
                </p>

                {option.monthly === null ? (
                  <p className="font-display text-3xl font-semibold text-content dark:text-content-dark">
                    Custom
                  </p>
                ) : (
                  <p className="font-display text-3xl font-semibold text-content dark:text-content-dark">
                    £{priceFor(option.monthly, period)}
                    <span className="ml-1 text-sm font-normal text-content-muted dark:text-content-muted-dark">
                      /month
                    </span>
                  </p>
                )}
                <p className="mb-4 text-xs text-content-muted dark:text-content-muted-dark">
                  {option.staffLimit}
                </p>

                <ul className="mb-5 flex-1 space-y-2">
                  {option.features.map((f) => (
                    <li
                      key={f}
                      className="flex gap-2 text-xs text-content dark:text-content-dark"
                    >
                      <Check
                        size={14}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-primary"
                      />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  variant={selected ? undefined : 'secondary'}
                  size="sm"
                  className="w-full"
                  disabled={enquiryOnly}
                  title={
                    enquiryOnly
                      ? 'Enterprise is arranged directly — get in touch with the team'
                      : undefined
                  }
                  onClick={() => onSelect(option.value)}
                >
                  {enquiryOnly ? 'Contact us' : selected ? 'Selected' : 'Select plan'}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            <strong>No payment is taken.</strong> Choosing a plan records your intent so
            the right features are enabled; billing is the final phase of the roadmap and
            no card details are collected anywhere in RotaFlow yet.
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
