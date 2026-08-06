import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { useToast } from '@/hooks/useToast';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { DEMO_DENIED_BY_OWNER } from '@/lib/adminOverviewDemo';
import { listAllOrganisations } from '@/services/platformService';
import {
  listSupportAccessSessions,
  requestSupportAccess,
  revokeSupportAccess,
} from '@/services/supportAccessService';
import {
  SCOPE_LABELS,
  SUPPORT_ACCESS_DURATIONS,
  formatRemaining,
  millisecondsRemaining,
  sessionStatus,
  summariseSessions,
  validateRequest,
  type SupportAccessScope,
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
 * `/admin/support-access`. NEW_STRUCTURE §34's temporary support access.
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

  // `load` is stable via useCallback, so this registers once and is cleared on
  // unmount by the hook itself.
  const refresh = useCallback(() => void load(), [load]);
  useRegisterConsoleRefresh(refresh);

  const stats = useMemo(() => summariseSessions(sessions ?? [], now), [sessions, now]);

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
      title="Temporary support access"
      description="Every session is scoped, time limited, tied to a case, revocable, and disclosed to the organisation owner. There is no permanent back door into a tenant."
      action={
        <Button onClick={() => setRequesting(true)}>
          <KeyRound size={16} aria-hidden="true" />
          Request access
        </Button>
      }
    >
      <div className="space-y-6">
        {active.length > 0 ? (
          <Callout
            tone="warning"
            title={`${active.length} session${active.length === 1 ? '' : 's'} open right now`}
          >
            <ul className="mt-1 space-y-1">
              {active.map((session) => (
                <li key={session.id}>
                  <span className="font-medium text-content dark:text-content-dark">
                    {session.adminName}
                  </span>{' '}
                  is viewing {session.orgName}. Expires in{' '}
                  {formatRemaining(millisecondsRemaining(session.expiresAt, now))} (
                  {session.caseRef})
                </li>
              ))}
            </ul>
          </Callout>
        ) : (
          <Callout tone="info">
            <p>
              No support session is currently active. Granting one writes an immutable
              audit record before the first byte of tenant data is read.
            </p>
          </Callout>
        )}

        <TileGrid>
          <StatTile
            label="Active sessions"
            value={stats.active}
            hint={
              stats.active ? 'Someone is inside a tenant' : 'Nobody is inside a tenant'
            }
          />
          <StatTile label="Granted this month" value={stats.grantedThisMonth} />
          <StatTile
            label="Median duration"
            value={stats.medianMinutes === null ? '-' : `${stats.medianMinutes}m`}
            hint={stats.medianMinutes === null ? 'No session has ended yet' : undefined}
          />
          <StatTile
            label="Revoked early"
            value={stats.revokedEarly}
            hint="by administrator or owner"
          />
          <StatTile label="Expired" value={stats.expired} hint="Ran to the deadline" />
          {/* The reference calls this "Denied by owner". A refusal is not
              recorded anywhere, `request_support_access` simply raises, so
              this is the one placeholder on an otherwise measured screen. */}
          <StatTile
            label="Denied by owner"
            value={DEMO_DENIED_BY_OWNER}
            hint="Placeholder. Refusals are not recorded"
          />
        </TileGrid>

        <Panel
          title="Session history"
          actions={<Badge tone="neutral">Retained 7 years</Badge>}
          flush
        >
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
        </Panel>

        <Panel title="What a session here does, and does not, do">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            A row records that a named administrator stated a reason, quoted a case
            reference and accepted a deadline. It is an accountability trail.{' '}
            <strong className="text-content dark:text-content-dark">
              It is not the thing that grants access
            </strong>{' '}
            . Platform staff already hold cross-tenant read, and making that read
            conditional on an open session touches every policy in the platform-roles
            migration. Saying otherwise to a customer would be wrong.
          </p>
          <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
            What <em>is</em> enforced in the database: a customer who turns support access
            off cannot have a session opened against them, the reason and case reference
            are required, and no session can outlast 24 hours. The organisation&rsquo;s
            own owner can end any session, and sees the same records you do.
          </p>
        </Panel>
      </div>

      <RequestModal
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

interface RequestInput {
  orgId: string;
  reason: string;
  caseRef: string;
  scope: SupportAccessScope;
  minutes: number;
}

function RequestModal({
  open,
  orgs,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  orgs: readonly Organisation[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: RequestInput) => Promise<void>;
}): JSX.Element {
  const [orgId, setOrgId] = useState('');
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [scope, setScope] = useState<SupportAccessScope>('read');
  const [minutes, setMinutes] = useState(60);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (): void => {
    const found = validateRequest({ orgId, reason, caseRef, minutes });
    const all: Record<string, string> = { ...found };
    if (!confirmed) {
      all.confirmed = 'Confirm that this access is necessary before continuing.';
    }
    setErrors(all);
    if (Object.keys(all).length > 0) return;
    void onSubmit({ orgId, reason, caseRef, scope, minutes });
  };

  return (
    <Modal open={open} onClose={onClose} title="Request support access">
      <div className="space-y-4">
        <div>
          <Label htmlFor="sa-org">Organisation</Label>
          <Select
            id="sa-org"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            aria-invalid={Boolean(errors.orgId)}
          >
            <option value="">Choose an organisation…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          {errors.orgId && <FieldError message={errors.orgId} />}
        </div>

        <div>
          <Label htmlFor="sa-reason">Support reason</Label>
          <textarea
            id="sa-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Investigating the rota publish failure reported in CASE-2400."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Recorded permanently and visible to the organisation&rsquo;s owner.
          </p>
          {errors.reason && <FieldError message={errors.reason} />}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sa-case">Case reference</Label>
            <Input
              id="sa-case"
              value={caseRef}
              onChange={(e) => setCaseRef(e.target.value)}
              placeholder="CASE-2400"
            />
            {errors.caseRef && <FieldError message={errors.caseRef} />}
          </div>
          <div>
            <Label htmlFor="sa-duration">Duration</Label>
            <Select
              id="sa-duration"
              value={String(minutes)}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {SUPPORT_ACCESS_DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </Select>
            {errors.minutes && <FieldError message={errors.minutes} />}
          </div>
        </div>

        <div>
          <Label htmlFor="sa-scope">Access scope</Label>
          <Select
            id="sa-scope"
            value={scope}
            onChange={(e) =>
              setScope(e.target.value === 'read_write' ? 'read_write' : 'read')
            }
          >
            <option value="read">Read only</option>
            <option value="read_write">Read and write</option>
          </Select>
        </div>

        <label className="flex items-start gap-2 text-sm text-content dark:text-content-dark">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            I confirm that this access is necessary to resolve the identified support
            issue.
          </span>
        </label>
        {errors.confirmed && <FieldError message={errors.confirmed} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Opening…' : 'Request access'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FieldError({ message }: { message: string }): JSX.Element {
  return (
    <p role="alert" className="mt-1 text-xs text-danger">
      {message}
    </p>
  );
}
