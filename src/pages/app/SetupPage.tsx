import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, CircleDashed, Lock } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { loadSetupFacts } from '@/services/setupService';
import {
  buildSetupSteps,
  summariseSetup,
  type SetupStep,
  type SetupStepStatus,
} from '@/lib/setupProgress';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';

const STATUS_META: Record<
  SetupStepStatus,
  { label: string; icon: typeof Check; wrap: string; ring: string }
> = {
  done: {
    label: 'Done',
    icon: Check,
    wrap: 'bg-success-wash text-success-ink dark:bg-success-wash-dark dark:text-success-ink-dark',
    ring: 'ring-success/30',
  },
  todo: {
    label: 'To do',
    icon: ArrowRight,
    wrap: 'bg-primary-wash text-primary-ink dark:bg-primary-wash-dark dark:text-primary-ink-dark',
    ring: 'ring-primary/30',
  },
  blocked: {
    label: 'Waiting',
    icon: Lock,
    wrap: 'bg-surface-subtle text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
    ring: 'ring-surface-border dark:ring-surface-border-dark',
  },
  optional: {
    label: 'Optional',
    icon: CircleDashed,
    wrap: 'bg-surface-subtle text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
    ring: 'ring-surface-border dark:ring-surface-border-dark',
  },
};

function StepRow({
  step,
  stepsById,
}: {
  step: SetupStep;
  stepsById: Map<string, SetupStep>;
}): JSX.Element {
  const meta = STATUS_META[step.status];
  const Icon = meta.icon;
  const blocker = step.blockedBy ? stepsById.get(step.blockedBy) : undefined;

  return (
    <li className="flex gap-3 border-b border-surface-border py-4 last:border-0 dark:border-surface-border-dark">
      <span
        className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1',
          meta.wrap,
          meta.ring,
        )}
      >
        <Icon size={15} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold text-content dark:text-content-dark">
            {step.title}
          </span>
          {/* The status is a word, not only a colour and a glyph. */}
          <span className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
            {meta.label}
            {step.required ? '' : ' · recommended'}
          </span>
        </p>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          {step.why}
        </p>
        {/* What the database currently holds, shown whatever the status —
            "3 sites" is more use than a tick, and it is the thing that makes
            this a report rather than a checklist somebody ticked once. */}
        <p className="mt-1 text-sm text-content dark:text-content-dark">{step.detail}</p>
        {step.status === 'blocked' && blocker && (
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            Needs {blocker.title.toLowerCase()} first.
          </p>
        )}
      </div>

      <div className="shrink-0 self-center">
        {/* Always a link, including on a finished step: "done" is a count that
            can go back down, and a person reading this wants to go and look. */}
        <Link
          to={step.to}
          className="inline-flex h-9 items-center rounded-xl border border-surface-border px-3 text-sm font-medium text-primary-ink hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-primary-ink-dark dark:hover:bg-surface-subtle-dark"
        >
          {step.status === 'done' ? 'Review' : 'Open'}
          <span className="sr-only"> {step.title}</span>
        </Link>
      </div>
    </li>
  );
}

/**
 * `/app/setup` — what this organisation still has to set up, read from the
 * database rather than from anything it remembers about itself.
 *
 * ## Why it is not the onboarding wizard
 *
 * `/onboarding` covers the account: create the organisation, its details,
 * invite people, choose a plan. It resumes correctly and it is not what this
 * replaces. What nothing covered is the workforce — locations, departments,
 * job titles, shift types, staffing minimums, staff, and a first published
 * rota. Each is built on its own screen and persists correctly, and until now
 * nothing anywhere said which of them an organisation had none of. A new
 * customer finished the wizard, landed on a dashboard reporting zero of
 * everything, and had to work out for themselves that a rota needs a location
 * before it needs a shift.
 *
 * ## Why the progress is a query
 *
 * Every row's status is a count read back through RLS, so it cannot drift
 * from the thing it describes. There is no stored "step 4 complete" flag,
 * because a flag and the rows it claims to describe part company the moment
 * somebody deletes their only location — and the flag is the one that gets
 * believed.
 *
 * That also makes this screen useful long after setup: delete every location
 * and it says so.
 */
export function SetupPage(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const [steps, setSteps] = useState<SetupStep[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    setFailed(false);
    try {
      setSteps(buildSetupSteps(await loadSetupFacts(orgId)));
    } catch (error) {
      reportError(error, { area: 'setup:load' });
      // Not `setSteps([])`. An empty checklist reads as "nothing to do",
      // which is the opposite of what a failed read means.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Somebody working through this list has the screen open in another tab, or
  // is doing it alongside a colleague. Re-reading on a change is what makes a
  // step tick over without a reload.
  useRealtimeRefresh({
    tables: [
      'locations',
      'departments',
      'shift_types',
      'staff_profiles',
      'rotas',
      'invites',
    ],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const summary = steps ? summariseSetup(steps) : null;
  const stepsById = new Map((steps ?? []).map((step) => [step.id, step]));

  return (
    <div className="max-w-3xl">
      <WorkspaceHeader
        title="Set up"
        subtitle={`What ${orgName ?? 'this organisation'} still needs before a rota can be published. Read from your data, not from a checklist anybody ticked.`}
        primaryAction={
          summary?.next ? (
            <Link
              to={summary.next.to}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary/90"
            >
              {summary.next.title}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : undefined
        }
      />

      {loading && (
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      )}

      {failed && (
        <Card className="max-w-md">
          <p className="mb-4 flex items-start gap-2 text-sm text-content-muted dark:text-content-muted-dark">
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            Your setup could not be read. This is not the same as having nothing set up —
            nothing is known either way until it loads.
          </p>
          <Button onClick={() => void load()}>Retry</Button>
        </Card>
      )}

      {steps && summary && !failed && (
        <>
          <Card className="mb-5 p-5">
            <p
              aria-live="polite"
              className="font-semibold text-content dark:text-content-dark"
            >
              {summary.complete
                ? 'Everything needed to run a rota is in place.'
                : `${summary.requiredDone} of ${summary.requiredTotal} essentials done`}
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {summary.complete
                ? 'The recommended steps below are improvements, not requirements. Nothing here blocks you.'
                : 'The recommended steps are improvements and never block anything — an organisation with one site genuinely needs no departments.'}
            </p>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-surface-subtle dark:bg-surface-subtle-dark"
              role="presentation"
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{
                  width: `${Math.round((summary.requiredDone / Math.max(1, summary.requiredTotal)) * 100)}%`,
                }}
              />
            </div>
          </Card>

          <Card className="p-5">
            <ul>
              {steps.map((step) => (
                <StepRow key={step.id} step={step} stepsById={stepsById} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
