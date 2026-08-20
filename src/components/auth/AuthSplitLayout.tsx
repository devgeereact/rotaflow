import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import { LanguagePill } from '@/components/ui/LanguagePill';
import { SplashWaves } from '@/components/SplashWaves';
import { AuthTrustStrip } from '@/components/auth/AuthTrustStrip';

export interface AuthFeature {
  icon: LucideIcon;
  title: string;
  body: string;
}

interface AuthSplitLayoutProps {
  /** First headline line. Dark ink, e.g. "Create your account." */
  headline: string;
  /** Second headline line, set in brand blue, e.g. "Build a stronger team." */
  headlineAccent: string;
  description: string;
  features: readonly AuthFeature[];
  children: ReactNode;
}

/**
 * The split-screen shell shared by the auth screens (docs/design/signup.png,
 * docs/design/signin.png): a marketing panel. Logo, headline, feature list, wave
 * background. Beside a white form panel supplied via `children`.
 *
 * The reference's marketing panel also carries a customer testimonial (name,
 * role, photo). Omitted deliberately: RotaFlow is pre-launch with no real
 * customers, and HomePage.tsx already rejects fabricated social proof for the
 * same reason. Inventing a quote here would be inconsistent with that policy.
 */
export function AuthSplitLayout({
  headline,
  headlineAccent,
  description,
  features,
  children,
}: AuthSplitLayoutProps): JSX.Element {
  return (
    <div className="relative flex min-h-screen bg-background dark:bg-background-dark">
      <div className="relative hidden w-[46%] shrink-0 overflow-hidden lg:block">
        <SplashWaves />

        <div className="relative flex h-full flex-col px-14 pb-16 pt-12 xl:px-20">
          <div className="mb-14 flex items-center gap-3">
            <BrandMark label={null} className="h-14 w-14" />
            <div>
              <p className="font-display text-2xl font-bold text-ink dark:text-content-dark">
                Rota<span className="text-brand dark:text-brand-light">Flow</span>
              </p>
              <p className="text-xs font-semibold uppercase tracking-lockup text-content-muted dark:text-content-muted-dark">
                Workforce Scheduling Platform
              </p>
            </div>
          </div>

          <h1 className="mb-5 font-display text-4xl font-bold leading-tight text-ink dark:text-content-dark xl:text-5xl">
            {headline}
            <br />
            <span className="text-brand dark:text-brand-light">{headlineAccent}</span>
          </h1>
          <p className="mb-10 max-w-md text-lg text-content-muted dark:text-content-muted-dark">
            {description}
          </p>

          <ul className="flex flex-col gap-6">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface text-brand shadow-sm dark:bg-surface-dark">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-ink dark:text-content-dark">{title}</p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col">
        <div className="flex justify-end px-6 pt-4 md:px-10">
          <LanguagePill />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-6">
          {children}
        </div>
        <AuthTrustStrip />
      </div>
    </div>
  );
}
