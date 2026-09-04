import { useEffect, useState } from 'react';
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
 */

/** One hour. Long enough to be free, short enough to catch a same-day deploy. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export function UpdatePrompt(): JSX.Element | null {
  const [needRefresh, setNeedRefresh] = useState(false);
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

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md animate-fade-up motion-reduce:animate-none items-center justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark">
      <p className="text-sm text-content dark:text-content-dark">
        A new version is available.
      </p>
      <Button size="sm" onClick={() => void update?.()}>
        Reload
      </Button>
    </div>
  );
}
