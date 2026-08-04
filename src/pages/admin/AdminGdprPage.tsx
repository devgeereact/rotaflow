import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
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
  AdminStat,
} from '@/components/admin/AdminPage';
import { useToast } from '@/hooks/useToast';
import { listAllOrganisations } from '@/services/platformService';
import {
  extendGdprRequest,
  listGdprRequests,
  logGdprRequest,
  setGdprRequestStatus,
} from '@/services/gdprRequestService';
import {
  GDPR_KIND_LABELS,
  GDPR_STATUS_LABELS,
  deadlineState,
  effectiveDueDate,
  extendedDueDate,
  formatDeadline,
  isClosed,
  statutoryDueDate,
  todayIso,
  type DeadlineState,
  type GdprRequest,
  type GdprRequestKind,
  type GdprRequestStatus,
} from '@/lib/gdprRequests';
import type { Organisation } from '@/types';

const DEADLINE_TONE: Record<DeadlineState, BadgeTone> = {
  overdue: 'danger',
  due_soon: 'warning',
  on_track: 'success',
  closed: 'neutral',
};

const STATUS_TONE: Record<GdprRequestStatus, BadgeTone> = {
  received: 'info',
  in_progress: 'primary',
  awaiting_information: 'warning',
  completed: 'success',
  refused: 'neutral',
};

type ColumnKey = 'subject' | 'kind' | 'org' | 'received' | 'due' | 'status' | 'actions';

/**
 * `/admin/gdpr` — NEW_STRUCTURE §34's GDPR and data management.
 *
 * ## Why this is a deadline board, not a data browser
 *
 * 0011 already lets an organisation owner export and anonymise one staff
 * member from the staff screen. That is the *action*, and it lives where it is
 * used. This is the *obligation*: Article 12(3) gives one month from receipt,
 * extendable by two, and the breach is the lateness itself regardless of how
 * good the eventual answer was.
 *
 * So the screen is organised around the clock. Overdue first, then due within
 * a week, and the summary tiles count what is actually at risk rather than
 * what merely exists. It is a register you can be asked to produce, which is
 * the only form of this screen worth building.
 *
 * The deadline is computed by the database on insert, not supplied by this
 * page, and closing a request needs an outcome note — both enforced in 0020,
 * so neither can be skipped by a caller that forgets.
 */
export function AdminGdprPage(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const [requests, setRequests] = useState<GdprRequest[] | null>(null);
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [failed, setFailed] = useState(false);
  const [logging, setLogging] = useState(false);
  const [closing, setClosing] = useState<GdprRequest | null>(null);
  const [extending, setExtending] = useState<GdprRequest | null>(null);

  const today = todayIso();

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      const [rows, allOrgs] = await Promise.all([
        listGdprRequests(),
        listAllOrganisations(),
      ]);
      setRequests(rows);
      setOrgs(allOrgs);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const all = requests ?? [];
    const open = all.filter((r) => !isClosed(r.status));
    return {
      open: open.length,
      overdue: open.filter((r) => deadlineState(r, today) === 'overdue').length,
      dueSoon: open.filter((r) => deadlineState(r, today) === 'due_soon').length,
      unassignedOrg: open.filter((r) => r.orgId === null).length,
    };
  }, [requests, today]);

  const columns: readonly DataTableColumn<GdprRequest, ColumnKey>[] = useMemo(
    () => [
      {
        key: 'subject',
        label: 'Data subject',
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-content dark:text-content-dark">
              {r.subjectName ?? r.subjectEmail}
            </p>
            {r.subjectName && (
              <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                {r.subjectEmail}
              </p>
            )}
          </div>
        ),
      },
      { key: 'kind', label: 'Right', cell: (r) => GDPR_KIND_LABELS[r.kind] },
      {
        key: 'org',
        label: 'Organisation',
        cell: (r) =>
          r.orgName ?? (
            // Unresolved is a state worth acting on, not a blank cell: the
            // clock is already running on a request nobody has traced yet.
            <Badge tone="warning">Not yet identified</Badge>
          ),
      },
      { key: 'received', label: 'Received', cell: (r) => r.receivedOn },
      {
        key: 'due',
        label: 'Deadline',
        cell: (r) => {
          const state = deadlineState(r, today);
          return (
            <div className="flex flex-col gap-1">
              <Badge tone={DEADLINE_TONE[state]}>{formatDeadline(r, today)}</Badge>
              <span className="text-xs text-content-muted dark:text-content-muted-dark">
                {effectiveDueDate(r)}
                {r.extendedTo && ' (extended)'}
              </span>
            </div>
          );
        },
      },
      {
        key: 'status',
        label: 'Status',
        cell: (r) => (
          <Badge tone={STATUS_TONE[r.status]}>{GDPR_STATUS_LABELS[r.status]}</Badge>
        ),
      },
      {
        key: 'actions',
        label: '',
        cell: (r) =>
          isClosed(r.status) ? (
            <span className="text-xs text-content-muted dark:text-content-muted-dark">
              {r.outcomeNote ? 'Outcome recorded' : '—'}
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setClosing(r)}>
                Close
              </Button>
              {!r.extendedTo && (
                <Button size="sm" variant="ghost" onClick={() => setExtending(r)}>
                  Extend
                </Button>
              )}
            </div>
          ),
      },
    ],
    [today],
  );

  return (
    <AdminPage
      title="GDPR and data"
      description="Data subject requests and the statutory clock running on each one."
      action={
        <Button onClick={() => setLogging(true)}>
          <Plus size={16} aria-hidden="true" />
          Log a request
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStat label="Open" value={counts.open} hint="Not yet closed" />
          <AdminStat
            label="Overdue"
            value={counts.overdue}
            hint="Past the statutory deadline"
          />
          <AdminStat label="Due within 7 days" value={counts.dueSoon} hint="Chase now" />
          <AdminStat
            label="Organisation unknown"
            value={counts.unassignedOrg}
            hint="Clock running, tenant not traced"
          />
        </div>

        {counts.overdue > 0 && (
          <Card className="border-danger/40 bg-danger/5">
            <div className="flex items-start gap-3">
              <CalendarClock
                size={20}
                className="mt-0.5 text-danger"
                aria-hidden="true"
              />
              <p className="text-sm text-content dark:text-content-dark">
                <span className="font-semibold">
                  {counts.overdue} request{counts.overdue === 1 ? ' is' : 's are'} past
                  the statutory deadline.
                </span>{' '}
                Under Article 12(3) the lateness is itself the breach, regardless of the
                eventual answer. If a request is complex, extend it and tell the subject
                why — an extension taken late is worth more than none at all.
              </p>
            </div>
          </Card>
        )}

        <Card className="p-0">
          {failed ? (
            <AdminError onRetry={() => void load()} />
          ) : requests === null ? (
            <AdminLoading rows={6} />
          ) : requests.length === 0 ? (
            <AdminEmpty message="No data subject request has been logged." />
          ) : (
            <DataTable
              caption="Data subject requests, earliest deadline first"
              columns={columns}
              rows={requests}
              rowKey={(r) => r.id}
            />
          )}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
            What this register does and does not cover
          </h2>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            It records the obligation: what was asked, by whom, when it arrived and when
            it must be answered. Deadlines are computed by the database from the date of
            receipt, and closing a request requires an outcome note — neither can be
            skipped from this screen.
          </p>
          <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
            It does not perform the work. Exporting or erasing a person&rsquo;s data is
            done by their organisation&rsquo;s owner from the staff record, which is where
            the data actually lives and where the right permissions apply. Telling the
            subject about an extension is an email someone still has to send — this
            database cannot do it, so it does not pretend the box being ticked means the
            person was informed.
          </p>
        </Card>
      </div>

      <LogRequestModal
        open={logging}
        orgs={orgs}
        onClose={() => setLogging(false)}
        onDone={async () => {
          setLogging(false);
          await load();
        }}
        onError={showError}
        onSuccess={showSuccess}
      />

      <CloseRequestModal
        request={closing}
        onClose={() => setClosing(null)}
        onDone={async () => {
          setClosing(null);
          await load();
        }}
        onError={showError}
        onSuccess={showSuccess}
      />

      <ExtendRequestModal
        request={extending}
        onClose={() => setExtending(null)}
        onDone={async () => {
          setExtending(null);
          await load();
        }}
        onError={showError}
        onSuccess={showSuccess}
      />
    </AdminPage>
  );
}

interface ModalCallbacks {
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function LogRequestModal({
  open,
  orgs,
  onClose,
  onDone,
  onError,
  onSuccess,
}: ModalCallbacks & { open: boolean; orgs: readonly Organisation[] }): JSX.Element {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GdprRequestKind>('access');
  const [orgId, setOrgId] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter the data subject's email address.");
      return;
    }
    if (receivedOn > todayIso()) {
      setError('A request cannot have been received in the future.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await logGdprRequest({
        subjectEmail: email,
        subjectName: name || undefined,
        kind,
        orgId: orgId || null,
        receivedOn,
      });
      onSuccess(`Request logged. Due ${statutoryDueDate(receivedOn)}.`);
      await onDone();
    } catch (e) {
      onError(message(e, 'Could not log that request.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log a data subject request">
      <div className="space-y-4">
        <div>
          <Label htmlFor="g-email">Data subject email</Label>
          <Input
            id="g-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.co.uk"
          />
        </div>
        <div>
          <Label htmlFor="g-name">Name (optional)</Label>
          <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="g-kind">Right exercised</Label>
            <Select
              id="g-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as GdprRequestKind)}
            >
              {Object.entries(GDPR_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="g-received">Received on</Label>
            <Input
              id="g-received"
              type="date"
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="g-org">Organisation (if known)</Label>
          <Select id="g-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Not yet identified</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-content-muted dark:text-content-muted-dark">
          The deadline is calculated from the date of receipt — one calendar month, per
          Article 12(3). Logging this on {todayIso()} for a request received {receivedOn}{' '}
          gives a deadline of {statutoryDueDate(receivedOn)}.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Logging…' : 'Log request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CloseRequestModal({
  request,
  onClose,
  onDone,
  onError,
  onSuccess,
}: ModalCallbacks & { request: GdprRequest | null }): JSX.Element {
  const [status, setStatus] = useState<GdprRequestStatus>('completed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (note.trim().length < 10) {
      setError('Say what was done — this is the record you would be asked to produce.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await setGdprRequestStatus(request?.id ?? '', status, note.trim());
      onSuccess(`Request marked ${GDPR_STATUS_LABELS[status].toLowerCase()}.`);
      setNote('');
      await onDone();
    } catch (e) {
      onError(message(e, 'Could not update that request.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={request !== null} onClose={onClose} title="Close this request">
      <div className="space-y-4">
        <div>
          <Label htmlFor="g-status">Outcome</Label>
          <Select
            id="g-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as GdprRequestStatus)}
          >
            <option value="completed">Completed</option>
            <option value="refused">Refused</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="g-note">What was done</Label>
          <textarea
            id="g-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Exported the staff record and emailed it to the subject on 4 August."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Required. A refusal must also state the lawful ground and the subject&rsquo;s
            right to complain to the ICO.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : 'Close request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ExtendRequestModal({
  request,
  onClose,
  onDone,
  onError,
  onSuccess,
}: ModalCallbacks & { request: GdprRequest | null }): JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (reason.trim().length < 15) {
      setError(
        'Give a reason of at least 15 characters — complexity, or number of requests.',
      );
      return;
    }
    setError('');
    setBusy(true);
    try {
      const newDue = await extendGdprRequest(request?.id ?? '', reason.trim());
      onSuccess(
        `Deadline extended to ${newDue}. Tell the subject why, within the first month.`,
      );
      setReason('');
      await onDone();
    } catch (e) {
      onError(message(e, 'Could not extend that deadline.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={request !== null} onClose={onClose} title="Extend the deadline">
      <div className="space-y-4">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Article 12(3) allows two further months for complex or numerous requests,{' '}
          <strong className="text-content dark:text-content-dark">
            provided the subject is told within the first month
          </strong>
          . This records the extension; sending that message is still a job for a person.
        </p>
        {request && (
          <p className="text-sm text-content dark:text-content-dark">
            Deadline would move from <strong>{request.dueOn}</strong> to{' '}
            <strong>{extendedDueDate(request.dueOn)}</strong>.
          </p>
        )}
        <div>
          <Label htmlFor="g-reason">Reason</Label>
          <textarea
            id="g-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Request covers four years of clock events across three sites."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Extending…' : 'Extend deadline'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
