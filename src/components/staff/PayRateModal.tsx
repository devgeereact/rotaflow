import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { listPayRates, setPayRate, type PayRate } from '@/services/payRateService';
import { reportError } from '@/lib/sentry';
import { useToast } from '@/hooks/useToast';
import { todayIso } from '@/lib/schedulePeriod';

interface PayRateModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  staffProfileId: string;
  staffName: string;
  createdBy: string;
}

/** `1234` → `12.34`, for an input somebody types pounds into. */
function poundsFromPence(pence: number): string {
  return (pence / 100).toFixed(2);
}

/**
 * Setting somebody's hourly rate (CAP-086).
 *
 * ## It adds, it does not overwrite
 *
 * The history is the point. A rate that is replaced rewrites the past —
 * raise somebody in April and every week they worked in March silently costs
 * more, so a figure already reported changes. So this asks for the date the
 * new rate starts, defaults it to today, and shows what came before.
 *
 * Correcting a typo is the one case that does replace: the same date replaces
 * that date's row, because two rates starting on one day is a question the
 * cost query cannot answer.
 *
 * ## Pounds in, pence stored
 *
 * The field takes pounds because that is what a person knows their rate as.
 * It is stored as integer pence, like everything else priced in this schema:
 * £12.34 as a float is 12.339999999999999, and a labour cost sums thousands
 * of them.
 */
export function PayRateModal({
  open,
  onClose,
  orgId,
  staffProfileId,
  staffName,
  createdBy,
}: PayRateModalProps): JSX.Element {
  const { showError, showSuccess } = useToast();
  const [history, setHistory] = useState<PayRate[] | null>(null);
  const [pounds, setPounds] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const rows = await listPayRates(orgId, staffProfileId);
        if (active) setHistory(rows);
      } catch (err) {
        reportError(err, { area: 'pay-rate:list' });
        if (active) setHistory([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, orgId, staffProfileId]);

  const parsed = Number(pounds);
  // Rejected rather than rounded. A rate typed as 12.345 is a mistake, and
  // silently storing 12.34 or 12.35 hides which one the product chose.
  const valid =
    pounds.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    /^\d+(\.\d{1,2})?$/.test(pounds.trim());

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      await setPayRate({
        orgId,
        staffProfileId,
        hourlyRatePence: Math.round(parsed * 100),
        effectiveFrom,
        createdBy,
      });
      showSuccess(`Rate recorded for ${staffName}.`);
      onClose();
    } catch (err) {
      reportError(err, { area: 'pay-rate:save' });
      showError('That rate could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [
    orgId,
    staffProfileId,
    parsed,
    effectiveFrom,
    createdBy,
    staffName,
    onClose,
    showError,
    showSuccess,
  ]);

  return (
    <Modal open={open} onClose={onClose} title={`Pay rate — ${staffName}`}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="rate-amount">Hourly rate (£)</Label>
            <Input
              id="rate-amount"
              inputMode="decimal"
              placeholder="12.50"
              value={pounds}
              onChange={(event) => setPounds(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rate-from">Takes effect from</Label>
            <Input
              id="rate-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>
        </div>

        {pounds.trim() !== '' && !valid && (
          <p className="text-xs text-danger-ink dark:text-danger-ink-dark" role="alert">
            Enter an amount in pounds and pence, like 12.50.
          </p>
        )}

        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Shifts worked before this date keep the rate that applied then. That is
          deliberate — a raise should not change what last quarter cost.
        </p>

        {history && history.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-content dark:text-content-dark">
              Previously
            </p>
            <ul className="space-y-1 text-sm text-content-muted dark:text-content-muted-dark">
              {history.map((rate) => (
                <li key={rate.id}>
                  £{poundsFromPence(rate.hourlyRatePence)} from{' '}
                  {new Date(`${rate.effectiveFrom}T00:00:00`).toLocaleDateString('en-GB')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save rate'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
