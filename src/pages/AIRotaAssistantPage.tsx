import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { generateRotaSuggestions, type AiShiftSuggestion } from '@/services/aiRotaService';
import { createDraftRota } from '@/services/rotaService';
import { createShifts } from '@/services/shiftService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ShiftInsert } from '@/types';

function defaultPeriod(): { start: string; end: string } {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 6);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function AIRotaAssistantPage(): JSX.Element {
  const { currentOrg, currentRole, loading: orgLoading, createOrg } = useOrg();

  const [orgName, setOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const period = defaultPeriod();
  const [periodStart, setPeriodStart] = useState(period.start);
  const [periodEnd, setPeriodEnd] = useState(period.end);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiShiftSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleCreateOrg = useCallback(async (): Promise<void> => {
    if (!orgName.trim()) return;
    setCreatingOrg(true);
    try {
      await createOrg(orgName.trim());
    } catch (err) {
      reportError(err, { area: 'ai-rota:create-org' });
      setError('Could not create the organisation. Please try again.');
    } finally {
      setCreatingOrg(false);
    }
  }, [orgName, createOrg]);

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (!currentOrg || !prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setApplied(false);
    try {
      const result = await generateRotaSuggestions({
        orgId: currentOrg.id,
        prompt: prompt.trim(),
        periodStart,
        periodEnd,
      });
      setSummary(result.summary);
      setSuggestions(result.suggestions);
    } catch (err) {
      reportError(err, { area: 'ai-rota:generate' });
      setError(
        err instanceof Error ? err.message : 'The AI assistant could not be reached.',
      );
    } finally {
      setGenerating(false);
    }
  }, [currentOrg, prompt, periodStart, periodEnd]);

  const handleApply = useCallback(async (): Promise<void> => {
    if (!currentOrg || suggestions.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const rota = await createDraftRota({
        orgId: currentOrg.id,
        name: `AI draft ${periodStart} – ${periodEnd}`,
        periodStart,
        periodEnd,
      });
      const inserts: ShiftInsert[] = suggestions.map((s) => ({
        org_id: currentOrg.id,
        rota_id: rota.id,
        staff_profile_id: s.staffProfileId,
        shift_type_id: s.shiftTypeId,
        starts_at: toIso(s.date, s.startTime),
        ends_at: toIso(s.date, s.endTime),
        status: 'assigned',
        notes: s.reasoning || null,
      }));
      await createShifts(inserts);
      setApplied(true);
    } catch (err) {
      reportError(err, { area: 'ai-rota:apply' });
      setError(err instanceof Error ? err.message : 'Could not save the rota draft.');
    } finally {
      setApplying(false);
    }
  }, [currentOrg, suggestions, periodStart, periodEnd]);

  if (orgLoading) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      </main>
    );
  }

  if (!currentOrg) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link to="/dashboard" className="text-sm text-primary">
          ← Back to dashboard
        </Link>
        <h1 className="mb-2 mt-4 font-display text-3xl text-content dark:text-content-dark">
          Set up your organisation
        </h1>
        <p className="mb-6 text-content-muted dark:text-content-muted-dark">
          The AI rota assistant needs an organisation to schedule staff within.
        </p>
        <Card className="space-y-4">
          <input
            className="w-full rounded-xl border border-surface-border bg-transparent px-4 py-2 text-content dark:border-surface-border-dark dark:text-content-dark"
            placeholder="Organisation name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
          <Button onClick={() => void handleCreateOrg()} disabled={creatingOrg}>
            {creatingOrg ? 'Creating…' : 'Create organisation'}
          </Button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </Card>
      </main>
    );
  }

  const canManage = currentRole === 'owner' || currentRole === 'manager';

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/dashboard" className="text-sm text-primary">
        ← Back to dashboard
      </Link>
      <h1 className="mb-2 mt-4 font-display text-3xl text-content dark:text-content-dark">
        AI rota assistant
      </h1>
      <p className="mb-8 text-content-muted dark:text-content-muted-dark">
        Describe your staffing needs in plain English for{' '}
        <strong>{currentOrg.name}</strong>. Suggestions are grounded in real staff,
        skills and existing shifts — nothing is saved until you apply them.
      </p>

      {!canManage ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            Only owners and managers can generate rota suggestions.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex gap-4">
              <label className="flex-1 text-sm text-content-muted dark:text-content-muted-dark">
                From
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-surface-border bg-transparent px-4 py-2 text-content dark:border-surface-border-dark dark:text-content-dark"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </label>
              <label className="flex-1 text-sm text-content-muted dark:text-content-muted-dark">
                To
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-surface-border bg-transparent px-4 py-2 text-content dark:border-surface-border-dark dark:text-content-dark"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </label>
            </div>
            <textarea
              className="w-full rounded-xl border border-surface-border bg-transparent px-4 py-3 text-content dark:border-surface-border-dark dark:text-content-dark"
              rows={3}
              placeholder="e.g. Cover Saturday and Sunday nights with two people who can do lates, prioritise anyone under their weekly hours."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating || !prompt.trim()}
            >
              {generating ? 'Thinking…' : 'Generate suggestions'}
            </Button>
            {error && <p className="text-sm text-danger">{error}</p>}
          </Card>

          {summary && (
            <Card>
              <p className="text-content dark:text-content-dark">{summary}</p>
            </Card>
          )}

          {suggestions.length > 0 && (
            <Card className="space-y-4">
              <h2 className="text-lg font-semibold text-content dark:text-content-dark">
                Suggested shifts ({suggestions.length})
              </h2>
              <ul className="space-y-3">
                {suggestions.map((s, i) => (
                  <li
                    key={`${s.staffProfileId}-${s.date}-${s.startTime}-${i}`}
                    className="rounded-xl border border-surface-border p-4 dark:border-surface-border-dark"
                  >
                    <p className="font-medium text-content dark:text-content-dark">
                      {s.staffName} · {s.date} · {s.startTime}–{s.endTime}
                      {s.shiftTypeName ? ` · ${s.shiftTypeName}` : ''}
                    </p>
                    {s.reasoning && (
                      <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">{s.reasoning}</p>
                    )}
                  </li>
                ))}
              </ul>
              <Button onClick={() => void handleApply()} disabled={applying || applied}>
                {applied ? 'Applied ✓' : applying ? 'Saving…' : 'Apply to draft rota'}
              </Button>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
