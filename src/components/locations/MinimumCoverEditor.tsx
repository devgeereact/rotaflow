import { useEffect, useState, type ChangeEvent } from 'react';
import { listMinimumCoverRules, setMinimumCoverRules } from '@/services/locationService';
import { reportError } from '@/lib/sentry';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';

interface MinimumCoverEditorProps {
  orgId: string;
  locationId: string;
  canEdit: boolean;
}

/**
 * A day's minimum, stored 0=Sunday..6=Saturday (matches `availability.weekday`
 * and `minimum_cover_rules.weekday`), shown Monday-first because that is how
 * every rota grid in the app already reads.
 */
const DAYS: { weekday: number; label: string }[] = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
];

/**
 * A site's staffing minimum, one number per day of the week. Feeds the rota
 * builder's publish gate and the dashboard's cover chart (see
 * 0036_minimum_cover_rules.sql); zero means "no minimum set", not "closed".
 */
export function MinimumCoverEditor({
  orgId,
  locationId,
  canEdit,
}: MinimumCoverEditorProps): JSX.Element {
  const { showError, showSuccess } = useToast();
  const [values, setValues] = useState<number[]>(() => DAYS.map(() => 0));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const rules = await listMinimumCoverRules(locationId);
        if (!active) return;
        const byWeekday = new Map(rules.map((r) => [r.weekday, r.min_staff]));
        setValues(DAYS.map((d) => byWeekday.get(d.weekday) ?? 0));
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'locations:minimum-cover-load' });
        showError('Could not load the staffing minimum for this site.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [locationId, showError]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      // Indexed 0=Sunday..6=Saturday for the service call, DAYS is Monday-first.
      const weekdayMinimums: number[] = [];
      DAYS.forEach((d, i) => {
        weekdayMinimums[d.weekday] = values[i] ?? 0;
      });
      await setMinimumCoverRules(orgId, locationId, weekdayMinimums);
      showSuccess('Staffing minimum saved.');
    } catch (err) {
      reportError(err, { area: 'locations:minimum-cover-save' });
      showError('Could not save the staffing minimum. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-content-muted dark:text-content-muted-dark">Loading…</p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        How many people this site needs on shift each day. The rota builder blocks
        publishing a week that falls short, and the manager dashboard charts it. A day
        left at 0 has no minimum set, not a minimum of zero.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DAYS.map((day, i) => (
          <div key={day.weekday}>
            <Label htmlFor={`cover-${day.weekday}`}>{day.label}</Label>
            <Input
              id={`cover-${day.weekday}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              step={1}
              disabled={!canEdit}
              value={String(values[i] ?? 0)}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const parsed = Number(e.target.value);
                if (!Number.isFinite(parsed)) return;
                setValues((prev) =>
                  prev.map((v, j) => (j === i ? Math.max(0, parsed) : v)),
                );
              }}
            />
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save staffing minimum'}
          </Button>
        </div>
      )}
    </div>
  );
}
