import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';

interface RepeatWeekModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (weeks: number) => void;
  busy: boolean;
}

const MAX_WEEKS = 26;

/**
 * How many weeks to repeat this one forward (CAP-006).
 *
 * ## Why this is a modal and not `window.prompt`
 *
 * `ConfirmContext` exists in this codebase precisely because the native
 * dialog had to go: it blocks the event loop, it cannot be styled or
 * translated, and a Playwright run walks straight into it. Reaching for
 * `window.prompt` here would have reintroduced the same problem one screen
 * over, for the sake of collecting a single number.
 *
 * ## Why the ceiling is stated rather than merely enforced
 *
 * Twenty-six weeks is half a year, further ahead than any real rota is
 * planned, and an unbounded count is a way to write tens of thousands of rows
 * from one click. The database refuses anything larger; saying so on the
 * screen means nobody discovers it by being refused.
 */
export function RepeatWeekModal({
  open,
  onClose,
  onConfirm,
  busy,
}: RepeatWeekModalProps): JSX.Element {
  const [weeks, setWeeks] = useState('4');

  const parsed = Number(weeks);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_WEEKS;

  return (
    <Modal open={open} onClose={onClose} title="Repeat this week forward">
      <div className="space-y-5">
        <div className="max-w-[160px]">
          <Label htmlFor="repeat-weeks">How many weeks</Label>
          <Input
            id="repeat-weeks"
            inputMode="numeric"
            value={weeks}
            onChange={(event) => setWeeks(event.target.value)}
          />
        </div>

        {weeks.trim() !== '' && !valid && (
          <p className="text-xs text-danger" role="alert">
            A whole number between 1 and {MAX_WEEKS}.
          </p>
        )}

        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Every shift in this week is copied into each of the next {valid ? parsed : 'n'}{' '}
          weeks, keeping its time, its person and its site. A week that is already
          published, or whose draft somebody has started, is left alone — you will be told
          how many.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={() => onConfirm(parsed)}>
            {busy ? 'Repeating…' : 'Repeat'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
