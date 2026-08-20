import { Link } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  Calendar,
  Database,
  Flag,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import { StatusPill } from '@/components/ui/StatusPill';
import { StepRing, type StepRingState } from '@/components/ui/StepRing';
import { SplashWaves } from '@/components/SplashWaves';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

interface BootStage {
  icon: LucideIcon;
  label: string;
  state: StepRingState;
}

interface AppBootScreenProps {
  /** The Supabase session has resolved (not necessarily signed in). */
  authResolved: boolean;
  /** Org memberships have resolved. */
  orgResolved: boolean;
}

interface BootFeature {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FEATURES: BootFeature[] = [
  { icon: Calendar, title: 'Smart Scheduling', body: 'Create balanced rotas with ease' },
  {
    icon: Users,
    title: 'Happy Teams',
    body: 'Empower your team and improve satisfaction',
  },
  {
    icon: ShieldCheck,
    title: 'Compliant & Secure',
    body: 'Stay compliant with confidence',
  },
  {
    icon: BarChart3,
    title: 'Data Driven',
    body: 'Make better decisions with real-time insights',
  },
];

const STAGE_COPY: Record<StepRingState, string> = {
  done: 'Completed',
  active: 'In progress',
  pending: 'Pending',
};

/**
 * Boot progress for a cold start (docs/design/appboot.png).
 *
 * Every stage reflects a real signal. Connectivity, the auth session resolving,
 * memberships resolving, and the bar is the proportion of those actually
 * finished. It is deliberately not a timed animation: a progress bar that
 * advances on a timer tells the user the app is making progress when it may be
 * stuck, which is worst precisely when it matters (a staff member on bad ward
 * wifi trying to see today's shift).
 */
export function AppBootScreen({
  authResolved,
  orgResolved,
}: AppBootScreenProps): JSX.Element {
  const online = useOnlineStatus();

  const stages: BootStage[] = [
    { icon: ShieldCheck, label: 'Secure connection', state: online ? 'done' : 'active' },
    {
      icon: Database,
      label: 'Loading your data',
      state: !online ? 'pending' : authResolved ? 'done' : 'active',
    },
    {
      icon: Building2,
      label: 'Setting up organisation',
      state: !authResolved ? 'pending' : orgResolved ? 'done' : 'active',
    },
    {
      icon: Users,
      label: 'Preparing features',
      state: orgResolved ? 'done' : 'pending',
    },
    {
      icon: Flag,
      label: 'Finalising',
      state: authResolved && orgResolved ? 'active' : 'pending',
    },
  ];

  const done = stages.filter((s) => s.state === 'done').length;
  const percent = Math.round((done / stages.length) * 100);
  const active = stages.find((s) => s.state === 'active');

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background dark:bg-background-dark">
      <SplashWaves />

      <header className="relative flex items-center justify-between gap-6 px-6 py-6 md:px-10">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            aria-label="RotaFlow home"
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BrandMark label={null} className="h-12 w-12" />
          </Link>
          <Link
            to="/"
            className="font-display text-2xl font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-dark"
          >
            Rota<span className="text-brand dark:text-brand-light">Flow</span>
          </Link>
          <span
            aria-hidden="true"
            className="ml-2 hidden h-6 w-px bg-surface-border dark:bg-surface-border-dark sm:block"
          />
          <span className="hidden text-xs font-semibold uppercase tracking-lockup text-content-muted dark:text-content-muted-dark sm:block">
            Workforce Scheduling Platform
          </span>
        </div>

        <StatusPill />
      </header>

      <main className="relative mx-auto w-full max-w-7xl flex-1 px-6 pb-40 pt-14 md:px-10">
        <div className="mb-14 text-center">
          <p className="mb-3 text-base text-content-muted dark:text-content-muted-dark">
            Starting up RotaFlow...
          </p>
          <h1 className="mb-3 font-display text-4xl font-bold text-ink dark:text-content-dark md:text-5xl">
            Preparing your workspace
          </h1>
          <p className="text-lg text-content-muted dark:text-content-muted-dark">
            {online
              ? "We're getting everything ready for you. This will only take a few moments."
              : "You're offline. RotaFlow will use what it has cached."}
          </p>
        </div>

        <ol
          className="relative mx-auto mb-10 grid grid-cols-3 gap-y-8 sm:grid-cols-5 sm:gap-y-0"
          aria-label="Startup progress"
        >
          {stages.map(({ icon: Icon, label, state }, i) => (
            <li key={label} className="relative flex flex-col items-center text-center">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1/2 top-12 hidden w-full border-t-2 border-dashed border-surface-border sm:block dark:border-surface-border-dark"
                />
              )}
              <StepRing icon={Icon} state={state} label={label} className="relative" />
              <p className="mt-3 text-sm font-medium text-ink dark:text-content-dark">
                {label}
              </p>
              <p
                className={cn(
                  'text-sm',
                  state === 'pending'
                    ? 'text-content-muted dark:text-content-muted-dark'
                    : 'text-brand dark:text-brand-light',
                )}
              >
                {STAGE_COPY[state]}
              </p>
            </li>
          ))}
        </ol>

        <div className="mx-auto mb-16 rounded-2xl border border-surface-border bg-surface p-9 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-ink dark:text-content-dark">
                {active?.label ?? 'Finalising'}
              </p>
              <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                Configuring locations, roles and permissions...
              </p>
            </div>
            <p className="font-mono text-base font-semibold text-brand dark:text-brand-light">
              {percent}%
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Startup progress"
            className="h-2.5 overflow-hidden rounded-full bg-brand-wash dark:bg-surface-border-dark"
          >
            {/* Width is data, not style: Tailwind cannot express an arbitrary
                percentage, and this mirrors the splash screen's bar. */}
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <ul className="mx-auto grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="relative flex items-start gap-3.5">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -left-3 top-1 hidden h-16 w-px bg-surface-border lg:block dark:bg-surface-border-dark"
                />
              )}
              <span className="grid h-[3.125rem] w-[3.125rem] shrink-0 place-items-center rounded-full bg-brand-wash text-brand dark:bg-brand-deep/20 dark:text-brand-light">
                <Icon size={22} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink dark:text-content-dark">
                  {title}
                </p>
                <p className="mt-1 text-sm leading-snug text-content-muted dark:text-content-muted-dark">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
