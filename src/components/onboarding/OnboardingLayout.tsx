import type { ReactNode } from 'react';
import { Check, HelpCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

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
  intro: string;
  features: BrandFeature[];
  steps: OnboardingStepMeta[];
  currentStep: number;
  children: ReactNode;
  /** Top-right slot — "Back to sign in", language picker, etc. */
  action?: ReactNode;
}

/**
 * Three-column onboarding shell from design/Organisation-Onboarding.png:
 * brand panel, progress stepper, and the active step's form card.
 *
 * The two left columns collapse away below `lg` — the stepper is decoration
 * once there is no room for it, and a five-step form on a phone should be the
 * form and nothing else.
 */
export function OnboardingLayout({
  headline,
  intro,
  features,
  steps,
  currentStep,
  children,
  action,
}: OnboardingLayoutProps): JSX.Element {
  return (
    <div className="min-h-screen bg-background dark:bg-background-dark">
      {action && <div className="flex justify-end px-6 pt-6 md:px-10">{action}</div>}

      <div className="mx-auto grid max-w-[1600px] gap-8 px-6 py-8 md:px-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,17rem)_minmax(0,1fr)]">
        {/* ---- Brand panel ---- */}
        <aside className="hidden lg:block">
          <div className="mb-8 flex items-center gap-3">
            <img src={logo} alt="" className="h-11 w-11" aria-hidden="true" />
            <div>
              <p className="font-display text-2xl font-semibold leading-none text-content dark:text-content-dark">
                RotaFlow
              </p>
              <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-content-muted dark:text-content-muted-dark">
                Workforce scheduling platform
              </p>
            </div>
          </div>

          <h1 className="mb-4 font-display text-4xl font-semibold leading-tight text-content dark:text-content-dark">
            {headline}
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
            {intro}
          </p>

          <ul className="space-y-5">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-surface-border bg-surface text-primary dark:border-surface-border-dark dark:bg-surface-dark">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-content dark:text-content-dark">
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
          className="hidden rounded-2xl border border-surface-border bg-surface p-6 dark:border-surface-border-dark dark:bg-surface-dark lg:block"
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
                            ? 'bg-primary'
                            : 'bg-surface-border dark:bg-surface-border-dark',
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold',
                      done && 'bg-success text-white',
                      active && 'bg-primary text-white',
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
                        'text-sm font-medium',
                        active ? 'text-primary' : 'text-content dark:text-content-dark',
                      )}
                    >
                      {step.title}
                      {active && <span className="sr-only"> (current step)</span>}
                    </p>
                    <p
                      className={cn(
                        'truncate text-xs',
                        done
                          ? 'text-primary'
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

          <div className="mt-6 rounded-xl border border-surface-border bg-background p-4 dark:border-surface-border-dark dark:bg-background-dark">
            <div className="mb-1 flex items-center gap-2">
              <HelpCircle size={16} aria-hidden="true" className="text-primary" />
              <p className="text-sm font-medium text-content dark:text-content-dark">
                Need help?
              </p>
            </div>
            <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
              You can change any of this later from organisation settings.
            </p>
          </div>
        </nav>

        {/* ---- Active step ---- */}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
