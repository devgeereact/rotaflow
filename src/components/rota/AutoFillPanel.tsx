import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { computeShiftIsoRange, formatDayLabel } from '@/lib/rotaGrid';
import { generateRotaSuggestions, type AiShiftSuggestion } from '@/services/aiRotaService';
import { createShifts } from '@/services/shiftService';
import { reportError } from '@/lib/sentry';
import type { ShiftInsert } from '@/types';

interface AutoFillPanelProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  locationId: string;
  rotaId: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  onPreview: (suggestions: AiShiftSuggestion[]) => void;
  onApplied: () => void;
}

/**
 * The AI rota assistant, folded into the builder as "Auto-fill" (was a
 * standalone page). Suggestions preview directly on the grid via onPreview;
 * Apply writes into the rota that's actually open, not a disconnected draft.
 */
export function AutoFillPanel({
  open,
  onClose,
  orgId,
  locationId,
  rotaId,
  weekStart,
  weekEnd,
  timezone,
  onPreview,
  onApplied,
}: AutoFillPanelProps): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiShiftSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback((): void => {
    setPrompt('');
    setSummary(null);
    setSuggestions([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleClose = (): void => {
    onPreview([]);
    onClose();
  };

  const handleGenerate = async (): Promise<void> => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generateRotaSuggestions({
        orgId,
        prompt: prompt.trim(),
        periodStart: weekStart,
        periodEnd: weekEnd,
      });
      setSummary(result.summary);
      setSuggestions(result.suggestions);
      onPreview(result.suggestions);
    } catch (err) {
      reportError(err, { area: 'rota:auto-fill' });
      setError(err instanceof Error ? err.message : 'The AI assistant could not be reached.');
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    if (suggestions.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const inserts: ShiftInsert[] = suggestions.map((s) => {
        const { startsAt, endsAt } = computeShiftIsoRange(s.date, s.startTime, s.endTime, timezone);
        return {
          org_id: orgId,
          rota_id: rotaId,
          location_id: locationId,
          staff_profile_id: s.staffProfileId,
          shift_type_id: s.shiftTypeId,
          starts_at: startsAt,
          ends_at: endsAt,
          status: 'assigned',
          notes: s.reasoning || null,
        };
      });
      await createShifts(inserts);
      onPreview([]);
      onApplied();
      handleClose();
    } catch (err) {
      reportError(err, { area: 'rota:auto-fill-apply' });
      setError('Could not save these shifts. Please try again.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Auto-fill with AI">
      <div className="space-y-4">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Describe your staffing needs for this week. Suggestions preview on the grid —
          nothing is saved until you apply them.
        </p>

        <textarea
          className="w-full rounded-xl border border-surface-border bg-background px-4 py-3 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
          rows={3}
          placeholder="e.g. Cover Saturday and Sunday nights with two people who can do lates."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <Button onClick={() => void handleGenerate()} disabled={generating || !prompt.trim()}>
          <Sparkles size={16} aria-hidden="true" className="mr-1.5" />
          {generating ? 'Thinking…' : 'Generate suggestions'}
        </Button>

        {error && <p className="text-sm text-danger">{error}</p>}

        {summary && (
          <Card className="text-sm text-content dark:text-content-dark">{summary}</Card>
        )}

        {suggestions.length > 0 && (
          <>
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li key={i} className="text-sm text-content-muted dark:text-content-muted-dark">
                  {s.staffName} · {formatDayLabel(s.date).weekday} {formatDayLabel(s.date).day} ·{' '}
                  {s.startTime}–{s.endTime}
                  {s.shiftTypeName ? ` · ${s.shiftTypeName}` : ''}
                </li>
              ))}
            </ul>
            <Button className="w-full" onClick={() => void handleApply()} disabled={applying}>
              {applying ? 'Applying…' : `Apply ${suggestions.length} shift${suggestions.length === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
