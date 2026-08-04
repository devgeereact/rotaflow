import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { RequestSupportAccessModal } from '@/components/admin/RequestSupportAccessModal';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  AdminStat,
} from '@/components/admin/AdminPage';
import { useToast } from '@/hooks/useToast';
import { listAllOrganisations } from '@/services/platformService';
import {
  listSupportAccessSessions,
  requestSupportAccess,
  revokeSupportAccess,
} from '@/services/supportAccessService';
import {
  SCOPE_LABELS,
  formatRemaining,
  millisecondsRemaining,
  sessionStatus,
  type SupportAccessSession,
  type SupportAccessStatus,
} from '@/lib/supportAccess';
import type { Organisation } from '@/types';

const STATUS_TONE: Record<SupportAccessStatus, BadgeTone> = {
  active: 'warning',
  expired: 'neutral',
  revoked: 'neutral',
};

type ColumnKey = 'org' | 'admin' | 'reason' | 'scope' | 'granted' | 'expires' | 'status';

/**
 * `/admin/support-access` — NEW_STRUCTURE §34's temporary support access.
 *
 * ## What a row here means, precisely
 *
 * It means a named platform administrator stated a reason, quoted a case
 * reference, and accepted a deadline. It does **not** mean access was switched
 * on: platform staff already hold cross-tenant read through `has_platform_role`
 * (0015), and 0019 deliberately does not make that read conditional on an open
 * session, because doing it halfway would produce a table that looks like an
 * access control and is not one.
 *
 * That distinction is on the screen rather than buried in a migration comment,
 * because "we have support access sessions" is exactly the sentence someone
 * repeats to a customer, and it needs to survive being repeated accurately.
 *
 * The customer's opt-out *is* enforced: `request_support_access` refuses
 * outright when `support_access_allowed` is false, in the database, so no
 * console path can route around it.
 */
export function AdminSupportAccessPage(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const [sessions, setSessions] = useState<SupportAccessSession[] | null>(null);
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [failed, setFailed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // One clock for the whole render pass, ticking once a minute. Every row and
  // the countdown agree about "now" rather than each sampling it separately.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      const [rows, allOrgs] = await Promise.all([
        listSupportAccessSessions(),
        listAllOrganisations(),
      ]);
      setSessions(rows);
      setOrgs(allOrgs);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => (sessions ?? []).filter((s) => sessionStatus(s, now) === 'active'),
    [sessions, now],
  );

  const handleRevoke = useCallback(
    async (session: SupportAccessSession): Promise<void> => {
      try {
        await revokeSupportAccess(session.id, 'Revoked from the platform console');
        showSuccess(`Access to ${session.orgName} revoked.`);
        await load();
      } catch (error) {
        showError(
          error instanceof Error ? error.message : 'Could not revoke that session.',
        );
      }
    },
    [load, showError, showSuccess],
  );

  const columns: readonly DataTableColumn<SupportAccessSession, ColumnKey>[] = useMemo(
    () => [
      {
        key: 'org',
        label: 'Organisation',
        cell: (s) => (
          <span className="font-medium text-content dark:text-content-dark">
            {s.orgName}
          </span>
        ),
      },
      { key: 'admin', label: 'Administrator', cell: (s) => s.adminName },
      {
        key: 'reason',
        label: 'Reason',
        cell: (s) => (
          <span
            className="block max-w-md truncate text-content-muted dark:text-content-muted-dark"
            title={s.reason}
          >
            {s.reason}
          </span>
        ),
      },
      {
        key: 'scope',
        label: 'Scope',
        cell: (s) => (
          <Badge tone={s.scope === 'read_write' ? 'danger' : 'neutral'}>
            {SCOPE_LABELS[s.scope]}
          </Badge>
        ),
      },
      {
        key: 'granted',
        label: 'Started',
        cell: (s) => new Date(s.grantedAt).toLocaleString('en-GB'),
      },
      {
        key: 'expires',
        label: 'Expires',
        cell: (s) => {
          const status = sessionStatus(s, now);
          if (status !== 'active') return new Date(s.expiresAt).toLocaleString('en-GB');
          return (
            <span className="font-medium text-warning">
              in {formatRemaining(millisecondsRemaining(s.expiresAt, now))}
            </span>
          );
        },
      },
      {
        key: 'status',
        label: 'Status',
        cell: (s) => {
          const status = sessionStatus(s, now);
          return (
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[status]}>{status}</Badge>
              {status === 'active' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleRevoke(s)}
                >
                  Revoke
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [now, handleRevoke],
  );

  return (
    <AdminPage
      title="Support access"
      description="Time-boxed, justified records of platform staff opening a customer's data."
      action={
        <Button onClick={() => setRequesting(true)}>
          <KeyRound size={16} aria-hidden="true" />
          Request support access
        </Button>
      }
    >
      <div className="space-y-6">
        {active.length > 0 && (
          <Card className="border-warning/40 bg-warning/5">
            <div className="flex flex-wrap items-start gap-3">
              <ShieldAlert size={20} className="mt-0.5 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-content dark:text-content-dark">
                  {active.length} session{active.length === 1 ? '' : 's'} open right now
                </h2>
                <ul className="mt-1 space-y-1 text-sm text-content-muted dark:text-content-muted-dark">
                  {active.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium text-content dark:text-content-dark">
                        {s.adminName}
                      </span>{' '}
                      is viewing {s.orgName} — expires in{' '}
                      {formatRemaining(millisecondsRemaining(s.expiresAt, now))} (
                      {s.caseRef})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStat label="Open now" value={active.length} hint="Live sessions" />
          <AdminStat
            label="Recorded"
            value={sessions?.length ?? '—'}
            hint="Most recent 100"
          />
          <AdminStat
            label="Revoked early"
            value={(sessions ?? []).filter((s) => s.revokedAt !== null).length}
            hint="Ended before expiry"
          />
          <AdminStat
            label="Write access"
            value={(sessions ?? []).filter((s) => s.scope === 'read_write').length}
            hint="Sessions that could change data"
          />
        </div>

        <Card className="p-0">
          {failed ? (
            <AdminError onRetry={() => void load()} />
          ) : sessions === null ? (
            <AdminLoading rows={5} />
          ) : sessions.length === 0 ? (
            <AdminEmpty message="No support session has ever been opened." />
          ) : (
            <DataTable
              caption="Support access sessions, newest first"
              columns={columns}
              rows={sessions}
              rowKey={(s) => s.id}
            />
          )}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
            What a session here does, and does not, do
          </h2>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            A row records that a named administrator stated a reason, quoted a case
            reference and accepted a deadline. It is an accountability trail.{' '}
            <strong className="text-content dark:text-content-dark">
              It is not the thing that grants access
            </strong>{' '}
            — platform staff already hold cross-tenant read, and making that read
            conditional on an open session touches every policy in the platform-roles
            migration. Saying otherwise to a customer would be wrong.
          </p>
          <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
            What <em>is</em> enforced in the database: a customer who turns support access
            off cannot have a session opened against them, the reason and case reference
            are required, and no session can outlast 24 hours. The organisation&rsquo;s
            own owner can end any session, and sees the same records you do.
          </p>
        </Card>
      </div>

      <RequestSupportAccessModal
        open={requesting}
        orgs={orgs}
        busy={submitting}
        onClose={() => setRequesting(false)}
        onSubmit={async (input) => {
          setSubmitting(true);
          try {
            await requestSupportAccess(input);
            showSuccess('Support access opened. The organisation has been notified.');
            setRequesting(false);
            await load();
          } catch (error) {
            showError(
              error instanceof Error
                ? error.message
                : 'Could not open a support session.',
            );
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </AdminPage>
  );
}
