import { useEffect, useState } from 'react';
import {
  millisecondsUntilNextLocalMidnight,
  operationalDate,
} from '@/lib/operationalDay';

/**
 * The current local date in `timezone`, which rolls over on its own.
 *
 * ## Why a timer rather than `todayIso()`
 *
 * An operations board is left open. On a ward or in a site office the tab
 * stays up for days, and until this existed the date was read once at mount:
 * at 00:05 the screen still showed yesterday's roster, with yesterday's
 * counts, and looked exactly like a working screen. Nothing prompted a
 * reload, because nothing appeared to be wrong.
 *
 * The timer is set to the next **local** midnight rather than to a fixed
 * 24-hour interval, so it lands on the boundary rather than drifting past it,
 * and it is correct on a clock-change date where the day is 23 or 25 hours
 * long.
 *
 * Rescheduled after every fire rather than with `setInterval`, for the same
 * reason: each day's length is computed from that day's own transition.
 */
export function useOperationalDate(timezone: string): string {
  const [date, setDate] = useState(() => operationalDate(new Date(), timezone));

  useEffect(() => {
    // A timezone change is a scope change, not a tick: re-read immediately
    // rather than waiting for the next midnight in the previous zone.
    setDate(operationalDate(new Date(), timezone));

    let timer: ReturnType<typeof setTimeout>;

    const schedule = (): void => {
      timer = setTimeout(
        () => {
          setDate(operationalDate(new Date(), timezone));
          schedule();
        },
        millisecondsUntilNextLocalMidnight(new Date(), timezone),
      );
    };

    schedule();

    // A laptop that was asleep over midnight fires the timer late, or not at
    // all in some browsers. Re-reading when the tab becomes visible covers
    // that without polling.
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      setDate(operationalDate(new Date(), timezone));
      clearTimeout(timer);
      schedule();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timezone]);

  return date;
}
