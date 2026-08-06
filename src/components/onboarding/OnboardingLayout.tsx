import type { ReactNode } from 'react';
import { Check, HelpCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/ui/BrandMark';
import { OnboardingWave } from '@/components/onboarding/OnboardingWave';
import { BuildingIllustration } from '@/components/onboarding/BuildingIllustration';

export interface OnboardingStepMeta {
  /** 1-based step number. */
  number: number;
  title: string;
  /** Shown under the title; becomes a summary of the answer once complete. */
  subtitle: string;
}

export interface BrandFeature {
  icon: LucideIcon;
  title: string;
  body: string;
}

interface OnboardingLayoutProps {
  headline: ReactNode;
  headlineAccent: ReactNode;
  intro: string;
  features: BrandFeature[];
  steps: OnboardingStepMeta[];
  currentStep: number;
  children: ReactNode;
  /** Top-right slot, "Back to sign in", language picker, "Need help?" link. */
  action?: ReactNode;
  /** Defaults to `BuildingIllustration`. Step 3 swaps in `TeamIllustration`. */
  illustration?: ReactNode;
}

/**
 * Three-column onboarding shell shared by design/Organisation-Onboarding.png,
 * design/Organisation-about.png and design/Onboarding-Complete.png: brand
 * panel, progress stepper, and the active step's form card.
 *
 * On the final step every prior step's subtitle switches from generic helper
 * text to the actual captured answer (Onboarding-Complete.png shows "Sunnyvale
 * Care Group", "3 locations", etc., all in the accent colour). Mid-wizard
 * screens keep every non-active subtitle muted (Organisation-about.png shows
 * step 1's subtitle as the plain "Set up your organisation" hint even though
 * that step is done). `OnboardingPage` already threads real answers into
 * `subtitle` once known; this only changes the *colour* once the wizard is
 * fully finished, not what text is shown at each point.
 *
 * The two left columns collapse away below `lg`. The stepper is decoration
 * once there is no room for it, and a five-step form on a phone should be the
 * form and nothing else.
 */
export function OnboardingLayout({
  headline,
  headlineAccent,
  intro,
  features,
  steps,
  currentStep,
  children,
  action,
  illustration = <BuildingIllustration />,
}: OnboardingLayoutProps): JSX.Element {
  const isReceipt = currentStep >= steps.length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background dark:bg-background-dark">
      {action && (
        <div className="relative flex justify-end px-6 pt-6 md:px-10">{action}</div>
      )}

      <div className="relative mx-auto grid max-w-[1600px] gap-8 px-6 py-8 md:px-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,17rem)_minmax(0,1fr)]">
        {/* ---- Brand panel ---- */}
        <aside className="relative hidden lg:block">
          <OnboardingWave />
          {illustration}

          <div className="relative mb-10 flex items-center gap-3">
            <BrandMark label={null} className="h-11 w-11" />
            <div>
              <p className="font-display text-xl font-bold leading-none text-ink dark:text-content-dark">
                Rota<span className="text-brand dark:text-brand-light">Flow</span>
              </p>
              <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-lockup text-content-muted dark:text-content-muted-dark">
                Workforce Scheduling Platform
              </p>
            </div>
          </div>

          <h1 className="relative mb-4 font-display text-3xl font-bold leading-tight text-ink dark:text-content-dark">
            {headline}{' '}
            <span className="text-brand dark:text-brand-light">{headlineAccent}</span>
          </h1>
          <p className="relative mb-8 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
            {intro}
          </p>

          <ul className="relative space-y-5">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-brand shadow-sm dark:bg-surface-dark">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink dark:text-content-dark">
                    {title}
                  </p>
                  <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {/* ---- Stepper ---- */}
        <nav
          aria-label="Onboarding progress"
          className="relative hidden self-start rounded-2xl border border-surface-border bg-surface p-6 dark:border-surface-border-dark dark:bg-surface-dark lg:block"
        >
          <ol>
            {steps.map((step, index) => {
              const done = step.number < currentStep;
              const active = step.number === currentStep;
              const last = index === steps.length - 1;

              return (
                <li key={step.number} className="relative flex gap-3 pb-6 last:pb-0">
                  {!last && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute left-[0.9375rem] top-8 h-[calc(100%-2rem)] w-px',
                        done
                          ? 'bg-success'
                          : active
                            ? 'bg-brand'
                            : 'bg-surface-border dark:bg-surface-border-dark',
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold',
                      done && 'bg-success text-white',
                      active && 'bg-brand text-white',
                      !done &&
                        !active &&
                        'border border-surface-border bg-background text-content-muted dark:border-surface-border-dark dark:bg-background-dark dark:text-content-muted-dark',
                    )}
                  >
                    {done ? <Check size={16} aria-hidden="true" /> : step.number}
                  </span>
                  <div className="min-w-0 pt-1">
                    <p
                      className={cn(
                        'text-sm font-semibold',
                        active
                          ? 'text-brand dark:text-brand-light'
                          : 'text-ink dark:text-content-dark',
                      )}
                    >
                      {step.title}
                      {active && <span className="sr-only"> (current step)</span>}
                    </p>
                    <p
                      className={cn(
                        'text-xs leading-snug',
                        done && isReceipt
                          ? 'text-brand dark:text-brand-light'
                          : 'text-content-muted dark:text-content-muted-dark',
                      )}
                    >
                      {step.subtitle}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          {!isReceipt && (
            <div className="mt-6 rounded-xl border border-surface-border bg-background p-4 dark:border-surface-border-dark dark:bg-background-dark">
              <div className="mb-1 flex items-center gap-2">
                <HelpCircle size={16} aria-hidden="true" className="text-brand" />
                <p className="text-sm font-semibold text-ink dark:text-content-dark">
                  Need help?
                </p>
              </div>
              <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                You can change any of this later from organisation settings.
              </p>
            </div>
          )}
        </nav>

        {/* ---- Active step ---- */}
        <main className="relative min-w-0">{children}</main>
      </div>
    </div>
  );
}
