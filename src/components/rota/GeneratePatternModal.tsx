import { useEffect, useMemo, useState, type JSX } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/apiClient';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import {
  generateHeadline,
  groupSkipped,
  MAX_BLOCKS,
  type PatternFields,
  patternBody,
  patternError,
} from '@/lib/schedulingRules';
import { generatePattern, type GenerateResult } from '@/services/schedulingService';
import type { Location, Rota, ShiftType, StaffProfile } from '@/types';

/**
 * "Generate pattern" (slice S11, `scheduling_tools` flag): a recurring pattern becomes ordinary
 * draft shifts in one rota. Weekly (chosen weekdays) or a days-on / days-off cycle, one to six
 * time blocks a working day, at most 92 days and 500 shifts, inside the rota's own dates. Times
 * are the site's wall clock, so 06:00 stays 06:00 across a clock change. A shift that would
 * double-book the person, or that is already there, is skipped and counted, never forced.
 *
 * Loaded lazily from the rota builder, so the module costs nothing while it is off.
 */
interface GeneratePatternModalProps {
  open: boolean;
  onClose: () => void;
  rotas: Rota[];
  locations: Location[];
  staff: StaffProfile[];
  shiftTypes: ShiftType[];
  onGenerated: (created: number) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function blank(
  rota: Pick<Rota, 'period_start' | 'period_end' | 'location_id'> | undefined,
): PatternFields {
  return {
    kind: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    daysOn: '4',
    daysOff: '4',
    cycleStart: rota?.period_start ?? '',
    from: rota?.period_start ?? '',
    to: rota?.period_end ?? '',
    blocks: [{ start: '09:00', end: '17:00' }],
    staffProfileId: '',
    locationId: rota?.location_id ?? '',
    shiftTypeId: '',
    breakRaw: '0',
    notes: '',
  };
}

function apiMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.status < 500 && err.message
    ? err.message
    : fallback;
}

export function GeneratePatternModal({
  open,
  onClose,
  rotas,
  locations,
  staff,
  shiftTypes,
  onGenerated,
}: GeneratePatternModalProps): JSX.Element {
  const [rotaId, setRotaId] = useState('');
  const [f, setF] = useState<PatternFields>(() => blank(undefined));
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rota = rotas.find((r) => r.id === rotaId);

  // Reset when the dialog opens. Keyed on plain values: the builder rebuilds `rotas` every render.
  const first = rotas[0];
  const firstId = first?.id ?? '';
  const firstStart = first?.period_start ?? '';
  const firstEnd = first?.period_end ?? '';
  const firstLocation = first?.location_id ?? null;
  useEffect(() => {
    if (!open) return;
    setRotaId(firstId);
    setF(
      blank({
        period_start: firstStart,
        period_end: firstEnd,
        location_id: firstLocation,
      }),
    );
    setResult(null);
    setError(null);
  }, [open, firstId, firstStart, firstEnd, firstLocation]);

  const problem = useMemo(
    () =>
      rota
        ? patternError(f, { start: rota.period_start, end: rota.period_end })
        : 'Choose a rota.',
    [f, rota],
  );
  const set = (patch: Partial<PatternFields>): void => {
    setF((v) => ({ ...v, ...patch }));
    setResult(null);
  };

  const run = async (preview: boolean): Promise<void> => {
    if (!rota || problem) return;
    setBusy(true);
    setError(null);
    try {
      const r = await generatePattern(rota.id, patternBody(f, preview));
      setResult(r);
      if (!preview) {
        onGenerated(r.created);
        if (r.skipped.length === 0) onClose();
      }
    } catch (err) {
      if (!(err instanceof ApiError && err.status < 500)) {
        reportError(err, { area: 'rota:generate-pattern' });
      }
      setError(apiMessage(err, 'Could not generate the pattern. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const locationName = (id: string | null): string =>
    locations.find((l) => l.id === id)?.name ?? 'Whole organisation';

  return (
    <Modal open={open} onClose={onClose} title="Generate a pattern">
      <div className="space-y-4">
        {rotas.length > 1 && (
          <div>
            <Label htmlFor="gp-rota">Rota</Label>
            <Select
              id="gp-rota"
              value={rotaId}
              onChange={(e) => {
                const next = rotas.find((r) => r.id === e.target.value);
                setRotaId(e.target.value);
                setF(blank(next));
                setResult(null);
              }}
            >
              {rotas.map((r) => (
                <option key={r.id} value={r.id}>
                  {locationName(r.location_id)}, {r.period_start} to {r.period_end}
                </option>
              ))}
            </Select>
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-content dark:text-content-dark">
            Repeat
          </legend>
          <div className="mt-1 flex gap-2">
            {(['weekly', 'cycle'] as const).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={f.kind === k ? 'primary' : 'secondary'}
                aria-pressed={f.kind === k}
                onClick={() => set({ kind: k })}
              >
                {k === 'weekly' ? 'Days of the week' : 'Days on, days off'}
              </Button>
            ))}
          </div>
        </fieldset>

        {f.kind === 'weekly' ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
            {WEEKDAYS.map((label, i) => {
              const day = i + 1;
              const on = f.weekdays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      weekdays: on
                        ? f.weekdays.filter((d) => d !== day)
                        : [...f.weekdays, day],
                    })
                  }
                  className={cn(
                    'min-h-11 min-w-11 rounded-xl border-2 px-2 text-sm font-medium',
                    on
                      ? 'border-primary bg-primary/5 text-content dark:text-content-dark'
                      : 'border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="gp-on">Days on</Label>
              <Input
                id="gp-on"
                inputMode="numeric"
                value={f.daysOn}
                onChange={(e) => set({ daysOn: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="gp-off">Days off</Label>
              <Input
                id="gp-off"
                inputMode="numeric"
                value={f.daysOff}
                onChange={(e) => set({ daysOff: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="gp-anchor">Cycle starts</Label>
              <Input
                id="gp-anchor"
                type="date"
                value={f.cycleStart}
                onChange={(e) => set({ cycleStart: e.target.value })}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="gp-from">From</Label>
            <Input
              id="gp-from"
              type="date"
              value={f.from}
              min={rota?.period_start}
              max={rota?.period_end}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="gp-to">To</Label>
            <Input
              id="gp-to"
              type="date"
              value={f.to}
              min={rota?.period_start}
              max={rota?.period_end}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-content dark:text-content-dark">
            Times each working day
          </p>
          {f.blocks.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond their position
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor={`gp-start-${i}`}>Start</Label>
                <Input
                  id={`gp-start-${i}`}
                  type="time"
                  value={b.start}
                  onChange={(e) =>
                    set({
                      blocks: f.blocks.map((x, j) =>
                        j === i ? { ...x, start: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <div className="flex-1">
                <Label htmlFor={`gp-end-${i}`}>End</Label>
                <Input
                  id={`gp-end-${i}`}
                  type="time"
                  value={b.end}
                  onChange={(e) =>
                    set({
                      blocks: f.blocks.map((x, j) =>
                        j === i ? { ...x, end: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              {f.blocks.length > 1 && (
                <IconButton
                  icon={Trash2}
                  label={`Remove times ${i + 1}`}
                  onClick={() => set({ blocks: f.blocks.filter((_, j) => j !== i) })}
                />
              )}
            </div>
          ))}
          {f.blocks.length < MAX_BLOCKS && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                set({ blocks: [...f.blocks, { start: '18:00', end: '22:00' }] })
              }
            >
              <Plus size={14} aria-hidden="true" /> Add times (split shift)
            </Button>
          )}
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            An end before the start runs overnight.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="gp-staff">Person</Label>
            <Select
              id="gp-staff"
              value={f.staffProfileId}
              onChange={(e) => set({ staffProfileId: e.target.value })}
            >
              <option value="">Open shifts (nobody yet)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.first_name} {s.last_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="gp-type">Shift type</Label>
            <Select
              id="gp-type"
              value={f.shiftTypeId}
              onChange={(e) => set({ shiftTypeId: e.target.value })}
            >
              <option value="">None</option>
              {shiftTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="gp-break">Break (minutes)</Label>
            <Input
              id="gp-break"
              inputMode="numeric"
              value={f.breakRaw}
              onChange={(e) => set({ breakRaw: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="gp-notes">Notes</Label>
            <Input
              id="gp-notes"
              value={f.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        {problem && rota && (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {problem}
          </p>
        )}
        {error && (
          <p className="text-sm text-danger-ink dark:text-danger-ink-dark">{error}</p>
        )}

        {result && (
          <div
            role="status"
            className="rounded-xl border border-surface-border p-3 text-sm dark:border-surface-border-dark"
          >
            <p className="font-medium text-content dark:text-content-dark">
              {generateHeadline(result)}
            </p>
            {groupSkipped(result.skipped).map((g) => (
              <p
                key={g.reason}
                className="text-content-muted dark:text-content-muted-dark"
              >
                Skipped {g.count}: {g.label.toLowerCase()}
              </p>
            ))}
            {result.warnings.length > 0 && (
              <p className="text-warning-ink dark:text-warning-ink-dark">
                {result.warnings.length}{' '}
                {result.warnings.length === 1 ? 'shift has' : 'shifts have'} a warning (
                {[
                  ...new Set(
                    result.warnings.flatMap((w) => w.warnings.map((x) => x.message)),
                  ),
                ]
                  .slice(0, 3)
                  .join('; ')}
                ). They are still created.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => void run(true)}
            disabled={busy || Boolean(problem)}
          >
            {busy ? 'Checking…' : 'Preview'}
          </Button>
          <Button
            className="flex-1"
            onClick={() => void run(false)}
            disabled={busy || Boolean(problem)}
          >
            {busy ? 'Working…' : 'Create draft shifts'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
