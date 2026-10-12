import {
  ArrowRight,
  Building2,
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
  /**
   * Marks onboarding complete and leaves the wizard for `to`. Navigation is
   * the caller's, so the completion stamp and the destination cannot race.
   */
  onFinish: (to: string) => void;
}

/**
 * One primary next step and one secondary, nothing else.
 *
 * This step used to offer four cards, two of which went to `/app/team`, plus
 * two footer buttons that both went to the dashboard, and none to the setup
 * checklist. The checklist is the screen that says what is still missing, so
 * it is the secondary action; building the first rota is the primary one.
 */
const PRIMARY = { to: '/app/rota', label: 'Build your first rota' } as const;
const SECONDARY = { to: '/app/setup', label: 'Open setup checklist' } as const;

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
    // The reference shows a "Next billing: 1 Jun 2025" date here. There is no
    // billing engine behind plan selection (see PLANS in constants.ts: "No
    // charge is taken anywhere"), so a real date would be a fabricated claim.
    { icon: ShieldCheck, label: 'No billing set up', hint: 'No payment taken' },
  ];

  return (
    <Card className="animate-fade-up motion-reduce:animate-none p-6 shadow md:p-8">
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
          Your organisation is ready.
        </h2>
        <p className="text-content-muted dark:text-content-muted-dark">
          You can now start scheduling and managing your team in RotaFlow.
        </p>
      </div>

      <div className="mb-8 flex items-start gap-3 rounded-xl border border-success/20 bg-success/5 p-4">
        <ShieldCheck
          size={20}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-success"
        />
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

      <div className="flex flex-col gap-4 border-t border-surface-border pt-6 dark:border-surface-border-dark sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Start with a rota, or see what is still to set up.
        </p>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => onFinish(SECONDARY.to)}>
            {SECONDARY.label}
          </Button>
          <Button
            className="bg-brand hover:bg-brand/90 dark:bg-brand"
            onClick={() => onFinish(PRIMARY.to)}
          >
            {PRIMARY.label}
            <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
