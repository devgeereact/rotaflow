import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface StepCompleteProps {
  orgName: string;
  planLabel: string;
  locationCount: number;
  inviteCount: number;
  onFinish: () => void;
}

const NEXT_STEPS = [
  {
    icon: CalendarDays,
    title: 'Build your first rota',
    body: 'Create a rota for your team in a few minutes.',
    to: '/app/rota',
    cta: 'Go to rota builder',
  },
  {
    icon: Users,
    title: 'Add more team members',
    body: 'Invite more colleagues to join your organisation.',
    to: '/app/team',
    cta: 'Invite team',
  },
  {
    icon: MapPin,
    title: 'Set up your locations',
    body: 'Add the sites and departments you schedule across.',
    to: '/app/locations',
    cta: 'Manage locations',
  },
  {
    icon: Bell,
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
    { icon: ShieldCheck, label: 'No billing set up', hint: 'No payment taken' },
  ];

  return (
    <Card className="animate-fade-up p-6 md:p-8">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 size={40} aria-hidden="true" />
        </span>
        <h2 className="font-display text-2xl font-semibold text-content dark:text-content-dark">
          Your organisation is ready
        </h2>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          You can now start scheduling and managing your team in RotaFlow.
        </p>
      </div>

      <div className="mb-8">
        <h3 className="mb-3 text-sm font-medium text-content dark:text-content-dark">
          Your organisation summary
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(({ icon: Icon, label, hint }) => (
            <div
              key={label}
              className="rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
            >
              <Icon size={18} aria-hidden="true" className="mb-2 text-primary" />
              <p className="truncate text-sm font-medium text-content dark:text-content-dark">
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
        <h3 className="mb-3 text-sm font-medium text-content dark:text-content-dark">
          Next steps
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {NEXT_STEPS.map(({ icon: Icon, title, body, to, cta }) => (
            <div
              key={title}
              className="flex flex-col rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
            >
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon size={20} aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-content dark:text-content-dark">
                {title}
              </p>
              <p className="mb-4 flex-1 text-xs text-content-muted dark:text-content-muted-dark">
                {body}
              </p>
              <Link to={to} onClick={onFinish}>
                <Button size="sm" variant="secondary" className="w-full">
                  {cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end border-t border-surface-border pt-6 dark:border-surface-border-dark">
        <Button onClick={onFinish}>
          Go to dashboard
          <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
        </Button>
      </div>
    </Card>
  );
}
