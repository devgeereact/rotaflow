import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  AdminStat,
} from '@/components/admin/AdminPage';
import { useToast } from '@/hooks/useToast';
import {
  addIncidentEvent,
  listIncidents,
  openIncident,
  setIncidentStatus,
} from '@/services/incidentService';
import {
  SEVERITY_LABELS,
  STATUS_LABELS,
  durationMs,
  formatDuration,
  isOpen,
  meanTimeToResolve,
  sortForTriage,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/incidents';

const SEVERITY_TONE: Record<IncidentSeverity, BadgeTone> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const STATUS_TONE: Record<IncidentStatus, BadgeTone> = {
  investigating: 'danger',
  identified: 'warning',
  monitoring: 'info',
  resolved: 'success',
};

/** The things Platform Health probes, plus room for what it does not. */
const SERVICES = [
  'API',
  'PostgreSQL database',
  'Authentication',
  'Realtime',
  'File storage',
  'Email delivery',
  'Push notifications',
  'Web application',
  'Other',
] as const;

/**
 * `/admin/incidents` — NEW_STRUCTURE §34's incident management.
 *
 * ## Why this exists next to Platform Health
 *
 * Platform Health measures whether the platform is reachable *right now*, from
 * this browser. Each visit sees only that moment and nothing survives the page
 * closing. This is the durable half: when something is wrong, someone says so
 * once, in a place the next person will look, and it is still there afterwards.
 *
 * The list is sorted for triage rather than by date — open above resolved,
 * worst severity first — because the moment this page is opened in anger is
 * the moment nobody should be scrolling past six fixed things.
 *
 * The timeline is rows, not an appended text field, so a post-incident review
 * can still tell who said what and when.
 */
export function AdminIncidentsPage(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      setIncidents(await listIncidents());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => sortForTriage(incidents ?? []), [incidents]);
  const open = sorted.filter((i) => isOpen(i.status));
  const mttr = meanTimeToResolve(incidents ?? []);

  return (
    <AdminPage
      title="Incidents"
      description="What went wrong, what was done about it, and how long it took."
      action={
        <Button onClick={() => setOpening(true)}>
          <Plus size={16} aria-hidden="true" />
          Open an incident
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStat label="Open" value={open.length} hint="Not yet resolved" />
          <AdminStat
            label="Critical or high"
            value={
              open.filter((i) => i.severity === 'critical' || i.severity === 'high')
                .length
            }
            hint="Among the open ones"
          />
          <AdminStat
            label="Recorded"
            value={incidents?.length ?? '—'}
            hint="Most recent 100"
          />
          <AdminStat
            label="Mean time to resolve"
            value={mttr === null ? '—' : formatDuration(mttr)}
            hint={mttr === null ? 'Nothing resolved yet' : 'Resolved incidents only'}
          />
        </div>

        {failed ? (
          <AdminError onRetry={() => void load()} />
        ) : incidents === null ? (
          <AdminLoading rows={4} />
        ) : incidents.length === 0 ? (
          <Card className="p-0">
            <AdminEmpty message="No incident has been recorded. That is the good outcome." />
          </Card>
        ) : (
          <div className="space-y-4">
            {sorted.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                now={now}
                onChanged={load}
                onError={showError}
                onSuccess={showSuccess}
              />
            ))}
          </div>
        )}

        <Card className="border-warning/30 bg-warning/5">
          <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
            This does not tell anyone
          </h2>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Recording an incident here notifies no customer. There is no status page and
            no incident email, so telling people is still a message a person writes and
            sends. A tick box that reached nobody would be worse than this sentence.
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
            Nothing here is visible to tenants either — an incident record contains
            half-formed diagnosis written at speed, which is not the same thing as
            customer communication and should not be mistaken for it.
          </p>
        </Card>
      </div>

      <OpenIncidentModal
        open={opening}
        onClose={() => setOpening(false)}
        onDone={async () => {
          setOpening(false);
          await load();
        }}
        onError={showError}
        onSuccess={showSuccess}
      />
    </AdminPage>
  );
}

function IncidentCard({
  incident,
  now,
  onChanged,
  onError,
  onSuccess,
}: {
  incident: Incident;
  now: Date;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
  onSuccess: (m: string) => void;
}): JSX.Element {
  const [update, setUpdate] = useState('');
  const [busy, setBusy] = useState(false);
  const live = isOpen(incident.status);

  const postUpdate = async (): Promise<void> => {
    if (update.trim().length < 5) {
      onError('Write an update of at least five characters.');
      return;
    }
    setBusy(true);
    try {
      await addIncidentEvent(incident.id, update.trim());
      setUpdate('');
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add that update.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: IncidentStatus): Promise<void> => {
    // Resolving needs a note, so reuse whatever is in the update box rather
    // than opening a second dialog for one field.
    if (status === 'resolved' && update.trim().length < 5) {
      onError('Write what fixed it in the update box, then resolve.');
      return;
    }
    setBusy(true);
    try {
      await setIncidentStatus(incident.id, status, update.trim() || undefined);
      setUpdate('');
      onSuccess(`Incident marked ${STATUS_LABELS[status].toLowerCase()}.`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change the status.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={live ? 'border-danger/30' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[incident.severity]}>
              {SEVERITY_LABELS[incident.severity]}
            </Badge>
            <Badge tone={STATUS_TONE[incident.status]}>
              {STATUS_LABELS[incident.status]}
            </Badge>
            <span className="text-xs text-content-muted dark:text-content-muted-dark">
              {incident.service}
            </span>
          </div>
          <h3 className="mt-2 font-display text-card-heading font-semibold text-content dark:text-content-dark">
            {incident.title}
          </h3>
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            {incident.impact}
          </p>
        </div>
        <div className="text-right text-sm text-content-muted dark:text-content-muted-dark">
          <p className="font-medium text-content dark:text-content-dark">
            {formatDuration(durationMs(incident, now))}
          </p>
          <p className="text-xs">{live ? 'and counting' : 'to resolve'}</p>
          {incident.ownerName && <p className="mt-1 text-xs">{incident.ownerName}</p>}
        </div>
      </div>

      {incident.events.length > 0 && (
        <ol className="mt-4 border-l-2 border-surface-border pl-4 dark:border-surface-border-dark">
          {incident.events.map((event) => (
            <li key={event.id} className="pb-3 last:pb-0">
              <p className="text-xs text-content-muted dark:text-content-muted-dark">
                {new Date(event.createdAt).toLocaleString('en-GB')}
                {event.authorName && ` · ${event.authorName}`}
              </p>
              <p className="text-sm text-content dark:text-content-dark">{event.body}</p>
            </li>
          ))}
        </ol>
      )}

      {live && (
        <div className="mt-4 space-y-2 border-t border-divider pt-4 dark:border-divider-dark">
          <Label htmlFor={`u-${incident.id}`}>Add an update</Label>
          <Input
            id={`u-${incident.id}`}
            value={update}
            onChange={(e) => setUpdate(e.target.value)}
            placeholder="Latency recovering. Monitoring for an hour before closing."
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void postUpdate()}
              disabled={busy}
            >
              Post update
            </Button>
            {incident.status !== 'identified' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void changeStatus('identified')}
                disabled={busy}
              >
                Cause identified
              </Button>
            )}
            {incident.status !== 'monitoring' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void changeStatus('monitoring')}
                disabled={busy}
              >
                Monitoring
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => void changeStatus('resolved')}
              disabled={busy}
            >
              Resolve
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function OpenIncidentModal({
  open,
  onClose,
  onDone,
  onError,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (m: string) => void;
  onSuccess: (m: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [service, setService] = useState<string>(SERVICES[0]);
  const [impact, setImpact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (title.trim().length < 10) {
      setError('Give the incident a title of at least ten characters.');
      return;
    }
    if (impact.trim().length < 15) {
      setError('Describe the customer impact — at least fifteen characters.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await openIncident({
        title: title.trim(),
        severity,
        service,
        impact: impact.trim(),
      });
      onSuccess('Incident opened.');
      setTitle('');
      setImpact('');
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open an incident.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Open an incident">
      <div className="space-y-4">
        <div>
          <Label htmlFor="i-title">Title</Label>
          <Input
            id="i-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Elevated API latency in eu-west-2"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="i-sev">Severity</Label>
            <Select
              id="i-sev"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
            >
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="i-svc">Affected service</Label>
            <Select
              id="i-svc"
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              {SERVICES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="i-impact">Customer impact</Label>
          <textarea
            id="i-impact"
            rows={3}
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            placeholder="Document uploads are slower than usual. No data loss."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            What this actually did to someone. It is the first question asked afterwards
            and the hardest to reconstruct later.
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
            {busy ? 'Opening…' : 'Open incident'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
