import {
  BarChart3,
  Building2,
  CalendarCheck,
  Check,
  Database,
  Flag,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

type StageState = 'done' | 'active' | 'pending';

interface BootStage {
  icon: LucideIcon;
  label: string;
  state: StageState;
}

interface AppBootScreenProps {
  /** The Supabase session has resolved (not necessarily signed in). */
  authResolved: boolean;
  /** Org memberships have resolved. */
  orgResolved: boolean;
}

const FEATURES = [
  {
    icon: CalendarCheck,
    title: 'Smart scheduling',
    body: 'Create balanced rotas with ease',
  },
  {
    icon: Users,
    title: 'Happy teams',
    body: 'Empower your team and improve satisfaction',
  },
  {
    icon: ShieldCheck,
    title: 'Compliant & secure',
    body: 'Tenant data isolated at the database',
  },
  {
    icon: BarChart3,
    title: 'Data driven',
    body: 'Better decisions with real-time insight',
  },
];

const STAGE_COPY: Record<StageState, string> = {
  done: 'Completed',
  active: 'In progress',
  pending: 'Pending',
};

/**
 * Boot progress for a cold start (design/appboot.png).
 *
 * Every stage reflects a real signal — connectivity, the auth session resolving,
 * memberships resolving — and the bar is the proportion of those actually
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
    <div className="relative grid min-h-screen grid-rows-[auto_1fr] overflow-hidden bg-background dark:bg-background-dark">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="h-10 w-10" aria-hidden="true" />
          <p className="font-display text-xl font-semibold text-content dark:text-content-dark">
            RotaFlow
          </p>
          <span className="hidden border-l border-surface-border pl-3 text-xs font-medium uppercase tracking-[0.14em] text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark sm:block">
            Workforce scheduling platform
          </span>
        </div>

        <span
          className={cn(
            'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
            online
              ? 'border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark'
              : 'border-warning/30 bg-warning/10 text-warning',
          )}
        >
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 rounded-full', online ? 'bg-success' : 'bg-warning')}
          />
          {online ? 'Online' : 'Offline'}
        </span>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-12 md:px-10">
        <div className="mb-10 text-center">
          <p className="mb-2 text-sm text-content-muted dark:text-content-muted-dark">
            Starting up RotaFlow…
          </p>
          <h1 className="mb-2 font-display text-3xl font-semibold text-content dark:text-content-dark md:text-4xl">
            Preparing your workspace
          </h1>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {online
              ? "We're getting everything ready for you."
              : "You're offline — RotaFlow will use what it has cached."}
          </p>
        </div>

        <ol
          className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
          aria-label="Startup progress"
        >
          {stages.map(({ icon: Icon, label, state }) => (
            <li key={label} className="flex flex-col items-center text-center">
              <span className="relative mb-3">
                <span
                  className={cn(
                    'grid h-16 w-16 place-items-center rounded-full border-2 transition-colors',
                    state === 'done' && 'border-primary/30 bg-primary/5 text-primary',
                    state === 'active' && 'border-primary bg-primary/5 text-primary',
                    state === 'pending' &&
                      'border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark',
                  )}
                >
                  <Icon size={24} aria-hidden="true" />
                </span>
                {state === 'done' && (
                  <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-success text-white">
                    <Check size={14} aria-hidden="true" />
                  </span>
                )}
              </span>
              <p className="text-sm font-medium text-content dark:text-content-dark">
                {label}
              </p>
              <p
                className={cn(
                  'text-xs',
                  state === 'pending'
                    ? 'text-content-muted dark:text-content-muted-dark'
                    : 'text-primary',
                )}
              >
                {STAGE_COPY[state]}
              </p>
            </li>
          ))}
        </ol>

        <div className="mb-10 rounded-2xl border border-surface-border bg-surface p-5 dark:border-surface-border-dark dark:bg-surface-dark">
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium text-content dark:text-content-dark">
              {active?.label ?? 'Finalising'}
            </p>
            <p className="font-mono text-sm text-primary">{percent}%</p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Startup progress"
            className="h-2 overflow-hidden rounded-full bg-surface-border dark:bg-surface-border-dark"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-content dark:text-content-dark">
                  {title}
                </p>
                <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
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
