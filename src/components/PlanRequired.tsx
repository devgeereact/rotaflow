import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { usePermissions } from '@/hooks/usePermissions';

interface PlanRequiredProps {
  /** What the screen would have shown, e.g. "Reports". Reads inside a sentence. */
  area: string;
  /** The lowest plan that includes it, e.g. "Professional". */
  plan: string;
  /** One sentence on what they would get. */
  summary: string;
}

/**
 * Shown when someone reaches a screen their organisation's plan does not
 * include (docs/SAAS.md BUG-064).
 *
 * ## Not `PermissionDenied`, on purpose
 *
 * The two look similar and mean opposite things. `PermissionDenied` says "your
 * colleagues can see this and you cannot", and the way out is to ask an owner
 * for a role. This says "nobody here can see this yet", and the way out is a
 * billing decision. Sending someone to ask for a role change that would not
 * help is worse than saying nothing.
 *
 * ## This is packaging, not a control
 *
 * Worth being exact, because the distinction matters elsewhere in this
 * codebase. `RequireRole` and `PermissionDenied` sit in front of things RLS
 * also refuses; hiding the route stops an honest mistake and nothing else.
 * This component sits in front of a screen that computes its rows **in the
 * browser from the organisation's own records** — rows RLS grants them because
 * they are theirs. There is no server-side endpoint to refuse and no data
 * being withheld. It is a paywall on a convenience, and it should never be
 * described as enforcement.
 *
 * Where a plan limit governs a WRITE (`seat_limit`, `location_limit`) or
 * spends money (`ai_rota_assistant`), the enforcement is in the database or
 * the Edge Function, where it belongs — see `0070` and `0074`.
 */
export function PlanRequired({ area, plan, summary }: PlanRequiredProps): JSX.Element {
  // Billing is an owner's screen, so only an owner is offered the way to it.
  const { canManageOrg } = usePermissions();

  return (
    <Card className="mx-auto max-w-lg text-center" role="status" aria-live="polite">
      <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary-ink dark:text-primary-ink-dark">
        <Sparkles size={28} aria-hidden="true" />
      </span>

      <h1 className="font-display text-xl font-bold text-content dark:text-content-dark">
        {area} is included with {plan}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
        {summary}
      </p>

      {/* Only an owner can act on this. Showing a manager a button to a
          billing screen they cannot use turns a clear message into a dead
          end, so they get the sentence that tells them who to ask. */}
      {!canManageOrg && (
        <p className="mt-5 text-sm text-content-muted dark:text-content-muted-dark">
          An owner in your organisation can change the plan from Settings.
        </p>
      )}

      <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
        {canManageOrg && (
          <Link to="/app/settings/billing">
            <Button className="w-full sm:w-auto">See plans</Button>
          </Link>
        )}
        <Link to="/app/dashboard">
          <Button variant="secondary" className="w-full sm:w-auto">
            <ArrowLeft size={18} aria-hidden="true" />
            Back to dashboard
          </Button>
        </Link>
      </div>
    </Card>
  );
}
