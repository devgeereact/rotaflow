import { Link } from 'react-router-dom';
import { BarChart3, Calendar, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import { StatusPill } from '@/components/ui/StatusPill';
import { SplashWaves } from '@/components/SplashWaves';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface SplashFeature {
  icon: LucideIcon;
  label: string;
}

const FEATURES: SplashFeature[] = [
  { icon: Calendar, label: 'Smart Scheduling' },
  { icon: Users, label: 'Happy Teams' },
  { icon: ShieldCheck, label: 'Compliant & Secure' },
  { icon: BarChart3, label: 'Data Driven' },
];

interface SplashScreenProps {
  /** Boot completion, 0–100. Drives the progress bar width. */
  progress?: number;
  /** Caption under the bar; reflects whatever the shell is waiting on. */
  message?: string;
}

/**
 * Cold-start splash (design/splash-screen.png).
 *
 * Deliberately presentational — it owns no boot logic. The only live signal is
 * connectivity, so a staff member on bad ward wifi sees "Offline" instead of a
 * bar that implies progress the app is not making.
 */
export function SplashScreen({
  progress = 47,
  message = 'Loading your workspace...',
}: SplashScreenProps): JSX.Element {
  const online = useOnlineStatus();
  const percent = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 dark:bg-background-dark">
      <SplashWaves />

      <StatusPill className="absolute right-9 top-8" />

      {/* Lockup */}
      <main className="relative flex flex-col items-center pb-16 text-center">
        <Link
          to="/"
          aria-label="RotaFlow home"
          className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background dark:focus-visible:ring-offset-background-dark"
        >
          <BrandMark label={null} className="h-40 w-40 sm:h-52 sm:w-52 lg:h-66 lg:w-66" />
        </Link>

        <h1 className="mt-6 font-display text-5xl font-bold tracking-tighter text-ink dark:text-content-dark sm:text-8xl lg:text-wordmark">
          Rota<span className="text-brand dark:text-brand-light">Flow</span>
        </h1>

        <p className="mt-1 text-xs font-medium uppercase tracking-lockup text-ink-muted dark:text-content-muted-dark sm:text-lg lg:text-2xl">
          Workforce Scheduling Platform
        </p>

        <div className="mt-14 w-full max-w-md">
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Startup progress"
            className="h-1.5 overflow-hidden rounded-full bg-brand-wash dark:bg-surface-border-dark"
          >
            {/* Width is data, not style: Tailwind cannot express an arbitrary
                percentage, and this mirrors the existing AppBootScreen bar. */}
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-5 text-lg text-ink-soft dark:text-content-muted-dark">
            {online ? message : "You're offline — showing your cached rota."}
          </p>
        </div>
      </main>

      {/* Feature strip */}
      <ul className="absolute inset-x-0 bottom-28 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 px-6">
        {FEATURES.map(({ icon: Icon, label }, i) => (
          <li key={label} className="flex items-center gap-8">
            {i > 0 && (
              <span
                aria-hidden="true"
                className="hidden h-6 w-px bg-surface-border dark:bg-surface-border-dark lg:block"
              />
            )}
            <span className="flex items-center gap-2.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-surface-border bg-surface dark:border-surface-border-dark dark:bg-surface-dark">
                <Icon
                  size={26}
                  strokeWidth={2.25}
                  className="text-brand"
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm text-ink dark:text-content-dark">{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
