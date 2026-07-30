import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface StepCompleteProps {
  orgName: string;
  planLabel: string;
  locationCount: number;
  inviteCount: number;
  onFinish: () => void;
}

/**
 * Destinations that actually exist. design/Onboarding-Complete.png shows
 * "Set up shift types" / "Customise notifications" linking to a shift-types
 * page and a settings page — neither exists in this app (shift types are
 * configured from a modal inside the rota builder, and there is no settings
 * route yet). Substituted with the two other real setup surfaces
 * (Locations, Staff) rather than link to something that 404s.
 */
const NEXT_STEPS = [
  {
    icon: CalendarDays,
    tint: 'bg-brand-wash text-brand dark:bg-brand-deep/20 dark:text-brand-light',
    title: 'Build your first rota',
    body: 'Create a rota for your team in a few minutes.',
    to: '/app/rota',
    cta: 'Go to Rota Builder',
  },
  {
    icon: Users,
    tint: 'bg-shift-violet/15 text-shift-violet',
    title: 'Add more team members',
    body: 'Invite more colleagues to join your organisation.',
    to: '/app/team',
    cta: 'Invite team',
  },
  {
    icon: MapPin,
    tint: 'bg-shift-teal/15 text-shift-teal',
    title: 'Set up your locations',
    body: 'Add the sites and departments you schedule across.',
    to: '/app/locations',
    cta: 'Manage locations',
  },
  {
    icon: Users,
    tint: 'bg-shift-amber/20 text-shift-amber',
    title: 'Add your staff',
    body: 'Build the staff directory your rotas are assigned to.',
    to: '/app/staff',
    cta: 'Go to staff',
  },
];

export function StepComplete({
  orgName,
  planLabel,
  locationCount,
  inviteCount,
  onFinish,
}: StepCompleteProps): JSX.Element {
  const summary = [
    { icon: Building2, label: orgName, hint: `${planLabel} plan` },
    {
      icon: MapPin,
      label: `${locationCount} location${locationCount === 1 ? '' : 's'}`,
      hint: locationCount > 0 ? 'Configured' : 'Add one to start scheduling',
    },
    {
      icon: Users,
      label: `${inviteCount} invitation${inviteCount === 1 ? '' : 's'}`,
      hint: inviteCount > 0 ? 'Links ready to send' : 'None yet',
    },
    // The reference shows a "Next billing: 1 Jun 2025" date here — there is no
    // billing engine behind plan selection (see PLANS in constants.ts: "No
    // charge is taken anywhere"), so a real date would be a fabricated claim.
    { icon: ShieldCheck, label: 'No billing set up', hint: 'No payment taken' },
  ];

  return (
    <Card className="animate-fade-up p-6 shadow md:p-8">
      <div className="relative mb-8 text-center">
        <div className="relative mx-auto mb-4 h-20 w-20">
          <span
            aria-hidden="true"
            className="absolute -left-3 top-1 h-2 w-2 rounded-full bg-shift-amber"
          />
          <span
            aria-hidden="true"
            className="absolute -right-2 top-3 h-1.5 w-1.5 rounded-full bg-shift-violet"
          />
          <span
            aria-hidden="true"
            className="absolute -right-3 bottom-2 h-2 w-2 rounded-full bg-brand"
          />
          <span
            aria-hidden="true"
            className="absolute -left-2 bottom-0 h-1.5 w-1.5 rounded-full bg-shift-teal"
          />
          <span className="grid h-20 w-20 place-items-center rounded-full bg-success text-white">
            <CheckCircle2 size={40} aria-hidden="true" />
          </span>
        </div>
        <h2 className="font-display text-2xl font-bold text-ink dark:text-content-dark">
          Your organisation is ready!
        </h2>
        <p className="text-content-muted dark:text-content-muted-dark">
          You can now start scheduling and managing your team in RotaFlow.
        </p>
      </div>

      <div className="mb-8 flex items-start gap-3 rounded-xl border border-success/20 bg-success/5 p-4">
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
        <div>
          <p className="text-sm font-semibold text-ink dark:text-content-dark">
            Your account is secure and ready to use.
          </p>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            We&rsquo;ve set everything up based on your selections.
          </p>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="mb-3 text-sm font-semibold text-ink dark:text-content-dark">
          Your organisation summary
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(({ icon: Icon, label, hint }) => (
            <div
              key={label}
              className="rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
            >
              <Icon size={18} aria-hidden="true" className="mb-2 text-brand" />
              <p className="truncate text-sm font-medium text-ink dark:text-content-dark">
                {label}
              </p>
              <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                {hint}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="mb-3 text-sm font-semibold text-ink dark:text-content-dark">
          Next steps
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {NEXT_STEPS.map(({ icon: Icon, tint, title, body, to, cta }, i) => (
            <div
              key={title}
              className="relative flex flex-col rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
            >
              <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-surface-subtle text-[0.65rem] font-semibold text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark">
                {i + 1}
              </span>
              <span className={cn('mb-3 grid h-11 w-11 place-items-center rounded-xl', tint)}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold text-ink dark:text-content-dark">{title}</p>
              <p className="mb-4 flex-1 text-xs text-content-muted dark:text-content-muted-dark">
                {body}
              </p>
              <Link to={to} onClick={onFinish}>
                <Button
                  size="sm"
                  variant={i === 0 ? 'primary' : 'secondary'}
                  className={cn('w-full', i === 0 && 'bg-brand hover:bg-brand/90 dark:bg-brand')}
                >
                  {cta}
                  <ArrowRight size={14} aria-hidden="true" className="ml-1" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-surface-border pt-6 dark:border-surface-border-dark sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          🎉 <span className="font-medium text-ink dark:text-content-dark">Welcome aboard!</span>{' '}
          We&rsquo;re excited to help you streamline your workforce scheduling.
        </p>
        <div className="flex shrink-0 gap-3">
          <Button variant="secondary" onClick={onFinish}>
            Explore dashboard
          </Button>
          <Button className="bg-brand hover:bg-brand/90 dark:bg-brand" onClick={onFinish}>
            Go to dashboard
            <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
