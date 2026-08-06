import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import {
  listActiveSessionsForOrg,
  revokeSupportAccess,
} from '@/services/supportAccessService';
import {
  formatRemaining,
  millisecondsRemaining,
  SCOPE_LABELS,
  type SupportAccessSession,
} from '@/lib/supportAccess';

/**
 * Tells this organisation, in their own app, that RotaFlow staff are currently
 * looking at their data.
 *
 * ## Why this is the important half of support access
 *
 * The console screen is for us. This is for them. A support-access system whose
 * only visible surface is the administrator's own console is a log we keep
 * about ourselves. The customer has to ask, and trust the answer. Showing it
 * here, unprompted, with the reason and the case reference and a button that
 * ends it, is the difference between an audit trail and actual accountability.
 *
 * Renders nothing at all in the overwhelmingly common case. The query filters
 * on the partial index from 0019 and returns no rows when nobody is looking, so
 * the cost of that common case is one cheap request per org switch.
 */
export function SupportAccessBanner(): JSX.Element | null {
  const { orgId, role } = useOrg();
  const { showError, showSuccess } = useToast();
  const [sessions, setSessions] = useState<SupportAccessSession[]>([]);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) {
      setSessions([]);
      return;
    }
    try {
      setSessions(await listActiveSessionsForOrg(orgId));
    } catch {
      // Deliberately silent. A failure to read the banner must not put an
      // error toast in front of a care worker trying to clock in. The
      // console remains the authoritative record either way.
      setSessions([]);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-check every minute: this both counts the banner down and makes it
  // disappear on its own when the session expires, without a page reload.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
      void load();
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const live = sessions.filter((s) => millisecondsRemaining(s.expiresAt, now) > 0);
  if (live.length === 0) return null;

  const handleRevoke = async (session: SupportAccessSession): Promise<void> => {
    try {
      await revokeSupportAccess(session.id, 'Ended by the organisation');
      showSuccess('Support access ended. RotaFlow staff can no longer view your data.');
      await load();
    } catch (error) {
      showError(
        error instanceof Error ? error.message : 'Could not end that support session.',
      );
    }
  };

  return (
    <div
      role="status"
      className="border-b border-warning/30 bg-warning/10 px-6 py-3 md:px-10"
    >
      {live.map((session) => (
        <div key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ShieldAlert size={18} className="shrink-0 text-warning" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-content dark:text-content-dark">
            <span className="font-semibold">RotaFlow support is viewing your data.</span>{' '}
            {session.adminName} opened a {SCOPE_LABELS[session.scope].toLowerCase()}{' '}
            session for case {session.caseRef}, “{session.reason}”. It ends automatically
            in{' '}
            <span className="font-semibold">
              {formatRemaining(millisecondsRemaining(session.expiresAt, now))}
            </span>
            .
          </p>
          {/* Only an owner may end it. Matching `revoke_support_access`, which
              refuses anyone else. Showing a button that raises 42501 to a
              manager would be worse than not showing one. */}
          {role === 'owner' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleRevoke(session)}
            >
              End this session
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
