import { useEffect, useState, type JSX } from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/apiClient';
import { reportError } from '@/lib/sentry';
import { dayLabel, summariseWarnings } from '@/lib/schedulingRules';
import { utcToZoned } from '@/lib/zonedTime';
import { getPublishPreview, type PublishPreview } from '@/services/schedulingService';
import type { Rota } from '@/types';

/**
 * The publish preview (slice S11, `scheduling_tools` flag): before a draft goes to staff, what
 * changes and what to check. Warnings (rest, weekly hours, leave, unavailable) never stop the
 * publish; a person in two places at once does, here and on the server.
 *
 * Loaded lazily from the rota builder, so the module costs nothing while it is off. Named
 * "Check", not "Preview": the bundle guard (scripts/check-bundle-size.mjs) refuses any chunk
 * whose name says preview, because that is how DEV-only preview pages are caught.
 */
interface PublishCheckModalProps {
  open: boolean;
  onClose: () => void;
  rotas: Rota[];
  staffName: (staffProfileId: string | null) => string;
  timezoneOf: (locationId: string | null) => string;
  publishing: boolean;
  onPublish: () => void;
}

function when(startsAt: string, endsAt: string, tz: string): string {
  const a = utcToZoned(startsAt, tz);
  const b = utcToZoned(endsAt, tz);
  return `${dayLabel(a.date)} ${a.time}–${b.time}`;
}

export function PublishCheckModal({
  open,
  onClose,
  rotas,
  staffName,
  timezoneOf,
  publishing,
  onPublish,
}: PublishCheckModalProps): JSX.Element {
  const [previews, setPreviews] = useState<PublishPreview[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // The ids, not the array: the builder rebuilds that list on every render.
  const rotaIds = rotas.map((r) => r.id).join(',');

  useEffect(() => {
    if (!open || rotaIds === '') return;
    let active = true;
    setPreviews(null);
    setFailed(null);
    void Promise.all(rotaIds.split(',').map((id) => getPublishPreview(id)))
      .then((rows) => {
        if (active) setPreviews(rows);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (!(err instanceof ApiError && err.status < 500)) {
          reportError(err, { area: 'rota:publish-preview' });
        }
        setFailed(
          err instanceof ApiError && err.status < 500 && err.message
            ? err.message
            : 'Could not load the preview. You can still publish; the server checks for double-booking either way.',
        );
      });
    return () => {
      active = false;
    };
  }, [open, rotaIds]);

  const shifts = previews?.flatMap((p) => p.shifts) ?? [];
  const flagged = shifts.filter((s) => s.warnings.length > 0);
  const summary = summariseWarnings(shifts);
  const overlaps = previews?.flatMap((p) => p.overlaps) ?? [];
  const blocked = overlaps.length > 0;

  return (
    <Modal open={open} onClose={onClose} title="Before you publish">
      <div className="space-y-4">
        {previews === null && failed === null && (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Checking the rota…
          </p>
        )}
        {failed && (
          <p className="text-sm text-danger-ink dark:text-danger-ink-dark">{failed}</p>
        )}

        {previews?.map((p) => (
          <p key={p.rota.id} className="text-sm text-content dark:text-content-dark">
            <span className="font-medium">{p.rota.name}</span>
            {': '}
            {p.counts.new} new
            {p.rota.supersedes_rota_id
              ? `, ${p.counts.unchanged} unchanged, ${p.counts.removed} removed`
              : ''}
            {p.counts.cancelled > 0 ? `, ${p.counts.cancelled} cancelled` : ''}
            {p.truncated ? ` (first 500 of ${p.total} shown)` : ''}
          </p>
        ))}

        {blocked && (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger-ink dark:text-danger-ink-dark"
          >
            <p className="flex items-center gap-1.5 font-medium">
              <Ban size={14} aria-hidden="true" />
              {overlaps.length === 1
                ? 'One person is booked in two places at once'
                : `${overlaps.length} double-bookings`}
              . Move one shift of each pair, then publish.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {overlaps.slice(0, 20).map((o) => (
                <li key={`${o.shift.id}:${o.other.id}`}>
                  {staffName(o.staff_profile_id)}:{' '}
                  {when(
                    o.shift.starts_at,
                    o.shift.ends_at,
                    timezoneOf(o.shift.location_id),
                  )}{' '}
                  overlaps{' '}
                  {when(
                    o.other.starts_at,
                    o.other.ends_at,
                    timezoneOf(o.other.location_id),
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {previews && flagged.length === 0 && !blocked && (
          <p className="text-sm text-content dark:text-content-dark">
            Nothing to check: no short rest, long weeks, leave or unavailability.
          </p>
        )}

        {flagged.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning-wash p-3 dark:bg-warning-wash-dark">
            <p className="flex items-center gap-1.5 text-sm font-medium text-warning-ink dark:text-warning-ink-dark">
              <AlertTriangle size={14} aria-hidden="true" />
              {summary.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(' · ')}
            </p>
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-sm text-content dark:text-content-dark">
              {flagged.slice(0, 100).map((s) => (
                <li key={s.id}>
                  <span className="font-medium">{staffName(s.staff_profile_id)}</span>,{' '}
                  {when(s.starts_at, s.ends_at, timezoneOf(s.location_id))}
                  <span className="block text-content-muted dark:text-content-muted-dark">
                    {s.warnings.map((w) => w.message).join('. ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
              Warnings do not stop you publishing.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={onPublish}
            disabled={publishing || blocked || (previews === null && failed === null)}
          >
            {publishing
              ? 'Publishing…'
              : flagged.length > 0
                ? 'Publish anyway'
                : 'Publish'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={publishing}>
            Back to the rota
          </Button>
        </div>
      </div>
    </Modal>
  );
}
