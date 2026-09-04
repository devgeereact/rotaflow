import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { Button } from '@/components/ui/Button';
import { reportError } from '@/lib/sentry';

/**
 * Registers the service worker and surfaces a non-destructive
 * "new version available" prompt. With skipWaiting:false the new SW
 * waits until the user opts in, so we never interrupt their work.
 *
 * ## Why it also polls
 *
 * A browser checks for a new service worker on navigation. An installed PWA
 * that is left open for a week — which is exactly how a ward tablet or a site
 * office terminal is used — may never navigate, so it can run a build that is
 * days old and never be told. `registration.update()` on an interval is what
 * closes that: it costs one conditional request an hour and it is the only
 * thing that reaches a session nobody reloads.
 *
 * ## And why a failed registration is reported
 *
 * `registerSW` swallows a registration error by default. If it fails, the app
 * silently loses offline support and its update path at the same time, and the
 * only symptom is that neither ever works — which nobody reports, because
 * nothing appears to be wrong.
 *
 * ## And why it can be dismissed
 *
 * Reloading discards whatever is in an unsaved form, and this toast can appear
 * in the middle of building a rota. Until 2026-09-04 the only ways out were to
 * reload or to navigate away, and it carried no `role`, so a screen-reader user
 * was never told it was there at all (WCAG 2.2 AA 4.1.3). Dismissing hides it
 * for this session only: the hourly poll keeps running and the waiting worker
 * stays waiting, so the next reload still lands on the new build. "Not now" is
 * not "never".
 */

/** One hour. Long enough to be free, short enough to catch a same-day deploy. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export function UpdatePrompt(): JSX.Element | null {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => () => updateSW(true));
        setNeedRefresh(true);
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        interval = setInterval(() => {
          void registration.update();
        }, UPDATE_CHECK_INTERVAL_MS);
      },
      onRegisterError(err) {
        reportError(err, { area: 'pwa:register' });
      },
    });

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md animate-fade-up motion-reduce:animate-none items-center justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
    >
      <p className="text-sm text-content dark:text-content-dark">
        A new version is available.
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={() => void update?.()}>
          Reload
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg p-2 text-content-muted hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark"
          aria-label="Dismiss the update notice"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
